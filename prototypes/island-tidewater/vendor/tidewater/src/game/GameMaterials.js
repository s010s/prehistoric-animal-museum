import { standard } from '../materials/Materials.js';
import { Vector3 } from '../engine/index.js';
import { ShaderModule } from '../engine/gpu/Shader.js';
import { commonModule } from '../engine/render/wgsl/common.js';

// Materials for the game's props (rod, bobber, fish stand, vendor). Geometry is built with the
// boat's GeoKit layout: color = linear albedo, aux = ( roughness, metalness, pattern, spare ).
//   pattern 0 plain, 1 weathered wood (grain along local y... planks: see woodAxis), 2 canvas /
//   cloth, 3 skin, 4 cork, 5 painted metal with rust; fishing tackle (local +Y = the rod or reel
//   axis): 8 carbon blank under clear coat, 9 epoxy-coated thread wraps, 10 EVA foam grip,
//   11 braided line on the spool, 12 machined / anodised metal, 13 knurled metal, 14 rubber
export const PAT = {
	plain: 0, wood: 1, cloth: 2, skin: 3, cork: 4, rusty: 5, woodX: 6, woodZ: 7,
	carbon: 8, thread: 9, eva: 10, braid: 11, machined: 12, knurl: 13, rubber: 14,
};

const gameModule = new ShaderModule( {
	name: 'gameProps',
	deps: [ commonModule ],
	code: /* wgsl */`
fn gpHash( p: vec3f ) -> f32 { return fract( sin( dot( p, vec3f( 127.1, 311.7, 74.7 ) ) ) * 43758.5453 ); }
fn gpNoise( p: vec3f ) -> f32 {
	let i = floor( p ); let f = fract( p ); let u = f * f * ( 3.0 - 2.0 * f );
	let a = mix( mix( gpHash( i ), gpHash( i + vec3f( 1, 0, 0 ) ), u.x ), mix( gpHash( i + vec3f( 0, 1, 0 ) ), gpHash( i + vec3f( 1, 1, 0 ) ), u.x ), u.y );
	let b = mix( mix( gpHash( i + vec3f( 0, 0, 1 ) ), gpHash( i + vec3f( 1, 0, 1 ) ), u.x ), mix( gpHash( i + vec3f( 0, 1, 1 ) ), gpHash( i + vec3f( 1, 1, 1 ) ), u.x ), u.y );
	return mix( a, b, u.z );
}
fn gpFbm( p: vec3f ) -> f32 { return gpNoise( p ) * 0.55 + gpNoise( p * 2.13 + 7.1 ) * 0.3 + gpNoise( p * 4.7 + 3.3 ) * 0.15; }
fn gpBump( P: vec3f, N: vec3f, height: f32 ) -> vec3f {
	let dPdx = dpdx( P ); let dPdy = dpdy( P );
	let r1 = cross( dPdy, N ); let r2 = cross( N, dPdx );
	let det = dot( dPdx, r1 );
	let grad = sign( det ) * ( dpdx( height ) * r1 + dpdy( height ) * r2 );
	return normalize( abs( det ) * N - grad + N * 1e-12 );
}
`,
} );

// extra: { uniforms, vertex, clearcoat } (vertex runs after aux / the rest position are passed on; clearcoat
// enables the clear-coat lobe, which the carbon / thread patterns use)
export function createPropMaterial( name = 'gameProp', extra = {} ) {

	const m = standard( {
		vertexColors: true,
		modules: [ gameModule ],
		attributes: { aux: 'vec4f' },
		varyings: { vAux: 'vec4f', vLocal: 'vec3f' },
		uniforms: extra.uniforms || {},
		// the pattern coordinates are the rest position: patterns stay on parts the vertex snippet moves
		vertex: /* wgsl */`
	o.vAux = v.aux;
	o.vLocal = v.position;
` + ( extra.vertex || '' ),
	} );
	m.name = name;
	if ( extra.clearcoat ) m.setDefine( 'CLEARCOAT', 1 );
	m.surface = /* wgsl */`
	let base = in.color.rgb;
	var rough = in.vs.vAux.x;
	let metal = in.vs.vAux.y;
	let pat = in.vs.vAux.z;
	let P = in.P;
	let lp = in.vs.vLocal;
	var col = base;
	var h = 0.0;
	if ( ( pat > 0.5 && pat < 1.5 ) || pat > 5.5 ) {
		// weathered, sun-bleached timber: grain along the board (local y, x or z), silvery on top,
		// dark in the cracks, grime low down
		var q = lp.xzy;
		if ( pat > 6.5 ) { q = lp.xyz; } else if ( pat > 5.5 ) { q = lp.yzx; }
		let grain = gpFbm( vec3f( q.x * 40.0, q.y * 40.0, q.z * 1.6 ) );
		let rings = sin( ( q.x * 23.0 + q.y * 17.0 + grain * 6.0 ) * 3.0 ) * 0.5 + 0.5;
		let blotch = gpFbm( P * 1.3 );
		col = base * mix( 0.72, 1.12, grain ) * mix( 0.9, 1.05, rings );
		col = mix( col, vec3f( dot( col, vec3f( 0.33 ) ) * 1.05 ), 0.35 * smoothstep( 0.2, 0.9, in.N.y ) );
		col *= mix( 1.0, 0.72, smoothstep( 0.55, 0.8, blotch ) );
		col *= mix( 0.75, 1.0, smoothstep( 0.0, 0.6, P.y - frame.seaLevel ) );
		let crack = smoothstep( 0.62, 0.7, gpNoise( vec3f( q.x * 90.0, q.y * 90.0, q.z * 3.0 ) ) );
		col *= 1.0 - crack * 0.5;
		h = grain * 0.0015 - crack * 0.0012;
		rough = clamp( rough + ( grain - 0.5 ) * 0.1, 0.6, 1.0 );
	} else if ( pat > 1.5 && pat < 2.5 ) {
		// canvas / cotton: weave, fading and grime
		let weave = sin( lp.x * 900.0 ) * sin( lp.y * 900.0 + lp.z * 900.0 ) * ( 1.0 - smoothstep( 0.002, 0.006, fwidth( lp.x + lp.y ) ) );
		let fade = gpFbm( P * 2.5 );
		col = base * mix( 0.8, 1.08, fade ) * ( 1.0 + weave * 0.04 );
		h = weave * 0.0003 + fade * 0.002;
	} else if ( pat > 2.5 && pat < 3.5 ) {
		// weathered skin: blotchy, a little ruddy
		let b = gpFbm( lp * 22.0 );
		col = base * mix( 0.85, 1.1, b ) * vec3f( 1.0, mix( 0.94, 1.0, b ), mix( 0.92, 1.0, b ) );
		rough = 0.55;
		h = b * 0.0008;
	} else if ( pat > 3.5 && pat < 4.5 ) {
		// cork grip: speckled
		let s = gpNoise( lp * 700.0 );
		col = base * mix( 0.7, 1.1, s );
		h = s * 0.0004;
	} else if ( pat > 4.5 && pat < 5.5 ) {
		// painted metal, rust at the edges and streaking down
		let r = smoothstep( 0.55, 0.75, gpFbm( P * vec3f( 3.0, 0.8, 3.0 ) ) );
		col = mix( base, vec3f( 0.23, 0.1, 0.04 ), r * 0.8 );
		rough = mix( rough, 0.85, r );
	} else if ( pat > 7.5 ) {
		// fishing tackle, in the part's local frame (+Y along the rod / reel axis)
		let ang = atan2( lp.x, lp.z );
		if ( pat < 8.5 ) {
			// carbon blank: fine woven / wrapped scrim under a glossy clear coat, faded out where the
			// weave is below a pixel
			let u = ang * 18.0; let w = lp.y * 700.0;
			let aa = 1.0 - smoothstep( 0.3, 1.2, fwidth( w ) );
			let weave = sin( u + w ) * sin( u - w );
			col = base * ( 1.0 + weave * 0.09 * aa ) * mix( 0.94, 1.04, gpNoise( vec3f( 0.0, lp.y * 3.0, 0.0 ) ) );
			h = weave * 0.00004 * aa;
			s.clearcoat = 1.0; s.clearcoatRoughness = 0.05;
		} else if ( pat < 9.5 ) {
			// nylon thread wraps sealed in epoxy: tight turns around the blank, a little uneven
			let w = lp.y * 3200.0;
			let aa = 1.0 - smoothstep( 0.3, 1.2, fwidth( w ) );
			let turns = sin( w + ang * 0.16 ) * aa;
			col = base * ( 1.0 + turns * 0.12 ) * mix( 0.92, 1.06, gpNoise( lp * 300.0 ) );
			h = turns * 0.00003;
			s.clearcoat = 1.0; s.clearcoatRoughness = 0.04;
		} else if ( pat < 10.5 ) {
			// EVA foam: closed-cell pores, darker and smoother where the hand holds it, grime
			let pore = smoothstep( 0.72, 0.9, gpNoise( lp * 2600.0 ) );
			let grime = gpFbm( lp * 60.0 );
			col = base * ( 1.0 - pore * 0.35 ) * mix( 0.85, 1.08, grime );
			rough = clamp( rough - grime * 0.12, 0.55, 1.0 );
			h = - pore * 0.0002;
		} else if ( pat < 11.5 ) {
			// braided line wound on the spool: fine crossing turns
			let w = lp.y * 1500.0; let u = ang * 60.0;
			let aa = 1.0 - smoothstep( 0.3, 1.2, fwidth( w ) );
			let b = sin( u + w ) * 0.5 + 0.5;
			col = base * mix( 0.8, 1.08, b * aa + 0.5 * ( 1.0 - aa ) );
			h = b * 0.00006 * aa;
		} else if ( pat < 12.5 ) {
			// machined / anodised metal: circumferential lathe marks, slightly uneven sheen
			let w = length( lp.xz ) * 5000.0 + lp.y * 800.0;
			let aa = 1.0 - smoothstep( 0.3, 1.2, fwidth( w ) );
			let m = sin( w ) * aa;
			col = base * ( 1.0 + m * 0.03 );
			rough = clamp( rough + m * 0.05 + ( gpNoise( lp * 150.0 ) - 0.5 ) * 0.06, 0.12, 0.9 );
		} else if ( pat < 13.5 ) {
			// knurled metal (lock nut): a diamond grip pattern in the relief
			let u = ang * 24.0; let w = lp.y * 900.0;
			let aa = 1.0 - smoothstep( 0.3, 1.2, fwidth( w ) );
			let k = abs( sin( u + w ) ) * abs( sin( u - w ) );
			col = base * ( 0.85 + k * 0.25 * aa );
			h = k * 0.00012 * aa;
		} else {
			// rubber: matte, a few scuffs
			let sc = gpFbm( lp * 250.0 );
			col = base * mix( 0.9, 1.15, sc );
			rough = clamp( rough + ( sc - 0.5 ) * 0.2, 0.6, 1.0 );
		}
	}
	s.albedo = col;
	s.roughness = rough;
	s.metalness = metal;
	if ( h != 0.0 ) { s.normal = gpBump( P, s.normal, h ); }
`;
	return m;

}

// Fishing line: a thin ribbon laid along a sagging curve between two world points, built in the
// vertex shader from ( t along the line, side ) so it costs one draw and no uploads per frame.
export function createLineMaterial( segments ) {

	const m = standard( {
		color: 0xd8dde0,
		roughness: 0.35,
		side: 'double',
		uniforms: {
			lineA: [ 'vec3f', new Vector3() ],
			lineB: [ 'vec3f', new Vector3() ],
			lineCtl: [ 'vec3f', new Vector3() ], // middle control point (sag / belly), quadratic Bezier
			lineShow: [ 'f32', 0 ],
		},
		attributes: { aLine: 'vec2f' },
		vertex: /* wgsl */`
	let t = v.aLine.x;
	let side = v.aLine.y;
	let a = mat.lineA; let b = mat.lineB; let c = mat.lineCtl;
	let P = ( 1.0 - t ) * ( 1.0 - t ) * a + 2.0 * ( 1.0 - t ) * t * c + t * t * b;
	let T = normalize( 2.0 * ( 1.0 - t ) * ( c - a ) + 2.0 * t * ( b - c ) + vec3f( 1e-6, 0.0, 0.0 ) );
	let toCam = frame.cameraPos - P;
	let dist = length( toCam );
	let W = normalize( cross( T, toCam ) + vec3f( 0.0, 1e-6, 0.0 ) );
	// about a pixel wide at any distance (TAA resolves the sub-pixel coverage)
	let w = max( 0.0006, dist * 0.0006 ) * mat.lineShow;
	v.useWorld = true;
	v.worldPos = P + W * side * w;
	v.prevWorldPos = v.worldPos;
	v.worldNormal = normalize( toCam );
`,
	} );
	m.name = 'fishingLine';
	m.receiveShadows = true;
	return m;

}
