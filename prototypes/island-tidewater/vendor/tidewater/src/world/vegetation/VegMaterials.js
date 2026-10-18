import { Material } from '../../engine/render/Material.js';
import { ShaderModule } from '../../engine/gpu/Shader.js';
import { vegModule, vegParams, LOD_BAND, C, f } from './VegNodes.js';

// Vegetation materials (engine Materials: WGSL vertex / surface snippets on the scene lighting).
//
// Port notes (TSL -> WGSL):
//  - three's positionNode ran after the instance node, so positionLocal / normalLocal were already
//    through the instance matrix: the vertex snippets do the same (v.model * position,
//    vegInstanceNormal) and write world positions (v.useWorld; the vegetation group is identity).
//  - maskNode -> `discard` in the surface snippet, and the same test in the shadow hook.
//  - normalNode is view space in three; here s.normal is world space: normalView -> in.N (flipped on
//    back faces), normalViewGeometry / normalWorldGeometry -> normalize( in.vs.normal ) (unflipped),
//    positionViewDirection -> in.V, normalFlat -> the face normal from derivatives of in.P.
//  - translucencyNode( lightColor ) -> s.translucency (the lighting multiplies by the shadowed light
//    colour).
//  - attributes read in the fragment stage travel as varyings (vMat, vIDat, vIPos ...).

// Coconut palm bark: irregular leaf-scar rings (uneven spacing, closer below the crown, wavy,
// partial), fine vertical fissures, grey-brown to silver weathering, lichen, dark stains and the
// root mass at the base, the fibrous old frond bases under the crown. Returns the albedo and a
// relief height (m) for the bump. y: height along the stem (m), a: 0..1 around, H: stem height.
const PALM_BARK = /* wgsl */`
struct VegBark { bark: vec3f, hd: f32 };
// (the last evaluation is remembered: the albedo and the trunk bump both ask for the same point)
var<private> vegBarkMemoKey: vec4f = vec4f( 3.0e38 );
var<private> vegBarkMemoIv: f32 = 3.0e38;
var<private> vegBarkMemo: VegBark;
fn vegPalmBark( y: f32, a: f32, H: f32, seed: f32, iv: f32 ) -> VegBark {
	let key = vec4f( y, a, H, seed );
	if ( all( key == vegBarkMemoKey ) && iv == vegBarkMemoIv ) { return vegBarkMemo; }
	vegBarkMemoKey = key;
	vegBarkMemoIv = iv;
	vegBarkMemo = _vegPalmBark( y, a, H, seed, iv );
	return vegBarkMemo;
}
fn _vegPalmBark( y: f32, a: f32, H: f32, seed: f32, iv: f32 ) -> VegBark {
	let A = a * 6.2832;
	let ca = cos( A ); let sa = sin( A );
	let yn = y / H;
	// rings: phase grows faster toward the crown, jittered per ring band and around the trunk
	let wob = ( vegNoise( vec2f( ca * 1.3 + y * 0.35, sa * 1.3 + seed * 9.0 ) ) - 0.5 ) * 0.7
		+ sin( A * 2.0 + y * 1.1 + seed * 5.0 ) * 0.1;
	let phase = y * mix( 8.5, 11.0, iv ) + pow( yn, 2.2 ) * H * 5.5 + vegNoise( vec2f( y * 0.8, seed * 7.3 ) ) * 3.2
		+ vegNoise( vec2f( y * 3.1, seed * 2.9 ) ) * 0.9 + wob;
	let k0 = floor( phase );
	// ragged ring edges: the scar line wanders a little around the trunk
	let phaseR = phase + ( vegNoise( vec2f( a * 38.0, k0 * 2.3 + seed * 5.0 ) ) - 0.5 ) * 0.22;
	let k = floor( phaseR );
	let fr = phaseR - k;
	// each ring scar has its own width and depth
	let rk = vegHash12( vec2f( k, seed * 13.7 ) );
	let gw = mix( 0.05, 0.14, rk );
	let groove = ( smoothstep( gw, 0.0, fr ) + smoothstep( 1.0 - gw * 0.6, 1.0, fr ) ) * mix( 0.45, 1.0, vegHash12( vec2f( k * 1.3, seed * 3.1 ) ) );
	let ridge = smoothstep( 0.07, 0.15, fr ) * smoothstep( 0.45, 0.16, fr );
	// partial rings: each ring fades out around part of the circumference
	let amp = smoothstep( 0.28, 0.6, vegNoise( vec2f( ca * 1.8 + k * 3.17, sa * 1.8 + k * 1.71 + seed * 11.0 ) ) ) * 0.75 + 0.25;
	// fine vertical fissures (level set of a vertically stretched noise) and bark plates
	let nf = vegNoise( vec2f( a * 54.0, y * 1.6 + seed * 41.0 ) );
	let nf2 = vegNoise( vec2f( a * 110.0, y * 3.4 + seed * 29.0 ) );
	// fissures: short, broken vertical splits (not continuous grain lines)
	let segA = smoothstep( 0.45, 0.62, vegNoise( vec2f( a * 30.0, y * 4.5 + seed * 9.0 ) ) );
	let segB = smoothstep( 0.5, 0.66, vegNoise( vec2f( a * 60.0 + 3.7, y * 9.0 + seed * 21.0 ) ) );
	let crack = max( smoothstep( 0.09, 0.0, abs( nf - 0.5 ) ) * segA, smoothstep( 0.06, 0.0, abs( nf2 - 0.5 ) ) * segB * 0.7 );
	let plate = vegNoise( vec2f( a * 24.0, y * 3.5 + seed * 17.0 ) );
	let blotch = vegNoise( vec2f( a * 6.0, y * 0.4 + seed * 13.0 ) );
	// grey-brown bark weathering to silver-grey, per palm
	var bark = mix( ${ C( 0x5e554a ) }, ${ C( 0xa49a88 ) }, sat( blotch * 0.55 + plate * 0.25 + ( iv - 0.5 ) * 0.5 + yn * 0.15 ) );
	// warmer tan on some trees and in patches, dark weathered (rain-soaked) blotches
	bark = mix( bark, bark * vec3f( 1.12, 1.0, 0.82 ), sat( ( vegNoise( vec2f( a * 4.0, y * 0.25 + seed * 31.0 ) ) - 0.4 ) * 2.0 ) * iv );
	bark = bark * mix( 1.0, 0.72, smoothstep( 0.6, 0.8, vegNoise( vec2f( a * 5.0, y * 0.7 + seed * 43.0 ) ) ) );
	// fine mottling (rough, fibrous surface) and pale sun-bleached patches
	let mott = vegNoise( vec2f( a * 90.0, y * 80.0 + seed * 7.0 ) ) * 0.6 + vegNoise( vec2f( a * 35.0, y * 30.0 + seed * 3.0 ) ) * 0.4;
	bark = bark * ( mott * 0.45 + 0.78 ) * ( plate * 0.25 + 0.88 );
	bark = mix( bark, ${ C( 0xb3ad9f ) }, smoothstep( 0.55, 0.75, vegNoise( vec2f( a * 8.0, y * 1.3 + seed * 61.0 ) ) ) * 0.35 * ( 1.0 - yn * 0.5 ) );
	bark = bark * mix( 1.0, 0.7, groove * amp ) * ( ridge * amp * 0.1 + 1.0 ) * mix( 1.0, 0.5, crack );
	// lichen: pale grey-green crusts and white spots, a little orange; darker rain streaks
	let lic = smoothstep( 0.6, 0.72, vegNoise( vec2f( a * 9.0, y * 2.1 + seed * 23.0 ) ) + ( vegNoise( vec2f( a * 31.0, y * 7.0 ) ) - 0.5 ) * 0.3 ) * smoothstep( 0.9, 0.2, yn );
	let licC = mix( ${ C( 0x8e917f ) }, ${ C( 0xa9a799 ) }, plate );
	bark = mix( bark, licC, lic * 0.5 );
	let streak = smoothstep( 0.62, 0.8, vegNoise( vec2f( a * 16.0, y * 0.12 + seed * 5.0 ) ) ) * smoothstep( 1.0, 0.6, yn );
	bark = bark * ( 1.0 - streak * 0.28 );
	// damp, dark base (splash of sand and soil) and the mass of exposed roots at the ground
	let baseK = smoothstep( 1.4, 0.2, y + ( blotch - 0.5 ) * 0.8 );
	bark = mix( bark, bark * vec3f( 0.62, 0.56, 0.48 ), baseK );
	let rootN = vegNoise( vec2f( a * 26.0, y * 2.2 + seed * 19.0 ) );
	let roots = smoothstep( 0.42, 0.05, y ) * smoothstep( 0.35, 0.6, rootN );
	bark = mix( bark, mix( ${ C( 0x3a2e22 ) }, ${ C( 0x5e4a36 ) }, rootN ), smoothstep( 0.5, 0.0, y ) * 0.85 );
	// fibrous old frond bases (boot) under the crown: criss-cross fibre mat, brown
	let boot = smoothstep( H - 1.0, H - 0.35, y + ( blotch - 0.5 ) * 0.3 );
	let fib = sin( A * 34.0 + y * 30.0 ) * sin( A * 34.0 - y * 30.0 ) * 0.5 + 0.5;
	bark = mix( bark, mix( ${ C( 0x4d3722 ) }, ${ C( 0x8a744c ) }, fib * 0.6 + plate * 0.4 ), boot );
	var o: VegBark;
	o.bark = bark;
	o.hd = ( ridge * amp * 0.004 - groove * amp * 0.008 - crack * 0.006 + plate * 0.004 + mott * 0.004 + roots * 0.01 ) * ( 1.0 - boot ) + boot * fib * 0.004;
	return o;
}
`;

const BROAD = /* wgsl */`
// Broadleaf plants (parts 6 monstera, 7 elephant ear, 8 heliconia leaf, 9 heliconia bract). Blade
// coordinates: y along the midrib (0 back of the basal lobes .. 1 tip), x across in units of the
// half-width W (m). Returns the outline half-width (x units) at y and whether a hole / slit / tear is
// cut at (y, x).
struct VegBroad { w: f32, cut: bool };
fn vegBroadShape( part: f32, y: f32, x: f32, age: f32, W: f32, fseed: f32, seed: f32 ) -> VegBroad {
	let ax = abs( x );
	var w = 0.0;
	var cut = false;
	// ragged, slightly irregular margin on every leaf (more on old ones)
	let rag = 1.0 - ( vegNoise( vec2f( y * 38.0 + select( 0.0, 17.0, x > 0.0 ), fseed * 31.0 ) ) * 0.05 + age * age * 0.12 * vegNoise( vec2f( y * 11.0, fseed * 7.0 + x ) ) );
	if ( part < 6.5 ) {
		// monstera: cordate blade, basal lobes behind the petiole, V sinus; mature leaves are split
		// from the margin between the primary veins, with a row of holes (fenestrations) inside
		let yb = 0.16;
		let g = ( y - yb ) / ( 1.0 - yb );
		if ( y >= yb ) {
			w = pow( max( sin( 3.14159 * min( 1.0, 0.4 + 0.6 * g ) ), 0.0 ), 0.8 ) * ( 1.0 - 0.15 * smoothstep( 0.8, 1.0, g ) );
		} else {
			let q = ( yb - y ) / yb;
			w = sqrt( max( 1.0 - q * q * q, 0.0 ) ) * 0.96;
			cut = ax < 0.3 * ( 1.0 - y / yb );
		}
		w *= rag;
		let matK = smoothstep( 0.28, 0.45, age );
		if ( matK > 0.0 && y > yb * 0.4 && y < 0.93 ) {
			let L = W / 0.47;
			let X = ax * W;
			let Y = ( y - yb ) * L;
			let p = ( Y - 0.55 * X ) / ( L * 0.8 / 5.5 ) + fseed * 0.37;
			let k = floor( p + 0.5 );
			let e = abs( p - k ); // 0 on the gap between two primary veins
			let hk = vegHash12( vec2f( k + select( 0.0, 50.0, x > 0.0 ), fseed * 19.3 ) );
			let r = ax / max( w, 0.05 );
			let depth = mix( 0.42, 0.75, hk ) + ( 1.0 - matK ) * 0.4;
			// slits widen toward the margin, their inner end rounded
			let slit = e < 0.035 + 0.1 * smoothstep( depth, 1.0, r ) && r > depth - 0.03;
			// fenestrations: one or two elongated holes along the gap line, inside the slit
			let r0 = 0.14; let r1 = depth - 0.1;
			let qh = ( r - r0 ) / max( r1 - r0, 0.05 );
			let nh = select( 1.0, 2.0, hk > 0.45 );
			let qq = fract( qh * nh );
			let hole = qh > 0.0 && qh < 1.0 && e < 0.16 * pow( sin( 3.14159 * qq ), 0.6 ) * matK && hk > 0.12;
			cut = cut || slit || hole;
		}
	} else if ( part < 7.5 ) {
		// elephant ear: peltate blade (petiole joins inside it), rounded basal lobes, acute tip
		let yb = 0.3;
		let g = ( y - yb ) / ( 1.0 - yb );
		if ( y >= yb ) {
			w = pow( max( sin( 3.14159 * min( 1.0, 0.5 + 0.5 * g ) ), 0.0 ), 0.85 );
		} else {
			let q = ( yb - y ) / yb;
			w = sqrt( max( 1.0 - pow( q, 1.6 ), 0.0 ) ) * 0.98;
			cut = y < 0.1 && ax < 0.2 * ( 1.0 - y / 0.1 );
		}
		w *= rag;
	} else if ( part < 8.5 || ( part > 9.5 && part < 10.5 ) ) {
		// heliconia / bird of paradise: paddle blade, torn along the lateral veins (more on old leaves)
		w = pow( max( sin( 3.14159 * min( y * 1.02, 1.0 ) ), 0.0 ), 0.5 ) * ( 1.0 - 0.3 * smoothstep( 0.75, 1.0, y ) ) * rag;
		let xl = y * 22.0 + ax * 1.2 + sin( y * 31.0 + fseed * 10.0 ) * 0.3;
		let k = floor( xl );
		let r1 = vegHash12( vec2f( k + select( 0.0, 40.0, x > 0.0 ), fseed * 7.7 ) );
		let r2 = vegHash12( vec2f( k + 0.5, fseed * 3.3 + seed ) );
		let fx = abs( fract( xl ) - 0.5 );
		cut = r1 < select( 0.12, 0.2, part > 9.5 ) + age * 0.45 && ax / max( w, 0.05 ) > mix( 0.25, 0.8, r2 ) && fx > 0.44;
	} else if ( part < 9.5 ) {
		// bract: boat-shaped, pointed
		w = sin( 3.14159 * min( 1.0, 0.15 + y * 0.9 ) ) * ( 1.0 - 0.4 * smoothstep( 0.7, 1.0, y ) );
	} else {
		// bird of paradise flower pieces: pointed
		w = sin( 3.14159 * min( 1.0, 0.1 + y * 0.9 ) ) * ( 1.0 - 0.5 * smoothstep( 0.6, 1.0, y ) );
	}
	if ( part < 7.5 ) {
		let dmg = vegNoise( vec2f( y * 26.0 + fseed * 17.0, x * 11.0 + seed * 9.0 ) );
		cut = cut || dmg > 0.95 - age * 0.08;
	}
	var o: VegBroad;
	o.w = w;
	o.cut = cut;
	return o;
}

fn vegBroadAlbedo( part: f32, y: f32, x: f32, age: f32, W: f32, fseed: f32, seed: f32, iv: f32, hGround: f32 ) -> vec3f {
	let ax = abs( x );
	let fr = vegHash12( vec2f( fseed * 51.3, seed * 17.9 ) );
	let n1 = vegNoise( vec2f( y * 9.0 + fseed * 13.0, x * 4.0 ) );
	let n2 = vegNoise( vec2f( y * 37.0 + fseed * 3.0, x * 17.0 + seed * 5.0 ) );
	var c = vec3f( 0.0 );
	if ( part < 6.5 ) {
		// monstera: deep glossy green, juvenile leaves lighter yellow-green, old ones yellowing
		var g = mix( ${ C( 0x223b15 ) }, ${ C( 0x324f1d ) }, iv * 0.6 + fr * 0.4 );
		g = mix( ${ C( 0x4f6f28 ) }, g, smoothstep( 0.1, 0.35, age ) );
		g = mix( g, ${ C( 0x9a913e ) }, smoothstep( 0.85, 0.97, age ) * ( 0.6 + 0.4 * n1 ) );
		c = g * ( n1 * 0.16 + 0.92 );
		// primary veins a touch paler, midrib pale
		let L = W / 0.47;
		let p = ( ( y - 0.16 ) * L - 0.55 * ax * W ) / ( L * 0.8 / 5.5 ) + fseed * 0.37;
		let rib = smoothstep( 0.1, 0.0, abs( fract( p ) - 0.5 ) ) * step( 0.16, y );
		c = c * ( 1.0 + rib * 0.12 );
		c = mix( c, ${ C( 0x80994a ) }, smoothstep( 0.03, 0.0, ax * W ) * 0.7 );
	} else if ( part < 7.5 ) {
		// elephant ear: mid green, pale veins radiating from where the petiole joins
		var g = mix( ${ C( 0x33581e ) }, ${ C( 0x4a7128 ) }, iv * 0.6 + fr * 0.4 );
		g = mix( g, ${ C( 0x98913f ) }, smoothstep( 0.85, 0.97, age ) * ( 0.6 + 0.4 * n1 ) );
		let ang = atan2( ax * W, ( y - 0.3 ) * W / 0.4 );
		let vein = smoothstep( 0.1, 0.0, abs( fract( ang * 2.6 ) - 0.5 ) - 0.38 ) * 0.7;
		c = g * ( n1 * 0.14 + 0.93 );
		c = mix( c, ${ C( 0x7f9658 ) }, vein * 0.35 + smoothstep( 0.025, 0.0, ax * W ) * step( 0.3, y ) * 0.5 );
	} else if ( part > 10.5 ) {
		// bird of paradise flower: beak green-grey with a purple-red keel, orange sepals, blue tongue
		let beak = mix( mix( ${ C( 0x5b6b4a ) }, ${ C( 0x6b2f3a ) }, smoothstep( 0.3, 0.9, ax ) * 0.7 ), ${ C( 0xc0703a ) }, smoothstep( 0.8, 1.0, y ) * 0.4 );
		let sepal = mix( ${ C( 0xe0741c ) }, ${ C( 0xf09a2a ) }, n1 );
		let tongue = mix( ${ C( 0x2c3f9a ) }, ${ C( 0x4058b8 ) }, n1 );
		return select( select( beak, sepal, age > 0.25 ), tongue, age > 0.75 );
	} else if ( part > 9.5 ) {
		// bird of paradise leaf: glaucous grey-green, pale midrib
		var g = mix( ${ C( 0x3e5a36 ) }, ${ C( 0x4f6a43 ) }, iv * 0.6 + fr * 0.4 );
		g = mix( g, ${ C( 0x8f8a4a ) }, smoothstep( 0.8, 0.95, age ) );
		c = g * ( n1 * 0.1 + 0.95 );
		c = mix( c, ${ C( 0xa3a878 ) }, smoothstep( 0.015, 0.0, ax * W ) * 0.6 );
	} else if ( part < 8.5 ) {
		var g = mix( ${ C( 0x365d20 ) }, ${ C( 0x4b7229 ) }, iv * 0.6 + fr * 0.4 );
		g = mix( g, ${ C( 0x8f8a3a ) }, smoothstep( 0.8, 0.95, age ) );
		c = g * ( ( sin( y * 180.0 + ax * 30.0 ) * 0.5 + 0.5 ) * 0.06 + 0.95 ) * ( n1 * 0.12 + 0.94 );
		c = mix( c, ${ C( 0xaab86e ) }, smoothstep( 0.02, 0.0, ax * W ) * 0.7 );
	} else {
		// heliconia bract: scarlet, yellow lip, green tip on the youngest (top) bracts
		c = mix( ${ C( 0x8e1a12 ) }, ${ C( 0xbd2a1a ) }, n1 * 0.6 + fr * 0.4 );
		c = mix( c, ${ C( 0xe3bd38 ) }, smoothstep( 0.62, 0.9, ax ) );
		c = mix( c, ${ C( 0x6c8a2e ) }, smoothstep( 0.8, 1.0, y ) * smoothstep( 0.6, 1.0, age ) * 0.7 );
		return c;
	}
	// weathering: browned dry margins and tips, fungal spots, splashed soil on low leaves
	let edge = smoothstep( 0.8, 1.0, ax + n2 * 0.25 - 0.1 ) * ( 0.25 + age * 0.9 );
	c = mix( c, mix( ${ C( 0x7b6639 ) }, ${ C( 0x5a4528 ) }, n2 ), sat( edge ) * 0.85 );
	let spot = vegNoise( vec2f( y * 14.0 + fseed * 9.0, x * 6.0 + seed * 3.0 ) );
	c = mix( c, ${ C( 0x5e5433 ) }, smoothstep( 0.86, 0.93, spot ) * 0.5 * ( 0.4 + age ) );
	c = mix( c, ${ C( 0x6c5c45 ) }, smoothstep( 0.55, 0.0, hGround ) * smoothstep( 0.5, 0.75, n2 ) * 0.5 );
	// dead leaves: brown and papery
	c = mix( c, mix( ${ C( 0x6e5634 ) }, ${ C( 0x8f7a4e ) }, n1 ), smoothstep( 0.93, 0.99, age ) );
	return c;
}

fn vegBroadStem( part: f32, a: f32, f: f32, seed: f32, age: f32 ) -> vec3f {
	let n = vegNoise( vec2f( a * 6.0, f * 30.0 + seed * 11.0 ) );
	if ( part < 6.5 ) { return mix( ${ C( 0x4a6a2a ) }, ${ C( 0x5c7c33 ) }, n ) * mix( 1.0, 0.8, smoothstep( 0.7, 1.0, age ) ); }
	if ( part < 7.5 ) { return mix( ${ C( 0x566a34 ) }, ${ C( 0x5d4a3c ) }, n * 0.5 ); }
	if ( part < 8.5 ) { return mix( mix( ${ C( 0x4a6b2e ) }, ${ C( 0x61773a ) }, n ), ${ C( 0x5a4a30 ) }, smoothstep( 0.6, 0.8, vegNoise( vec2f( a * 3.0, f * 8.0 + seed * 5.0 ) ) ) * 0.6 ); }
	if ( part > 9.5 ) { return mix( ${ C( 0x55664a ) }, ${ C( 0x6d7658 ) }, n ); }
	return ${ C( 0x8e1a12 ) };
}
`;

// Palms (trunk, coconuts, fronds), young palms, banana plants, ferns -------------------------
//
// aMat = (part, age / stem colour, leaflet length (m), frond seed); uv = (s along, t across)
// parts: 0 stem, 1 coconut frond, 2 fern frond, 3 banana leaf, 5 coconut

const plantModule = new ShaderModule( {
	name: 'vegPlant',
	deps: [ vegModule ],
	code: PALM_BARK + BROAD + /* wgsl */`
// alpha mask (fronds / pinnae / torn banana blades) + the LOD cross-fade of the instance
fn vegPlantMask( in: FragInput ) -> bool {
	let st = in.uv;
	let s = st.x;
	let t = st.y;
	let fwS = fwidth( s ); // evaluated in uniform control flow, before the branches
	let aMat = in.vs.vMat;
	let part = aMat.x; let age = aMat.y; let Ll = aMat.z; let fseed = aMat.w;
	let seed = in.vs.vIDat.w;
	var m = 1.0;
	if ( part > 0.5 && part < 1.5 ) {
		// coconut frond: ~95 narrow leaflets per side (100-125 on a real frond), separated by gaps
		// that show the sky; leaflets bunch and spread irregularly, some are short, split or torn
		// away (runs of missing leaflets, more on old fronds)
		let N = 95.0;
		let x = s * N + ( vegNoise( vec2f( s * 7.0, fseed * 23.0 + seed * 3.0 ) ) - 0.5 ) * 2.2;
		let k = floor( x );
		let r1 = vegHash12( vec2f( k, fseed * 91.7 ) );
		let r2 = vegHash12( vec2f( k * 1.37 + 3.1, fseed * 17.3 + seed * 5.0 ) );
		let fx = fract( x ) - 0.5 - ( r1 - 0.5 ) * 0.35;
		let tEnd = mix( 0.72, 1.0, r2 ) * select( 1.0, 0.45, r1 < 0.06 );
		let tt = t / tEnd;
		let hw = pow( max( 1.0 - tt, 0.0 ), 0.6 ) * 0.22 * ( smoothstep( 0.0, 0.1, tt ) * 0.4 + 0.6 );
		// split leaflets: a slit from the tip back along the midvein
		let split = r2 > 0.9 && tt > mix( 0.35, 0.7, r1 ) && abs( fx ) < hw * 0.3;
		// torn-out runs of leaflets
		let torn = vegNoise( vec2f( k * 0.21 + seed * 17.0, fseed * 37.0 ) ) > 0.83 - age * 0.2 && s > 0.3;
		// sub-pixel leaflets widen instead of aliasing (fronds turn solid in the distance)
		let hwE = max( hw, min( fwS * ( N * 0.6 ), 0.5 ) * select( 0.0, 1.0, tt < 1.0 ) );
		let leaf = abs( fx ) < hwE && tt < 1.0 && s > 0.06 && ! split && ! torn;
		let rachis = t * Ll < 0.026;
		m = select( 0.0, 1.0, leaf || rachis );
	} else if ( part > 1.5 && part < 2.5 ) {
		// fern: rounded pinnae
		let N = 26.0;
		let x = s * N;
		let k = floor( x );
		let r2 = vegHash12( vec2f( k, fseed * 31.1 ) );
		let fx = fract( x ) - 0.5;
		let tt = t / mix( 0.8, 1.0, r2 );
		let hw = sqrt( max( 1.0 - tt * tt, 0.0 ) ) * 0.34;
		let hwE = max( hw, min( fwS * ( N * 0.6 ), 0.5 ) * select( 0.0, 1.0, tt < 1.0 ) );
		let leaf = abs( fx ) < hwE && tt < 1.0 && s > 0.04;
		let rachis = t * Ll < 0.006;
		m = select( 0.0, 1.0, leaf || rachis );
	} else if ( part > 2.5 && part < 3.5 && s >= 0.0 ) {
		// banana: full blade, torn along lateral veins, ragged edge
		let x = s * 13.0 + sin( s * 31.0 + fseed * 10.0 ) * 0.35;
		let k = floor( x );
		let r1 = vegHash12( vec2f( k, fseed * 7.7 ) );
		let r2 = vegHash12( vec2f( k + 0.5, fseed * 3.3 + seed ) );
		let fx = abs( fract( x ) - 0.5 );
		// dead leaves are shredded
		let dead = step( 0.8, age );
		// wind-torn strips: most tears start at the margin and run in along the veins, more on older
		// leaves; dead leaves are shredded
		let tear = r1 < mix( 0.45 + age * 0.6, 0.95, dead ) && t > mix( 0.12, 0.75, r2 ) * mix( 1.0, 0.4, dead ) && fx > mix( 0.45, 0.37, r2 ) - dead * 0.12;
		let edge = t < 0.985 - vegNoise( vec2f( s * 60.0, fseed * 9.0 ) ) * 0.07;
		m = select( 0.0, 1.0, ! tear && edge );
	} else if ( part > 5.5 && s >= 0.0 ) {
		// broadleaf blades (petioles, s < 0, are kept whole)
		let sh = vegBroadShape( part, s, t, age, Ll, fseed, seed );
		m = select( 0.0, 1.0, abs( t ) < sh.w && ! sh.cut );
	}
	return m > 0.5 && vegLodDither( in.vs.vIPos, draw.params.yzw, in.pixel );
}

fn vegPlantAlbedo( in: FragInput ) -> vec3f {
	let st = in.uv;
	let s = st.x;
	let t = st.y;
	let aMat = in.vs.vMat;
	let part = aMat.x; let age = aMat.y; let Ll = aMat.z; let fseed = aMat.w;
	let seed = in.vs.vIDat.w;
	let H = in.vs.vIDat.z;
	var col = vec3f( 0.0 );
	let iv = vegHash12( vec2f( seed * 37.1, 1.7 ) );
	if ( part < 0.5 ) {
		// stems: age 0 -> weathered, ringed palm trunk; 1 -> green banana pseudostem
		let y = in.vs.vTrunkY;
		let a = st.x;
		let bark = vegPalmBark( y, a, H, seed, iv ).bark;
		// (palm trunks have age 0: the pseudostem colour only where it is mixed in)
		var green = vec3f( 0.0 );
		if ( age > 0.0 ) {
			let fiss = vegNoise( vec2f( a * 46.0, y * 1.1 + seed * 50.0 ) );
			let blotch = vegNoise( vec2f( a * 7.0, y * 0.45 + seed * 13.0 ) );
			// banana pseudostem: overlapping sheaths (vertical streaks), dark blotches, dry brown
			// sheath strips peeling off low down (no leaf-scar rings)
			let streakS = vegNoise( vec2f( a * 24.0, y * 0.35 + seed * 7.0 ) );
			green = mix( ${ C( 0x4e6a2a ) }, ${ C( 0x6b8438 ) }, streakS * 0.7 + fiss * 0.3 );
			green = mix( green, ${ C( 0x3b3322 ) }, smoothstep( 0.62, 0.82, blotch ) * 0.55 );
			green = mix( green, mix( ${ C( 0x6e5534 ) }, ${ C( 0x8f7a52 ) }, fiss ), smoothstep( 0.55, 0.75, streakS ) * smoothstep( 1.1, 0.3, y ) );
		}
		col = mix( bark, green, age );
	} else if ( part < 1.5 ) {
		// age (aMat.y): 0 young upper fronds (lighter yellow-green) .. 0.55 old lower fronds (olive,
		// yellowing); 1 = the two hanging fronds, whose state is picked per tree and frond (one crown
		// mesh is shared): still olive, yellowing or dead brown
		let fr = vegHash12( vec2f( fseed * 51.3, seed * 17.9 ) );
		let a = sat( age / 0.55 );
		var g = mix( ${ C( 0x728c33 ) }, ${ C( 0x445f27 ) }, smoothstep( 0.0, 0.35, a ) );
		g = mix( g, ${ C( 0x69702f ) }, smoothstep( 0.55, 1.0, a ) );
		// per tree: yellower or bluer greens; per frond: value
		g = mix( g, g * vec3f( 1.12, 1.02, 0.78 ), iv * 0.8 );
		g = mix( g, g * vec3f( 0.86, 0.98, 1.08 ), ( 1.0 - iv ) * 0.5 );
		g = g * mix( 0.82, 1.1, fr );
		// leaflets: darker toward their tips, paler at the base, each a little different
		let kL = floor( s * 95.0 );
		let perLeaf = vegHash12( vec2f( kL, fseed * 13.1 ) );
		var c = g * mix( 1.08, 0.86, smoothstep( 0.2, 1.0, t ) ) * ( perLeaf * 0.22 + 0.9 );
		// browned, dried tips on some leaflets (more on old fronds)
		let tipK = smoothstep( 0.72, 0.97, t ) * step( 0.55 - a * 0.35, vegHash12( vec2f( kL * 1.7, fseed * 5.3 + seed ) ) );
		c = mix( c, mix( ${ C( 0x8c7a4a ) }, ${ C( 0x6e5b39 ) }, perLeaf ), tipK * 0.85 );
		// hanging fronds
		let hangK = smoothstep( 0.8, 0.95, age );
		let state = vegHash12( vec2f( fseed * 7.1, seed * 29.3 ) );
		let yellowing = mix( ${ C( 0x8f8a3c ) }, ${ C( 0xa08a45 ) }, perLeaf );
		let deadC = mix( ${ C( 0x7a6440 ) }, ${ C( 0x5c4a30 ) }, perLeaf );
		let hangC = select( select( c * 0.9, yellowing, state > 0.35 ), deadC, state > 0.62 );
		c = mix( c, hangC, hangK );
		// midrib: pale yellow on young fronds, straw on old, brown when dead
		let rachis = t * Ll < 0.026;
		let rib = mix( mix( ${ C( 0xb3a660 ) }, ${ C( 0x98894e ) }, a ), ${ C( 0x6f5a3a ) }, hangK * step( 0.62, state ) );
		col = select( c, rib, rachis );
	} else if ( part < 2.5 ) {
		let c = mix( ${ C( 0x345c20 ) }, ${ C( 0x55802c ) }, smoothstep( 0.1, 1.0, s ) * 0.6 + iv * 0.4 );
		col = c * mix( 0.85, 1.1, vegHash12( vec2f( floor( s * 26.0 ), fseed ) ) );
	} else if ( part < 3.5 ) {
		if ( s < 0.0 ) {
			// banana pseudostem: overlapping sheaths (vertical streaks), brown / purple-black blotches,
			// dry brown sheath fibre peeling low down
			let f = ( s + 1.0 ) * 2.0;
			let a = t;
			let streakS = vegNoise( vec2f( a * 26.0, f * 3.0 + fseed * 7.0 ) );
			let blotch = vegNoise( vec2f( a * 9.0, f * 6.0 + fseed * 13.0 ) );
			var gS = mix( ${ C( 0x55672e ) }, ${ C( 0x6e7d3a ) }, streakS * 0.7 + iv * 0.3 );
			gS = mix( gS, ${ C( 0x3a2a28 ) }, smoothstep( 0.6, 0.8, blotch ) * 0.6 );
			let dry = smoothstep( 0.45, 0.7, vegNoise( vec2f( a * 14.0 + 3.0, f * 2.5 + fseed * 19.0 ) ) ) * smoothstep( 0.8, 0.2, f );
			col = mix( gS, mix( ${ C( 0x6a5233 ) }, ${ C( 0x8e7a52 ) }, streakS ), dry * 0.9 );
		} else {
			// blade: muted green (per plant and leaf), paler midrib, faint lateral veins; dried, browned
			// margins and torn strip edges; old leaves yellowing; dead ones brown and papery
			let lf = vegHash12( vec2f( fseed * 23.1, seed * 3.7 ) );
			var base = mix( ${ C( 0x3f5f24 ) }, ${ C( 0x55742d ) }, iv * 0.55 + lf * 0.45 );
			base = mix( base, ${ C( 0x7c7d35 ) }, smoothstep( 0.35, 0.6, age ) * 0.55 );
			let vein = ( sin( s * 260.0 ) * 0.5 + 0.5 ) * 0.07;
			let mott = vegNoise( vec2f( s * 11.0 + fseed * 3.0, t * 4.0 ) );
			var c = base * ( vein + 0.94 ) * ( mott * 0.14 + 0.93 );
			c = mix( c, ${ C( 0xa9b06e ) }, smoothstep( 0.05, 0.0, t ) * 0.75 ); // midrib
			let xs = s * 13.0 + sin( s * 31.0 + fseed * 10.0 ) * 0.35;
			let stripEdge = smoothstep( 0.36, 0.47, abs( fract( xs ) - 0.5 ) ) * smoothstep( 0.4, 0.8, t ) * ( 0.3 + age );
			let dryEdge = smoothstep( 0.72, 1.0, t + ( vegNoise( vec2f( s * 25.0, fseed * 4.0 ) ) - 0.5 ) * 0.3 ) * ( 0.45 + age * 0.8 );
			let brownC = mix( ${ C( 0x6b5531 ) }, ${ C( 0x8f7a48 ) }, mott );
			c = mix( c, brownC, sat( max( dryEdge, stripEdge * 0.6 ) ) * 0.85 );
			let deadC = mix( ${ C( 0x5e4a2c ) }, ${ C( 0x86704a ) }, vegNoise( vec2f( s * 18.0, t * 3.0 + fseed * 5.0 ) ) );
			c = mix( c, deadC, smoothstep( 0.85, 0.95, age ) );
			col = c;
		}
	} else if ( part > 5.5 ) {
		let hGround = in.P.y - in.vs.vIPos.y;
		if ( s < 0.0 ) {
			col = vegBroadStem( part, t, ( s + 1.0 ) * 2.0, fseed, age );
		} else {
			col = vegBroadAlbedo( part, s, t, age, Ll, fseed, seed, iv, hGround );
		}
	} else {
		// coconuts: green -> yellow -> brown
		col = mix( mix( ${ C( 0x68762a ) }, ${ C( 0x9c8a34 ) }, smoothstep( 0.3, 0.7, age ) ), ${ C( 0x5c4122 ) }, smoothstep( 0.82, 0.95, age ) );
	}
	return col;
}
`,
} );

const PLANT_ATTRIBUTES = { iPos: 'vec4f', iDat: 'vec4f', aVeg: 'vec4f', aMat: 'vec4f', aLobe: 'vec4f' };

export function createPlantLeafMaterial() {

	const mat = new Material( {
		name: 'veg-plant-leaf',
		side: 'double',
		modules: [ vegModule, plantModule ],
		attributes: PLANT_ATTRIBUTES,
		varyings: { vTrunkY: 'f32', vTrunkT: 'vec3f', vMat: 'vec4f', vIDat: 'vec4f', vIPos: 'vec3f' },
		vertex: /* wgsl */`
	let pl = vegPlantDeform( ( v.model * vec4f( v.position, 1.0 ) ).xyz, vegInstanceNormal( v.model, v.normal ), v.iPos, v.iDat, v.aVeg, v.aMat, v.aLobe, draw.params.yzw );
	v.useWorld = true;
	v.worldPos = pl.pos;
	v.worldNormal = pl.normal;
	o.vTrunkY = pl.trunkY;
	o.vTrunkT = pl.trunkT;
	o.vMat = v.aMat;
	o.vIDat = v.iDat;
	o.vIPos = v.iPos.xyz;`,
		surface: /* wgsl */`
	if ( ! vegPlantMask( in ) ) { discard; }
	let aMat = in.vs.vMat;
	let part = aMat.x;
	let age = aMat.y;
	let isStem = part < 0.5;
	let isNut = part > 4.5 && part < 5.5;
	let isLeaf = ! isStem && ! isNut;
	let isBroad = part > 5.5;
	var albedo = vegPlantAlbedo( in );
	// the underside of fronds and leaves is duller and a little bluer than the waxy upper side
	let upper = in.front;
	albedo = select( albedo * vec3f( 0.74, 0.8, 0.84 ), albedo, upper || ! isLeaf );
	s.albedo = albedo;
	// stems: leaf-scar ring bump along the trunk axis; leaves: normals bent slightly towards
	// the viewer to soften grazing-angle Fresnel
	// palm trunks: bark relief (rings, fissures, roots, fibres) along the trunk axis (finite
	// difference of the bark height, faded with distance); leaves: normals bent towards the viewer
	var d = 0.0;
	var dA = 0.0;
	let fadeB = 1.0 - smoothstep( 10.0, 32.0, length( frame.cameraPos - in.P ) );
	if ( isStem && fadeB > 0.0 ) {
		let seed = in.vs.vIDat.w;
		let H = in.vs.vIDat.z;
		let y = in.vs.vTrunkY;
		let a = in.uv.x;
		let ivN = vegHash12( vec2f( seed * 37.1, 1.7 ) );
		let e = 0.004;
		let ea = 0.0015; // around the trunk (a: 0..1 over a ~1.1 m circumference)
		let h0 = vegPalmBark( y, a, H, seed, ivN ).hd;
		let slope = ( vegPalmBark( y + e, a, H, seed, ivN ).hd - h0 ) / e;
		let slopeA = ( vegPalmBark( y, a + ea, H, seed, ivN ).hd - h0 ) / ( ea * 1.1 );
		d = slope * fadeB * ( 1.0 - age );
		dA = slopeA * fadeB * ( 1.0 - age );
	}
	s.normal = normalize( in.N - in.vs.vTrunkT * d - cross( in.N, in.vs.vTrunkT ) * dA + in.V * select( 0.0, 0.15, isLeaf ) );
	// waxy but not glossy: a sharper, stronger sheen mirrored the bright sky near the sun and read as a
	// white film over backlit foliage
	// broadleaf: monstera glossy, elephant ear waxy-matte, heliconia satin, bracts glossy; dead
	// leaves dull
	let broadR = select( select( select( 0.45, 0.42, part > 7.5 ), 0.58, part > 6.5 && part < 7.5 ), 0.46, part < 6.5 );
	s.roughness = select( select( select( 0.7, 0.62, part < 1.5 || isNut ), 0.92, isStem ), mix( broadR, 0.85, smoothstep( 0.9, 0.98, age ) ), isBroad );
	s.metalness = 0.0;
	s.specularIntensity = select( select( 0.4, 0.3, isStem ), 0.42, isBroad );
	s.translucency = vec3f( 0.0 );
	if ( isLeaf ) { s.translucency = vegTranslucency( albedo, in.N, select( 0.3, 0.2, isBroad ), in.P ); }`,
		shadow: 'return vegPlantMask( in );',
	} );
	return mat;

}

// Tree / shrub foliage (leaf-cluster cards) and tree bark ------------------------------------

// Trees / shrubs / impostors. aVeg = (height fraction, branch flex, flutter weight, phase);
// iDat = (yaw, vertical scale (negative: shrub), plant height (m), seed). With `lobes`, leaf cards
// move towards / onto their lobe centre (aLobe) by the per-instance lobe scale: dropped lobes
// vanish, the others vary in size, so every instance gets its own irregular crown.
const canopyDeform = ( lobes ) => /* wgsl */`
	let iPos = v.iPos;
	let iDat = v.iDat;
	let veg = v.aVeg;
	let base = iPos.xyz;
	let sc = iPos.w;
	let Hh = iDat.z;
	let seed = iDat.w;
	let hf = veg.x;
	let flex = veg.y;
	let flut = veg.z;
	let ph = veg.w;
	var P = ( v.model * vec4f( v.position, 1.0 ) ).xyz;
	let isShrubI = iDat.y < 0.0;
	var keep = 1.0;
${ lobes ? /* wgsl */`
	// merged tree + shrub geometry: keep the parts of this instance's plant type
	let isShrubPart = v.aMat.x > 3.5;
	keep = select( 0.0, 1.0, isShrubPart == isShrubI );
	// leaf cards move towards their lobe centre by the variant's lobe scale (0: dropped lobe)
	let lobe = v.aLobe;
	let lk = select( 0.0, 1.0 - vegLobeScale( seed, lobe.w, isShrubI ), lobe.w >= 0.0 );
	let ld = lobe.xyz * lk;
	let yaw = iDat.x; let cy = cos( yaw ); let sy = sin( yaw );
	let sv = abs( iDat.y );
	P += vec3f( ld.x * cy + ld.z * sy, ld.y * sv, ld.z * cy - ld.x * sy ) * sc;
` : '' }
	let N = vegInstanceNormal( v.model, v.normal );
	let w = vegWindStrength();
	let g = vegGustAt( base.xz );
	let t = frame.time;
	let ph0 = seed * 6.2832;
	let h2 = hf * hf;
	let sway = ( w * w * 0.009 * ( g * 0.8 + 0.3 ) + sin( t * 0.9 + ph0 ) * w * 0.0045 * ( g + 0.4 ) ) * Hh * h2;
	let swayP = sin( t * 0.67 + ph0 * 1.3 ) * w * 0.002 * Hh * h2;
	let branch = sin( t * ( ph + 1.7 ) + ph * 20.0 + ph0 ) * flex * w * sc * 0.07 * ( g + 0.5 )
		- flex * w * w * sc * 0.04 * ( g + 0.3 ); // branches sag / stream in strong gusts
	let flutter = sin( t * 9.5 + ph * 50.0 + P.x * 1.9 + P.z * 2.3 ) * flut * sc * ( w * 0.035 + 0.005 );
	let pos = P + vegWindDir3() * sway + vegWindPerp3() * swayP + VEG_UP * branch + N * flutter;
	// near LOD: trees and shrubs hand over to the impostors at their own distance
	let dCam = length( vegParams.camPos - base );
	let nearK = select( 0.0, 1.0, dCam < select( vegParams.canopyNear.x, vegParams.canopyNear.y, isShrubI ) * ( 1.0 + VEG_LOD_BAND / 2.0 ) );
	v.useWorld = true;
	v.worldPos = base + ( pos - base ) * ( keep * nearK );
	v.worldNormal = N;
`;

// near -> impostor switch distance (m) of trees (x) and shrubs (y)
export const uCanopyNear = vegParams.fields.canopyNear;

// aMat = (part, canopy exposure (ao), colour rand, card rand); parts: 0 bark, 1 tree card, 4 shrub card
// Species per instance (seed): trees 0 dark glossy (bronze new flush), 1 mid green, 2 yellow-green,
// 3 blue-green; shrubs 0 sea grape (round leaves, red veins), 1 croton (variegated), 2 hibiscus
// (flowering). The far impostors use the same palette (canopyLeafColor) and brightness structure.
export const canopyModule = new ShaderModule( {
	name: 'vegCanopy',
	deps: [ vegModule ],
	code: /* wgsl */`
fn vegPick4( s4: f32, a: vec3f, b: vec3f, c: vec3f, d: vec3f ) -> vec3f { return select( select( select( d, c, s4 < 2.5 ), b, s4 < 1.5 ), a, s4 < 0.5 ); }
fn vegPick3( s3: f32, a: vec3f, b: vec3f, c: vec3f ) -> vec3f { return select( select( c, b, s3 < 1.5 ), a, s3 < 0.5 ); }
fn vegTreeSpecies( seed: f32 ) -> f32 { return floor( fract( seed * 5.31 ) * 4.0 ); }
// shrubs: 0 sea grape 45 %, 1 croton 15 %, 2 hibiscus 40 %
fn vegShrubSpecies( seed: f32 ) -> f32 {
	let h = fract( seed * 3.17 );
	return select( select( 2.0, 1.0, h < 0.6 ), 0.0, h < 0.45 );
}

// base leaf colour of an instance (species, per-card random cr, per-instance tint)
fn vegCanopyLeafColor( seed: f32, cr: f32, isShrub: bool ) -> vec3f {
	let spT = vegTreeSpecies( seed ); let spS = vegShrubSpecies( seed );
	// tree species: dark glossy (bronze flush), fresh mid green, yellow-green, blue-green
	// (Caribbean hillside forest: deep, olive and yellow-greens, muted, with a few dry / bronze
	// and flowering crowns)
	let t0 = mix( mix( ${ C( 0x283a1b ) }, ${ C( 0x364a23 ) }, cr ), ${ C( 0x5e4a2e ) }, smoothstep( 0.96, 0.995, cr ) * 0.5 );
	let t1 = mix( ${ C( 0x34491f ) }, ${ C( 0x485c27 ) }, cr );
	let t2 = mix( ${ C( 0x4f5a27 ) }, ${ C( 0x646a31 ) }, cr );
	let t3 = mix( ${ C( 0x2a3b2a ) }, ${ C( 0x3a4a36 ) }, cr );
	let s0 = mix( ${ C( 0x3f5522 ) }, ${ C( 0x52662a ) }, cr );
	let s1 = mix( ${ C( 0x2c421e ) }, ${ C( 0x44561f ) }, cr );
	let s2 = mix( ${ C( 0x34521c ) }, ${ C( 0x466624 ) }, cr );
	let iv = vegHash12( vec2f( seed * 17.3, 4.1 ) );
	let iv2 = vegHash12( vec2f( seed * 5.9, 8.3 ) );
	var c = select( vegPick4( spT, t0, t1, t2, t3 ), vegPick3( spS, s0, s1, s2 ), isShrub ) * ( iv * 0.36 + 0.74 );
	// a few trees dry / dropping leaves (brown-olive), or flowering (flamboyant, orange-red)
	let treeK = select( 1.0, 0.0, isShrub );
	let dry = step( iv2, 0.035 ) * treeK;
	c = mix( c, mix( ${ C( 0x5c5234 ) }, ${ C( 0x6e5a3a ) }, cr ), dry * 0.5 );
	let flower = step( 0.988, iv2 ) * treeK * step( 0.5, cr );
	c = mix( c, ${ C( 0x8a4a2c ) }, flower * 0.5 );
	return mix( vec3f( luminance( c ) ), c, 0.85 );
}

fn vegBarkColor( n: f32, n2: f32 ) -> vec3f {
	return mix( mix( ${ C( 0x302a22 ) }, ${ C( 0x5c5549 ) }, n * 0.6 + n2 * 0.4 ), ${ C( 0x7b7b6a ) }, smoothstep( 0.64, 0.8, n2 ) * 0.3 );
}

// leaf-cluster tile of a card: trees broad / narrow leaves by species, shrubs round / narrow
fn vegLeafTile( seed: f32, isShrub: bool ) -> f32 {
	let spT = vegTreeSpecies( seed ); let spS = vegShrubSpecies( seed );
	return select( select( 0.0, 1.0, fract( spT * 0.5 ) > 0.25 ), select( 2.0, 3.0, spS == 1.0 ), isShrub );
}

// alpha-test threshold compensating the coverage loss of the minified (mipmapped) leaf texture
fn vegCoverageThreshold( st: vec2f ) -> f32 {
	let lod = log2( max( max( fwidth( st.x ), fwidth( st.y ) ) * 256.0, 1e-4 ) );
	return mix( 0.5, 0.3, sat( lod / 4.0 ) );
}

// Runtime colour of an impostor fragment (same palette as the near canopy)
fn vegImpostorColor( seed: f32, cr: f32, leaf: f32, bright: f32, isGroup1: bool ) -> vec3f {
	let leafC = vegCanopyLeafColor( seed, cr, isGroup1 ) * ( bright * 1.4 );
	// limbs and twigs seen through the crown gaps are in the crown's shade: dark and a little
	// green-brown, and the leaves dominate the blend (grey limbs made far crowns read grey-beige)
	let barkC = mix( ${ C( 0x1c1a13 ) }, ${ C( 0x2e2b20 ) }, ( bright - 0.4 ) / 0.5 );
	let c = mix( barkC, leafC, smoothstep( 0.05, 0.55, leaf ) );
	// far crowns keep their green through the haze (a little more saturated than the near canopy)
	return max( mix( vec3f( luminance( c ) ), c, 1.25 ), vec3f( 0.0 ) );
}
`,
} );

// the canopy mask (fragment and shadow pass): leaf coverage, edge-on thinning, impostor cross-fade
const CANOPY_MASK = /* wgsl */`
fn vegCanopyMask( in: FragInput, L: vec4f ) -> bool {
	let part = in.vs.vMat.x;
	let isBark = part < 0.5 || part > 4.5;
	// cross-fade into the impostors (outgoing level of the band around uCanopyNear)
	let nearD = select( vegParams.canopyNear.x, vegParams.canopyNear.y, in.vs.vIDat.y < 0.0 );
	let fade = smoothstep( nearD * ( 1.0 - VEG_LOD_BAND / 2.0 ), nearD * ( 1.0 + VEG_LOD_BAND / 2.0 ), length( vegParams.camPos - in.vs.vIPos ) );
	// cards seen edge-on thin out (no sliver lines through the crown)
	let facing = abs( dot( normalize( cross( dpdx( in.P ), dpdy( in.P ) ) ), in.V ) );
	let thr = vegCoverageThreshold( in.uv ) + ( 1.0 - smoothstep( 0.08, 0.35, facing ) ) * 0.45;
	return ( isBark || L.x > thr ) && bayer4( in.pixel ) >= fade;
}
fn vegCanopyLeaf( in: FragInput ) -> vec4f {
	let part = in.vs.vMat.x;
	return vegLeafSample( in.uv, vegLeafTile( in.vs.vIDat.w, part > 2.5 ) );
}
`;

export function createCanopyMaterial( leafAtlas ) {

	const maskModule = new ShaderModule( { name: 'vegCanopyMask', deps: [ canopyModule, leafAtlas.module ], code: CANOPY_MASK } );
	const mat = new Material( {
		name: 'veg-canopy',
		side: 'double',
		modules: [ vegModule, canopyModule, leafAtlas.module, maskModule ],
		attributes: PLANT_ATTRIBUTES,
		varyings: { vMat: 'vec4f', vIDat: 'vec4f', vIPos: 'vec3f', vHf: 'f32' },
		vertex: canopyDeform( true ) + /* wgsl */`
	o.vMat = v.aMat;
	o.vIDat = v.iDat;
	o.vIPos = v.iPos.xyz;
	o.vHf = v.aVeg.x;`,
		surface: /* wgsl */`
	let aMat = in.vs.vMat;
	let part = aMat.x;
	let ao = aMat.y;
	let cr = aMat.z;
	let seed = in.vs.vIDat.w;
	let isBark = part < 0.5 || part > 4.5;
	let isShrub = part > 2.5;
	let spT = vegTreeSpecies( seed ); let spS = vegShrubSpecies( seed );
	// leaf cluster sampled once (first in the fragment shader), shared by the mask and the colour
	let L = vegCanopyLeaf( in );
	if ( ! vegCanopyMask( in, L ) ) { discard; }
	let bright = L.y * 1.4;
	let cell = L.z;
	var c = vegCanopyLeafColor( seed, cr, isShrub ) * bright;
	// species details: red-veined old leaves (sea grape), variegation (croton), flowers (hibiscus)
	let shrub0 = isShrub && spS < 0.5; let shrub1 = isShrub && spS == 1.0; let shrub2 = isShrub && spS > 1.5;
	c = mix( c, ${ C( 0x7a3a22 ) }, smoothstep( 0.86, 0.98, cell ) * 0.55 * select( 0.0, 1.0, shrub0 ) );
	let vari = select( ${ C( 0x7a3a22 ) }, ${ C( 0x9a8a30 ) }, fract( cell * 7.3 ) > 0.5 );
	c = mix( c, vari, smoothstep( 0.72, 0.9, cell ) * 0.55 * select( 0.0, 1.0, shrub1 ) );
	c = select( c, ${ C( 0xb3261e ) }, shrub2 && cell > 0.92 );
	// trees: a few old leaves turning red / yellow before they drop (sea almond)
	let treeK = select( 1.0, 0.0, isShrub );
	c = mix( c, mix( ${ C( 0x8a7a3a ) }, ${ C( 0x7e3e22 ) }, step( 0.992, fract( cell * 3.7 ) ) ), step( 0.984, fract( cell * 3.7 ) ) * treeK * 0.6 );
	// sunlit outer / upper leaves brighter and a little yellow-green; shaded interior kept for contrast
	let outer = smoothstep( 0.62, 1.0, ao );
	c = mix( c, c * vec3f( 1.16, 1.22, 0.92 ), outer * 0.7 );
	let leaf = c * mix( 0.55, 1.0, ao );
	// bark: grey-brown with vertical streaks, lichen patches
	let hfB = in.vs.vHf;
	var albedo = leaf;
	if ( isBark ) {
		let st = in.uv;
		let n2 = vegNoise( vec2f( st.x * 6.0, st.y * 0.7 ) );
		var bark = vegBarkColor( vegNoise( vec2f( st.x * 30.0, st.y * 2.5 + seed * 40.0 ) ), n2 );
		// moss and epiphytes on the humid lower trunk and the upper sides of the limbs
		bark = mix( bark, mix( ${ C( 0x2c3a18 ) }, ${ C( 0x44552a ) }, n2 ), smoothstep( 0.45, 0.7, vegNoise( vec2f( st.x * 9.0, st.y * 1.3 + seed * 11.0 ) ) + ( 0.35 - hfB ) * 0.6 ) * 0.7 );
		albedo = bark;
	}
	s.albedo = albedo;
	// bark: the trunk under the crown sees little of the sky
	s.ao = select( mix( 0.35, 1.0, ao ), smoothstep( 0.0, 0.75, hfB ) * 0.45 + 0.4, isBark );
	s.roughness = select( select( 0.82, 0.65, ( isShrub && spS < 0.5 ) || ( ! isShrub && spT < 0.5 ) ), 0.92, isBark );
	s.metalness = 0.0;
	s.specularIntensity = 0.15;
	// leaves: canopy (spherical) normals, not flipped on back faces, bent towards the viewer
	// so they are never shaded at grazing angles (avoids a white Fresnel sheen when backlit)
	let geoN = normalize( in.vs.normal );
	s.normal = select( normalize( geoN + in.V * 0.7 ), in.N, isBark );
	s.translucency = vec3f( 0.0 );
	if ( ! isBark ) { s.translucency = vegTranslucency( albedo, geoN, 0.5, in.P ) * ( ao * 0.6 + 0.4 ); }`,
		shadow: 'return vegCanopyMask( in, vegCanopyLeaf( in ) );',
	} );
	return mat;

}

// Unlit bake materials for the impostor atlases:
//   albedo: (leaf brightness / 1.4 | bark brightness, leaf flag, card colour random, 1)
//   normal: (plant-local normal * 0.5 + 0.5, exposure)
export function createCanopyBakeMaterials( leafAtlas ) {

	const make = ( which ) => new Material( {
		name: 'veg-impostor-bake-' + which,
		side: 'double',
		lit: false,
		modules: [ vegModule, leafAtlas.module ],
		attributes: { aMat: 'vec4f' },
		varyings: { vMat: 'vec4f', vLocalN: 'vec3f' },
		vertex: 'o.vMat = v.aMat; o.vLocalN = v.normal;',
		surface: /* wgsl */`
	let aMat = in.vs.vMat;
	let part = aMat.x;
	let isBark = part < 0.5 || part > 4.5;
	let isShrub = part > 2.5;
	let st = in.uv;
	let L = vegLeafSample( st, select( 0.0, 2.0, isShrub ) );
	if ( ! ( isBark || L.x > 0.5 ) ) { discard; }`,
		output: which === 'albedo' ? /* wgsl */`
	let aMat = in.vs.vMat;
	let part = aMat.x;
	let isBark = part < 0.5 || part > 4.5;
	let isShrub = part > 2.5;
	let st = in.uv;
	let vBright = vegLeafSample( st, select( 0.0, 2.0, isShrub ) ).y * 1.4;
	let barkN = vegNoise( vec2f( st.x * 30.0, st.y * 2.5 ) ) * 0.6 + vegNoise( vec2f( st.x * 6.0, st.y * 0.7 ) ) * 0.4;
	let bright = select( vBright / 1.4, barkN * 0.5 + 0.4, isBark );
	r.color = vec4f( bright, select( 1.0, 0.0, isBark ), aMat.z, 1.0 );` : /* wgsl */`
	let aMat = in.vs.vMat;
	let part = aMat.x;
	let isBark = part < 0.5 || part > 4.5;
	r.color = vec4f( normalize( in.vs.vLocalN ) * 0.5 + 0.5, select( aMat.y, 0.6, isBark ) );`,
	} );

	return { albedo: make( 'albedo' ), normal: make( 'normal' ) };

}

// Runtime colour of an impostor fragment (same palette as the near canopy): WGSL
// vegImpostorColor( seed, cr, leaf, bright, isGroup1 ) in canopyModule
export const impostorColor = 'vegImpostorColor';
