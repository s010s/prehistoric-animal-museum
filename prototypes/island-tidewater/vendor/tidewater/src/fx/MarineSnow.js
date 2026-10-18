import { Vector2, Vector3, PlaneGeometry, InstancedBufferGeometry, Mesh } from '../engine/index.js';
import { UniformBlock, ShaderModule, Material } from '../engine/webgpu.js';
import { LAYERS } from '../core/SceneRenderer.js';

// Suspended particles in the water around the camera (marine snow, plankton, sand grains).
// Positions are procedural (hash of the instance) inside a box that wraps around the camera, so
// there is no simulation and no CPU work. The particles drift with a slow current and sway back
// and forth with the orbital motion of the passing swell (longest FFT cascades, decaying with
// depth). Only drawn while the view can be under water, and only below the surface (when the
// waterline crosses the lens, none float in the air half). The specks are tiny depth-writing discs
// in the opaque pass, so the underwater fog treats each one at its own distance (TAA smooths the
// edges).
//
// Consumes: fft.module (oceanDisplacement: texture_2d_array, cascade sizes ocean.sizes[ c ].x),
// query.module (waterQueryHeightAtXZ( xz ) -> f32, optional), and the diver's torch of LocalLights
// (materials/LocalLights.js FLASH handles: on, pos, dir, col, cone). Port note: the torch values
// live in this material's own `SnowFlash` block whose `{ value }` handles are linked to FLASH by
// setFlash( FLASH ) (done automatically once materials/LocalLights.js loads; the spot profile is
// the same formula as LocalLights' spotProfile, localLightsSpotProfile in WGSL).
export class MarineSnow {

	constructor( { fft, query = null, count = 12000, box = 8 } ) {

		this.fft = fft;
		this.box = box;

		const geo = new PlaneGeometry( 1, 1 );
		const inst = new InstancedBufferGeometry();
		inst.index = geo.index;
		inst.setAttribute( 'position', geo.getAttribute( 'position' ) );
		inst.setAttribute( 'uv', geo.getAttribute( 'uv' ) );
		inst.instanceCount = count;

		// the torch (linked to LocalLights' FLASH by setFlash)
		this.flashBlock = new UniformBlock( 'SnowFlash', {
			pos: [ 'vec3f', new Vector3() ],
			on: [ 'f32', 0 ],
			dir: [ 'vec3f', new Vector3( 0, 0, - 1 ) ],
			col: [ 'vec3f', new Vector3() ], // rgb x intensity
			cone: [ 'vec2f', new Vector2( 0.99, 0.82 ) ], // cos inner, cos outer
		}, { label: 'snow flash' } );
		const flashModule = new ShaderModule( {
			name: 'snowFlash',
			uniforms: this.flashBlock,
			uniformName: 'snowFlash',
			code: /* wgsl */`
// spot profile shared by the shading, the beam and the snow: hot centre, soft edge, faint spill
// (LocalLights spotProfile)
fn snowSpotProfile( cd: f32, cosInner: f32, cosOuter: f32 ) -> f32 {
	let m = smoothstep( cosOuter, cosInner, cd );
	return max( m * m, smoothstep( cosOuter - 0.55, cosOuter, cd ) * 0.05 );
}
`,
		} );

		// orbital sway from the passing swell: the two longest cascades
		let sway = '';
		for ( let c = 0; c < Math.min( 2, fft.cascades ?? 2 ); c ++ ) {

			// (cascade size L from the ocean uniforms, so setCascadeSizes() is followed)
			sway += `\tsway += textureSampleLevel( oceanDisplacement, smpLinearRepeat, p.xz / ocean.sizes[ ${ c } ].x, ${ c }, 3.0 ).xyz * exp( depth * ( - TWO_PI / ocean.sizes[ ${ c } ].x ) );\n`;

		}

		const modules = [ fft.module, flashModule ];
		if ( query && query.module ) modules.push( query.module );

		const mat = new Material( {
			name: 'MarineSnow',
			lit: false,
			modules,
			uniforms: {
				camPos: [ 'vec3f', new Vector3() ],
				snowOpacity: [ 'f32', 1 ],
				box: [ 'f32', box ],
			},
			varyings: { vFade: 'f32', vDepth: 'f32', vTorch: 'vec3f' },
			vertex: /* wgsl */`
	let id = f32( v.instance );
	let h = snowHash3( id * 0.7131 );
	let h2 = snowHash3( id * 1.3917 + 5.1 );
	let B = mat.box;
	// slow current + sinking, wrapped into the camera box
	let drift = vec3f( 0.05, - 0.012, 0.03 ) * frame.time + ( h2 - 0.5 ) * ( frame.time * 0.02 );
	let local = ( fract( h + drift / B - mat.camPos / B ) - 0.5 ) * B;
	var p = mat.camPos + local;
	// orbital sway from the passing swell (decays ~exp(-k z) with depth)
	let depth = max( frame.seaLevel - p.y, 0.0 );
	var sway = vec3f( 0.0 );
${ sway }	p += vec3f( sway.x, sway.y * 0.5, sway.z ) * 0.8;

	// camera-facing quad, 3-8 mm (a few flecks larger)
	let size = mix( 0.003, 0.008, h2.x * h2.x ) + select( 0.0, 0.008, h2.y > 0.98 );
	let pv0 = frame.view * vec4f( p, 1.0 );
	// fade in the box edges and right in front of the lens (by shrinking)
	let dist = length( local );
	var fade = smoothstep( B * 0.5, B * 0.3, dist ) * smoothstep( 0.08, 0.3, - pv0.z );
${ query && query.module ? '\tfade *= smoothstep( 0.0, 0.04, waterQueryHeightAtXZ( p.xz ) - p.y );\n' : '' }	// (view-space offset: along the camera's right / up axes in world space)
	let right = vec3f( frame.view[ 0 ][ 0 ], frame.view[ 1 ][ 0 ], frame.view[ 2 ][ 0 ] );
	let up = vec3f( frame.view[ 0 ][ 1 ], frame.view[ 1 ][ 1 ], frame.view[ 2 ][ 1 ] );
	let q = v.position.xy * size * fade;
	o.vFade = fade;
	o.vDepth = depth;
	// flashlight on the speck (per vertex): the backscatter sparkle of a diver's torch; the
	// view leg is attenuated by the underwater composite
	let tv = p - snowFlash.pos;
	let tr2 = max( dot( tv, tv ), 1e-4 );
	let tr = sqrt( tr2 );
	let tspot = snowSpotProfile( dot( tv / tr, snowFlash.dir ), snowFlash.cone.x, snowFlash.cone.y );
	let sigT = frame.waterAbsorption + frame.waterScattering;
	o.vTorch = snowFlash.col * exp( - sigT * tr ) * ( tspot / ( tr2 + 0.15 ) * snowFlash.on * 0.35 );
	// nearly still in the world: camera-only motion vectors (no previous position)
	v.useWorld = true;
	v.worldPos = p + right * q.x + up * q.y;
	v.worldNormal = - normalize( vec3f( frame.view[ 0 ][ 2 ], frame.view[ 1 ][ 2 ], frame.view[ 2 ][ 2 ] ) );
`,
			surface: /* wgsl */`
	let r = length( in.uv - 0.5 ) * 2.0;
	if ( r > 1.0 || in.vs.vFade < 0.02 ) { discard; }
	// lit by the light that reaches this depth, slightly greenish-white (organic matter)
	let sigT = frame.waterAbsorption + frame.waterScattering;
	let light = ( frame.sunColor * 0.1 + frame.skyIrradiance * 1.2 ) * exp( - sigT * in.vs.vDepth );
	s.albedo = ( light + in.vs.vTorch ) * vec3f( 0.9, 1.0, 0.95 ) * mix( 1.3, 0.8, r ) * mat.snowOpacity;
	s.emissive = vec3f( 0.0 );
	s.alpha = 1.0;
`,
		} );
		// hash3 of the reference (sin-fract), in a tiny module of its own
		mat.modules.push( new ShaderModule( { name: 'snowHash', code: /* wgsl */`
fn snowHash3( n: f32 ) -> vec3f { return fract( sin( vec3f( n, n + 17.13, n + 43.71 ) ) * vec3f( 43758.5453, 22578.1459, 19642.3490 ) ); }
` } ) );

		this.material = mat;
		this.camPos = mat.uniforms.camPos;
		this.opacity = mat.uniforms.snowOpacity;

		this.mesh = new Mesh( inst, mat );
		this.mesh.frustumCulled = false;
		this.mesh.castShadow = false;
		this.mesh.layers.set( LAYERS.OPAQUE );
		this.mesh.visible = false;

		// the torch of LocalLights (once that module is ported; harmless if it isn't)
		import( '../materials/LocalLights.js' ).then( ( m ) => {

			if ( m.FLASH ) this.setFlash( m.FLASH );

		} ).catch( () => {} );

	}

	// link the torch uniforms to LocalLights' FLASH handles ({ on, pos, dir, col, cone } with .value)
	setFlash( flash ) {

		const F = this.flashBlock.fields;
		for ( const k of [ 'on', 'pos', 'dir', 'col', 'cone' ] ) if ( flash[ k ] && 'value' in flash[ k ] ) F[ k ] = flash[ k ];

	}

	update( camera, underwater ) {

		this.mesh.visible = underwater;
		if ( underwater ) this.camPos.value.copy( camera.position );

	}

}
