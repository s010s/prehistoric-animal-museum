import {
	BufferGeometry, Float32BufferAttribute, Uint32BufferAttribute, Matrix4, Matrix3, Vector3, Quaternion, Euler,
	CylinderGeometry, TorusGeometry, SphereGeometry, LatheGeometry, Vector2,
} from '../engine/index.js';
import { Texture } from '../engine/gpu/Texture.js';
import { generateMipmaps } from '../engine/gpu/Mipmaps.js';
import { commonModule } from '../engine/render/wgsl/common.js';
import { ShaderModule } from '../engine/gpu/Shader.js';
import { decodeImage } from '../engine/loaders/GLTF.js';
import { standard } from '../materials/Materials.js';

// Shared kit for the vendor stalls (FishStand, Chandlery): photoscanned CC0 surfaces and props from
// Poly Haven (public/models/props, built by tools/props/build.mjs; credits in CREDITS.md) plus a
// few procedural pieces, all merged into ONE mesh per stall with ONE material:
//
//   per vertex: uv, color (tint / plain colour), aLayer (what it is), aUV2 (a second uv or params)
//   aLayer  0..3   tiling surface (texture array, 1K): 0 weathered wall planks (boards along u),
//                  1 dark nailed planks (boards along v), 2 corrugated iron (ribs along v), 3 painted timber
//           100+i  scanned prop texture set i (texture array, 512 px), uv = the model's own uvs
//           -1 crushed ice, -2 hand-painted sign (painted timber + the sign atlas at aUV2),
//           -3 chalkboard (slate + chalk from the atlas at aUV2), -4 plain (color, aUV2 = roughness,
//           metalness), -5 rope (color, uv = ( metres along, around )), -6 weathered painted float,
//           -7 enamel scale dial (atlas at aUV2)
// Textures are loaded once (loadStallAssets) and shared by both stalls.

export const LAYER = { WALL: 0, DECK: 1, TIN: 2, PAINTED: 3, PROP: 100, ICE: - 1, SIGN: - 2, CHALK: - 3, PLAIN: - 4, ROPE: - 5, FLOAT: - 6, DIAL: - 7 };
// metres covered by one repeat of each surface texture, and which uv axis the boards / ribs follow
const SURF = [
	{ name: 'weathered_brown_planks', size: 1.8, grain: 'u' },
	{ name: 'weathered_planks', size: 2.0, grain: 'v' },
	{ name: 'worn_corrugated_iron', size: 1.8, grain: 'v' },
	{ name: 'weathered_peeling_timber', size: 1.1, grain: 'v' },
];
// sign atlas (signs.png, 2048 x 1024) regions in uv: [ u0, v0, u1, v1 ]
export const ATLAS = {
	joe: [ 0.0, 0.0, 1.0, 0.25 ],
	marta: [ 0.0, 0.25, 0.72, 0.5 ],
	prices: [ 0.0, 0.5, 0.5, 1.0 ],
	dial: [ 0.75, 0.5, 1.0, 1.0 ],
};
// corrugation measured from the iron's normal map: 16 ribs per 1.8 m tile, height phase 1.029 rad
const RIBS = 16, RIB_PHASE = 1.029, RIB_AMP = 0.011;

const BASE = ( ( import.meta.env && import.meta.env.BASE_URL ) || '/' ) + 'models/props/';

async function bytes( url ) {

	if ( globalThis.__assetFile ) return globalThis.__assetFile( url );
	const res = await fetch( url );
	if ( ! res.ok ) throw new Error( 'StallKit: ' + url + ' ' + res.status );
	return res.arrayBuffer();

}

async function pixels( url ) {

	return decodeImage( new Uint8Array( await bytes( url ) ), url.endsWith( '.png' ) ? 'image/png' : 'image/jpeg' );

}

// one texture array from same-sized images
function arrayTexture( label, imgs, srgb ) {

	const w = imgs[ 0 ].width, h = imgs[ 0 ].height;
	const data = new Uint8Array( w * h * 4 * imgs.length );
	imgs.forEach( ( im, i ) => {

		if ( im.width !== w || im.height !== h ) throw new Error( 'StallKit: ' + label + ' layer ' + i + ' is ' + im.width + 'x' + im.height );
		data.set( im.data, w * h * 4 * i );

	} );
	const tex = new Texture( { label, width: w, height: h, depth: imgs.length, dimension: '2d-array', format: srgb ? 'rgba8unorm-srgb' : 'rgba8unorm', mips: true, usage: [ 'sample', 'copyDst' ], data } );
	tex.getGPU();
	generateMipmaps( tex );
	return tex;

}

let _assets = null;
export function loadStallAssets() {

	return _assets || ( _assets = _load() );

}

async function _load() {

	const t0 = performance.now();
	const info = JSON.parse( new TextDecoder().decode( await bytes( BASE + 'props.json' ) ) );
	const bin = await bytes( BASE + 'props.bin' );
	const verts = new Float32Array( bin, 0, info.vertexCount * info.vertexFloats );
	const index = new Uint32Array( bin, info.indexByteOffset, info.indexCount );
	const set = ( names, prefix ) => Promise.all( [ 'a', 'n', 'r' ].map( ( m ) => Promise.all( names.map( ( n ) => pixels( BASE + prefix + n + '_' + m + '.jpg' ) ) ) ) );
	const [ surf, prop, signs ] = await Promise.all( [ set( SURF.map( ( s ) => s.name ), 's_' ), set( info.layers, 'p_' ), pixels( BASE + 'signs.png' ) ] );
	const assets = {
		info, verts, index,
		surf: { a: arrayTexture( 'stallSurfA', surf[ 0 ], true ), n: arrayTexture( 'stallSurfN', surf[ 1 ], false ), r: arrayTexture( 'stallSurfR', surf[ 2 ], false ) },
		prop: { a: arrayTexture( 'stallPropA', prop[ 0 ], true ), n: arrayTexture( 'stallPropN', prop[ 1 ], false ), r: arrayTexture( 'stallPropR', prop[ 2 ], false ) },
		signs: arrayTexture( 'stallSigns', [ signs ], true ),
	};
	assets.material = createStallMaterial( assets );
	assets.loadMs = performance.now() - t0;
	return assets;

}

// ---------------------------------------------------------------- material

const kitModule = new ShaderModule( {
	name: 'stallKit',
	deps: [ commonModule ],
	code: /* wgsl */`
fn skHash( p: vec3f ) -> f32 { return fract( sin( dot( p, vec3f( 127.1, 311.7, 74.7 ) ) ) * 43758.5453 ); }
fn skNoise( p: vec3f ) -> f32 {
	let i = floor( p ); let f = fract( p ); let u = f * f * ( 3.0 - 2.0 * f );
	let a = mix( mix( skHash( i ), skHash( i + vec3f( 1, 0, 0 ) ), u.x ), mix( skHash( i + vec3f( 0, 1, 0 ) ), skHash( i + vec3f( 1, 1, 0 ) ), u.x ), u.y );
	let b = mix( mix( skHash( i + vec3f( 0, 0, 1 ) ), skHash( i + vec3f( 1, 0, 1 ) ), u.x ), mix( skHash( i + vec3f( 0, 1, 1 ) ), skHash( i + vec3f( 1, 1, 1 ) ), u.x ), u.y );
	return mix( a, b, u.z );
}
fn skFbm( p: vec3f ) -> f32 { return skNoise( p ) * 0.55 + skNoise( p * 2.13 + 7.1 ) * 0.3 + skNoise( p * 4.7 + 3.3 ) * 0.15; }
// 2D cellular noise: ( distance to the nearest feature, to the second nearest )
fn skCells( p: vec2f ) -> vec2f {
	let i = floor( p ); let f = fract( p );
	var d1 = 8.0; var d2 = 8.0;
	for ( var y = -1; y <= 1; y++ ) {
		for ( var x = -1; x <= 1; x++ ) {
			let g = vec2f( f32( x ), f32( y ) );
			let h = vec2f( skHash( vec3f( i + g, 1.7 ) ), skHash( vec3f( i + g, 9.3 ) ) );
			let d = length( g + h - f );
			if ( d < d1 ) { d2 = d1; d1 = d; } else if ( d < d2 ) { d2 = d; }
		}
	}
	return vec2f( d1, d2 );
}
// perturbed normal from a scalar height (screen-space derivatives)
fn skBump( P: vec3f, N: vec3f, h: f32 ) -> vec3f {
	let dPdx = dpdx( P ); let dPdy = dpdy( P );
	let r1 = cross( dPdy, N ); let r2 = cross( N, dPdx );
	let det = dot( dPdx, r1 );
	let grad = sign( det ) * ( dpdx( h ) * r1 + dpdy( h ) * r2 );
	return normalize( abs( det ) * N - grad + N * 1e-12 );
}
`,
} );

export function createStallMaterial( assets ) {

	const m = standard( {
		vertexColors: true,
		modules: [ kitModule ],
		attributes: { aLayer: 'f32', aUV2: 'vec2f' },
		varyings: { vLayer: 'f32', vUV2: 'vec2f' },
		textures: {
			skSurfA: assets.surf.a, skSurfN: assets.surf.n, skSurfR: assets.surf.r,
			skPropA: assets.prop.a, skPropN: assets.prop.n, skPropR: assets.prop.r,
			skSigns: assets.signs,
		},
		vertex: /* wgsl */`
	o.vLayer = v.aLayer;
	o.vUV2 = v.aUV2;
`,
	} );
	m.name = 'stall';
	m.setDefine( 'CLEARCOAT', 1 ); // the ice and the enamel dial
	m.surface = /* wgsl */`
	let L = round( in.vs.vLayer );
	let uv = in.uv;
	let uv2 = in.vs.vUV2;
	let P = in.P;
	let N0 = s.normal;
	// tangent frame from derivatives (uniform control flow): OpenGL normal maps, image v runs down
	let dp1 = dpdx( P ); let dp2 = dpdy( P ); let duv1 = dpdx( uv ); let duv2 = dpdy( uv );
	let dp2perp = cross( dp2, N0 ); let dp1perp = cross( N0, dp1 );
	let Tt = dp2perp * duv1.x + dp1perp * duv2.x;
	let Bt = dp2perp * duv1.y + dp1perp * duv2.y;
	let tInv = inverseSqrt( max( max( dot( Tt, Tt ), dot( Bt, Bt ) ), 1e-24 ) );
	let TBN = mat3x3f( Tt * tInv, - Bt * tInv, N0 );
	let g2x = dpdx( uv2 ); let g2y = dpdy( uv2 );
	let tint = in.color.rgb;
	var alb = tint;
	var rough = 0.8;
	var metal = 0.0;
	var ao = 1.0;
	var nrm = N0;
	if ( L > -0.5 ) {
		// scanned texture set: a prop (512 px) or a tiling surface (1K)
		var a: vec4f; var n: vec4f; var r: vec4f;
		if ( L > 99.5 ) {
			let li = i32( L - 100.0 );
			a = textureSampleGrad( skPropA, smpAnisoRepeat, uv, li, duv1, duv2 );
			n = textureSampleGrad( skPropN, smpAnisoRepeat, uv, li, duv1, duv2 );
			r = textureSampleGrad( skPropR, smpAnisoRepeat, uv, li, duv1, duv2 );
		} else {
			let li = i32( L );
			a = textureSampleGrad( skSurfA, smpAnisoRepeat, uv, li, duv1, duv2 );
			n = textureSampleGrad( skSurfN, smpAnisoRepeat, uv, li, duv1, duv2 );
			r = textureSampleGrad( skSurfR, smpAnisoRepeat, uv, li, duv1, duv2 );
		}
		// the corrugated sheets are corrugated in the geometry too: keep only a little of the ribs
		let strength = select( 1.0, 0.35, abs( L - 2.0 ) < 0.5 );
		var tn = n.xyz * 2.0 - 1.0;
		tn = vec3f( tn.xy * strength, max( tn.z, 0.05 ) );
		nrm = normalize( TBN * tn );
		alb = a.rgb * tint;
		ao = r.r; rough = r.g; metal = r.b;
		// the lantern's glass (prop layer 7: wooden_lantern_01_1): sooty panes that glow warm from dusk,
		// as the village lanterns do (the stall's local light switches on over the same range, App)
		if ( abs( L - 107.0 ) < 0.5 ) {
			let lum = dot( a.rgb, vec3f( 0.3, 0.55, 0.15 ) );
			let pane = smoothstep( 0.32, 0.16, lum ); // the dark panes, not the frame rims
			let nightOn = smoothstep( 0.15, 0.75, frame.night );
			let flicker = sin( frame.time * 9.0 + P.x * 40.0 ) * sin( frame.time * 5.3 + P.z * 13.0 ) * 0.12 + 0.9;
			// lit from inside: the flame shows through the soot, brighter in the middle of each pane
			// (the soot and smudges on the glass hold part of it back: a warm, uneven glow, not a light box)
			let soot = mix( 1.0, 0.35, smoothstep( 0.05, 0.22, lum ) );
			// the flame sits ~19 cm up in the middle: a hot core behind the glass, dim toward the frame
			let q = ( uv2 - vec2f( 0.0, 0.19 ) ) / vec2f( 0.05, 0.075 );
			let core = exp( - dot( q, q ) );
			let glow = vec3f( 1.0, 0.5, 0.18 ) * 0.35 + vec3f( 1.0, 0.72, 0.4 ) * 3.0 * core;
			s.emissive = glow * flicker * nightOn * pane * soot;
			// clean glass over the soot: glossy, a little lighter than the scan by day
			alb = mix( alb, alb * 1.6 + 0.02, pane );
			rough = mix( rough, 0.12, pane );
			metal = 0.0;
		}
		// sun-bleached and salty on the upward faces of the stall timber
		if ( L < 1.5 ) {
			let up = smoothstep( 0.3, 0.95, N0.y );
			let lum = dot( alb, vec3f( 0.3, 0.55, 0.15 ) );
			alb = mix( alb, vec3f( lum * 1.25 ), 0.28 * up + 0.12 );
			rough = clamp( rough + 0.06, 0.0, 1.0 );
		}
	} else if ( L > -1.5 ) {
		// crushed ice: packed chunks with glassy facets, clear meltwater in the gaps
		let c = skCells( P.xz * 34.0 + vec2f( P.y * 11.0 ) );
		let chunk = smoothstep( 0.0, 0.55, c.y - c.x );
		let frost = skFbm( P * 90.0 );
		let hgt = chunk * 0.004 + frost * 0.0008;
		nrm = skBump( P, N0, hgt );
		alb = mix( vec3f( 0.52, 0.62, 0.66 ), vec3f( 0.86, 0.92, 0.95 ), chunk * 0.8 + frost * 0.2 );
		rough = mix( 0.03, 0.28, frost * chunk );
		s.translucency = vec3f( 0.25, 0.32, 0.35 ) * chunk;
		s.clearcoat = 1.0; s.clearcoatRoughness = 0.02;
	} else if ( L > -3.5 || ( L > -7.5 && L < -6.5 ) ) {
		// painted: a sign on peeling timber, a chalkboard, or the scale's enamel dial
		let paint = textureSampleGrad( skSigns, smpLinearClamp, uv2, 0, g2x, g2y );
		if ( L > -2.5 ) {
			let a = textureSampleGrad( skSurfA, smpAnisoRepeat, uv, 3, duv1, duv2 );
			let n = textureSampleGrad( skSurfN, smpAnisoRepeat, uv, 3, duv1, duv2 );
			let r = textureSampleGrad( skSurfR, smpAnisoRepeat, uv, 3, duv1, duv2 );
			// the board was painted over: a dark ground coat, the lettering, both chipped and sun-faded
			// chipped through where the old timber shows (its own peeling paint pattern) and at random
			let wear = skFbm( vec3f( uv2 * vec2f( 90.0, 45.0 ), 3.1 ) );
			let chips = smoothstep( 0.64, 0.74, wear + ( 0.45 - dot( a.rgb, vec3f( 0.33 ) ) ) * 0.35 );
			let ground = mix( vec3f( 0.03, 0.062, 0.068 ) * mix( 0.8, 1.15, wear ), a.rgb * tint, chips );
			let letters = paint.a * ( 1.0 - chips * 0.8 ) * mix( 0.78, 1.0, skNoise( vec3f( uv2 * 400.0, 0.0 ) ) );
			alb = mix( ground, paint.rgb * 0.82, letters );
			rough = mix( r.g, 0.62, ( 1.0 - chips ) * 0.8 );
			ao = r.r;
			var tn = n.xyz * 2.0 - 1.0;
			nrm = normalize( TBN * vec3f( tn.xy * mix( 1.0, 0.45, 1.0 - chips ), tn.z ) );
		} else if ( L > -3.5 ) {
			// slate with smeared chalk dust, the prices in chalk
			let dust = skFbm( vec3f( uv2 * vec2f( 18.0, 9.0 ), 0.0 ) );
			let chalk = paint.a * mix( 0.55, 1.0, skNoise( vec3f( uv2 * 900.0, 1.0 ) ) );
			alb = mix( vec3f( 0.028, 0.034, 0.031 ) + dust * 0.035, vec3f( 0.72, 0.72, 0.68 ), chalk );
			rough = 0.9;
		} else {
			// enamel dial face, a little crazed and yellowed
			let crazing = skNoise( vec3f( uv2 * 900.0, 2.0 ) );
			alb = mix( vec3f( 0.72, 0.68, 0.58 ), paint.rgb, paint.a ) * mix( 0.92, 1.0, crazing );
			rough = 0.22;
			s.clearcoat = 1.0; s.clearcoatRoughness = 0.06;
		}
	} else if ( L > -4.5 ) {
		// plain: colour, roughness and metalness from the vertex data; a little grime and pitting
		let g = skFbm( P * 14.0 );
		alb = tint * mix( 0.78, 1.04, g );
		rough = clamp( uv2.x + ( g - 0.5 ) * 0.2, 0.05, 1.0 );
		metal = uv2.y;
		if ( metal > 0.5 ) {
			let rust = smoothstep( 0.6, 0.8, skFbm( P * 40.0 + 3.0 ) );
			alb = mix( alb, vec3f( 0.2, 0.09, 0.04 ), rust * 0.8 );
			metal = mix( metal, 0.0, rust );
			rough = mix( rough, 0.9, rust );
		}
	} else if ( L > -5.5 ) {
		// three-strand laid rope: twisted strands, fibres, grime
		let strand = sin( ( uv.y * 3.0 + uv.x * 22.0 ) * 6.2831853 ) * 0.5 + 0.5;
		let fibre = skNoise( vec3f( uv.x * 900.0, uv.y * 40.0, 0.0 ) );
		alb = tint * mix( 0.55, 1.05, strand ) * mix( 0.85, 1.05, fibre ) * mix( 0.8, 1.0, skFbm( P * 6.0 ) );
		rough = 0.95;
		nrm = skBump( P, N0, strand * 0.0025 + fibre * 0.0003 );
	} else {
		// sun-faded painted float or fender: chalky, chipped to the white foam, streaky grime
		let fade = skFbm( P * 9.0 );
		let chip = smoothstep( 0.66, 0.74, skFbm( P * 55.0 + 2.0 ) );
		let streak = skFbm( vec3f( P.x * 30.0, P.y * 3.0, P.z * 30.0 ) );
		let chalky = mix( tint, vec3f( dot( tint, vec3f( 0.33 ) ) * 1.1 + 0.08 ), 0.3 + fade * 0.2 );
		alb = mix( chalky, vec3f( 0.78, 0.76, 0.7 ), chip ) * mix( 0.62, 1.0, smoothstep( 0.35, 0.7, streak ) );
		rough = mix( 0.55, 0.85, fade );
		nrm = skBump( P, N0, - chip * 0.0015 + fade * 0.0006 );
	}
	s.albedo = alb;
	s.roughness = rough;
	s.metalness = metal;
	s.ao = ao;
	s.normal = nrm;
`;
	return m;

}

// ---------------------------------------------------------------- geometry builder

const _m = new Matrix4(), _n = new Matrix3(), _v = new Vector3(), _w = new Vector3();

// matrix from a position and yaw / pitch / roll (radians, YXZ)
export function place( x, y, z, ry = 0, rx = 0, rz = 0, s = 1 ) {

	return new Matrix4().compose( new Vector3( x, y, z ), new Quaternion().setFromEuler( new Euler( rx, ry, rz, 'YXZ' ) ), new Vector3( s, s, s ) );

}

export class KitBuilder {

	constructor( assets, seed = 1 ) {

		this.assets = assets;
		this.pos = []; this.nrm = []; this.uv = []; this.col = []; this.layer = []; this.uv2 = []; this.idx = [];
		this.seed = seed;

	}

	rnd() {

		this.seed = ( this.seed * 16807 ) % 2147483647;
		return this.seed / 2147483647;

	}

	jit( a ) {

		return ( this.rnd() - 0.5 ) * a;

	}

	// raw vertex append; returns the first index
	_vert( p, n, uv, col, layer, uv2 ) {

		this.pos.push( p.x, p.y, p.z );
		this.nrm.push( n.x, n.y, n.z );
		this.uv.push( uv[ 0 ], uv[ 1 ] );
		this.col.push( col[ 0 ], col[ 1 ], col[ 2 ], 1 );
		this.layer.push( layer );
		this.uv2.push( uv2[ 0 ], uv2[ 1 ] );
		return this.pos.length / 3 - 1;

	}

	// A box of size w x h x d (centred) under `matrix`. Surfaces tile at their real size with the
	// boards / ribs running along the box's local `along` axis ('x' | 'y' | 'z'); `off` shifts the
	// texture so neighbouring boards differ. o.uv2Rect maps the +z face (the front) into the sign
	// atlas; o.params = [ roughness, metalness ] for plain boxes.
	box( w, h, d, matrix, o = {} ) {

		const layer = o.layer ?? LAYER.WALL;
		const col = o.color || [ 1, 1, 1 ];
		const S = layer >= 0 && layer < 100 ? SURF[ layer ] : { size: 1, grain: 'u' };
		const off = o.off || [ this.rnd(), this.rnd() ];
		const along = o.along || 'x';
		_n.getNormalMatrix( matrix );
		const half = [ w / 2, h / 2, d / 2 ];
		const axes = [ 'x', 'y', 'z' ];
		for ( let f = 0; f < 6; f ++ ) {

			const ax = f >> 1, sgn = f & 1 ? - 1 : 1;
			const u = ( ax + 1 ) % 3, v = ( ax + 2 ) % 3;
			// the face spans axes u and v: put the grain axis on the texture's grain direction
			let ua = u, va = v;
			const want = axes.indexOf( along );
			if ( S.grain === 'u' ? va === want : ua === want ) {

				ua = v; va = u;

			}

			const n = new Vector3(); n.setComponent( ax, sgn );
			const nw = n.clone().applyMatrix3( _n ).normalize();
			const base = this.pos.length / 3;
			for ( const [ a, b ] of [ [ - 1, - 1 ], [ 1, - 1 ], [ 1, 1 ], [ - 1, 1 ] ] ) {

				const p = new Vector3();
				p.setComponent( ax, sgn * half[ ax ] );
				p.setComponent( ua, a * half[ ua ] );
				p.setComponent( va, b * half[ va ] );
				const tu = ( p.getComponent( ua ) + half[ ua ] ) / S.size + off[ 0 ];
				const tv = - ( p.getComponent( va ) + half[ va ] ) / S.size + off[ 1 ];
				let uv2 = o.params || [ 0, 0 ];
				if ( o.uv2Rect && ax === 2 && sgn > 0 ) {

					const R = o.uv2Rect;
					uv2 = [ R[ 0 ] + ( R[ 2 ] - R[ 0 ] ) * ( p.x / w + 0.5 ), R[ 1 ] + ( R[ 3 ] - R[ 1 ] ) * ( 0.5 - p.y / h ) ];

				} else if ( o.uv2Rect ) uv2 = [ o.uv2Rect[ 0 ] + 0.001, o.uv2Rect[ 1 ] + 0.001 ];

				p.applyMatrix4( matrix );
				this._vert( p, nw, [ tu, tv ], col, layer, uv2 );

			}

			// winding: counter-clockwise seen from outside
			const flip = ( ( ua - ax + 3 ) % 3 === 1 ) === ( sgn > 0 );
			if ( flip ) this.idx.push( base, base + 1, base + 2, base, base + 2, base + 3 );
			else this.idx.push( base, base + 2, base + 1, base, base + 3, base + 2 );

		}

	}

	// any engine geometry (position / normal / uv / index), transformed; uv scaled by uvScale;
	// o.params = [ roughness, metalness ] for plain parts
	geometry( g, matrix, o = {} ) {

		const layer = o.layer ?? LAYER.PLAIN;
		const col = o.color || [ 1, 1, 1 ];
		const uv2 = o.params || [ 0.6, 0 ];
		const us = o.uvScale || [ 1, 1 ];
		_n.getNormalMatrix( matrix );
		const P = g.attributes.position, N = g.attributes.normal, U = g.attributes.uv;
		const base = this.pos.length / 3;
		for ( let i = 0; i < P.count; i ++ ) {

			_v.fromBufferAttribute( P, i ).applyMatrix4( matrix );
			_w.fromBufferAttribute( N, i ).applyMatrix3( _n ).normalize();
			const uv = U ? [ U.getX( i ) * us[ 0 ], U.getY( i ) * us[ 1 ] ] : [ 0, 0 ];
			// uv2FromUV: [ u0, v0, u1, v1 ] maps the geometry's uv (0..1) into the sign atlas
			const R = o.uv2FromUV;
			this._vert( _v, _w, uv, col, layer, R && U ? [ R[ 0 ] + ( R[ 2 ] - R[ 0 ] ) * U.getX( i ), R[ 1 ] + ( R[ 3 ] - R[ 1 ] ) * ( 1 - U.getY( i ) ) ] : uv2 );

		}

		if ( g.index ) for ( let i = 0; i < g.index.count; i ++ ) this.idx.push( base + g.index.getX( i ) );
		else for ( let i = 0; i < P.count; i ++ ) this.idx.push( base + i );

	}

	// rope along a polyline (world points), radius r, colour
	rope( points, r = 0.009, color = [ 0.62, 0.53, 0.38 ], radial = 6 ) {

		const base = this.pos.length / 3;
		let len = 0;
		const T = new Vector3(), B = new Vector3(), Nn = new Vector3(), up = new Vector3( 0, 1, 0 );
		for ( let i = 0; i < points.length; i ++ ) {

			const p = points[ i ];
			const a = points[ Math.max( 0, i - 1 ) ], b = points[ Math.min( points.length - 1, i + 1 ) ];
			T.subVectors( b, a ).normalize();
			if ( i > 0 ) len += p.distanceTo( points[ i - 1 ] );
			Nn.crossVectors( T, Math.abs( T.y ) > 0.9 ? new Vector3( 1, 0, 0 ) : up ).normalize();
			B.crossVectors( T, Nn );
			for ( let k = 0; k <= radial; k ++ ) {

				const ang = k / radial * Math.PI * 2;
				const dir = Nn.clone().multiplyScalar( Math.cos( ang ) ).addScaledVector( B, Math.sin( ang ) );
				this._vert( p.clone().addScaledVector( dir, r ), dir, [ len, k / radial ], color, LAYER.ROPE, [ 0, 0 ] );

			}

		}

		for ( let i = 0; i < points.length - 1; i ++ ) for ( let k = 0; k < radial; k ++ ) {

			const a = base + i * ( radial + 1 ) + k, b = a + radial + 1;
			this.idx.push( a, a + 1, b, a + 1, b + 1, b );

		}

	}

	// a coil of rope lying flat: `turns` rings at radius r, stacked a little
	coil( x, y, z, r = 0.2, turns = 5, rr = 0.012, color ) {

		for ( let t = 0; t < turns; t ++ ) {

			const pts = [];
			const R = r - t * rr * 1.6 + this.jit( 0.01 );
			for ( let i = 0; i <= 28; i ++ ) {

				const a = i / 28 * Math.PI * 2 + t * 0.7;
				pts.push( new Vector3( x + Math.cos( a ) * R, y + rr + t * rr * 1.3 + Math.sin( a * 3 + t ) * 0.003, z + Math.sin( a ) * R ) );

			}

			this.rope( pts, rr, color );

		}

	}

	// a corrugated iron sheet in its local xz plane (ribs along z), w wide, l long, under matrix.
	// The ribs line up with the texture's (u = x / 1.8 m).
	corrugated( w, l, matrix, u0 = 0, color = [ 1, 1, 1 ] ) {

		const nx = Math.ceil( w / 1.8 * RIBS * 8 ), nz = 2;
		_n.getNormalMatrix( matrix );
		const base = this.pos.length / 3;
		const hAt = ( x ) => {

			const u = x / 1.8 + u0;
			return RIB_AMP * Math.cos( 2 * Math.PI * RIBS * u - RIB_PHASE );

		};

		for ( let j = 0; j <= nz; j ++ ) for ( let i = 0; i <= nx; i ++ ) {

			const x = - w / 2 + w * i / nx, z = - l / 2 + l * j / nz;
			const dh = ( hAt( x + 1e-3 ) - hAt( x - 1e-3 ) ) / 2e-3;
			const p = new Vector3( x, hAt( x ), z ).applyMatrix4( matrix );
			const n = new Vector3( - dh, 1, 0 ).normalize().applyMatrix3( _n ).normalize();
			this._vert( p, n, [ x / 1.8 + u0, - z / 1.8 ], color, LAYER.TIN, [ 0, 0 ] );

		}

		for ( let j = 0; j < nz; j ++ ) for ( let i = 0; i < nx; i ++ ) {

			const a = base + j * ( nx + 1 ) + i, b = a + nx + 1;
			this.idx.push( a, b, a + 1, a + 1, b, b + 1 );
			// underside: the same sheet seen from below (double-sided)
		}

		// underside copy (normals flipped, reversed winding)
		const top = this.pos.length / 3;
		for ( let k = base; k < top; k ++ ) {

			const p = new Vector3( this.pos[ k * 3 ], this.pos[ k * 3 + 1 ], this.pos[ k * 3 + 2 ] );
			const n = new Vector3( - this.nrm[ k * 3 ], - this.nrm[ k * 3 + 1 ], - this.nrm[ k * 3 + 2 ] );
			this._vert( p, n, [ this.uv[ k * 2 ], this.uv[ k * 2 + 1 ] ], [ 0.8, 0.8, 0.8 ], LAYER.TIN, [ 0, 0 ] );

		}

		for ( let j = 0; j < nz; j ++ ) for ( let i = 0; i < nx; i ++ ) {

			const a = top + j * ( nx + 1 ) + i, b = a + nx + 1;
			this.idx.push( a, a + 1, b, a + 1, b + 1, b );

		}

	}

	// crushed-ice bed: a lumpy heightfield w x d at height y (local), under matrix
	ice( w, d, matrix, lump = 0.018 ) {

		const nx = 36, nz = 22;
		_n.getNormalMatrix( matrix );
		const H = [];
		for ( let j = 0; j <= nz; j ++ ) for ( let i = 0; i <= nx; i ++ ) {

			const edge = Math.min( i, nx - i, j, nz - j ) === 0 ? - 0.4 : 1;
			H.push( ( this.rnd() * 0.7 + 0.3 * Math.sin( i * 1.7 + j * 2.3 ) ) * lump * edge );

		}

		const base = this.pos.length / 3;
		for ( let j = 0; j <= nz; j ++ ) for ( let i = 0; i <= nx; i ++ ) {

			const x = - w / 2 + w * i / nx, z = - d / 2 + d * j / nz;
			const h = ( ii, jj ) => H[ Math.min( nz, Math.max( 0, jj ) ) * ( nx + 1 ) + Math.min( nx, Math.max( 0, ii ) ) ];
			const n = new Vector3( ( h( i - 1, j ) - h( i + 1, j ) ) / ( 2 * w / nx ), 1, ( h( i, j - 1 ) - h( i, j + 1 ) ) / ( 2 * d / nz ) ).normalize();
			const p = new Vector3( x, h( i, j ), z ).applyMatrix4( matrix );
			this._vert( p, n.applyMatrix3( _n ).normalize(), [ x, z ], [ 1, 1, 1 ], LAYER.ICE, [ 0, 0 ] );

		}

		for ( let j = 0; j < nz; j ++ ) for ( let i = 0; i < nx; i ++ ) {

			const a = base + j * ( nx + 1 ) + i, b = a + nx + 1;
			this.idx.push( a, b, a + 1, a + 1, b, b + 1 );

		}

	}

	// a flat disc of radius r in the local xy plane facing +z, uv2 mapping it into an atlas rect
	disc( r, matrix, o = {} ) {

		const seg = 40, layer = o.layer ?? LAYER.DIAL, R = o.uv2Rect || [ 0, 0, 1, 1 ], col = o.color || [ 1, 1, 1 ];
		_n.getNormalMatrix( matrix );
		const nw = new Vector3( 0, 0, 1 ).applyMatrix3( _n ).normalize();
		const at = ( x, y ) => [ R[ 0 ] + ( R[ 2 ] - R[ 0 ] ) * ( x / r * 0.5 + 0.5 ), R[ 1 ] + ( R[ 3 ] - R[ 1 ] ) * ( 0.5 - y / r * 0.5 ) ];
		const c = this._vert( new Vector3( 0, 0, 0 ).applyMatrix4( matrix ), nw, [ 0.5, 0.5 ], col, layer, at( 0, 0 ) );
		for ( let i = 0; i <= seg; i ++ ) {

			const a = i / seg * Math.PI * 2, x = Math.cos( a ) * r, y = Math.sin( a ) * r;
			this._vert( new Vector3( x, y, 0 ).applyMatrix4( matrix ), nw, [ x / r * 0.5 + 0.5, 0.5 - y / r * 0.5 ], col, layer, at( x, y ) );
			if ( i > 0 ) this.idx.push( c, c + i, c + i + 1 );

		}

	}

	// a scanned prop from props.bin (placed with its origin at the matrix; props are y-up, metres)
	prop( name, matrix ) {

		const A = this.assets, P = A.info.props[ name ];
		if ( ! P ) throw new Error( 'StallKit: no prop ' + name );
		const V = A.verts, F = A.info.vertexFloats;
		const fix = propLayers( A, name, P );
		_n.getNormalMatrix( matrix );
		const base = this.pos.length / 3;
		for ( let i = 0; i < P.vCount; i ++ ) {

			const k = ( P.vOff + i ) * F;
			_v.set( V[ k ], V[ k + 1 ], V[ k + 2 ] ).applyMatrix4( matrix );
			_w.set( V[ k + 3 ], V[ k + 4 ], V[ k + 5 ] ).applyMatrix3( _n ).normalize();
			this._vert( _v, _w, [ V[ k + 6 ], V[ k + 7 ] ], [ 1, 1, 1 ], LAYER.PROP + ( fix ? fix.layer[ i ] : V[ k + 8 ] ), fix ? [ fix.uv2[ i * 2 ], fix.uv2[ i * 2 + 1 ] ] : [ 0, 0 ] );

		}

		for ( let i = 0; i < P.iCount; i ++ ) this.idx.push( base + A.index[ P.iOff + i ] );

	}

	// bounds of a prop (for placing it on a surface)
	bounds( name ) {

		return this.assets.info.props[ name ];

	}

	build() {

		const g = new BufferGeometry();
		g.setAttribute( 'position', new Float32BufferAttribute( this.pos, 3 ) );
		g.setAttribute( 'normal', new Float32BufferAttribute( this.nrm, 3 ) );
		g.setAttribute( 'uv', new Float32BufferAttribute( this.uv, 2 ) );
		g.setAttribute( 'color', new Float32BufferAttribute( this.col, 4 ) );
		g.setAttribute( 'aLayer', new Float32BufferAttribute( this.layer, 1 ) );
		g.setAttribute( 'aUV2', new Float32BufferAttribute( this.uv2, 2 ) );
		g.setIndex( new Uint32BufferAttribute( this.idx, 1 ) );
		g.computeBoundingBox();
		g.computeBoundingSphere();
		return g;

	}

}

// Per-vertex texture layers of a prop, where props.bin lost a material. The decimated lantern came
// out as one material (the frame): its four glass panes are found again as the thin flat pieces
// between the rails (~25 cm tall, ~1 cm thick) and given the glass layer (wooden_lantern_01_1);
// their uv2 is the position on the pane in metres (across, up) for the flame's glow.
const _propLayers = new Map();
function propLayers( A, name, P ) {

	if ( name !== 'wooden_lantern_01' ) return null;
	if ( _propLayers.has( name ) ) return _propLayers.get( name );
	const glassLayer = A.info.layers.indexOf( 'wooden_lantern_01_1' );
	if ( glassLayer < 0 ) return null;
	const V = A.verts, F = A.info.vertexFloats, n = P.vCount;
	// connected pieces: shared indices and coincident positions
	const parent = new Int32Array( n ).map( ( _, i ) => i );
	const find = ( a ) => {

		while ( parent[ a ] !== a ) a = parent[ a ] = parent[ parent[ a ] ];
		return a;

	};

	const union = ( a, b ) => { parent[ find( a ) ] = find( b ); };
	const seen = new Map();
	for ( let i = 0; i < n; i ++ ) {

		const k = ( P.vOff + i ) * F;
		const key = `${ Math.round( V[ k ] * 1e4 ) },${ Math.round( V[ k + 1 ] * 1e4 ) },${ Math.round( V[ k + 2 ] * 1e4 ) }`;
		if ( seen.has( key ) ) union( i, seen.get( key ) );
		else seen.set( key, i );

	}

	for ( let t = 0; t < P.iCount; t += 3 ) {

		const a = A.index[ P.iOff + t ];
		union( a, A.index[ P.iOff + t + 1 ] );
		union( a, A.index[ P.iOff + t + 2 ] );

	}

	const box = new Map();
	for ( let i = 0; i < n; i ++ ) {

		const r = find( i ), k = ( P.vOff + i ) * F;
		let b = box.get( r );
		if ( ! b ) box.set( r, b = [ 1e9, 1e9, 1e9, - 1e9, - 1e9, - 1e9 ] );
		for ( let j = 0; j < 3; j ++ ) {

			b[ j ] = Math.min( b[ j ], V[ k + j ] );
			b[ j + 3 ] = Math.max( b[ j + 3 ], V[ k + j ] );

		}

	}

	const out = { layer: new Float32Array( n ), uv2: new Float32Array( n * 2 ) };
	for ( let i = 0; i < n; i ++ ) {

		const b = box.get( find( i ) ), k = ( P.vOff + i ) * F;
		const thinX = b[ 3 ] - b[ 0 ] < b[ 5 ] - b[ 2 ];
		const pane = b[ 4 ] - b[ 1 ] > 0.2 && b[ 1 ] > 0.045 && b[ 4 ] < 0.3 && Math.min( b[ 3 ] - b[ 0 ], b[ 5 ] - b[ 2 ] ) < 0.015;
		out.layer[ i ] = pane ? glassLayer : V[ k + 8 ];
		out.uv2[ i * 2 ] = thinX ? V[ k + 2 ] : V[ k ];
		out.uv2[ i * 2 + 1 ] = V[ k + 1 ];

	}

	_propLayers.set( name, out );
	return out;

}

// helpers for common shapes
export const Shapes = {
	cylinder: ( rt, rb, h, seg = 16, open = false ) => new CylinderGeometry( rt, rb, h, seg, 1, open ),
	torus: ( r, t, rs = 8, ts = 24 ) => new TorusGeometry( r, t, rs, ts ),
	sphere: ( r, ws = 14, hs = 10 ) => new SphereGeometry( r, ws, hs ),
	lathe: ( pts, seg = 16 ) => new LatheGeometry( pts.map( ( [ x, y ] ) => new Vector2( x, y ) ), seg ),
};
