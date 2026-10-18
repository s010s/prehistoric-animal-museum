import { Color, Vector2 } from '../../engine/index.js';
import { Material } from '../../engine/render/Material.js';
import { ShaderModule, UniformBlock } from '../../engine/gpu/Shader.js';
import { commonModule } from '../../engine/render/wgsl/common.js';
import { lodFadeModule } from '../../materials/LODFade.js';
import { WORLD } from '../WorldLayout.js';
import { NOISE_SCALE } from './ReefNoise.js';

// Materials of the reef (WGSL snippets on the engine Material). All surface detail is procedural;
// the only texture is a small tileable 3D noise volume (ReefNoise.js) that replaces per-pixel
// noise evaluation: one fetch gives four noise values, which made the reef several times cheaper
// to shade.
//
// Both reef batches share the vertex stage: the instance record (see Reef.js) places,
// rotates and scales the model, massive forms get a per-colony warp, flexible organisms
// sway with the surge of the swell, and everything the fragment stage needs is passed as
// a few varyings.
//
// Instance record (4 x vec4):
//   r0 = ( position.xyz, scale )    r1 = orientation quaternion
//   r2 = ( colour 1, colour 2 (packed sRGB 8:8:8), draw distance (whole m) + seed, surface type )
//   r3 = ( stretch.xyz, flexibility (> 0) or shape warp (< 0) )
//
// The hard batch has no discard, which keeps the GPU's hidden surface removal effective
// (overdraw is cheap). Surfaces are close to water in refractive index, so underwater they
// show almost no specular reflection: specular intensity is kept low except on glossy spines.
//
// WGSL port - exports used by other files (they were TSL nodes / functions before):
//   reefCommonModule: WGSL
//     fn rotateQ( q: vec4f, v: vec3f ) -> vec3f
//     fn reefUnpackColor( f: f32 ) -> vec3f                       packed sRGB -> linear
//     fn bumpNormal( P: vec3f, N: vec3f, height: f32 ) -> vec3f  world-space surface-gradient bump
//        (P = in.P, N = in.N; call in uniform control flow: it takes derivatives)
//   rotateQ( q, v ) / bumpNormal( height ) : JS helpers returning those calls as WGSL strings
//        (bumpNormal uses `in.P` / `in.N` of a surface snippet)
//   srgb( hex ): WGSL `vec3f( … )` literal of the linearized colour
//   makeSurge( getOcean ): { module, call( xz, depth, t ) } (module defines reefSurge)
//   V (varying names), reefColors() (WGSL expressions of the two unpacked colours)
//   reefVertex( batch, surge, view, fade ): the WGSL vertex snippet
// Motion vectors: the engine derives them from the swayed world position of this frame and the
// previous one (v.prevWorldPos), replacing the TSL mrt( staticVelocity + vVelocity ).

export const aData = 'v.aData';

export const SURFACE = {
	rock: 0, star: 1, brain: 2, brainWide: 3, porites: 4, acropora: 5, finger: 6, fire: 7, plate: 8, pillar: 9,
	gorgonian: 10, sponge: 11, urchin: 12, anemone: 13, rubble: 14, grass: 15, fan: 16, plume: 17,
	lettuce: 18, algae: 19, sargassum: 20,
};

const SWELL = new Vector2( WORLD.swellDir.x, WORLD.swellDir.y ).normalize();
const TAU = Math.PI * 2;
const f = ( x ) => {

	const s = String( x );
	return /[.e]/.test( s ) ? s : s + '.0';

};

export const srgb = ( hex ) => {

	const c = new Color( hex );
	return `vec3f( ${ f( c.r ) }, ${ f( c.g ) }, ${ f( c.b ) } )`;

};

// packs a colour as 8 bit sRGB into a float (exact: 24 bits)
export const packColor = ( c ) => c.getHex();

export const reefCommonModule = new ShaderModule( {
	name: 'reefCommon',
	deps: [ commonModule ],
	code: /* wgsl */`
fn reefUnpackColor( f: f32 ) -> vec3f {
	let u = u32( f + 0.5 ); // the value is exact, but interpolation may leave it a hair below
	let c = vec3f( f32( ( u >> 16u ) & 255u ), f32( ( u >> 8u ) & 255u ), f32( u & 255u ) ) / 255.0;
	return pow( c, vec3f( 2.2 ) );
}

fn rotateQ( q: vec4f, v: vec3f ) -> vec3f { return v + cross( q.xyz, cross( q.xyz, v ) + v * q.w ) * 2.0; }

// bump mapping from a scalar height field (Mikkelsen's surface gradient; the TSL version worked in
// view space, this one in world space: the construction is invariant under the view rotation)
fn bumpNormal( P: vec3f, N: vec3f, height: f32 ) -> vec3f {
	let dpx = dpdx( P ); let dpy = dpdy( P );
	let dhdx = dpdx( height ); let dhdy = dpdy( height );
	let r1 = cross( dpy, N ); let r2 = cross( N, dpx );
	let det = dot( dpx, r1 );
	let grad = sign( det ) * ( dhdx * r1 + dhdy * r2 );
	return normalize( abs( det ) * N - grad );
}
`,
} );

export const rotateQ = ( q, v ) => `rotateQ( ${ q }, ${ v } )`;
export const bumpNormal = ( height ) => `bumpNormal( in.P, in.N, ${ height } )`;

// Horizontal water displacement (m) at xz and the given depth, which sways the reef back and
// forth: the long-period surge of the ground swell (a coherent analytic wave train travelling
// with the swell: in 2 - 10 m of water its orbits reach the seabed almost undiminished) plus the
// orbital motion of the simulated waves overhead (long FFT cascades, when the ocean is known).
// WGSL: fn reefSurge( xz: vec2f, depth: f32, t: f32 ) -> vec2f; evaluated at frame.time and
// frame.time - frame.dt for the motion vectors (the FFT part changes little in a frame).
// getOcean() is read when the material is built: an OceanFFT exposing `module` (bindings
// oceanDisplacement: texture_2d_array), `cascades` and `sizes`.
export function makeSurge( getOcean ) {

	const fft = getOcean ? getOcean() : null;
	let fftCode = '';
	const deps = [ commonModule ];
	if ( fft && fft.module ) {

		deps.push( fft.module );
		for ( let k = 0; k < Math.min( 2, fft.cascades ); k ++ ) {

			const L = f( fft.sizes[ k ] );
			fftCode += `\t{ let smp = textureSampleLevel( oceanDisplacement, smpLinearRepeat, xz / ${ L }, ${ k }, 3.0 ); d += vec2f( smp.x, smp.z ) * exp( depth * ( - ${ f( TAU ) } / ${ L } ) ); }\n`;

		}

	}

	const module = new ShaderModule( {
		name: 'reefSurge' + ( fftCode ? '-fft' : '' ),
		deps,
		code: /* wgsl */`
const REEF_SWELL_DIR = vec2f( ${ f( SWELL.x ) }, ${ f( SWELL.y ) } );
const REEF_SWELL_SIDE = vec2f( ${ f( - SWELL.y ) }, ${ f( SWELL.x ) } );
fn reefSwell( xz: vec2f, t: f32 ) -> vec2f {
	let along = dot( xz, REEF_SWELL_DIR ); let across = dot( xz, REEF_SWELL_SIDE );
	let a = sin( t * ${ f( TAU / 8.2 ) } - along * ${ f( TAU / 70 ) } + sin( across * 0.021 ) * 1.5 ) * 0.3;
	let b = sin( t * ${ f( TAU / 5.3 ) } - along * ${ f( TAU / 34 ) } + across * 0.09 ) * 0.1;
	let c = sin( t * ${ f( TAU / 11.7 ) } + across * ${ f( TAU / 45 ) } ) * 0.07;
	return REEF_SWELL_DIR * ( a + b ) + REEF_SWELL_SIDE * c;
}
fn reefSurge( xz: vec2f, depth: f32, t: f32 ) -> vec2f {
	var d = vec2f( 0.0 );
${ fftCode }	return reefSwell( xz, t ) + d;
}
`,
	} );
	return { module, call: ( xz, depth, t ) => `reefSurge( ${ xz }, ${ depth }, ${ t } )` };

}

// varyings shared by the reef materials (kept small: on tile-based GPUs every vertex output
// is written to memory)
export const VARYINGS = {
	vReefColors: 'vec2f', // two packed sRGB colours
	vReefLocal: 'vec3f', // object-space position (m)
	vReefData: 'vec4f', // aData
	vReefInfo: 'vec3f', // seed, surface type, scale
};
export const V = { local: 'in.vs.vReefLocal', data: 'in.vs.vReefData', info: 'in.vs.vReefInfo' };

// Fragment stage: the two instance colours (linear).
export const reefColors = () => [ 'reefUnpackColor( in.vs.vReefColors.x )', 'reefUnpackColor( in.vs.vReefColors.y )' ];

// The view uniforms (main camera position, draw distance): Reef.js owns the block.
export function createReefView() {

	return new UniformBlock( 'ReefView', { position: [ 'vec3f' ], range: [ 'f32', 45 ] } );

}

// Vertex stage: sets the world position (the batch meshes have identity transforms), the normal
// and the varyings. view = ReefView uniforms: the main camera (not the shadow camera) and the draw
// distance; instances shrink away over the last fifth of their draw distance so that nothing pops
// when the culling adds or drops them.
// fade: level-of-detail cross-fade (ReefBatch fade channel): o.vReefFade = ( share of this level,
// outgoing (1) or not )
export function reefVertex( batch, surge, view, fade = false ) {

	const P = batch.prefix;
	const rec = batch.record( 'index' );
	return /* wgsl */`
	let kind = u32( v.aKind );
${ fade ? `	let e = ${ P }FadeEntry( kind, v.instance );
	o.vReefFade = vec2f( e.fade, e.outgoing );
	let index = e.index;` : `	let index = ${ P }RecordIndex( kind, v.instance );` }
	let r0 = ${ rec[ 0 ] }; let q = ${ rec[ 1 ] }; let r2 = ${ rec[ 2 ] }; let r3 = ${ rec[ 3 ] };
	let seed = fract( r2.z ); // integer part: the instance's draw distance (m)
	let fadeEnd = min( floor( r2.z ), reefView.range );
	let grow = 1.0 - smoothstep( fadeEnd * 0.75, fadeEnd * 0.95, length( r0.xyz - reefView.position ) );
	let scale = r3.xyz * r0.w;
	var p = v.position * scale;
	o.vReefLocal = p;
	o.vReefData = v.aData;
	o.vReefColors = r2.xy;
	o.vReefInfo = vec3f( seed, r2.w, r0.w );
	let nrm = normalize( rotateQ( q, v.normal / scale ) );
	let flex = r3.w;
	if ( flex < 0.0 ) {
		// massive forms: a smooth per-colony warp so no two look cloned (the base stays put)
		let w = v.position * 3.1 + seed * 17.0;
		let off = vec3f( sin( w.y * 1.7 + w.z ), sin( w.z * 1.3 + w.x * 1.1 ) * 0.6, sin( w.x * 1.9 + w.y * 0.7 ) );
		p += off * ( - flex * r0.w * ( v.aData.x * 0.8 + 0.2 ) );
	}
	var world = rotateQ( q, p * grow ) + r0.xyz;
	var prev = world;
	if ( flex > 0.0 ) {
		// bend grows with the square of the position along the organism; tips lag behind
		let t = v.aData.x;
		let h = max( world.y - r0.y, 0.0 );
		let depth = max( frame.seaLevel - world.y, 0.0 );
		let sxz = r0.xz - REEF_SWELL_DIR * ( h * 4.0 );
		let sNow = ${ surge.call( 'sxz', 'depth', 'frame.time' ) };
		let sPrev = ${ surge.call( 'sxz', 'depth', 'frame.time - frame.dt' ) };
		let ph = frame.time * 1.7 + seed * 40.0 + v.aData.w * 12.0;
		let phPrev = ph - frame.dt * 1.7;
		let bend = flex * t * t * grow;
		let dNow = ( sNow + vec2f( sin( ph ), cos( ph * 0.77 ) ) * 0.06 ) * bend;
		let now = vec3f( dNow.x, - dot( dNow, dNow ) / ( max( h, 0.1 ) * 2.0 ), dNow.y );
		let dPrev = ( sPrev + vec2f( sin( phPrev ), cos( phPrev * 0.77 ) ) * 0.06 ) * bend;
		let before = vec3f( dPrev.x, - dot( dPrev, dPrev ) / ( max( h, 0.1 ) * 2.0 ), dPrev.y );
		world += now;
		prev = world - now + before;
	}
	v.useWorld = true;
	v.worldPos = world;
	v.worldNormal = nrm;
	v.prevWorldPos = prev;
`;

}

// ---------------------------------------------------------------------------
// fragment helpers (WGSL)

const fragModule = new ShaderModule( {
	name: 'reefFrag',
	deps: [ commonModule, reefCommonModule ],
	code: /* wgsl */`
// pixel footprint in meters (computed once per pixel as reefPixel( in.P ) at the top), and a
// 1 -> 0 fade for patterns of the given spacing
fn reefPixel( P: vec3f ) -> f32 { return length( fwidth( ( frame.view * vec4f( P, 1.0 ) ).xyz ) ) * 0.7; }
fn reefFade( spacing: f32, px: f32 ) -> f32 { return 1.0 - smoothstep( 0.25, 0.6, px / spacing ); }

fn reefHue( c: vec3f, n: f32, amount: f32 ) -> vec3f { return c * ( vec3f( 1.0 ) + vec3f( n, n * 0.5, n * -0.5 ) * amount ); }

// cheap packed polyp / corallite bumps (0..1) with about \`spacing\` meters between them
fn reefPolyps( p: vec3f, spacing: f32 ) -> f32 {
	let q = p * ( PI / spacing );
	let w = q + sin( q.yzx * 0.47 ) * 1.4 + sin( q.zxy * 0.29 + 1.7 ) * 1.1;
	return abs( sin( w.x ) * sin( w.y ) * sin( w.z ) );
}

// Round features on a jittered 3D grid of \`size\` meters (one hash per pixel): distance from
// the cell's feature point (0 .. ~0.9) and a random value per cell. The surface slices the
// cells at random heights, so the cups / pits / pores vary in size. Returns ( d, h ).
fn reefCells( p: vec3f, size: f32 ) -> vec2f {
	let q = p / size;
	let h = mx_cell_noise_float3( floor( q ) );
	let c = vec3f( h, fract( h * 7.13 ), fract( h * 3.71 ) ) * 0.3 + 0.35;
	return vec2f( length( fract( q ) - c ), h );
}

// four noise values per fetch; the tile holds 8 noise cells, so sampling at p * k gives
// features of 1 / ( 8 k ) m
fn reefVol( p: vec3f ) -> vec4f { return ( textureSample( reefNoise, smpLinearRepeat, p ) - 0.5 ) * ${ f( NOISE_SCALE ) }; }
`,
} );

const S = SURFACE;

// hard batch: the whole shading as one surface snippet (writes s.*)
const HARD_SURFACE = /* wgsl */`
	// everything shared by the branches is computed up front
	let c1 = reefUnpackColor( in.vs.vReefColors.x );
	let c2 = reefUnpackColor( in.vs.vReefColors.y );
	let L = in.vs.vReefLocal; let D = in.vs.vReefData;
	let seed = in.vs.vReefInfo.x; let stype = floor( in.vs.vReefInfo.y + 0.5 );
	let t = D.x; let ao = D.y; let part = D.z; let rnd = D.w;
	let px = reefPixel( in.P );
	let P = L + seed * 17.0;
	let A = reefVol( P * 0.4 ); // ~30 cm features
	let B = reefVol( P * 1.25 + 0.37 ); // ~10 cm features
	let n1 = A.x; let n2 = B.x; // colony-scale mottling, blotches
	let base = reefHue( c1, n1, 0.18 ) * ( 1.0 + n2 * 0.12 );
	var albedo = base;
	var occl = ao;
	var height = 0.0;
	var rough = 0.8;
	var spec = 0.3;
	// light passing through thin tissue (blades, fronds, rods)
	var thin = select( select( 0.0, 0.3, stype == ${ f( S.gorgonian ) } || stype == ${ f( S.lettuce ) } || stype == ${ f( S.algae ) } ), 0.55, stype == ${ f( S.grass ) } || stype == ${ f( S.sargassum ) } );

	// turf-covered dead base where a colony meets the seabed
	let turf = mix( ${ srgb( 0x5e5234 ) }, ${ srgb( 0x725c46 ) }, smoothstep( -0.3, 0.4, n2 ) );
	let up = sat( in.N.y );

	if ( stype == ${ f( S.rock ) } ) {

		// dead coral framework: algal turf with a sediment veneer on the tops, crustose coralline
		// algae (pink / lavender) spreading over sides and edges, small encrusting colonies and
		// sponges, bio-eroded pits and cracks
		let n3 = A.y; let n4 = B.y;
		// fine speckle and grain (turf filaments, coralline bumps, pores), fetched only where
		// they are resolved (most reef pixels are distant)
		var speck = 0.0; var grainF = 0.0;
		let fs = reefFade( 0.04, px );
		if ( fs > 0.001 ) {
			speck = reefVol( P * 3.2 + 0.71 ).x * fs;
			let fg = reefFade( 0.012, px );
			if ( fg > 0.001 ) {
				let gv = reefVol( P * 12.0 + 1.7 );
				grainF = ( gv.x + gv.y * 0.5 ) * fg;
			}
		}
		let turfC = mix( ${ srgb( 0x6a5c44 ) }, ${ srgb( 0x86744e ) }, smoothstep( -0.4, 0.4, n2 + speck * 0.6 ) );
		var c = mix( base, turfC, smoothstep( -0.3, 0.3, n1 + up * 0.3 ) * 0.7 );
		// sediment veneer on flat tops
		c = mix( c, ${ srgb( 0xa89e88 ) }, smoothstep( 0.82, 0.97, up ) * smoothstep( -0.1, 0.3, A.z ) * 0.55 );
		// coralline crusts
		let cca = smoothstep( 0.05, 0.3, n3 * 0.7 + n4 * 0.5 ) * ( 1.0 - up * 0.5 );
		c = mix( c, c2 * ( 0.88 + speck * 0.2 + grainF * 0.25 ), cca * 0.8 );
		// small encrusting colonies (mustard / brown / olive) with corallites
		let col = smoothstep( 0.18, 0.26, B.z + A.w * 0.25 );
		let colC = mix( mix( ${ srgb( 0xa89048 ) }, ${ srgb( 0x8a6a48 ) }, smoothstep( -0.3, 0.3, A.w ) ), ${ srgb( 0x7a7c4a ) }, smoothstep( 0.2, 0.5, A.x ) );
		let colPol = reefPolyps( P, 0.006 ) * reefFade( 0.006, px ) * col;
		c = mix( c, colC * ( 0.8 + colPol * 0.35 + grainF * 0.2 ), col * 0.75 );
		// encrusting sponges on the sides
		let sp = smoothstep( 0.3, 0.38, B.w + A.z * 0.3 ) * ( 1.0 - up * 0.7 );
		let spC = mix( mix( ${ srgb( 0xc0662c ) }, ${ srgb( 0xa83a30 ) }, smoothstep( -0.2, 0.2, A.y ) ), mix( ${ srgb( 0x7a3a82 ) }, ${ srgb( 0xc8a02c ) }, smoothstep( 0.1, 0.3, B.y ) ), smoothstep( 0.2, 0.4, A.w ) );
		c = mix( c, spC, sp * 0.9 );
		// bio-eroded pits of varied size, coral recruits here and there
		let pc = reefCells( P, 0.03 );
		let pitR = pc.y * 0.16 + 0.06;
		let pit = ( 1.0 - smoothstep( pitR, pitR + 0.08, pc.x ) ) * step( 0.55, fract( pc.y * 5.3 ) ) * smoothstep( 0.0, 0.3, - A.w ) * reefFade( 0.045, px );
		let rc = reefCells( P, 0.08 );
		let recruit = ( 1.0 - smoothstep( 0.2, 0.3, rc.x ) ) * step( 0.93, rc.y );
		c = mix( c, mix( ${ srgb( 0xa89648 ) }, ${ srgb( 0xb07a50 ) }, fract( rc.y * 11.3 ) ), recruit * 0.9 );
		// rugged relief: ridged creases at two scales, rough grain; crevices stay dark
		let r3 = ( 1.0 - abs( n3 ) ) * 2.0 - 1.0;
		let r4 = ( 1.0 - abs( n4 ) ) * 2.0 - 1.0;
		let grain = speck * 1.4;
		let cav = smoothstep( -0.9, 0.2, r4 + grain * 0.4 + grainF * 0.3 );
		c = c * ( 0.88 + speck * 0.25 + grainF * 0.3 ) * ( 1.0 - pit * mix( 0.35, 0.7, pc.y ) ) * mix( 0.72, 1.0, cav );
		albedo = c;
		height = n1 * 0.04 + r3 * 0.016 + r4 * 0.008 + grain * 0.003 + grainF * 0.0018 + col * 0.003
			+ colPol * 0.0008 + sp * 0.002 + recruit * 0.004 - pit * 0.008;
		occl = occl * ( 1.0 - pit * 0.5 ) * mix( 0.65, 1.0, cav );
		rough = 0.95;

	} else if ( stype == ${ f( S.star ) } ) {

		// star coral: packed corallite cups with raised walls, mottled colony tissue
		let fz = reefFade( 0.006, px );
		let cup = reefCells( P, 0.0055 );
		let rim = smoothstep( 0.3, 0.55, cup.x ) * fz;
		let lump = B.z * reefFade( 0.05, px );
		let tone = mix( base, c2, smoothstep( 0.0, 0.3, n1 + n2 * 0.4 ) * 0.7 ) * ( 0.9 + lump * 0.15 );
		albedo = mix( tone * 0.7, tone * 1.12, rim + ( 1.0 - fz ) * 0.5 );
		height = rim * 0.0018 + n2 * 0.004 + lump * 0.004 + n1 * 0.01;
		rough = 0.78;

	} else if ( stype == ${ f( S.brain ) } || stype == ${ f( S.brainWide ) } ) {

		// brain corals: meandering valleys (the zero set of warped noise); wide-valley species
		// have a pale groove along the ridge
		let wide = stype == ${ f( S.brainWide ) };
		let freq = select( 52.0, 28.0, wide ) * mix( 0.85, 1.15, fract( seed * 7.3 ) );
		let q = P * freq;
		let wq = q + reefVol( q * ${ f( 0.31 / 8 ) } + seed ).xyz * 0.9;
		let mn = mx_noise_float3( wq );
		let aa = max( px * freq * 2.2, 1e-4 ); // ~ fwidth( mn ): no derivatives in divergent branches
		let width = select( 0.075, 0.12, wide );
		let ridge = mix( 0.55, smoothstep( width - aa, width + aa, abs( mn ) ), reefFade( 1.0 / freq, px ) );
		let valley = mix( c2, base * 0.55, 0.35 );
		let top = base * 1.15;
		let groove = smoothstep( 0.3, 0.34, abs( mn ) ) * ( 1.0 - smoothstep( 0.36, 0.4, abs( mn ) ) ) * reefFade( 0.5 / freq, px ) * select( 0.7, 1.0, wide );
		albedo = mix( valley, top, ridge ) * ( 1.0 - groove * 0.25 );
		height = ridge * select( 0.0035, 0.006, wide ) - groove * 0.001 + n1 * 0.006;
		rough = 0.7;

	} else if ( stype == ${ f( S.porites ) } ) {

		// mustard hill / starlet corals: fine pitted surface, knobby, mottled
		let pit = reefPolyps( P, 0.004 ) * reefFade( 0.004, px );
		let knob = reefPolyps( P + 3.3, 0.025 ) * reefFade( 0.025, px );
		let tone = mix( base, c2, smoothstep( 0.1, 0.4, n1 ) * 0.5 );
		albedo = tone * ( 0.74 + pit * 0.22 + knob * 0.28 );
		height = pit * 0.0008 + knob * 0.006 + n2 * 0.008 + B.z * 0.004;
		rough = 0.75;

	} else if ( stype == ${ f( S.acropora ) } ) {

		// elkhorn / staghorn: protruding corallites (a rough, bumpy surface), mottled
		// golden-brown tissue, a thin pale growing margin at the very tips
		let fz = reefFade( 0.005, px );
		let bump = reefPolyps( P, 0.005 ) * fz;
		let rough2 = reefVol( P * 4.75 ).x * reefFade( 0.04, px );
		let tip = smoothstep( 0.6, 1.0, part ) * smoothstep( 0.9, 1.0, t );
		let mott = mix( base, base * vec3f( 1.1, 0.95, 0.8 ), smoothstep( -0.3, 0.4, n2 ) );
		albedo = mix( mott, c2, tip * 0.8 ) * ( 0.84 + bump * 0.2 + rough2 * 0.14 );
		height = bump * 0.0016 + rough2 * 0.0025 + n2 * 0.002;
		rough = 0.8;

	} else if ( stype == ${ f( S.finger ) } || stype == ${ f( S.pillar ) } ) {

		// finger / pillar corals: fuzzy with extended polyps, blunt pale tips
		let fzv = reefVol( P * 18.0 );
		let fz = fzv.x * reefFade( 0.008, px ) + fzv.y * reefFade( 0.03, px ) * 0.6;
		let tip = smoothstep( 0.5, 1.0, part );
		albedo = mix( base, c2, tip * 0.6 ) * ( 0.88 + fz * 0.25 );
		height = fz * 0.002;
		rough = 0.95;

	} else if ( stype == ${ f( S.fire ) } ) {

		// fire coral: smooth, finely porous, mottled mustard with white growing edges
		let edge = smoothstep( 0.86, 1.0, t ) * ( part * 0.5 + 0.5 );
		let mott = mix( base, base * vec3f( 1.1, 1.0, 0.75 ), smoothstep( -0.3, 0.3, n2 ) );
		let pore = reefPolyps( P, 0.003 ) * reefFade( 0.003, px );
		albedo = mix( mott, c2, edge * 0.85 ) * ( 0.92 + pore * 0.12 );
		height = n2 * 0.004 + B.z * 0.002 + pore * 0.0004;
		rough = 0.6;

	} else if ( stype == ${ f( S.plate ) } ) {

		// plate corals: concentric ridges on top, pale growing margin, darker underside
		let r = length( L.xz );
		let ridges = sin( r * 260.0 + n1 * 3.0 ) * reefFade( 0.025, px ) * part;
		let margin = smoothstep( 0.85, 1.0, t );
		albedo = mix( base * mix( 0.55, 1.0, part ), c2, margin * 0.7 ) * ( 1.0 + ridges * 0.08 );
		height = ridges * 0.0012;
		rough = 0.7;

	} else if ( stype == ${ f( S.gorgonian ) } ) {

		// sea rods / whips: fuzzy with polyps; tips a little paler
		let fz = reefVol( P * 27.0 ).x * reefFade( 0.006, px );
		albedo = mix( base, c2, smoothstep( 0.6, 1.0, t ) * 0.5 ) * ( 0.85 + fz * 0.25 );
		height = fz * 0.001;
		rough = 0.95;

	} else if ( stype == ${ f( S.sponge ) } ) {

		// sponges: pores and oscula, a dark inner cavity
		let fz = reefFade( 0.008, px );
		let pc = reefCells( P, 0.009 );
		let pore = ( 1.0 - smoothstep( 0.1, 0.25, pc.x ) ) * fz;
		let inner = part;
		albedo = base * ( 1.0 - pore * 0.45 ) * mix( 1.0, 0.3, inner );
		height = pore * -0.0015 + n2 * 0.004;
		occl = ao * mix( 1.0, 0.45, inner );
		rough = 0.92;

	} else if ( stype == ${ f( S.urchin ) } ) {

		// long-spined urchin: glossy black spines with faint bands, dark purple test
		let band = ( sin( t * 40.0 ) * 0.5 + 0.5 ) * part * 0.15;
		albedo = mix( c2, c1, part ) + band * 0.02;
		rough = 0.35;
		spec = 1.0;

	} else if ( stype == ${ f( S.anemone ) } ) {

		// anemone: pale translucent tentacles with coloured tips
		albedo = mix( c1, c2, smoothstep( 0.6, 1.0, t ) * part );
		rough = 0.6;
		spec = 0.6;

	} else if ( stype == ${ f( S.rubble ) } ) {

		// rubble: bleached fragments and turf-covered pieces
		let bleached = mix( ${ srgb( 0xd4ccbc ) }, ${ srgb( 0xb9ad98 ) }, n2 * 0.5 + 0.5 );
		let turfed = mix( turf, c2, smoothstep( 0.2, 0.6, n1 ) * 0.6 );
		albedo = mix( turfed, bleached, part );
		height = reefPolyps( P, 0.004 ) * 0.0008 * reefFade( 0.004, px );
		rough = 0.9;

	} else if ( stype == ${ f( S.lettuce ) } ) {

		// lettuce coral: thin brown blades with fine ridges running up to a pale, growing edge
		let r = reefFade( 0.004, px );
		let ridges = sin( ( L.x + L.z ) * 700.0 + n1 * 4.0 ) * r;
		let edgeK = smoothstep( 0.82, 1.0, t );
		albedo = mix( base * ( 0.9 + ridges * 0.08 ), c2, edgeK * 0.75 );
		height = ridges * 0.0007 + n2 * 0.002;
		rough = 0.7;

	} else if ( stype == ${ f( S.algae ) } ) {

		// calcareous green algae: segments / tufts dusted with lime, paler at the edges
		let lime = smoothstep( 0.0, 0.6, n2 + t * 0.4 ) * 0.35;
		let tuft = part;
		albedo = mix( base, c2, lime + tuft * 0.2 ) * mix( 0.85, 1.05, rnd );
		rough = 0.85;

	} else if ( stype == ${ f( S.sargassum ) } ) {

		// Sargassum: olive-golden fronds, darker wiry axes, amber gas bladders
		let leaf = select( 0.0, 1.0, part > 0.5 && part < 1.5 );
		let bladder = select( 0.0, 1.0, part > 1.5 );
		let tone = base * mix( 0.8, 1.15, rnd ) * mix( 0.75, 1.05, t );
		albedo = mix( mix( tone * 0.6, tone, leaf ), ${ srgb( 0xa87a30 ) }, bladder * 0.7 );
		rough = 0.55;
		spec = 0.45;

	} else {

		// seagrass: dark bases, epiphyte-covered older tips
		let aged = mix( base, ${ srgb( 0x8a7c48 ) }, 0.6 );
		let tip = smoothstep( 0.5, 1.0, t ) * ( fract( rnd * 13.7 ) * 0.7 + 0.3 );
		albedo = mix( base * mix( 0.55, 1.0, smoothstep( 0.0, 0.4, t ) ), aged, tip );
		rough = 0.6;

	}

	// the attached base of colonies is dead, turf-covered skeleton, with a paler growing
	// margin of living tissue just above it
	let colonyK = select( 0.0, 1.0, stype > 0.5 && stype < 9.5 );
	let edge = t + n2 * 0.03;
	let deadBase = ( 1.0 - smoothstep( 0.0, 0.06, edge ) ) * colonyK;
	let margin = smoothstep( 0.04, 0.07, edge ) * ( 1.0 - smoothstep( 0.07, 0.12, edge ) ) * colonyK;
	albedo = mix( albedo, turf, deadBase * 0.9 ) * ( 1.0 + margin * 0.25 );
	// crevices also receive less direct light
	s.albedo = albedo * mix( 0.6, 1.0, occl );
	s.normal = bumpNormal( in.P, in.N, height );
	s.roughness = rough;
	s.ao = occl;
	s.specularIntensity = spec;
	let back = sat( dot( - in.N, frame.sunDir ) ) * 0.8 + 0.2;
	s.translucency = albedo * ( thin * back );
`;

// soft batch: alpha-tested sea fans and plumes (the mask goes to s.alpha, alphaTest 0.5)
const SOFT_SURFACE = /* wgsl */`
	let c1 = reefUnpackColor( in.vs.vReefColors.x );
	let c2 = reefUnpackColor( in.vs.vReefColors.y );
	let L = in.vs.vReefLocal; let D = in.vs.vReefData;
	let seed = in.vs.vReefInfo.x; let stype = floor( in.vs.vReefInfo.y + 0.5 ); let sc = in.vs.vReefInfo.z;
	let t = D.x; let part = D.z; let rnd = D.w;
	let px = reefPixel( in.P );
	let dither = interleavedGradientNoise( in.pixel + fract( frame.time * 7.3 ) * 97.0 );
	var mask = 1.0;
	var fanAlbedo = vec3f( 0.0 );
	if ( stype == ${ f( S.fan ) } ) {

		// fine net of anastomosing branchlets (~7 mm mesh, cells stretched along the radial
		// veins) and main veins forking outward from the stalk. Where the mesh gets too fine
		// to resolve the holes fill in (a solid silhouette): holes cost overdraw.
		let q = L.xy + seed * 3.1;
		let cell = 0.007;
		let resolve = smoothstep( 0.3, 1.0, px / cell );
		let rel = L.xy - vec2f( 0.0, sc * 0.06 );
		let r = length( rel ) / sc;
		let th = atan2( rel.x, rel.y );
		let forks = select( select( 20.0, 10.0, r < 0.48 ), 5.0, r < 0.22 );
		let wv = reefVol( vec3f( r * 0.75, seed * 1.1, q.x * 0.5 ) );
		let vv = abs( fract( th * forks / PI + wv.x * 0.35 ) - 0.5 ) * 2.0;
		let veinW = mix( 0.12, 0.035, r );
		let vein = 1.0 - smoothstep( veinW, veinW + 0.03, vv );
		var strand = select( 0.0, 1.0, dither < 0.72 );
		if ( resolve < 0.98 ) {
			let net = mx_worley_noise_vec2_2( vec2f( q.x, q.y * 0.55 ) / cell, 0.9 );
			let edge = sqrt( net.y ) - sqrt( net.x );
			strand = select( 0.0, 1.0, edge < 0.16 || dither < resolve * 0.72 );
		}
		mask = select( 0.0, 1.0, strand > 0.5 || vein > 0.5 || part > 0.5 || t < 0.05 );
		let tone = wv.y * 0.5 + 0.5;
		// a filled-in (distant) fan is darker: holes let the background through
		let col = mix( c1 * mix( 0.8, 1.1, tone ), c2, vein * 0.35 );
		fanAlbedo = mix( col, vec3f( dot( col, vec3f( 0.3, 0.5, 0.2 ) ) ), resolve * 0.45 ) * mix( 1.0, 0.7, resolve );

	} else {

		// plume: pinnules angled toward the branch tip on both sides of the rachis, of
		// uneven length; filled in where they can't be resolved
		let a = abs( part );
		let stem = part > 3.0;
		let k = t * 150.0 - a * 2.4 + rnd * 5.0;
		let lines = fract( k );
		let reach = 0.55 + fract( floor( k ) * 0.618 + rnd ) * 0.45;
		let pin = lines < 0.32 && a < reach;
		let resolve = smoothstep( 0.3, 1.0, px / ( sc * 0.0045 ) );
		let edge = a < mix( 1.0, 0.75, resolve );
		let solid = stem || a < 0.07 || pin || ( dither < resolve && edge );
		mask = select( 0.0, 1.0, solid );
		fanAlbedo = mix( c1, c2, a * 0.5 ) * mix( 0.8, 1.1, rnd ) * mix( 1.0, 0.8, resolve );

	}
	s.alpha = mask;
	s.albedo = fanAlbedo;
	s.specularIntensity = 0.2;
	// light shining through the thin tissue
	let back = sat( dot( - in.N, frame.sunDir ) );
	s.translucency = fanAlbedo * ( back * 0.4 + 0.05 );
`;

// shadow-pass mask of the soft batch is the full surface (alpha test), as three's maskNode

// fade: the materials of the level-of-detail cross-fade channels (dithered, see LODFade.js)
export function createReefMaterials( { hard, soft, getOcean, noise, view, fade: lodFade = false } ) {

	const surge = makeSurge( getOcean );
	const viewBlock = view && view.structName ? view : view.block; // the ReefView UniformBlock (createReefView)
	const common = {
		modules: [ commonModule, reefCommonModule, fragModule, surge.module, lodFadeModule ],
		textures: { reefNoise: noise },
		bindings: { reefView: { uniform: viewBlock } },
		attributes: { aKind: 'f32', aData: 'vec4f' },
		varyings: lodFade ? { ...VARYINGS, vReefFade: 'vec2f' } : { ...VARYINGS },
		roughness: 0.8, metalness: 0,
	};
	const fadeDiscard = lodFade ? /* wgsl */`
	if ( ! lodFadeVisible( in.pixel, in.vs.vReefFade.x, in.vs.vReefFade.y > 0.5 ) ) { discard; }
` : '';

	// ---- hard batch: everything opaque (no discard keeps hidden surface removal intact)
	const mat = new Material( {
		...common,
		modules: [ ...common.modules, hard.module ],
		name: lodFade ? 'ReefFade' : 'Reef',
		vertex: reefVertex( hard, surge, viewBlock, lodFade ),
		surface: fadeDiscard + HARD_SURFACE,
	} );

	// ---- soft batch: alpha-tested sea fans and plumes (double-sided, swaying)
	const fanMat = new Material( {
		...common,
		modules: [ ...common.modules, soft.module ],
		name: lodFade ? 'ReefSoftFade' : 'ReefSoft',
		roughness: 0.85,
		side: 'double',
		alphaTest: 0.5,
		vertex: reefVertex( soft, surge, viewBlock, lodFade ),
		surface: fadeDiscard + SOFT_SURFACE,
	} );

	return { hard: mat, soft: fanMat };

}
