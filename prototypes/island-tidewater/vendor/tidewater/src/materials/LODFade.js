import { ShaderModule } from '../engine/gpu/Shader.js';

// Screen-door cross-fade between levels of detail (and for anything that appears or disappears
// with distance), so nothing switches over in one frame.
//
// Both levels are drawn during a transition band. Each discards the pixels where the ordered-dither
// (Bayer 4x4) threshold says it isn't visible: the incoming level keeps the pixels below `fade`,
// the outgoing one the pixels at or above the SAME threshold, so together they cover every pixel
// exactly once (no holes, no double-drawn pixels). The pattern shifts every frame, so the TAA
// resolves the 16 dither levels into a smooth blend.
//
// fade: 0..1, the share of this level that is visible (the same value for both levels of one
// instance: ramp it with distance across the band on the CPU or in the vertex stage).
//
// WGSL (lodFadeModule):
//   fn bayer4( pixel: vec2f ) -> f32                 threshold in (0, 1) for a fragment coordinate
//   fn lodFadeVisible( pixel: vec2f, fade: f32, outgoing: bool ) -> bool
// In a surface / shadow snippet: `if ( ! lodFadeVisible( in.pixel, fade, false ) ) { discard; }`
// (Nothing is discarded at fade >= 1 (incoming) or fade <= 0 (outgoing).)

export const lodFadeModule = new ShaderModule( {
	name: 'lodFade',
	code: /* wgsl */`
// Bayer 4x4 threshold in (0, 1): bit-interleaved formula of
//   0  8  2 10 / 12  4 14  6 / 3 11  1  9 / 15  7 13  5
fn bayer4( pixel: vec2f ) -> f32 {
	let f = frame.frameIndex;
	// shift the pattern by a different offset every frame (all 16 over 16 frames)
	let p = vec2u( pixel ) + vec2u( f * 3u, ( f >> 2u ) * 1u );
	let x0 = p.x & 1u; let x1 = ( p.x >> 1u ) & 1u;
	let y0 = p.y & 1u; let y1 = ( p.y >> 1u ) & 1u;
	let v = ( ( x0 ^ y0 ) << 3u ) | ( y0 << 2u ) | ( ( x1 ^ y1 ) << 1u ) | y1;
	return ( f32( v ) + 0.5 ) / 16.0;
}

fn lodFadeVisible( pixel: vec2f, fade: f32, outgoing: bool ) -> bool {
	let t = bayer4( pixel );
	return select( ( t < fade ), ( t >= fade ), outgoing );
}
`,
} );

// Fade factor across a distance band [start, end] (0 before, 1 after), for the level that takes over
// at `end`. Use on the CPU when bucketing instances.
export function bandFade( dist, start, end ) {

	const t = ( dist - start ) / Math.max( end - start, 1e-6 );
	return t <= 0 ? 0 : t >= 1 ? 1 : t * t * ( 3 - 2 * t );

}
