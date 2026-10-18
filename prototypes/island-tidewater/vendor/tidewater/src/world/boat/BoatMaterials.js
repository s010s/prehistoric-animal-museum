import { Vector3, DoubleSide } from '../../engine/index.js';
import { ShaderModule } from '../../engine/gpu/Shader.js';
import { commonModule } from '../../engine/render/wgsl/common.js';
import { standard, physical } from '../../materials/Materials.js';

// WGSL port of the TSL node materials. The TSL helpers live in `boatModule`:
//   fn boatHash21( p: vec2f ) -> f32              sin-hash (the TSL file's own hash21, not common's)
//   fn boatLstep( a, b, x ) / boatInvstep( a, b, x )   smoothstep / 1 - smoothstep (a < b always)
//   fn boatIsPattern( auxZ: f32, id: f32 ) -> f32
//   fn boatBumpNormal( P, N, height ) -> vec3f   Mikkelsen surface-gradient bump (world space)
//   fn boatNonSkidHeight( uv: vec2f ) -> f32
// Shared attribute accessors (see GeoKit: color = linear albedo, aux = rough, metal, pattern, anim):
// `color` is the standard vertex colour (in.color / v.color), `aux` a material attribute copied to
// the `vAux` varying; `vLocal` carries positionLocal (the model-space position) to the fragment.

const boatModule = new ShaderModule( {
	name: 'boatMaterials',
	deps: [ commonModule ],
	code: /* wgsl */`
fn boatIsPattern( auxZ: f32, id: f32 ) -> f32 { return step( abs( auxZ - id ), 0.5 ); }
fn boatHash21( p: vec2f ) -> f32 { return fract( sin( dot( p, vec2f( 127.1, 311.7 ) ) ) * 43758.5453 ); }
// a < b always (WGSL requires ordered edges)
fn boatLstep( a: f32, b: f32, x: f32 ) -> f32 { return smoothstep( a, b, x ); }
fn boatInvstep( a: f32, b: f32, x: f32 ) -> f32 { return 1.0 - smoothstep( a, b, x ); }

// Mikkelsen surface-gradient bump mapping from a procedural height in meters.
// (TSL worked in view space with faceDirection; here P / N are world space and N already faces
// the viewer on double-sided materials, so faceDirection is folded into N.)
fn boatBumpNormal( P: vec3f, N: vec3f, height: f32 ) -> vec3f {
	let dPdx = dpdx( P );
	let dPdy = dpdy( P );
	let n = N;
	let r1 = cross( dPdy, n );
	let r2 = cross( n, dPdx );
	let det = dot( dPdx, r1 );
	let grad = sign( det ) * ( dpdx( height ) * r1 + dpdy( height ) * r2 );
	return normalize( abs( det ) * n - grad + n * 1e-12 );
}

// Molded non-skid: jittered pebbles on a ~1.8 cm lattice (uv in meters), faded when sub-pixel.
fn boatNonSkidHeight( uv: vec2f ) -> f32 {
	let q = uv * 55.0;
	let c = floor( q );
	let f = fract( q ) - 0.5;
	let j = ( vec2f( boatHash21( c ), boatHash21( c + 17.31 ) ) - 0.5 ) * 0.3;
	let d = length( f - j );
	let pebble = boatInvstep( 0.16, 0.36, d );
	let fade = boatInvstep( 0.3, 0.8, fwidth( q.x ) );
	return pebble * fade;
}
`,
} );

// vertex snippet shared by all boat materials: aux and the local position to the fragment
const AUX_VERTEX = /* wgsl */`
	o.vAux = v.aux;
	o.vLocal = v.position;
`;

const COMMON = () => ( {
	// the TSL read attribute( 'color' ) directly; the engine only binds it with vertexColors
	// (every snippet sets s.albedo itself, so mat.color * in.color never leaks through)
	vertexColors: true,
	modules: [ boatModule ],
	attributes: { aux: 'vec4f' },
	varyings: { vAux: 'vec4f', vLocal: 'vec3f' },
	vertex: AUX_VERTEX,
} );

// hex colour -> linear WGSL vec3f literal (TSL color( 0x.. ) is an sRGB hex converted to linear)
function col( hex ) {

	const c = ( v ) => {

		v /= 255;
		return v <= 0.04045 ? v / 12.92 : Math.pow( ( v + 0.055 ) / 1.055, 2.4 );

	};
	return `vec3f( ${ f( c( ( hex >> 16 ) & 255 ) ) }, ${ f( c( ( hex >> 8 ) & 255 ) ) }, ${ f( c( hex & 255 ) ) } )`;

}

// JS number -> WGSL float literal
function f( x ) {

	const s = String( + x.toPrecision( 9 ) );
	return s.includes( '.' ) || s.includes( 'e' ) ? s : s + '.0';

}

export class BoatMaterials {

	constructor( hullShape ) {

		this.hull = this.createHull( hullShape );
		this.gelcoat = this.createGelcoat();
		this.wood = this.createWood();
		this.fittings = this.createFittings();
		this.glass = this.createGlass();
		this.glow = this.createGlow();
		this.trap = this.createTrap();

		// uniform handles ({ value }), as the TSL uniform() nodes were
		this.navOn = this.glow.uniforms.navOn;
		this.flagPivot = this.fittings.uniforms.flagPivot;
		this.flagDir = this.fittings.uniforms.flagDir;
		this.flagWind = this.fittings.uniforms.flagWind;

	}

	// Hull exterior: antifouling / boot stripe / white topsides painted by height in the
	// boat frame (the hull mesh sits at the root with an identity transform).
	createHull( shape ) {

		const m = physical( { roughness: 0.25, metalness: 0, clearcoat: 1, clearcoatRoughness: 0.1, ...COMMON() } );
		m.name = 'boatHull';

		m.surface = /* wgsl */`
	let p = in.vs.vLocal;
	let tS = sat( ( p.z - ${ f( shape.zAft ) } ) / ${ f( shape.length ) } );
	let sheer = pow( tS, 2.2 ) * 0.62 + 0.98 + pow( max( 1.0 - tS / 0.2, 0.0 ), 2.0 ) * 0.04;

	// boot top sweeps up slightly toward the bow
	let boot = p.y - boatLstep( 0.8, 4.3, p.z ) * 0.06;
	let aaB = fwidth( boot ) + 1e-4;
	let aboveBottom = boatLstep( -aaB, aaB, boot - 0.05 );
	let aboveStripe = boatLstep( -aaB, aaB, boot - 0.15 );

	let below = sheer - p.y;
	let aaS = fwidth( below ) + 1e-4;
	let cove = boatLstep( -aaS, aaS, below - 0.1 ) * boatInvstep( -aaS, aaS, below - 0.122 );

	let n1 = mx_fractal_noise_float3( p * vec3f( 0.9, 2.4, 0.9 ), 3, 2.0, 0.5 );
	let streakN = mx_noise_float3( vec3f( p.z * 7.0, p.y * 0.45, p.x * 7.0 ) );
	let scuffN = mx_noise_float3( vec3f( p.z * 2.2, p.y * 34.0, p.x * 2.2 ) );

	var c = mix( ${ col( 0x7a1d15 ) }, ${ col( 0x0f1a30 ) }, aboveBottom );
	c = mix( c, ${ col( 0xf2efe6 ) }, aboveStripe );
	c = mix( c, ${ col( 0x0f1a30 ) }, cove );

	// waterline scum on the white, algae on the antifouling just below the boot top
	let scum = boatInvstep( 0.16, n1 * 0.09 + 0.42, boot ) * aboveStripe * sat( n1 * 0.6 + 0.7 );
	c = mix( c, ${ col( 0x8b7b57 ) }, scum * 0.32 );
	let algae = boatLstep( -0.35, 0.03, boot ) * ( 1.0 - aboveBottom ) * sat( n1 + 0.45 );
	c = mix( c, ${ col( 0x2c3a1f ) }, algae * 0.45 );

	// faint vertical weathering streaks under the gunwale
	let streak = boatLstep( 0.3, 0.75, streakN ) * boatLstep( 0.05, 0.2, below ) * boatInvstep( 0.4, 0.95, below ) * aboveStripe;
	c = mix( c, ${ col( 0xa29579 ) }, streak * 0.2 );

	// scuffs where traps come over the rail (starboard, aft of the wheelhouse)
	let side = boatLstep( -0.2, 0.2, -p.x ) * boatInvstep( -0.6, 0.2, p.z ) * boatLstep( -3.7, -2.8, p.z );
	let scuff = boatLstep( 0.45, 0.8, scuffN ) * boatLstep( 0.13, 0.18, below ) * boatInvstep( 0.45, 0.7, below ) * ( side * 0.8 + 0.2 );
	c = mix( c, ${ col( 0x5f5e59 ) }, scuff * 0.55 );

	s.albedo = c;
	s.roughness = mix( mix( 0.75, 0.35, aboveBottom ), 0.2, aboveStripe ) + scum * 0.25 + scuff * 0.3;
	s.clearcoat = aboveBottom * ( 1.0 - scum * 0.5 ) * ( 1.0 - scuff * 0.6 );
	s.clearcoatRoughness = 0.08 + scum * 0.3;
`;
		return m;

	}

	// White fiberglass (deck, lining, house, console); pattern 1 = molded non-skid,
	// 2 = wheelhouse interior (painted panels: seams, screws, grime, water stains),
	// 3 = headliner (perforated vinyl between battens).
	createGelcoat() {

		const m = standard( { roughness: 0.35, metalness: 0, ...COMMON() } );
		m.name = 'boatGelcoat';
		m.surface = /* wgsl */`
	let aux = in.vs.vAux;
	let vColor = in.color.rgb;
	let grip = boatIsPattern( aux.z, 1.0 );
	let h = boatNonSkidHeight( in.uv ) * grip;
	let p = in.vs.vLocal;
	let dirtN = mx_noise_float3( p * 1.7 );
	// worked deck: trodden grime, blotchy oil / bait / water stains
	let blot = boatLstep( 0.2, 0.55, mx_fractal_noise_float3( p * vec3f( 2.2, 2.2, 2.2 ) + vec3f( 7.7, 0.0, 3.1 ), 3, 2.0, 0.5 ) );
	let dirt = ( sat( dirtN * 0.5 + 0.35 ) * 0.22 + blot * 0.2 ) * grip;
	// a little grime where walls meet the sole
	let corner = boatInvstep( 0.35, 0.5, p.y ) * 0.08 * ( 1.0 - grip );

	// old gelcoat everywhere (not the non-skid): chalky yellowed patches, grime settling low down and
	// faint rust / dirt streaks running down from fittings
	let plainK = 1.0 - grip;
	let wear = mx_fractal_noise_float3( p * vec3f( 1.1, 1.6, 1.1 ) + vec3f( 5.3, 1.1, 2.9 ), 3, 2.0, 0.5 );
	let streakN = mx_noise_float3( vec3f( p.x * 14.0, p.y * 1.2, p.z * 14.0 ) );
	let streaks = boatLstep( 0.3, 0.7, streakN ) * 0.7 * plainK;
	// (deck / sole at 0.35 m)
	let lowDirt = boatInvstep( 0.38, 1.15, p.y ) * sat( wear + 0.7 ) * 0.34 * plainK;
	var base = vColor * ( 1.0 - h * 0.07 ) * ( 1.0 - dirt - corner * 1.8 - lowDirt );
	base = mix( base, base * vec3f( 0.94, 0.89, 0.78 ), boatLstep( -0.15, 0.35, wear ) * 0.45 * plainK );
	base = mix( base, base * vec3f( 0.78, 0.7, 0.6 ), streaks * 0.25 );
	var rough = mix( aux.x, 0.72, grip ) + h * 0.1 + ( sat( wear + 0.3 ) * 0.18 + lowDirt * 0.5 ) * plainK;
	var metal = aux.y;
	var groove = 0.0;
	var interiorAO = 1.0;
	var fill = vec3f( 0.0 );
	// wheelhouse interior (2) and headliner (3) only: the rest of the gelcoat skips the noise
	if ( aux.z > 1.5 ) {
		let mottle = mx_fractal_noise_float3( p * vec3f( 2.3, 3.1, 2.3 ), 3, 2.0, 0.5 );

		// ---- painted panels with screwed seams, grime and water stains
		let panel = boatIsPattern( aux.z, 2.0 );
		// seams: vertical every 0.61 m along the boat, horizontal at the rail height and below the windows
		let sz = ( p.z + 0.13 ) / 0.61;
		let seamDz = 0.305 - abs( fract( sz ) - 0.5 ) * 0.61; // distance to the nearest vertical seam (m)
		let dyA = abs( p.y - 1.17 );
		let dyB = abs( p.y - 1.52 );
		let seamD = min( seamDz, min( dyA, dyB ) );
		let aa = fwidth( seamD ) + 1e-4;
		let seam = boatInvstep( 0.0015, 0.0015 + aa * 1.5, seamD ) * panel;
		// pan-head screws every 0.15 m along the seams, 12 mm off the joint
		let screwV = length( vec2f( ( fract( p.y / 0.15 ) - 0.5 ) * 0.15, seamDz - 0.012 ) );
		let screwH = length( vec2f( ( fract( p.z / 0.15 ) - 0.5 ) * 0.15, min( dyA, dyB ) - 0.012 ) );
		let screwD = min( screwV, screwH );
		let screw = boatInvstep( 0.0035, 0.0035 + fwidth( screwD ) + 1e-4, screwD ) * panel;
		// grime: darker toward the sole and along the seams (hands, boots, salt), mottled
		// (the panels start at the rail, 1.17 m: grime collects on their lower part and the bottom seam)
		let low = boatInvstep( 1.15, 1.6, p.y );
		let grime = sat( low * ( 0.35 + mottle * 0.3 ) + boatInvstep( 0.0, 0.035, seamD ) * 0.18 + mottle * 0.08 ) * panel;
		// years of sun and diesel: blotchy yellowing over whole panels
		let age = mx_fractal_noise_float3( p * vec3f( 0.9, 1.4, 0.9 ) + vec3f( 3.1, 0.0, 1.7 ), 3, 2.0, 0.5 );
		// hand smudges at grab height, boot scuffs (streaks along the boat) just above the sole
		let smudge = boatLstep( 0.25, 0.6, mx_noise_float3( p * vec3f( 7.0, 5.0, 7.0 ) + vec3f( 9.0 ) ) ) * boatLstep( 1.05, 1.25, p.y ) * boatInvstep( 1.5, 1.75, p.y );
		let scuffN = mx_noise_float3( vec3f( p.z * 3.0, p.y * 60.0, p.x * 3.0 ) );
		let scuff = boatLstep( 0.45, 0.7, scuffN ) * boatInvstep( 0.9, 1.15, p.y ) * boatLstep( 0.2, 0.35, mottle + 0.5 );
		// water stains running down from the window sills, brown at their ends
		let run = mx_noise_float3( vec3f( p.z * 9.0, p.y * 0.8, p.x * 9.0 ) );
		let stain = boatLstep( 0.25, 0.7, run ) * boatLstep( 0.9, 1.35, p.y ) * boatInvstep( 1.3, 1.56, p.y ) * panel;
		// warm, yellowed off-white paint
		var pc = vColor * vec3f( 0.97, 0.94, 0.87 );
		pc = mix( pc, pc * vec3f( 0.9, 0.82, 0.64 ), boatLstep( -0.1, 0.35, age ) * 0.7 );
		pc = pc * ( 1.0 - grime * 0.6 ) * ( 1.0 - smudge * 0.12 * panel ) * ( 1.0 - scuff * 0.25 * panel );
		pc = mix( pc, pc * vec3f( 0.66, 0.54, 0.4 ), stain * 0.6 );
		pc = mix( pc, pc * 0.3, seam );
		// pan-head screws, some rusted with a short streak below
		let rustK = step( 0.55, boatHash21( floor( vec2f( p.y / 0.15, p.z / 0.15 ) + 0.5 ) ) );
		let screwCol = mix( vec3f( 0.55, 0.55, 0.53 ), vec3f( 0.32, 0.17, 0.08 ), rustK );
		pc = mix( pc, screwCol, screw );

		// ---- headliner: off-white perforated vinyl, quilted between the battens
		let head = boatIsPattern( aux.z, 3.0 );
		let hq = p.xz / 0.006;
		let perf = boatInvstep( 0.12, 0.3, length( fract( hq ) - 0.5 ) ) * boatInvstep( 0.3, 0.7, fwidth( hq.x ) );
		let quilt = sin( ( p.z + 0.1 ) / 0.5 * 3.14159 ) * 0.5 + 0.5;
		let hc = vec3f( 0.72, 0.69, 0.63 ) * ( 1.0 - perf * 0.18 ) * ( quilt * 0.12 + 0.88 ) * ( mottle * 0.08 + 0.96 );

		base = mix( mix( base, pc, panel ), hc, head );
		rough = mix( mix( rough, 0.5 + grime * 0.3 + age * 0.08 - smudge * 0.12 - screw * 0.2, panel ), 0.8, head );
		metal = metal + screw * 0.8 * ( 1.0 - rustK );
		// inside an enclosed wheelhouse most of the sky and sea is hidden: dim the ambient (the sun
		// through the windows is direct light and unaffected). Darker into the corners and overhead.
		interiorAO = mix( mix( 1.0, 0.55 - low * 0.12 - boatLstep( 1.9, 2.3, p.y ) * 0.1, panel ), 0.12, head );
		// the headliner faces the sole, not the sea: its light is the sun and sky bounced off the
		// deck, the sole and the walls (warm, neutral) - a small fill in place of the hidden IBL
		let skyL = dot( frame.skyIrradiance, vec3f( 0.3, 0.5, 0.2 ) );
		let sunL = dot( frame.sunColor, vec3f( 0.3, 0.5, 0.2 ) ) * sat( frame.sunDir.y );
		fill = hc * vec3f( 1.0, 0.95, 0.86 ) * ( skyL * 0.5 + sunL * 0.004 ) * head;
		groove = seam * -0.0006 + screw * 0.0004 + ( perf * -0.0002 + quilt * 0.002 ) * head;
	}
	s.albedo = base;
	s.roughness = rough;
	s.metalness = metal;
	s.ao = interiorAO;
	s.emissive = fill;
	s.normal = boatBumpNormal( in.P, in.N, h * 0.0008 + groove );
`;
		return m;

	}

	// Varnished teak/mahogany; grain follows uv.x. Pattern 1 = plain (brass, paint),
	// 2 = teak-and-holly sole (planks along uv.x, 0.1 m wide, pale holly strips, scuffed varnish).
	createWood() {

		const m = standard( { roughness: 0.35, metalness: 0, ...COMMON() } );
		m.name = 'boatWood';
		m.surface = /* wgsl */`
	let aux = in.vs.vAux;
	let w = in.uv;
	let g1 = mx_noise_float3( vec3f( w.x * 0.8, w.y * 30.0, 0.37 ) );
	let g2 = mx_noise_float3( vec3f( w.x * 10.0, w.y * 170.0, 5.1 ) );
	let rings = sin( w.y * 150.0 + g1 * 5.0 + w.x * 0.6 ) * 0.5 + 0.5;
	let grain = sat( rings * 0.45 + g2 * 0.22 + g1 * 0.22 + 0.28 );
	let plain = boatIsPattern( aux.z, 1.0 );
	var wood = mix( ${ col( 0x4a230f ) }, ${ col( 0x9c5b2b ) }, grain );
	var rough = aux.x + g2 * 0.04 * ( 1.0 - plain );

	// teak and holly: per-plank tone, holly strip between planks, butt joints, worn traffic lane
	let sole = boatIsPattern( aux.z, 2.0 );
	let pv = w.y / 0.1;
	let plankI = floor( pv );
	let pf = abs( fract( pv ) - 0.5 );
	let aaP = fwidth( pv ) + 1e-4;
	let holly = boatLstep( 0.5 - 0.06 - aaP, 0.5 - 0.06, pf );
	let caulk = boatLstep( 0.5 - 0.012 - aaP, 0.5 - 0.012, pf );
	let butt = boatInvstep( 0.0, 0.004 + fwidth( w.x ), abs( fract( w.x / 1.8 + boatHash21( vec2f( plankI, 3.0 ) ) ) - 0.5 ) * 1.8 );
	let tone = boatHash21( vec2f( plankI, 7.0 ) ) * 0.25 + 0.85;
	let lane = mx_noise_float3( vec3f( w.x * 1.3, w.y * 1.3, 2.0 ) ) * 0.5 + 0.5;
	var teak = mix( ${ col( 0x6b3f1d ) }, ${ col( 0xa87445 ) }, grain ) * tone;
	teak = mix( teak, teak * vec3f( 1.12, 1.08, 1.02 ), lane * 0.5 ); // worn, sun-bleached
	teak = mix( teak, ${ col( 0xd9c9a6 ) }, holly * ( 1.0 - caulk ) );
	teak = mix( teak, ${ col( 0x1c140e ) }, max( caulk, butt ) );
	wood = mix( wood, teak, sole );
	rough = mix( rough, 0.45 + lane * 0.25, sole );

	s.albedo = mix( wood, vec3f( 1.0 ), plain ) * in.color.rgb;
	s.roughness = rough;
	s.metalness = aux.y;
	s.normal = boatBumpNormal( in.P, in.N, ( g2 * 0.0002 - max( caulk, butt ) * 0.0012 ) * sole );
	// the sole is inside the wheelhouse: most of the sky is hidden (ambient only)
	s.ao = mix( 1.0, 0.6, sole );
`;
		return m;

	}

	// Everything else opaque: stainless, bronze, painted metal, plastics, rope, vinyl, flag.
	// Pattern 1 = laid rope, 2 = flag (animated), 3 = whip antenna (animated sway),
	// 4 = wrinkle-finish paint / textured plastic with scuffs, 5 = printed page (tide table, rows of
	// type; uv 0..1), 6 = folded paper chart, 7 = photo print, 8 = label tape (white, black type),
	// 9 = heavy fabric (oilskin, lifejacket; folds + stitching).
	createFittings() {

		const m = standard( {
			roughness: 0.5, metalness: 0, ...COMMON(),
			uniforms: {
				flagPivot: [ 'vec3f', new Vector3() ],
				flagDir: [ 'vec3f', new Vector3( 0, 0, - 1 ) ],
				flagWind: [ 'f32', 0.5 ],
			},
		} );
		m.name = 'boatFittings';

		m.surface = /* wgsl */`
	let aux = in.vs.vAux;
	let vColor = in.color.rgb;
	let u = in.uv;

	let strand = sin( ( u.x / 0.07 + u.y ) * ( TWO_PI * 3.0 ) );
	let ropeShade = boatLstep( -0.7, 0.7, strand ) * 0.4 + 0.6;

	let stripeIdx = floor( sat( u.y ) * 12.999 );
	let red = 1.0 - ( stripeIdx - 2.0 * floor( stripeIdx / 2.0 ) );
	let canton = step( u.x, 0.4 ) * step( ${ f( 6 / 13 ) }, u.y );
	let sx = fract( u.x / 0.4 * 6.0 ) - 0.5;
	let sy = fract( ( u.y - ${ f( 6 / 13 ) } ) / ${ f( 7 / 13 ) } * 5.0 ) - 0.5;
	let star = boatInvstep( 0.16, 0.24, length( vec2f( sx, sy ) ) );
	let stripes = mix( ${ col( 0xf4f1ea ) }, ${ col( 0xb3172a ) }, red );
	let flag = mix( stripes, mix( ${ col( 0x1c2a5c ) }, ${ col( 0xf4f1ea ) }, star ), canton );

	var c = mix( vColor, vColor * ropeShade, boatIsPattern( aux.z, 1.0 ) );
	c = mix( c, flag, boatIsPattern( aux.z, 2.0 ) );
	var rough = aux.x;
	var bump = 0.0;
	// interior props (patterns 4..9) only: ordinary fittings skip the noise
	if ( aux.z > 3.5 ) {
		let p = in.vs.vLocal;

		// wrinkle finish: fine crinkle bump, pale scuffs on the edges people touch
		let wrinkle = boatIsPattern( aux.z, 4.0 );
		let wn = mx_noise_float3( p * 380.0 );
		let scuffN = mx_fractal_noise_float3( p * vec3f( 6.0, 14.0, 6.0 ), 3, 2.0, 0.5 );
		let scuff = boatLstep( 0.35, 0.6, scuffN ) * wrinkle;
		c = mix( c, mix( c * ( 1.0 + wn * 0.08 ), c + vec3f( 0.05 ), scuff * 0.6 ), wrinkle );
		rough = mix( rough, rough + wn * 0.08 - scuff * 0.15, wrinkle );
		bump += wn * 0.00015 * wrinkle;

		// printed page: margins, header block, rows of type, a table grid, coffee ring
		let page = boatIsPattern( aux.z, 5.0 );
		let row = fract( u.y * 34.0 );
		let word = boatHash21( floor( vec2f( u.x * 16.0, u.y * 34.0 ) ) );
		let inText = step( 0.08, u.x ) * step( u.x, 0.92 ) * step( 0.06, u.y ) * step( u.y, 0.82 );
		let typeK = boatLstep( 0.35, 0.45, row ) * boatInvstep( 0.7, 0.8, row ) * step( 0.18, word ) * inText;
		let header = step( 0.86, u.y ) * step( u.y, 0.93 ) * step( 0.08, u.x ) * step( u.x, 0.6 );
		let grid = boatLstep( 0.478, 0.49, abs( fract( u.x * 4.0 ) - 0.5 ) ) * inText;
		let ring = boatInvstep( 0.0, 0.02, abs( length( u - vec2f( 0.7, 0.3 ) ) - 0.16 ) ) * 0.5;
		let paper = mix( vec3f( 0.86, 0.84, 0.78 ), vec3f( 0.1, 0.1, 0.12 ), max( max( typeK * 0.7, header * 0.85 ), grid * 0.5 ) );
		c = mix( c, mix( paper, vec3f( 0.45, 0.3, 0.18 ), ring ), page );
		rough = mix( rough, 0.9, page );

		// folded paper chart: sea and land tints, depth contours, fold creases, pencilled course
		let chartK = boatIsPattern( aux.z, 6.0 );
		let cn = mx_fractal_noise_float3( vec3f( u * 3.0 + vec2f( 1.3, 4.2 ), 0.7 ), 4, 2.0, 0.5 );
		let shore = cn + ( u.x - 0.55 ) * 1.4;
		let landK = boatLstep( 0.0, 0.02, shore );
		let contour = boatInvstep( 0.03, 0.06, abs( fract( shore * 7.0 ) - 0.5 ) ) * ( 1.0 - landK );
		let crease = boatInvstep( 0.0, 0.006, abs( u.x - 0.5 ) ) + boatInvstep( 0.0, 0.006, abs( u.y - 0.5 ) );
		let course = boatInvstep( 0.001, 0.004, abs( u.y - 0.2 - u.x * 0.45 ) ) * step( 0.1, u.x ) * step( u.x, 0.7 );
		var chart = mix( vec3f( 0.72, 0.8, 0.84 ), vec3f( 0.86, 0.78, 0.58 ), landK );
		chart = chart * ( 1.0 - contour * 0.25 ) * ( 1.0 - crease * 0.2 );
		chart = mix( chart, vec3f( 0.2, 0.2, 0.22 ), course * 0.8 );
		c = mix( c, chart, chartK );
		rough = mix( rough, 0.85, chartK );

		// photo print: white border, a sunlit boat / sea / sky picture
		let photo = boatIsPattern( aux.z, 7.0 );
		let inPic = step( 0.07, u.x ) * step( u.x, 0.93 ) * step( 0.07, u.y ) * step( u.y, 0.8 );
		let horizon = 0.45 + sin( u.x * 3.0 + aux.w * 6.0 ) * 0.03;
		var pic = mix( vec3f( 0.08, 0.22, 0.35 ), vec3f( 0.45, 0.65, 0.85 ), step( horizon, u.y ) );
		pic = mix( pic, vec3f( 0.85, 0.25, 0.12 ), boatInvstep( 0.06, 0.08, length( ( u - vec2f( 0.4 + aux.w * 0.2, horizon ) ) * vec2f( 1.0, 3.0 ) ) ) );
		pic = mix( vec3f( 0.92, 0.9, 0.86 ), pic * ( mx_noise_float3( vec3f( u * 20.0, aux.w * 9.0 ) ) * 0.15 + 0.9 ), inPic );
		c = mix( c, pic, photo );
		rough = mix( rough, 0.3, photo );

		// label tape: white with blocks of black type
		let label = boatIsPattern( aux.z, 8.0 );
		let lt = step( 0.3, fract( u.x * 7.0 ) ) * step( 0.3, boatHash21( floor( vec2f( u.x * 28.0, 3.0 ) ) ) ) * step( 0.25, u.y ) * step( u.y, 0.75 );
		c = mix( c, mix( vec3f( 0.85, 0.85, 0.82 ), vec3f( 0.05 ), lt ), label );

		// heavy fabric: soft folds, stitched seams, grime
		let fabric = boatIsPattern( aux.z, 9.0 );
		let fold = mx_fractal_noise_float3( p * vec3f( 9.0, 4.0, 9.0 ), 2, 2.0, 0.5 );
		// stitched seams every 0.31 m (dashed)
		let stitch = boatLstep( 0.486, 0.494, abs( fract( p.y / 0.31 ) - 0.5 ) ) * step( 0.5, fract( p.x * 160.0 + p.z * 160.0 ) );
		c = mix( c, c * ( fold * 0.35 + 0.8 ) * ( 1.0 - stitch * 0.3 ), fabric );
		rough = mix( rough, 0.65 + fold * 0.1, fabric );
		bump += fold * 0.004 * fabric;
	}

	s.albedo = c;
	s.roughness = rough;
	s.metalness = aux.y;
	s.normal = boatBumpNormal( in.P, in.N, bump );
	// patterns 4..9 are wheelhouse interior pieces: most of the sky is hidden (ambient only)
	s.ao = select( 1.0, 0.6, aux.z > 3.5 );
`;

		// vertex animation
		m.vertex = AUX_VERTEX + /* wgsl */`
	let aux = v.aux;
	let p = v.position;
	let t = frame.time;
	let wA = aux.w * aux.w;
	let phase = p.x * 3.1 + p.z * 1.7;
	let gust = frame.windSpeed * 0.06 + 0.5;
	let sway = vec3f( sin( t * 1.9 + phase ), 0.0, sin( t * 1.37 + phase * 1.3 ) * 0.6 ) * ( wA * 0.12 * gust );

	let rel = p - mat.flagPivot;
	let along = max( -rel.z, 0.0 );
	let fu = aux.w; // 0 at the hoist .. 1 at the fly
	let droop = ( 1.0 - mat.flagWind ) * 1.15 * ( fu * 0.5 + 0.5 );
	let lat = vec3f( mat.flagDir.z, 0.0, -mat.flagDir.x );
	let flutter = sin( fu * 9.0 - t * ( mat.flagWind * 9.0 + 4.0 ) + rel.y * 4.0 ) * fu * ( mat.flagWind * 0.05 + 0.015 );
	let flagPos = vec3f( mat.flagPivot.x, 0.0, mat.flagPivot.z )
		+ mat.flagDir * ( along * cos( droop ) )
		+ vec3f( 0.0, rel.y - along * sin( droop ), 0.0 )
		+ lat * flutter;

	v.position = mix( p + sway * boatIsPattern( aux.z, 3.0 ), flagPos, boatIsPattern( aux.z, 2.0 ) );
`;
		return m;

	}

	createGlass() {

		const m = physical( {
			color: 0xa9bec4, roughness: 0.05, metalness: 0, ior: 1.5,
			transparent: true, opacity: 0.25, side: DoubleSide, depthWrite: false,
			// the temporal resolve must reproject what is seen through the glass (the sea sliding past),
			// not the glass, which rides along with the helm camera: leave the velocity target untouched
			// (engine: velocity weight 0 in the blended pass keeps what is behind)
			velocityWeight: 0,
			...COMMON(),
		} );
		m.name = 'boatGlass';
		m.surface = /* wgsl */`
	let u = in.uv;
	let spots = boatLstep( 0.45, 0.85, mx_noise_float3( vec3f( u * 38.0, 3.3 ) ) );
	let haze = sat( mx_noise_float3( vec3f( u * 4.0, 9.1 ) ) * 0.5 + 0.5 );
	let edge = boatInvstep( 0.0, 0.18, u.y );
	let salt = sat( ( spots * 0.6 + haze * 0.25 ) * ( edge * 0.8 + 0.35 ) );
	s.albedo = mat.color; // no vertex colours on the glass (three: vertexColors off)
	s.alpha = 0.16 + salt * 0.22;
	s.roughness = 0.03 + salt * 0.35;
`;
		m.output = /* wgsl */`
	r.velocity = vec4f( 0.0 );
`;
		return m;

	}

	// Emissive parts. aux.z selects: 0 nav light, 1 radar display, 2 chart plotter,
	// 3 gauge dial, 4 flood/spot light, 5 cabin dome light, 6 LCD.
	createGlow() {

		const m = standard( { color: 0x000000, roughness: 0.3, metalness: 0, ...COMMON(), uniforms: { navOn: [ 'f32', 1 ] } } );
		m.name = 'boatGlow';
		m.surface = /* wgsl */`
	let aux = in.vs.vAux;
	let vColor = in.color.rgb;
	let mode = aux.z;
	let t = frame.time;
	let night = frame.night;
	let u = in.uv;

	// radar: head-up PPI with a 24 rpm sweep
	let q = ( u - 0.5 ) * 2.0;
	let r = length( q );
	let ang = atan2( q.x, q.y );
	let da = fract( ( t * 2.513 - ang ) / TWO_PI );
	let trail = exp( da * -5.0 );
	let beam = boatInvstep( 0.0, 0.01, da );
	let ringD = abs( fract( r * 3.0 + 0.5 ) - 0.5 );
	let ring = boatInvstep( 0.012, 0.03, ringD );
	let landN = mx_fractal_noise_float3( vec3f( q * 2.3 + vec2f( 1.7, 0.4 ), 0.5 ), 3, 2.0, 0.5 );
	let land = boatLstep( 0.18, 0.4, landN + q.x * 0.35 ) * boatLstep( 0.3, 0.45, r );
	let cell = floor( q * 7.0 );
	let blip = step( 0.93, boatHash21( cell ) ) * boatInvstep( 0.1, 0.3, length( fract( q * 7.0 ) - 0.5 ) ) * boatLstep( 0.2, 0.3, r );
	let heading = boatInvstep( 0.004, 0.012, abs( q.x ) ) * step( 0.0, q.y );
	let inside = boatInvstep( 0.96, 0.99, r );
	let echoes = sat( land + blip ) * ( trail * 0.75 + 0.25 );
	let radar = ( ( vec3f( 0.0, 0.012, 0.04 )
		+ vec3f( 0.05, 0.22, 0.28 ) * ( ring * 0.5 + heading * 0.6 )
		+ vec3f( 1.0, 0.72, 0.12 ) * echoes
		+ vec3f( 0.15, 0.9, 0.35 ) * ( beam * 0.8 + trail * 0.08 ) )
		* inside + vec3f( 0.01, 0.015, 0.02 ) ) * 1.3;

	// chart plotter
	let cp = u * vec2f( 1.35, 1.0 );
	let cn = mx_fractal_noise_float3( vec3f( cp * 2.6 + vec2f( 3.1, 1.2 ), 2.2 ), 4, 2.0, 0.5 );
	let shore = cn + ( u.x - 0.62 ) * 1.1;
	let isLand = boatLstep( 0.0, 0.015, shore );
	let shallow = boatLstep( -0.25, 0.0, shore );
	let contour = boatInvstep( 0.02, 0.05, abs( fract( shore * 9.0 ) - 0.5 ) ) * ( 1.0 - isLand );
	let water = mix( vec3f( 0.2, 0.42, 0.78 ), vec3f( 0.62, 0.82, 0.97 ), shallow );
	let track = boatInvstep( 0.003, 0.007, abs( u.x - 0.5 - ( u.y - 0.5 ) * 0.25 ) ) * step( 0.5, u.y );
	let boatIcon = boatInvstep( 0.012, 0.022, length( u - vec2f( 0.5, 0.5 ) ) );
	let chart = ( mix( water, vec3f( 0.88, 0.8, 0.55 ), isLand ) * ( 1.0 - contour * 0.35 )
		+ vec3f( 0.9, 0.1, 0.8 ) * track
		+ vec3f( 1.0, 0.35, 0.05 ) * boatIcon ) * 0.85;

	// gauge dial (backlit ticks + needle)
	let gq = ( u - 0.5 ) * 2.0;
	let gr = length( gq );
	let ga = atan2( gq.x, gq.y );
	let tickF = abs( fract( ga / TWO_PI * 24.0 ) - 0.5 );
	let ticks = boatInvstep( 0.08, 0.15, tickF ) * boatLstep( 0.72, 0.76, gr ) * boatInvstep( 0.86, 0.9, gr ) * boatInvstep( 2.3, 2.4, abs( ga ) );
	let lx = in.vs.vLocal.x; // positionLocal.x
	let needleA = sin( t * 0.7 + lx * 13.0 ) * 0.06 + lx * 3.7 + 0.3;
	let nd = vec2f( sin( needleA ), cos( needleA ) );
	let along = dot( gq, nd );
	let perp = length( gq - nd * along );
	let needle = boatInvstep( 0.025, 0.045, perp ) * step( -0.1, along ) * boatInvstep( 0.68, 0.72, along );
	let backlight = night * 1.4 + 0.25;
	let gauge = ( vec3f( 0.9, 0.95, 1.0 ) * ticks + vec3f( 1.0, 0.45, 0.08 ) * needle ) * backlight + vec3f( 0.004 );

	let nav = vColor * mat.navOn * ( night * 7.0 + 1.5 );
	let flood = vColor * ( night * 9.0 + 0.02 );
	let dome = vColor * ( night * 2.2 + 0.02 );
	let lcd = vColor * ( night * 0.5 + 0.45 );

	s.albedo = vColor * 0.06;
	s.emissive = nav * boatIsPattern( mode, 0.0 )
		+ radar * boatIsPattern( mode, 1.0 )
		+ chart * boatIsPattern( mode, 2.0 )
		+ gauge * boatIsPattern( mode, 3.0 )
		+ flood * boatIsPattern( mode, 4.0 )
		+ dome * boatIsPattern( mode, 5.0 )
		+ lcd * boatIsPattern( mode, 6.0 );
	s.roughness = aux.x;
`;
		return m;

	}

	// Vinyl-coated wire traps: alpha-tested mesh. uv in meters, aux.xy = face size
	// (for the solid frame border), pattern 1 = diamond twine netting.
	createTrap() {

		const m = standard( { roughness: 0.55, metalness: 0, side: DoubleSide, alphaTest: 0.5, ...COMMON() } );
		m.name = 'boatTrap';
		m.surface = /* wgsl */`
	let aux = in.vs.vAux;
	let u = in.uv;
	let net = boatIsPattern( aux.z, 1.0 );
	let diag = vec2f( u.x + u.y, u.x - u.y ) * 0.7071;
	let q = mix( u / 0.038, diag / 0.05, net );
	let fr = abs( fract( q ) - 0.5 );
	let fw = fwidth( q );
	let half = mix( ${ f( 0.5 - 0.0045 / 0.038 ) }, ${ f( 0.5 - 0.002 / 0.05 ) }, net );
	let lineX = boatLstep( half - fw.x, half, fr.x );
	let lineY = boatLstep( half - fw.y, half, fr.y );
	let b = 0.014;
	let inner = step( b, u.x ) * step( b, u.y ) * step( u.x, aux.x - b ) * step( u.y, aux.y - b );
	let border = ( 1.0 - inner ) * ( 1.0 - net );
	s.alpha = max( max( lineX, lineY ), border );
	s.albedo = in.color.rgb * mix( 1.0, 0.8, border );
`;
		return m;

	}

	setNavLights( on ) {

		this.navOn.value = on ? 1 : 0;

	}

	dispose() {

		for ( const k of [ 'hull', 'gelcoat', 'wood', 'fittings', 'glass', 'glow', 'trap' ] ) this[ k ].dispose();

	}

}
