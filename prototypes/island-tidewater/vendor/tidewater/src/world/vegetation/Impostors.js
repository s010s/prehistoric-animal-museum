import * as THREE from '../../engine/index.js';
import { Texture } from '../../engine/gpu/Texture.js';
import { generateMipmaps } from '../../engine/gpu/Mipmaps.js';
import { Material } from '../../engine/render/Material.js';
import { MeshRenderer } from '../../engine/render/MeshRenderer.js';
import { createViewUniforms, setFrameCamera } from '../../engine/render/Frame.js';
import { vegModule, f } from './VegNodes.js';
import { canopyModule } from './VegMaterials.js';

// Octahedral impostors for the broadleaf trees and shrubs.
//
// At startup (first update) every plant variant is rendered from N x N directions
// on the upper hemisphere (hemi-octahedral layout) into two atlases:
//   A: leaf brightness structure, leaf (1) / bark (0) flag, per-card colour random, coverage
//   B: plant-local normal * 0.5 + 0.5, exposure (ambient occlusion)
// Colours are applied at runtime with the same species palette as the near geometry, and the
// variants use the same lobe tables, so the far plants keep the near plants' crowns.
// At runtime each plant is one camera-facing quad; the fragment shader picks the three frames
// around the view direction (barycentric blend) and re-projects the view ray onto each frame's
// plane (exact for any view direction, non-uniform instance scale included).

export const OCT_N = 6; // frames per side
const BLEND_DIST = 100; // m: three-frame blending within, nearest frame beyond
const THIN = [ 140, 320 ]; // m: distance range over which the forest is thinned
const THIN_FRACTION = 0.5; // share of the crowns removed at the far end
const SHRUB_MAX = 180; // m: shrub impostors are dropped beyond (too small to matter)
const FRAME_PX = 128;

// hemi-octahedral decode: (u, v) in [-1, 1]^2 -> unit direction with y >= 0
export function octDecode( u, v, out = new THREE.Vector3() ) {

	const x = ( u - v ) * 0.5, z = ( u + v ) * 0.5;
	return out.set( x, 1 - Math.abs( x ) - Math.abs( z ), z ).normalize();

}

export function frameBasis( d ) {

	const right = new THREE.Vector3().crossVectors( new THREE.Vector3( 0, 1, 0 ), d );
	if ( right.lengthSq() < 1e-8 ) right.set( 1, 0, 0 );
	right.normalize();
	const up = new THREE.Vector3().crossVectors( d, right ).normalize();
	return { right, up };

}

// WGSL counterparts
const OCT_WGSL = /* wgsl */`
fn vegOctDecode( u: f32, v: f32 ) -> vec3f {
	let x = ( u - v ) * 0.5; let z = ( u + v ) * 0.5;
	return normalize( vec3f( x, 1.0 - abs( x ) - abs( z ), z ) );
}
fn vegOctEncode( d: vec3f ) -> vec2f {
	let p = d / ( abs( d.x ) + abs( d.y ) + abs( d.z ) );
	return vec2f( p.x + p.z, p.z - p.x );
}
`;

// Bakes and draws the impostors of a set of plant groups (group 0 trees, group 1 shrubs).
export class ImpostorAtlas {

	// groups: [ { variants: [ BufferGeometry ], center: Vector3 (on the plant axis), radius (frame
	// size), rh (horizontal radius), hv (half height) } ], bakeMaterials: { albedo, normal }
	constructor( groups, bakeMaterials ) {

		this.groups = groups;
		this.bakeMaterials = bakeMaterials;
		let v = 0;
		for ( const g of groups ) {

			g.variantBase = v;
			v += g.variants.length;

		}

		this.variantCount = v;
		const W = v * OCT_N * FRAME_PX, H = OCT_N * FRAME_PX;
		const make = ( name ) => {

			const texture = new Texture( { label: name, width: W, height: H, format: 'rgba8unorm', mips: true, usage: [ 'sample', 'render', 'copyDst', 'copySrc' ], sampler: 'linearClamp' } );
			return { texture, dispose: () => texture.destroy() };

		};

		this.rtA = make( 'vegImpostorA' );
		this.rtB = make( 'vegImpostorB' );
		this.depth = new Texture( { label: 'vegImpostorDepth', width: W, height: H, format: 'depth32float', usage: [ 'render' ] } );
		this.width = W;
		this.height = H;
		this.baked = false;

	}

	// frame transforms: local plant -> atlas plane (cell centre) for variant v, frame (i, j)
	_frameMatrices( g, vi ) {

		const mats = [];
		const R = g.radius, C = g.center;
		for ( let j = 0; j < OCT_N; j ++ ) for ( let i = 0; i < OCT_N; i ++ ) {

			const d = octDecode( - 1 + 2 * i / ( OCT_N - 1 ), - 1 + 2 * j / ( OCT_N - 1 ) );
			const { right, up } = frameBasis( d );
			const cx = ( ( g.variantBase + vi ) * OCT_N + i + 0.5 ) * 2 * R, cy = ( j + 0.5 ) * 2 * R;
			const m = new THREE.Matrix4().set(
				right.x, right.y, right.z, - C.dot( right ) + cx,
				up.x, up.y, up.z, - C.dot( up ) + cy,
				d.x, d.y, d.z, - C.dot( d ),
				0, 0, 0, 1 );
			mats.push( m );

		}

		return mats;

	}

	// Records the bake into the frame encoder (renderer: optional MeshRenderer; a private one is
	// used otherwise). Every group has its own orthographic view block (one buffer value per submit).
	bake( renderer = null ) {

		const t0 = performance.now();
		const mr = renderer && renderer.render && renderer.collect ? renderer : ( this._mr || ( this._mr = new MeshRenderer() ) );
		const depthView = this.depth.view();
		let first = true;

		for ( const [ rt, mat ] of [ [ this.rtA, this.bakeMaterials.albedo ], [ this.rtB, this.bakeMaterials.normal ] ] ) {

			first = true;
			const colorView = rt.texture.view( { dimension: '2d', baseMipLevel: 0, mipLevelCount: 1 } );
			this.groups.forEach( ( g, gi ) => {

				// the atlas plane is one orthographic view: every cell of this group is 2R wide
				const R = g.radius;
				const cam = new THREE.OrthographicCamera( 0, this.variantCount * OCT_N * 2 * R, OCT_N * 2 * R, 0, 0.1, 6 * R + 10 );
				cam.position.set( 0, 0, 3 * R + 2 );
				cam.lookAt( 0, 0, - 1 );
				cam.updateMatrixWorld();
				cam.updateProjectionMatrix();
				const block = ( this._blocks || ( this._blocks = [] ) )[ gi ] || ( this._blocks[ gi ] = createViewUniforms( 'vegImpostorBake' + gi ) );
				setFrameCamera( cam, this.width, this.height, { block } );
				const scene = new THREE.Scene();
				g.variants.forEach( ( geo, vi ) => {

					const mats = this._frameMatrices( g, vi );
					const mesh = new THREE.InstancedMesh( geo, mat, mats.length );
					mats.forEach( ( m, k ) => mesh.setMatrixAt( k, m ) );
					mesh.frustumCulled = false;
					scene.add( mesh );

				} );
				scene.updateMatrixWorld( true );
				mr.render( scene, {
					camera: cam, frameBlock: block, kind: 'color', label: 'veg impostor bake',
					colorViews: [ colorView ], colorFormats: [ 'rgba8unorm' ], depthView, depthFormat: 'depth32float',
					clearColors: [ first ? [ 0, 0, 0, 0 ] : null ], clearDepth: 0,
				} );
				first = false;

			} );
			generateMipmaps( rt.texture );

		}

		this.baked = true;
		this.bakeMs = performance.now() - t0;

	}

	// Runtime material. The callbacks return WGSL expressions (strings):
	// isGroup1( iDat ): bool (per instance) selecting group 1 (shrubs) over group 0 (trees);
	// variantOf( seed, isGroup1 ): variant index within the group;
	// colorOf( { seed, cr, leaf, bright, isGroup1 } ): linear albedo;
	// nearDist( isGroup1 ): the near plants' hand-over distance.
	createMaterial( { isGroup1, variantOf, colorOf, nearDist } ) {

		const [ g0, g1 ] = this.groups;
		const cells = this.variantCount * OCT_N;
		const sel = ( a, b ) => `select( ${ f( a ) }, ${ f( b ) }, g1Flag )`;
		const common = /* wgsl */`
	let g1Flag = ${ isGroup1( 'iDat' ) };
	let R = ${ sel( g0.radius, g1.radius ) };
	let Rh = ${ sel( g0.rh, g1.rh ) };
	let Hv = ${ sel( g0.hv, g1.hv ) };
	let Cy = ${ sel( g0.center.y, g1.center.y ) };
	let vBase = ${ sel( g0.variantBase, g1.variantBase ) };`;

		const mat = new Material( {
			name: 'veg-impostor',
			side: 'double',
			modules: [ vegModule, canopyModule ],
			textures: { vegImpA: this.rtA.texture, vegImpB: this.rtB.texture },
			attributes: { iPos: 'vec4f', iDat: 'vec4f' },
			// crown sway offset (xyz) and the effective scale (w) for the fragment stage
			varyings: { vImp: 'vec4f', vIPos4: 'vec4f', vIDat: 'vec4f' },
			// ---- vertex: camera-facing quad around the plant centre, swaying with the wind
			vertex: /* wgsl */`
	let iPos = v.iPos;
	let iDat = v.iDat;
${ common }
	let base = iPos.xyz;
	let sy = abs( iDat.y );
	// LOD window: from the near plant's hand-over distance to the fade-out, else collapsed
	let d = length( vegParams.camPos - base );
	let vis = select( 0.0, 1.0, d >= ( ${ nearDist( 'g1Flag' ) } ) * ( 1.0 - VEG_LOD_BAND / 2.0 ) && d < select( draw.params.w, ${ f( SHRUB_MAX ) }, g1Flag ) );
	// far away the forest is thinned out: fewer, proportionally larger crowns (grown about
	// the base) keep the canopy closed
	let thin = smoothstep( ${ f( THIN[ 0 ] ) }, ${ f( THIN[ 1 ] ) }, d );
	let keep = select( 1.0, 0.0, fract( iDat.w * 91.7 ) < thin * ${ f( THIN_FRACTION ) } );
	let grow = thin * ${ f( 1 / Math.sqrt( 1 - THIN_FRACTION ) - 1 ) } + 1.0;
	let s = iPos.w * grow;
	let C = base + vec3f( 0.0, Cy * s * sy, 0.0 );
	// sway of the whole crown (matches the near plants' trunk sway amplitude)
	let w = vegWindStrength();
	let g = vegGustAt( base.xz );
	let ph0 = iDat.w * 6.2832;
	let sway = ( w * w * 0.009 * ( g * 0.8 + 0.3 ) + sin( frame.time * 0.9 + ph0 ) * w * 0.0045 * ( g + 0.4 ) ) * iDat.z * 0.45;
	let swayV = vegWindDir3() * sway;
	let Cs = C + swayV;
	o.vImp = vec4f( swayV, s );
	o.vIPos4 = iPos;
	o.vIDat = iDat;
	let toCam = normalize( frame.cameraPos - Cs );
	let right = normalize( cross( VEG_UP, toCam ) + vec3f( 1e-4, 0.0, 0.0 ) );
	let up = cross( toCam, right );
	// quad fitted to the plant's projected extent: its horizontal radius across, from above
	// the crown disc, from the side the (stretched) height
	let k = s * vis * keep;
	let ty = abs( toCam.y );
	let halfW = Rh * k;
	let halfH = ( Hv * sy * sqrt( max( 1.0 - ty * ty, 0.0 ) ) + Rh * ty ) * k;
	let p = v.position;
	v.useWorld = true;
	v.worldPos = Cs + right * ( p.x * halfW ) + up * ( p.y * halfH );
	// (three: the geometry normal is left as is, +Z of the quad)
	v.worldNormal = v.normal;`,
			// ---- fragment: frame selection + re-projection
			surface: /* wgsl */`
	let iPos = in.vs.vIPos4;
	let iDat = in.vs.vIDat;
${ common }
	let base = iPos.xyz;
	let si = in.vs.vImp.w;
	let sy = abs( iDat.y );
	let yaw = iDat.x;
	let cyw = cos( yaw ); let syw = sin( yaw );
	let C = base + vec3f( 0.0, Cy * si * sy, 0.0 ) + in.vs.vImp.xyz;
	// world -> plant-local (unstretched, centred): rotate by -yaw, divide by the scale
	let Ow = frame.cameraPos - C;
	let Dw = in.P - frame.cameraPos;
	let scl = vec3f( si, si * sy, si );
	let O = vec3f( Ow.x * cyw - Ow.z * syw, Ow.y, Ow.x * syw + Ow.z * cyw ) / scl;
	let D = vec3f( Dw.x * cyw - Dw.z * syw, Dw.y, Dw.x * syw + Dw.z * cyw ) / scl;
	let vdir = normalize( O );
	let vd = normalize( vec3f( vdir.x, max( vdir.y, 0.02 ), vdir.z ) );
	let gg = ( vegOctEncode( vd ) * 0.5 + 0.5 ) * ${ f( OCT_N - 1 ) };
	let gi = floor( clamp( gg, vec2f( 0.0 ), vec2f( ${ f( OCT_N - 1.001 ) } ) ) );
	let fr = gg - gi;
	let upper = fr.x + fr.y > 1.0;
	// triangle of the cell containing g, barycentric weights
	let i0 = select( gi, gi + 1.0, upper );
	let i1 = select( gi + vec2f( 1.0, 0.0 ), gi + vec2f( 0.0, 1.0 ), upper );
	let i2 = select( gi + vec2f( 0.0, 1.0 ), gi + vec2f( 1.0, 0.0 ), upper );
	let w0 = select( 1.0 - fr.x - fr.y, fr.x + fr.y - 1.0, upper );
	let w1 = select( fr.x, 1.0 - fr.x, upper );
	let w2 = select( fr.y, 1.0 - fr.y, upper );
	let variant = vBase + ${ variantOf( 'iDat.w', 'g1Flag' ) };
	var vA = vec4f( 0.0 ); var vB = vec4f( 0.0 );
	// near: blend the three frames around the view direction; far: the dominant frame only
	let blend = length( vegParams.camPos - base ) < ${ f( BLEND_DIST ) };
	if ( blend ) {
		let s0 = vegImpSample( i0, O, D, variant, R );
		let s1 = vegImpSample( i1, O, D, variant, R );
		let s2 = vegImpSample( i2, O, D, variant, R );
		vA = s0[ 0 ] * w0 + s1[ 0 ] * w1 + s2[ 0 ] * w2;
		vB = s0[ 1 ] * w0 + s1[ 1 ] * w1 + s2[ 1 ] * w2;
	} else {
		let iMax = select( select( i2, i1, w1 >= w2 ), i0, w0 >= max( w1, w2 ) );
		let sm = vegImpSample( iMax, O, D, variant, R );
		vA = sm[ 0 ];
		vB = sm[ 1 ];
	}
	// cross-fade from the near geometry (incoming level of the band around nearDist)
	let nd = ${ nearDist( 'g1Flag' ) };
	let fade = smoothstep( nd * ( 1.0 - VEG_LOD_BAND / 2.0 ), nd * ( 1.0 + VEG_LOD_BAND / 2.0 ), length( vegParams.camPos - base ) );
	if ( ! ( vA.w > 0.42 && bayer4( in.pixel ) < fade ) ) { discard; }

	let cov = max( vA.w, 1e-3 );
	let bright = vA.x / cov; let leaf = vA.y / cov; let cr = vA.z / cov;
	// exposure (baked crown AO): the inside and underside of the crown in deep shade
	let ex = vB.w / cov;
	let albedo = ${ colorOf( { seed: 'iDat.w', cr: 'cr', leaf: 'leaf', bright: 'bright', isGroup1: 'g1Flag' } ) } * mix( 0.26, 1.0, ex * ex ) * ( bright * 0.6 + 0.7 );
	s.albedo = albedo;
	// B is written where A has coverage: un-premultiply the filtered edges by A's coverage
	let nl = vB.xyz / max( vA.w, 1e-3 ) * 2.0 - 1.0;
	// local -> world: inverse-transpose of the stretch, then the yaw rotation
	let ns = vec3f( nl.x, nl.y / sy, nl.z );
	let nw = normalize( vec3f( ns.x * cyw + ns.z * syw, ns.y, ns.z * cyw - ns.x * syw ) );
	s.normal = normalize( nw + in.V * 0.12 );
	s.roughness = 0.85;
	s.metalness = 0.0;
	s.specularIntensity = 0.12;
	// backlit crowns glow at the edges (light through the leaves), like the near canopy
	s.translucency = vegTranslucency( albedo, in.N, 0.35, in.P );`,
		} );

		// frame sampler: the frame's direction, the view ray re-projected on its plane
		mat.modules.push( new ( vegModule.constructor )( {
			name: 'vegImpostorSample',
			deps: [ vegModule ],
			code: OCT_WGSL + /* wgsl */`
fn vegImpSample( ij: vec2f, O: vec3f, D: vec3f, variant: f32, Rf: f32 ) -> array<vec4f, 2> {
	let d = vegOctDecode( ij.x / ${ f( OCT_N - 1 ) } * 2.0 - 1.0, ij.y / ${ f( OCT_N - 1 ) } * 2.0 - 1.0 );
	let right = normalize( cross( VEG_UP, d ) );
	let up = cross( d, right );
	let t = - dot( O, d ) / dot( D, d );
	let P = O + D * t;
	let a = dot( P, right ) / Rf; let b = dot( P, up ) / Rf;
	let cu = variant * ${ f( OCT_N ) } + ij.x + ( a * 0.5 + 0.5 );
	let cv = ij.y + ( b * 0.5 + 0.5 );
	let inCell = abs( a ) < 1.0 && abs( b ) < 1.0;
	// render targets are stored top row first: flip v
	let st = vec2f( cu / ${ f( cells ) }, 1.0 - cv / ${ f( OCT_N ) } );
	let k = select( 0.0, 1.0, inCell );
	return array<vec4f, 2>( textureSample( vegImpA, smpLinearClamp, st ) * k, textureSample( vegImpB, smpLinearClamp, st ) * k );
}
`,
		} ) );
		return mat;

	}

}

// Quad geometry for the impostor instances (corners at +-1)
export function buildImpostorQuad() {

	const g = new THREE.BufferGeometry();
	g.setAttribute( 'position', new THREE.Float32BufferAttribute( [ - 1, - 1, 0, 1, - 1, 0, 1, 1, 0, - 1, 1, 0 ], 3 ) );
	g.setAttribute( 'normal', new THREE.Float32BufferAttribute( [ 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1 ], 3 ) );
	g.setIndex( [ 0, 1, 2, 0, 2, 3 ] );
	g.boundingSphere = new THREE.Sphere( new THREE.Vector3(), 1e7 );
	return g;

}
