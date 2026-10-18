import { Color, Vector4 } from '../../engine/index.js';
import { Material } from '../../engine/render/Material.js';
import { ShaderModule, UniformBlock } from '../../engine/gpu/Shader.js';
import { commonModule } from '../../engine/render/wgsl/common.js';
import { lodFadeModule } from '../../materials/LODFade.js';
import { SPECIES, SKIN, PATTERN } from './FishSpecies.js';
import { PART } from './FishGeometry.js';

// The fish material (WGSL, ported from TSL), shared by the swimming fish (FishSchools) and the
// fish on the market stall, drying racks and cleaning tables (FishProps).
//
// Everything is procedural: a per-species table of colours and anatomy landmarks (eye, gill
// cover, lateral line, jaw hinge) and the species' markings in the fragment stage. Body skin:
// counter-shading from the dark back to the pale belly, overlapping scales in rows (colour and
// relief, faded out when smaller than a pixel), the lateral line, the edge of the gill cover,
// silvery guanine reflection with an iridescent sheen, wet specular. Fins: ray-striped
// membranes, darker and thinner toward the edge, lit through from behind. Eyes: pupil, iris
// with radial streaks and a glossy cornea (a dome at the nearest level of detail, painted
// further away). The vertex stage poses the model: a travelling swimming wave with pectoral
// sculling (swimming fish, with true motion vectors), or an open jaw and a curled / sagging
// body (props: fish lying on ice or hanging from a hook).
//
// Port notes:
//  - the instance record comes from the ReefBatch module (see recordOf() below and reef/ReefBatch.js);
//  - motion vectors: the TSL version added the fish's own motion (vFishDelta) to the static
//    (camera) velocity in the MRT output; here the vertex stage sets the previous world position
//    ( world - delta ), which the mesh template turns into exactly that velocity;
//  - bumpNormal (view-space Mikkelsen bump in ReefMaterials) = perturbNormalByHeight in world space;
//  - the props' maskNode (stochastic fin transparency) is a discard in the surface (and in the
//    shadow hook, as TSL's maskNode also applied to the shadow pass).
//
// WGSL (module `fishModule()`): fishRotateQ, fishRow( pattern, k ), fishHash, fishVnoise,
// fishOpercleEdge, fishOpercleMask, fishBand, fishPartOf, fishJawOf, fishSwimOffset, fishEyeCol.

const ROWS = 8; // vec4 rows per species in the table

// see the note at s.specularIntensity in surface()
export const FISH_SPECULAR = 'intended';

// species order = pattern ids
const NAMES = Object.keys( PATTERN ).sort( ( a, b ) => PATTERN[ a ] - PATTERN[ b ] );

function buildTable() {

	const rows = [];
	const lin = ( hex ) => new Color( hex );
	for ( const name of NAMES ) {

		const S = SPECIES[ name ], K = SKIN[ name ];
		const b = lin( K.back ), f = lin( K.flank ), be = lin( K.belly ), fi = lin( K.fin ), e = lin( K.edge ), ir = lin( S.iris );
		const L = S.body;
		rows.push(
			// guanine reflection: a metal-like specular layer, kept moderate so that silvery fish
			// stay bright in the dim underwater environment lighting
			new Vector4( b.r, b.g, b.b, S.metal * 0.55 ),
			new Vector4( f.r, f.g, f.b, S.irid ),
			new Vector4( be.r, be.g, be.b, K.rough ),
			new Vector4( fi.r, fi.g, fi.b, S.mouth.tip ),
			new Vector4( e.r, e.g, e.b, S.scales ),
			new Vector4( ir.r, ir.g, ir.b, S.scaleVis ),
			new Vector4( 0.5 - S.eye.u * L, S.eye.y, S.eye.r, 0.5 - S.opercle * L ),
			new Vector4( S.lateral, S.arch, 0.5 - S.mouth.corner * L, S.mouth.y ),
		);

	}

	return new UniformBlock( 'FishSkin', { rows: [ `vec4f[${ rows.length }]`, rows ] }, { label: 'fishSkin' } );

}

let _table = null;
export const skinTable = () => _table || ( _table = buildTable() );

// float literal of a table constant
const f = ( x ) => {

	const s = String( x );
	return s.includes( '.' ) || s.includes( 'e' ) ? s : s + '.0';

};
const PT = ( name ) => f( PATTERN[ name ] );
const PA = ( name ) => f( PART[ name ] );

let _module = null;
export function fishModule() {

	if ( _module ) return _module;
	_module = new ShaderModule( {
		name: 'fish',
		deps: [ commonModule, lodFadeModule ],
		uniforms: skinTable(),
		uniformName: 'fishSkin',
		code: /* wgsl */`
fn fishRotateQ( q: vec4f, v: vec3f ) -> vec3f { return v + cross( q.xyz, cross( q.xyz, v ) + v * q.w ) * 2.0; }
fn fishRow( pattern: f32, k: i32 ) -> vec4f { return fishSkin.rows[ clamp( i32( pattern ), 0, ${ NAMES.length - 1 } ) * ${ ROWS } + k ]; }
fn fishPartOf( d: vec4f ) -> f32 { return floor( d.y + 0.01 ); }
fn fishJawOf( d: vec4f ) -> f32 { return max( fract( d.y + 0.01 ) - 0.01, 0.0 ) / 0.9; }

fn fishHash( p: vec2f ) -> f32 { return fract( sin( dot( p, vec2f( 127.1, 311.7 ) ) ) * 43758.5453 ); }

// value noise 2D (cheap, for blotches and skin variation)
fn fishVnoise( p: vec2f ) -> f32 {
	let i = floor( p ); let f = fract( p );
	let w = f * f * ( 3.0 - f * 2.0 );
	let a = fishHash( i ); let b = fishHash( i + vec2f( 1.0, 0.0 ) ); let c = fishHash( i + vec2f( 0.0, 1.0 ) ); let d = fishHash( i + vec2f( 1.0, 1.0 ) );
	return mix( mix( a, b, w.x ), mix( c, d, w.x ), w.y );
}

// posterior edge of the gill cover (local z) at height fraction h: convex backward, sweeping
// forward under the throat
fn fishOpercleEdge( zOp: f32, h: f32 ) -> f32 { return zOp - 0.028 * ( 1.0 - h * h ) + smoothstep( -0.35, -1.0, h ) * 0.07; }
fn fishOpercleMask( h: f32 ) -> f32 { return smoothstep( -0.98, -0.9, h ) * ( 1.0 - smoothstep( 0.45, 0.62, h ) ); }

fn fishBand( x: f32, center: f32, width: f32, soft: f32 ) -> f32 { return 1.0 - smoothstep( width, width + soft, abs( x - center ) ); }

// Deformation as a function of the phase (evaluated for this and the previous frame):
// fish: travelling body wave (amplitude grows toward the tail) plus the turning bend,
// sculling pectorals; rays: the disc margins undulate (stingray) or flap (eagle ray);
// turtle: the front flippers stroke, the hind ones paddle.
// d = aData, p = rest position, amp = wave amplitude, bend = turning bend at this vertex
fn fishSwimOffset( ph: f32, d: vec4f, p: vec3f, env: f32, amp: f32, bend: f32, eagle: bool ) -> vec3f {
	let u = d.x;
	let part = fishPartOf( d );
	let isDisc = part == ${ PA( 'DISC' ) };
	let isFlip = part == ${ PA( 'FLIPPER' ) };
	let turtle = part > ${ f( PART.WHIP + 0.5 ) };
	let side = d.z; // rays: distance from the midline; flippers: along the flipper
	let lat = sin( ph - u * 5.6 ) * env * amp + bend;
	let flap = select( 0.0, sin( ph * 0.7 + 1.3 ) * d.z * 0.035, part == ${ PA( 'PECTORAL' ) } );
	let fish = vec3f( lat + flap * sign( p.x ), 0.0, 0.0 );
	let k = select( 8.0, 1.2, eagle );
	let disc = vec3f( 0.0, sin( ph - u * k ) * pow( side, 1.6 ) * amp, 0.0 );
	let front = d.w < 1.5;
	let stroke = vec3f( 0.0, sin( ph ) * select( 0.07, 0.3, front ), cos( ph ) * select( 0.0, 0.14, front ) ) * side;
	return select( select( select( fish, vec3f( 0.0 ), turtle ), stroke, isFlip ), disc, isDisc );
}

// eye colour: pupil, iris with radial streaks, dark rim
fn fishEyeCol( r: f32, ang: f32, irisC: vec3f, cloudy: f32 ) -> vec3f {
	let streak = sin( ang * 26.0 ) * 0.5 + 0.5;
	let irisL = dot( irisC, vec3f( 0.3, 0.59, 0.11 ) );
	let iris = irisC * min( 1.0, 0.36 / max( irisL, 1e-3 ) ) * mix( 0.6, 1.05, streak ) * ( smoothstep( 0.55, 0.72, r ) * 0.45 + 0.5 );
	let ring = smoothstep( 0.8, 0.97, r );
	var e = mix( iris, vec3f( 0.025, 0.025, 0.028 ), ring );
	e = mix( e, vec3f( 0.004, 0.005, 0.007 ), 1.0 - smoothstep( 0.5, 0.56, r ) );
	// cloudy eyes of fish out of the water for a while
	e = mix( e, vec3f( 0.42, 0.44, 0.46 ), cloudy * 0.55 * ( 1.0 - smoothstep( 0.7, 1.0, r ) ) );
	return e;
}
`,
	} );
	return _module;

}

// varyings shared by the vertex and fragment stages
const VARYINGS = {
	vFishLocal: 'vec3f', // rest pose position (model units)
	vFishData: 'vec4f', // aData
	vFishInfo: 'vec4f', // pattern, seed, length (m), 0
	vFishFlags: 'vec4f', // props: cloudy eye, wet, dried, blood
	vFishFade: 'vec2f', // level-of-detail cross-fade: share, outgoing
};

// Record of this vertex's instance (main or fade channel): WGSL statements defining r0, q, r2, r3
// (and o.vFishFade). The batch's module (batch.module) holds the instance storage and the lookups.
function recordOf( batch, fade ) {

	let head;
	if ( fade ) head = `let fe = ${ batch.fadeEntry() };\n\tlet ri = fe.index;\n\to.vFishFade = vec2f( fe.fade, fe.outgoing );`;
	else head = `let ri = ${ batch.recordIndex() };\n\to.vFishFade = vec2f( 1.0, 0.0 );`;
	const r = batch.record( 'ri' );
	return /* wgsl */`
	${ head }
	let r0 = ${ r[ 0 ] }; let q = ${ r[ 1 ] }; let r2 = ${ r[ 2 ] }; let r3 = ${ r[ 3 ] };`;

}

// ---------------------------------------------------------------------------
// vertex stages

// Swimming fish. Record: r0 = ( position, length ), r1 = orientation, r2 = ( wave phase,
// amplitude, turning bend, pattern + seed * 0.9 ), r3 = ( world motion since the last frame,
// phase change )
function swimVertex( batch, fade ) {

	return /* wgsl */`
	${ recordOf( batch, fade ) }
	let d = v.aData;
	let u = d.x;
	var p = v.position;
	o.vFishLocal = p;
	o.vFishData = d;
	o.vFishInfo = vec4f( floor( r2.w ), fract( r2.w ), r0.w, 0.0 );
	o.vFishFlags = vec4f( 0.0 );
	let pattern = floor( r2.w );
	let env = ( u * u * 0.85 + 0.08 ) * ( smoothstep( 0.0, 0.25, u ) * 0.7 + 0.3 );
	let bend = r2.z * ( u * u );
	let eagle = pattern == ${ PT( 'eagleRay' ) };
	let off = fishSwimOffset( r2.x, d, p, env, r2.y, bend, eagle );
	p += off;
	// the fish's own motion since the last frame (position change + swimming wave): motion vectors
	let delta = fishRotateQ( q, off - fishSwimOffset( r2.x - r3.w, d, v.position, env, r2.y, bend, eagle ) ) * r0.w + r3.xyz;
	v.useWorld = true;
	v.worldNormal = fishRotateQ( q, v.normal );
	v.worldPos = fishRotateQ( q, p * r0.w ) + r0.xyz;
	v.prevWorldPos = v.worldPos - delta;`;

}

// Fish props. Record: r0 = ( position, length ), r1 = orientation, r2 = ( pattern + seed * 0.9,
// lateral curl, dorso-ventral sag (1 / body length), jaw opening (rad) ), r3 = ( cloudy eye, wet,
// dried, blood )
function propVertex( batch, fade ) {

	return /* wgsl */`
	${ recordOf( batch, fade ) }
	let d = v.aData;
	let pattern = floor( r2.x );
	var p = v.position;
	var n = v.normal;
	o.vFishLocal = p;
	o.vFishData = d;
	o.vFishInfo = vec4f( pattern, fract( r2.x ), r0.w, 0.0 );
	o.vFishFlags = r3;

	// lower jaw: rotates down about the hinge at the corner of the mouth
	let hinge = fishRow( pattern, 7 ).zw;
	let a = r2.w * fishJawOf( d );
	let ca = cos( a ); let sa = sin( a );
	let dy = p.y - hinge.y; let dz = p.z - hinge.x;
	p.y = hinge.y + dy * ca - dz * sa;
	p.z = hinge.x + dy * sa + dz * ca;
	let ny = n.y * ca - n.z * sa; let nz = n.y * sa + n.z * ca;
	n.y = ny;
	n.z = nz;

	// body bent along circular arcs about its middle: sideways (curl), then up / down (sag)
	let k1 = r2.y + select( -1e-4, 1e-4, r2.y >= 0.0 );
	let t1 = k1 * p.z;
	let c1 = cos( t1 ); let s1 = sin( t1 ); let h1 = sin( t1 * 0.5 );
	let x1 = h1 * h1 * 2.0 / k1 + p.x * c1;
	let z1 = s1 / k1 - p.x * s1;
	let nx1 = n.x * c1 + n.z * s1; let nz1 = n.z * c1 - n.x * s1;
	let k2 = r2.z + select( -1e-4, 1e-4, r2.z >= 0.0 );
	let t2 = k2 * z1;
	let c2 = cos( t2 ); let s2 = sin( t2 ); let h2 = sin( t2 * 0.5 );
	let y2 = h2 * h2 * 2.0 / k2 + p.y * c2;
	let z2 = s2 / k2 - p.y * s2;
	let ny2 = n.y * c2 + nz1 * s2; let nz2 = nz1 * c2 - n.y * s2;
	v.useWorld = true;
	v.worldNormal = fishRotateQ( q, vec3f( nx1, ny2, nz2 ) );
	v.worldPos = fishRotateQ( q, vec3f( x1, y2, z2 ) * r0.w ) + r0.xyz;
	v.prevWorldPos = v.worldPos;`;

}

// ---------------------------------------------------------------------------
// fragment stage

// Level-of-detail cross-fade (see ReefBatch fade channel, materials/LODFade.js): the incoming level
// keeps the Bayer cells below the fade, the outgoing one the others.
const FADE_DISCARD = /* wgsl */`
	if ( ! lodFadeVisible( in.pixel, in.vs.vFishFade.x, in.vs.vFishFade.y > 0.5 ) ) { discard; }`;

// shared by colour and relief (scales), then the relief (bump height, m)
const COMMON = /* wgsl */`
	let D = in.vs.vFishData; let Lp = in.vs.vFishLocal; let I = in.vs.vFishInfo;
	let pattern = floor( I.x + 0.5 );
	let part = fishPartOf( D );
	let scaleSize = fishRow( pattern, 4 ).w; let scaleVis = fishRow( pattern, 5 ).w;
	// scale rows: posterior margins are arcs, rows offset by half a scale
	let ss = max( scaleSize, 0.004 );
	// gentle waviness of the scale rows (in scale units: big scales stay in orderly rows)
	let warp = ( sin( Lp.z * 23.0 + D.z * 31.0 ) * 0.35 + sin( Lp.z * 41.0 - D.z * 17.0 ) * 0.25 ) * mix( 1.0, 0.3, smoothstep( 0.015, 0.045, scaleSize ) );
	let sa = ( 0.5 - Lp.z ) / ss + warp; let sb = D.z / ( ss * 0.8 ) + warp * 0.6;
	let rowI = floor( sb );
	let fb = fract( sb ) * 2.0 - 1.0;
	let sf = fract( sa + rowI * 0.5 + fb * fb * 0.32 );
	// pixel footprint (m) against the scale size (m): fade out sub-pixel detail
	let Pv = ( frame.view * vec4f( in.P, 1.0 ) ).xyz;
	let px = length( fwidth( Pv ) );
	let sfade = ( 1.0 - smoothstep( 0.25, 0.7, px / ( ss * I.z ) ) ) * select( 0.0, 1.0, scaleSize > 0.001 );

	// ---- relief
	var bumpH = 0.0;
	{
		let isBody = part == ${ PA( 'BODY' ) };
		let L = I.z;
		// scales: each rises toward its free posterior margin
		let sc = smoothstep( 0.0, 0.9, sf ) * ( 1.0 - smoothstep( 0.9, 1.0, sf ) ) * sfade * scaleVis;
		// gill cover: raised in front of its edge
		let eyeOp = fishRow( pattern, 6 );
		let h = D.w;
		let zE = fishOpercleEdge( eyeOp.w, h );
		let onOp = fishOpercleMask( h );
		let op = smoothstep( -0.004, 0.004, Lp.z - zE ) * onOp;
		let grainFade = 1.0 - smoothstep( 0.3, 0.8, px / ( 0.004 * I.z ) );
		let grain = ( fishVnoise( vec2f( Lp.z, D.z ) * 420.0 ) - 0.5 ) * 0.00022 * grainFade;
		let bodyH = sc * 0.0016 + op * 0.0025 + grain;
		// fin rays: ridges
		let isFin = part > 0.5 && part < 7.5;
		let rd = abs( fract( D.w + 0.5 ) - 0.5 );
		let ray = ( 1.0 - smoothstep( 0.0, 0.25, rd ) ) * 0.0004;
		bumpH = select( select( 0.0, ray, isFin ), bodyH, isBody ) * L;
	}
	let dhdx = dpdx( bumpH ); let dhdy = dpdy( bumpH );`;

function surface( prop, lodFade ) {

	return /* wgsl */`
	${ COMMON }
	${ lodFade ? FADE_DISCARD : '' }
	var rough = 0.4;
	var metal = 0.0;
	var transl = 0.0;
	var coat = 0.0;
	var spec = 0.5;
	let seed = I.y; let L = I.z;
	let pat = pattern;
	let P = part;
	let u = D.x; let h = D.w; let sd = D.z;
	let z = Lp.z; let y = Lp.y;
	let t = D.z; let w = D.w; // fins: along / across the rays
	let isBody = P == ${ PA( 'BODY' ) };
	let isFin = P > 0.5 && P < 7.5;
	let bodyK = select( 0.0, 1.0, isBody );
	let r0 = fishRow( pat, 0 ); let r1 = fishRow( pat, 1 ); let r2 = fishRow( pat, 2 ); let r3 = fishRow( pat, 3 );
	let r4 = fishRow( pat, 4 ); let r5 = fishRow( pat, 5 ); let r6 = fishRow( pat, 6 ); let r7 = fishRow( pat, 7 );
	let back = r0.xyz; let flank = r1.xyz; let belly = r2.xyz;
	let finC = r3.xyz; let edgeC = r4.xyz; let irisC = r5.xyz;
	let eye = r6; let lat = r7;
	let flags = in.vs.vFishFlags;
	let n1 = fishVnoise( vec2f( z, y ) * 38.0 + seed * 17.0 );
	let n2 = fishVnoise( vec2f( z, sd ) * 11.0 + seed * 5.0 );
	let fwW = fwidth( w ); let fwH = fwidth( h );

	// ---- counter-shading
	let tBack = smoothstep( 0.2, 0.75, h );
	let tBelly = 1.0 - smoothstep( -0.7, -0.1, h );
	var c = mix( mix( flank, back, tBack ), belly, tBelly );
	let silver = 1.0 - tBack * 0.75; // guanine reflection weight
	metal = r0.w * silver * bodyK;
	rough = r2.w;
	// scales: a thin shadow line under each free margin, the exposed field slightly brighter
	// toward the margin
	let scaleShade = smoothstep( 0.3, 0.9, sf ) * sfade * scaleVis;
	let pocket = smoothstep( 0.88, 0.97, sf ) * ( 1.0 - smoothstep( 0.97, 1.0, sf ) ) * sfade * scaleVis;
	let cellK = ( fishHash( vec2f( floor( sa + floor( sb ) * 0.5 ), floor( sb ) ) ) - 0.5 ) * 0.1 * sfade * scaleVis;
	// (on silvery skin the pocket is a thin line: the mirror-like scale reflects its own light)
	c *= mix( 1.0, 0.96 + scaleShade * 0.07 - pocket * mix( 0.14, 0.06, r0.w ) + cellK, bodyK );
	c *= mix( 1.0, n1 * 0.14 + 0.93, bodyK );
	c *= mix( 1.0, n2 * 0.2 + 0.9, bodyK );
	rough = mix( rough, rough * mix( 0.8, 1.25, n2 ), bodyK );

	// ---- fins: ray-striped membranes, darker and thinner toward the edge
	if ( isFin && P != ${ PA( 'FINLET' ) } ) {
		var fin = mix( finC, edgeC, smoothstep( 0.4, 1.0, t ) );
		let rd = abs( fract( w + 0.5 ) - 0.5 );
		let rayW = select( 0.06, 0.1, P == ${ PA( 'DORSAL1' ) } );
		let ray = ( 1.0 - smoothstep( rayW, fwW * 1.2 + rayW + 0.04, rd ) ) * ( 1.0 - smoothstep( 0.2, 0.6, fwW ) );
		fin *= mix( 0.9, 1.06, ray );
		// thicker and darker where the fin joins the body, thinnest at the edge
		fin *= smoothstep( 0.0, 0.15, t ) * 0.2 + 0.8;
		c = fin;
		transl = mix( 0.8, 0.55, ray ) * ( smoothstep( 0.0, 0.3, t ) * 0.4 + 0.6 );
		// paired fins: the fin colour, a little lighter toward the edge (thin membrane)
		let paired = P == ${ PA( 'PECTORAL' ) } || P == ${ PA( 'PELVIC' ) };
		c = select( c, c * mix( 0.85, 1.1, smoothstep( 0.2, 1.0, t ) ), paired );
		transl *= select( 1.0, 0.45, paired );
		rough = 0.4;
	}

	// ---- species markings (body; some on fins)
	if ( pat == ${ PT( 'silverside' ) } ) {
		// silver lateral band with a dark upper edge; translucent green back
		let bandK = fishBand( h, 0.02, 0.1, fwH + 0.05 ) * bodyK;
		c = mix( c, vec3f( 0.78, 0.82, 0.84 ), bandK * 0.8 );
		c = mix( c, vec3f( 0.12, 0.2, 0.2 ), fishBand( h, 0.14, 0.015, fwH + 0.02 ) * bodyK * 0.6 );
		metal += bandK * 0.25;
	} else if ( pat == ${ PT( 'chromis' ) } ) {
		// dark margins on the tail lobes, azure line from the snout through the eye
		let lobe = select( 0.0, smoothstep( 5.5, 7.5, abs( w - 8.0 ) ), P == ${ PA( 'CAUDAL' ) } );
		c = mix( c, vec3f( 0.01, 0.015, 0.03 ), lobe );
		let lineK = fishBand( y - ( z - eye.x ) * 0.35, eye.y + 0.015, 0.004, 0.003 ) * smoothstep( eye.x - 0.02, eye.x + 0.05, z ) * bodyK;
		c = mix( c, vec3f( 0.3, 0.6, 0.95 ), lineK * 0.7 );
	} else if ( pat == ${ PT( 'grunt' ) } ) {
		// French grunt: yellow with oblique blue-silver stripes (straight above the lateral
		// line); bluestriped grunt: straight blue stripes. Red mouth.
		let blue = fract( seed * 3.7 ) < 0.4;
		let above = smoothstep( 0.35, 0.45, h );
		let slope = select( mix( 0.45, 0.0, above ), 0.0, blue );
		let sv = sin( ( y - z * slope ) * select( 150.0, 190.0, blue ) );
		let stripe = smoothstep( 0.45, 0.8, sv ) * bodyK * ( 1.0 - tBelly * 0.7 );
		let lineC = select( vec3f( 0.52, 0.6, 0.7 ), vec3f( 0.12, 0.26, 0.55 ), blue );
		c = mix( c, lineC, stripe * select( 0.7, 0.9, blue ) );
	} else if ( pat == ${ PT( 'yellowtail' ) } ) {
		// yellow stripe from the snout widening into the yellow tail; yellow spots on the back
		let wS = mix( 0.006, 0.035, smoothstep( 0.1, -0.25, z ) );
		let stripe = fishBand( y - 0.004, 0.0, wS, 0.004 ) * bodyK;
		let qq = vec2f( z, y ) * 70.0;
		let cell = floor( qq );
		let j = ( vec2f( fishHash( cell + 3.1 ), fishHash( cell + 7.7 ) ) - 0.5 ) * 0.5;
		let rr = fishHash( cell + 1.3 ) * 0.14 + 0.1;
		let spots = ( 1.0 - smoothstep( rr, rr + 0.12, length( fract( qq ) - 0.5 - j ) ) ) * step( 0.4, fishHash( cell + seed ) ) * tBack * bodyK;
		c = mix( c, vec3f( 0.85, 0.62, 0.05 ), max( stripe, spots * 0.8 ) );
		c = mix( c, vec3f( 0.86, 0.66, 0.06 ), select( 0.0, 1.0, P == ${ PA( 'CAUDAL' ) } ) );
	} else if ( pat == ${ PT( 'tang' ) } ) {
		// fine dark wavy lines, pale scalpel at the tail base
		let lines = smoothstep( 0.75, 0.95, sin( y * 170.0 + z * 30.0 + n1 * 3.0 ) ) * 0.3 * bodyK;
		c *= 1.0 - lines;
		let spine = ( 1.0 - smoothstep( 0.01, 0.02, length( vec2f( z + 0.27, y * 1.5 ) ) ) ) * bodyK;
		c = mix( c, vec3f( 0.85, 0.8, 0.55 ), spine );
		c = mix( c, edgeC, select( 0.0, smoothstep( 0.8, 1.0, t ), isFin ) );
	} else if ( pat == ${ PT( 'sergeant' ) } ) {
		// five black bars from behind the head to the tail stalk (a faint sixth on the peduncle), a dark
		// spot at the base of the pectoral fin
		let barsP = smoothstep( 0.45, 0.7, sin( ( z - 0.215 ) * 52.0 + 1.57 ) ) * smoothstep( -0.29, -0.24, z ) * ( 1.0 - smoothstep( 0.225, 0.26, z ) );
		let sixth = fishBand( z, -0.33, 0.012, 0.01 ) * 0.4;
		let bars = max( barsP, sixth ) * ( 1.0 - tBelly * 0.8 );
		c = mix( c, vec3f( 0.02, 0.02, 0.03 ), bars * select( select( 0.0, 0.4, isFin ), 0.92, isBody ) );
		let pecSpot = ( 1.0 - smoothstep( 0.012, 0.02, length( vec2f( z - eye.w + 0.03, y + 0.005 ) ) ) ) * bodyK;
		c = mix( c, vec3f( 0.03, 0.035, 0.05 ), pecSpot * 0.8 );
	} else if ( pat == ${ PT( 'wrasse' ) } ) {
		// bluehead wrasse: yellow initial phase with a dark midlateral stripe; blue-headed males
		let male = fract( seed * 7.1 ) < 0.15;
		let stripe = fishBand( h, 0.05, 0.1, fwH + 0.04 ) * bodyK * smoothstep( 0.25, 0.1, z );
		let female = mix( c, vec3f( 0.04, 0.04, 0.03 ), stripe * 0.9 );
		let head = smoothstep( 0.12, 0.17, z );
		let collar = fishBand( z, 0.13, 0.012, 0.006 );
		let maleC = mix( mix( vec3f( 0.1, 0.42, 0.28 ), vec3f( 0.05, 0.14, 0.62 ), head ), vec3f( 0.02, 0.02, 0.02 ), collar * bodyK );
		c = select( female, maleC, male );
	} else if ( pat == ${ PT( 'parrot' ) } ) {
		// stoplight (terminal phase: green, pink / orange marks, yellow spot on the gill cover)
		// or queen parrotfish (blue-green, orange-pink marks around the mouth)
		let queen = fract( seed * 4.3 ) < 0.4;
		let base = select( vec3f( 0.1, 0.42, 0.26 ), vec3f( 0.06, 0.34, 0.42 ), queen );
		c = mix( c, base * mix( 0.8, 1.1, scaleShade ), bodyK * 0.75 );
		let mark = fishBand( y - ( z - 0.3 ) * 0.4, -0.03, 0.008, 0.008 ) * smoothstep( 0.18, 0.35, z ) * bodyK;
		c = mix( c, select( vec3f( 0.85, 0.45, 0.32 ), vec3f( 0.75, 0.42, 0.28 ), queen ), mark );
		let spot = ( 1.0 - smoothstep( 0.01, 0.02, length( vec2f( z - eye.w - 0.02, y - 0.05 ) ) ) ) * bodyK;
		c = mix( c, vec3f( 0.88, 0.72, 0.12 ), spot * select( 1.0, 0.0, queen ) );
	} else if ( pat == ${ PT( 'angel' ) } ) {
		// French angelfish: black, yellow rims on the scales, yellow face and eye ring
		let rims = smoothstep( 0.72, 0.95, sf ) * max( sfade, 0.35 ) * bodyK;
		c = mix( c, vec3f( 0.62, 0.48, 0.06 ), rims * 0.6 );
		let face = smoothstep( 0.4, 0.43, z ) * bodyK;
		c = mix( c, vec3f( 0.55, 0.45, 0.2 ), face * 0.6 );
		let er0 = length( vec2f( z - eye.x, y - eye.y ) ) / eye.z;
		let ringA = smoothstep( 1.05, 1.2, er0 ) * ( 1.0 - smoothstep( 1.45, 1.65, er0 ) ) * bodyK;
		c = mix( c, vec3f( 0.7, 0.52, 0.06 ), ringA * 0.85 );
	} else if ( pat == ${ PT( 'barracuda' ) } ) {
		// dark oblique bars on the upper flank, black blotches on the lower rear flank
		let bars = smoothstep( 0.35, 0.8, sin( z * 58.0 + h * 1.5 + n1 ) ) * smoothstep( 0.2, 0.55, h ) * bodyK;
		c *= 1.0 - bars * 0.45;
		let bl = smoothstep( 0.6, 0.78, n2 ) * smoothstep( 0.1, -0.25, z ) * ( 1.0 - smoothstep( -0.3, 0.2, h ) ) * bodyK;
		c = mix( c, vec3f( 0.03, 0.03, 0.035 ), bl * 0.9 );
		c = mix( c, vec3f( 0.75, 0.78, 0.8 ), select( 0.0, smoothstep( 0.85, 1.0, t ) * smoothstep( 5.0, 7.0, abs( w - 8.0 ) ), P == ${ PA( 'CAUDAL' ) } ) );
	} else if ( pat == ${ PT( 'redSnapper' ) } ) {
		// rose red back fading to a silvery pink belly; rows of scales show as fine oblique lines
		let rows = smoothstep( 0.6, 0.95, sin( y * 210.0 + z * 120.0 ) ) * max( sfade, 0.3 ) * bodyK * 0.15;
		c *= 1.0 - rows;
	} else if ( pat == ${ PT( 'grouper' ) } ) {
		// Nassau grouper: dark brown bars, a band from the snout through the eye, a black saddle
		// on the tail stalk, dark spots around the eye
		let zz = 0.5 - z;
		let wob = ( n2 - 0.5 ) * 0.03;
		let bars = smoothstep( 0.2, 0.6, sin( ( zz + wob ) * 34.0 - 1.2 ) ) * smoothstep( 0.3, 0.38, zz ) * smoothstep( 0.86, 0.78, zz ) * ( 1.0 - tBelly * 0.85 );
		let stripe = fishBand( y - eye.y - ( z - eye.x ) * 0.25, 0.0, 0.008, 0.006 ) * smoothstep( eye.x - 0.08, eye.x, z ) * smoothstep( 0.5, 0.45, z );
		let saddle = smoothstep( 0.4, 0.7, h ) * fishBand( zz, 0.8, 0.025, 0.01 );
		let spots = smoothstep( 0.72, 0.85, fishVnoise( vec2f( z, y ) * 160.0 + seed * 3.0 ) ) * smoothstep( eye.x - 0.12, eye.x, z );
		let dark = max( max( bars * 0.85, stripe * 0.85 ), max( saddle, spots * 0.7 ) ) * bodyK;
		c = mix( c, vec3f( 0.13, 0.085, 0.05 ), dark );
		let pale = smoothstep( 0.86, 0.93, fishVnoise( vec2f( z, y ) * 150.0 + 9.0 ) ) * bodyK * 0.2;
		c = mix( c, vec3f( 0.85, 0.8, 0.72 ), pale );
	} else if ( pat == ${ PT( 'tuna' ) } ) {
		// blackfin tuna: sharp dark back, bronze band, pale bars on the belly, dusky yellow finlets
		let bronze = fishBand( h, 0.28, 0.05, fwH + 0.06 ) * smoothstep( 0.3, 0.2, z ) * bodyK;
		c = mix( c, vec3f( 0.42, 0.34, 0.14 ), bronze * 0.6 );
		c = mix( c, back, smoothstep( 0.28, 0.4, h ) * bodyK );
		let bars = smoothstep( 0.6, 0.9, sin( z * 95.0 ) ) * smoothstep( 0.0, -0.3, h ) * smoothstep( 0.2, 0.1, z ) * bodyK;
		c = mix( c, vec3f( 0.85, 0.88, 0.9 ), bars * 0.35 );
		c = mix( c, vec3f( 0.55, 0.48, 0.16 ), select( 0.0, 0.85, P == ${ PA( 'FINLET' ) } ) );
	} else if ( pat == ${ PT( 'mahi' ) } ) {
		// mahi-mahi: blue-green back, golden flanks with scattered blue spots
		let cell = floor( vec2f( z, y ) * 55.0 );
		let jit = vec2f( fishHash( cell + 3.1 ), fishHash( cell + 7.7 ) ) - 0.5;
		let fc = fract( vec2f( z, y ) * 55.0 ) - 0.5 - jit * 0.55;
		let rs = mix( 0.1, 0.24, fishHash( cell + 1.3 ) );
		let spots = ( 1.0 - smoothstep( rs, rs + 0.1, length( fc * vec2f( 1.0, 1.25 ) ) ) ) * step( 0.45, fishHash( cell + seed * 7.0 ) ) * bodyK * ( 1.0 - tBelly );
		c = mix( c, vec3f( 0.08, 0.22, 0.5 ), spots * 0.75 );
		c = mix( c, vec3f( 0.2, 0.5, 0.3 ), smoothstep( 0.0, 0.5, h ) * bodyK * 0.35 );
	} else if ( pat == ${ PT( 'mullet' ) } ) {
		// faint dark stripes along the scale rows of the upper flank
		let lines = smoothstep( 0.7, 0.95, sin( sd * 280.0 ) ) * smoothstep( -0.1, 0.3, h ) * bodyK * 0.25;
		c *= 1.0 - lines;
	} else if ( pat == ${ PT( 'needlefish' ) } ) {
		// dark blue lateral stripe, dark beak
		let stripe = fishBand( h, 0.0, 0.06, fwH + 0.05 ) * bodyK;
		c = mix( c, vec3f( 0.12, 0.25, 0.45 ), stripe * 0.6 );
		c = mix( c, vec3f( 0.12, 0.16, 0.16 ), smoothstep( 0.32, 0.36, z ) * bodyK * 0.7 );
	} else if ( pat == ${ PT( 'jack' ) } ) {
		// bar jack: black stripe along the base of the dorsal fin into the lower tail lobe,
		// electric blue below it
		let top = fishBand( h, 0.82, 0.06, fwH + 0.05 ) * smoothstep( 0.2, 0.05, z ) * bodyK;
		let blue = fishBand( h, 0.68, 0.05, fwH + 0.05 ) * smoothstep( 0.2, 0.05, z ) * bodyK;
		c = mix( c, vec3f( 0.15, 0.45, 0.9 ), blue * 0.5 );
		c = mix( c, vec3f( 0.02, 0.03, 0.05 ), top * 0.85 );
		let lobe = select( 0.0, smoothstep( 7.5, 5.5, w ) * smoothstep( 0.1, 0.3, t ), P == ${ PA( 'CAUDAL' ) } );
		c = mix( c, vec3f( 0.02, 0.03, 0.05 ), lobe * 0.8 );
	} else if ( pat == ${ PT( 'tarpon' ) } ) {
		// huge scales with dark edges
		let rims = smoothstep( 0.8, 0.97, sf ) * sfade * bodyK;
		c *= 1.0 - rims * 0.35;
	}

	// ---- lateral line (a row of pores along a dark line)
	let hl = lat.x + lat.y * ( 1.0 - smoothstep( 0.12, 0.55, u ) );
	let lineK = fishBand( h, hl, fwH * 0.5 + 0.012, fwH + 0.008 ) * bodyK * smoothstep( 0.18, 0.25, u ) * smoothstep( 0.9, 0.8, u );
	c *= 1.0 - lineK * 0.3;

	// ---- gill cover edge and the preopercle (dark creases); gills show red on dead fish
	let zE = fishOpercleEdge( eye.w, h );
	let dOp = z - zE;
	let onOp = fishOpercleMask( h ) * bodyK;
	let crease = ( 1.0 - smoothstep( 0.0015, 0.004, abs( dOp ) ) ) * onOp;
	c *= 1.0 - crease * 0.45;
	let pre = ( 1.0 - smoothstep( 0.001, 0.003, abs( dOp - 0.04 ) ) ) * onOp * smoothstep( 0.6, 0.2, h );
	c *= 1.0 - pre * 0.2;
	let gill = smoothstep( 0.0, -0.0015, dOp ) * smoothstep( -0.007, -0.003, dOp ) * onOp * smoothstep( 0.0, -0.5, h ) * flags.w;
	c = mix( c, vec3f( 0.3, 0.03, 0.035 ), gill * 0.8 );

	// ---- lips (the mouth line from the snout to the corner), the edge of the upper jaw bone
	// and the nostrils
	let hz = lat.z; let hy = lat.w; let tipY = r3.w;
	let mt = clamp( ( z - hz ) / ( 0.5 - hz ), 0.0, 1.0 );
	let yLip = mix( hy, tipY, mt );
	let lips = ( 1.0 - smoothstep( 0.0015, 0.0035, abs( y - yLip ) ) ) * step( hz - 0.004, z ) * bodyK;
	c *= 1.0 - lips * 0.55;
	let maxZ = hz + 0.006 - ( y - hy ) * 0.35;
	let maxilla = ( 1.0 - smoothstep( 0.001, 0.0025, abs( z - maxZ ) ) ) * smoothstep( hy - 0.002, hy + 0.002, y ) * smoothstep( hy + 0.04, hy + 0.025, y ) * bodyK;
	c *= 1.0 - maxilla * 0.3;
	let nostril = ( 1.0 - smoothstep( 0.1, 0.2, length( vec2f( z - eye.x - eye.z * 1.7, y - eye.y - eye.z * 0.25 ) ) / eye.z ) ) * bodyK;
	c *= 1.0 - nostril * 0.6;

	// ---- painted eye (under the dome where there is one)
	let er = length( vec2f( z - eye.x, y - eye.y ) ) / eye.z;
	let painted = ( 1.0 - smoothstep( 0.95, 1.1, er ) ) * bodyK;
	c = mix( c, fishEyeCol( er, atan2( y - eye.y, z - eye.x ), irisC, flags.x ), painted );
	metal *= 1.0 - painted;

	// ---- eye dome: pupil, iris, glossy cornea
	if ( P == ${ PA( 'EYE' ) } ) {
		let r = length( vec2f( t, w ) );
		c = fishEyeCol( r, atan2( w, t ), irisC, flags.x );
		c = mix( c, flank * 0.6, smoothstep( 0.93, 1.0, r ) );
		rough = mix( 0.04, 0.3, flags.x );
		spec = 1.0;
		metal = 0.0;
	} else if ( P == ${ PA( 'MOUTH' ) } ) {
		// inside of the mouth: pale pink lips to a dark throat (grunts are red inside)
		let lip = select( vec3f( 0.5, 0.3, 0.3 ), vec3f( 0.6, 0.08, 0.06 ), pat == ${ PT( 'grunt' ) } );
		c = mix( lip, vec3f( 0.03, 0.012, 0.012 ), smoothstep( 0.05, 0.85, t ) );
		metal = 0.0;
		rough = 0.35;
	} else if ( P == ${ PA( 'FLESH' ) } ) {
		// cut face: muscle rings around the backbone, bone and blood at the centre
		let r = length( vec2f( t, w * 1.2 ) );
		let dark = select( 0.0, 1.0, pat == ${ PT( 'tuna' ) } );
		let meat = mix( vec3f( 0.62, 0.36, 0.32 ), vec3f( 0.3, 0.035, 0.035 ), dark );
		let rings = smoothstep( 0.6, 0.95, sin( r * 520.0 + atan2( w, abs( t ) ) * 2.0 ) ) * 0.12;
		var m = meat * ( 1.0 - rings );
		let bone = 1.0 - smoothstep( 0.006, 0.009, length( vec2f( t, w - 0.004 ) ) );
		m = mix( m, vec3f( 0.75, 0.68, 0.58 ), bone );
		m = mix( m, vec3f( 0.3, 0.02, 0.02 ), ( 1.0 - smoothstep( 0.01, 0.03, r ) ) * 0.5 * ( 1.0 - bone ) );
		// skin rim
		c = m;
		metal = 0.0;
		rough = 0.3;
		transl = 0.3;
	} else if ( P == ${ PA( 'FILLET' ) } ) {
		// salted, sun dried flesh: pale and translucent at the thin edges, muscle chevrons,
		// salt crystals
		let ax = abs( t );
		let chev = smoothstep( 0.55, 0.9, sin( ( w + ax * 0.35 ) * 160.0 ) ) * 0.1;
		var m = mix( vec3f( 0.36, 0.26, 0.13 ), vec3f( 0.52, 0.42, 0.26 ), smoothstep( 0.35, 1.0, ax ) ) * ( 1.0 - chev );
		let salt = step( 0.94, fishHash( floor( vec2f( t, w ) * 900.0 ) ) );
		m = mix( m, vec3f( 0.8, 0.8, 0.78 ), salt * 0.6 );
		m *= mix( 0.9, 1.05, n1 );
		c = m;
		metal = 0.0;
		rough = 0.6;
		transl = mix( 0.25, 0.8, smoothstep( 0.5, 1.0, ax ) );
	} else if ( P == ${ PA( 'ICE' ) } ) {
		// glassy crushed ice: dim albedo (light passes into it), sharp glints
		c = vec3f( 0.3, 0.4, 0.46 ) * mix( 0.8, 1.15, fract( t * 7.3 ) );
		rough = mix( 0.04, 0.2, fract( w * 5.1 ) );
		metal = 0.0;
		transl = 0.9;
		spec = 1.0;
	} else if ( P == ${ PA( 'LEAF' ) } ) {
		// banana leaf: glossy green, pale midrib, fine parallel veins
		let ax = abs( t );
		let veins = smoothstep( 0.6, 0.95, sin( w * 420.0 + ax * 60.0 ) ) * 0.12;
		var lc = mix( vec3f( 0.025, 0.08, 0.015 ), vec3f( 0.05, 0.13, 0.025 ), n2 ) * ( 1.0 - veins );
		lc = mix( lc, vec3f( 0.25, 0.3, 0.1 ), 1.0 - smoothstep( 0.015, 0.03, ax ) );
		lc = mix( lc, vec3f( 0.25, 0.22, 0.08 ), smoothstep( 0.9, 1.0, ax ) * 0.6 );
		c = lc;
		metal = 0.0;
		rough = 0.28;
		transl = 0.25;
	} else if ( P == ${ PA( 'DISC' ) } || P == ${ PA( 'WHIP' ) } ) {
		// rays: sandy, finely mottled back (stingray) or black with white rings (eagle ray);
		// white belly
		let top = w > 0.0;
		let eagleK = select( 0.0, 1.0, pat == ${ PT( 'eagleRay' ) } );
		let qq = vec2f( Lp.x, Lp.z ) * 20.0;
		let cell = floor( qq );
		let jit = ( vec2f( fishHash( cell + 1.7 ), fishHash( cell + 5.3 ) ) - 0.5 ) * 0.4;
		let rad = fishHash( cell + 9.1 ) * 0.14 + 0.12;
		let ring = abs( length( fract( qq ) - 0.5 - jit ) - rad );
		let spots = ( 1.0 - smoothstep( 0.035, 0.075, ring ) ) * step( 0.45, fishHash( cell ) );
		let mottle = fishVnoise( vec2f( Lp.x, Lp.z ) * 60.0 ) * 0.25 + n2 * 0.2 + 0.7;
		var dorsal = mix( back * mottle, mix( back, vec3f( 0.75, 0.78, 0.8 ), spots * 0.85 ), eagleK );
		dorsal = mix( dorsal, edgeC, smoothstep( 0.8, 1.0, t ) * 0.4 * ( 1.0 - eagleK ) );
		c = select( belly, dorsal, top );
		c = select( c, finC, P == ${ PA( 'WHIP' ) } );
		metal = 0.0;
		rough = r2.w;
	} else if ( P == ${ PA( 'CARAPACE' ) } ) {
		// green turtle shell: scutes (vertebral row, costals, marginals) with dark seams and
		// radiating olive / brown / amber streaks
		let X = t; let Y = w;
		let ax = abs( X );
		let rr = length( vec2f( X, Y ) );
		let vert = ax < 0.3;
		let ySeams = select( vec4f( -0.42, -0.02, 0.36, 2.0 ), vec4f( -0.58, -0.22, 0.14, 0.5 ), vert );
		let yc = Y + ax * ax * 0.25;
		let dY = min( min( abs( yc - ySeams.x ), abs( yc - ySeams.y ) ), min( abs( yc - ySeams.z ), abs( yc - ySeams.w ) ) );
		let dX = abs( ax - 0.3 );
		let marg = rr > 0.84;
		let angle = atan2( Y, X );
		let dM = min( abs( rr - 0.84 ), abs( fract( angle * ${ f( 12 / Math.PI ) } ) - 0.5 ) * 0.25 );
		let seam = min( select( min( dY, dX ), dM, marg ), abs( rr - 0.84 ) );
		let streak = sin( atan2( yc - ( floor( yc * 2.8 ) + 0.5 ) / 2.8, X - sign( X ) * 0.55 ) * 11.0 + n2 * 6.0 ) * 0.5 + 0.5;
		let blotch = smoothstep( 0.45, 0.8, fishVnoise( vec2f( X, Y ) * 9.0 ) );
		var shell = mix( back, flank, streak * 0.55 + blotch * 0.45 );
		shell = mix( shell, vec3f( 0.2, 0.14, 0.06 ), smoothstep( 0.6, 0.9, n1 ) * 0.4 );
		shell *= mix( 0.45, 1.0, smoothstep( 0.003, 0.012, seam ) );
		c = shell;
		metal = 0.0;
		rough = 0.35;
	} else if ( P == ${ PA( 'SKIN' ) } || P == ${ PA( 'FLIPPER' ) } ) {
		// scaly grey-brown skin with pale scale margins; pale yellow plastron
		let qq = vec2f( Lp.x + Lp.y, Lp.z ) * 55.0;
		let rowS = floor( qq.y );
		let q2 = qq + vec2f( rowS * 0.5, 0.0 );
		let ff = fract( q2 ) - 0.5;
		let scale = smoothstep( 0.32, 0.47, max( abs( ff.x ), abs( ff.y ) ) );
		let tone = fishHash( floor( q2 ) ) * 0.35 + 0.8;
		let skin = mix( finC * tone, edgeC, scale * 0.45 );
		c = select( skin, belly * mix( 0.85, 1.05, n1 ), w > 1.5 && P == ${ PA( 'SKIN' ) } );
		metal = 0.0;
		rough = 0.5;
	} else if ( P == ${ PA( 'SHELL' ) } ) {
		// spiny lobster: red-brown carapace with cream spots, banded legs
		let sp = vec2f( t, w ) * 12.0;
		let spots = ( 1.0 - smoothstep( 0.18, 0.3, length( fract( sp ) - 0.5 ) ) ) * step( 0.6, fishHash( floor( sp ) ) );
		var sh = mix( vec3f( 0.16, 0.045, 0.03 ), vec3f( 0.32, 0.1, 0.04 ), n1 );
		sh = mix( sh, vec3f( 0.7, 0.55, 0.22 ), spots * 0.85 );
		c = sh;
		metal = 0.0;
		rough = 0.35;
	}
${ prop ? /* wgsl */`
	// ---- props: dull, drying skin; wet sheen; salted skin
	c = mix( c, vec3f( luminance( c ) ), flags.z * 0.55 * bodyK );
	c *= mix( 1.0, 0.85, flags.z * bodyK );
	metal *= 1.0 - flags.z;
	rough = mix( rough, rough * 0.55, flags.y );
	coat = flags.y * select( select( 0.0, 0.25, isFin ), 0.6, isBody );
` : '' }
	// iridescent sheen on silvery skin at grazing angles
	let cosV = abs( dot( in.N, in.V ) );
	let irid = r1.w * bodyK * silver * ( 1.0 - cosV );
	let hueA = vec3f( 0.55, 0.95, 0.8 ); let hueB = vec3f( 0.95, 0.6, 1.0 );
	c = mix( c, c * mix( hueA, hueB, cosV ) * 1.25, irid * 0.6 );

	s.albedo = c;
	s.roughness = rough;
	s.metalness = metal;
	// The reference (three r186) reads specularIntensityNode (the 'fishSpec' var) before the colour
	// function assigns it, so the var reads its zero default there: the fish have no dielectric
	// specular in the reference (only metal / grazing reflections; verified headless against the
	// original: with a constant 0.5 it gains exactly the port's highlights). FISH_SPECULAR selects: 'reference' (look of the three.js app) or 'intended' (0.5,
	// 1.0 on eyes and ice, as the code was written).
	s.specularIntensity = ${ FISH_SPECULAR === 'reference' ? '0.0 * spec' : 'spec' };
	s.normal = perturbNormalByHeight( in.P, in.N, dhdx, dhdy, 1.0 );
	// translucencyNode: lightColor * albedo * transl * 0.5 (the engine multiplies by the light)
	s.translucency = c * ( transl * 0.5 );
${ prop ? '\ts.clearcoat = coat;\n\ts.clearcoatRoughness = 0.2;\n' : '' }`;

}

// props: thin fin membranes let some light through: stochastic transparency, resolved by the
// temporal anti-aliasing (the rays stay opaque)
const PROP_MASK = /* wgsl */`
	{
		let Dm = in.vs.vFishData;
		let partM = fishPartOf( Dm );
		let finM = partM > 0.5 && partM < 6.5;
		let rayM = 1.0 - smoothstep( 0.07, 0.14, abs( fract( Dm.w + 0.5 ) - 0.5 ) );
		let alphaM = select( 1.0, max( mix( 0.9, 0.55, smoothstep( 0.25, 1.0, Dm.z ) ), rayM ), finM );
		let dither = interleavedGradientNoise( in.pixel + fract( frame.time * 7.3 ) * 97.0 );
		if ( ! ( dither < alphaM ) ) { discard; }
	}`;

function baseMaterial( batch, name, extra ) {

	return new Material( {
		name,
		roughness: 0.4,
		metalness: 0,
		modules: [ fishModule(), batch.module ],
		attributes: { aData: 'vec4f', aKind: 'f32' },
		varyings: VARYINGS,
		...extra,
	} );

}

// ---------------------------------------------------------------------------

// Material of the swimming fish (batch: ReefBatch with the fish kinds).
// fade: the material of the batch's level-of-detail cross-fade channel
// Motion vectors: camera motion (as for static geometry) plus the fish's own motion (vertex stage).
export function createSwimMaterial( batch, { fade = false } = {} ) {

	return baseMaterial( batch, fade ? 'FishFade' : 'Fish', {
		vertex: swimVertex( batch, fade ),
		surface: surface( false, fade ),
	} );

}

// Material of the fish props: wet, glossy (clear coat), static.
export function createPropMaterial( batch, { fade = false } = {} ) {

	return baseMaterial( batch, fade ? 'FishPropsFade' : 'FishProps', {
		vertex: propVertex( batch, fade ),
		surface: PROP_MASK + surface( true, fade ),
		shadow: PROP_MASK + '\n\treturn true;',
		defines: { CLEARCOAT: 1 },
	} );

}
