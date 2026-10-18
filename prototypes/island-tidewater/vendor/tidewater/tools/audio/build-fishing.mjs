// Builds the fishing sounds of public/audio from CC0 Freesound previews (see README.md):
//   node dl.mjs <id:user ...>        (downloads raw/<id>.ogg + raw/<id>.json, prints the licence)
//   node build-fishing.mjs           -> out/*.ogg + fishing-bank.json (slice tables + measured loudness)
// Loops: excerpt, equal-power crossfade at the wrap, loudness-normalised to -23 LUFS integrated.
// Sprites: slices peak-normalised to -1 dBFS; each slice's maximum momentary loudness is measured.
import { decode, writeWav, peak, gain, lufsOf, makeLoop, fade, encode, momentary, SR } from './lib.mjs';
import fs from 'node:fs';

const OUT = 'out', W = 'work';
fs.mkdirSync( OUT, { recursive: true } );
fs.mkdirSync( W, { recursive: true } );
const hp = ( f ) => `highpass=f=${ f }:p=2`;
const bank = {};

// ---------------------------------------------------------------- loops
const LOOPS = {
	// spinning reel cranked steadily: gear ticking + a little rotor whirr (rate follows the crank)
	reel_wind: { src: 509902, from: 10.2, len: 6.2, xf: 0.4, af: hp( 120 ) },
	// line pulled off a reel against the drag (fish running): the ratchet screams
	reel_drag: { src: 507070, from: 0.35, len: 3.2, xf: 0.3, af: hp( 200 ) },
	// nylon line under strain, rubbing (high tension creak)
	line_strain: { src: 450849, from: 0.05, len: 0.95, xf: 0.25, af: hp( 300 ) },
};
for ( const [ name, L ] of Object.entries( LOOPS ) ) {
	const N = Math.round( L.len * SR ), X = Math.round( L.xf * SR );
	const seg = decode( `raw/${ L.src }.ogg`, 1, L.from, L.len + L.xf + 0.05, L.af || '' );
	const loop = makeLoop( seg, N, X );
	writeWav( `${ W }/${ name }.wav`, loop );
	const m = lufsOf( `${ W }/${ name }.wav` );
	gain( loop, 10 ** ( ( - 23 - m.I ) / 20 ) );
	const pk = peak( loop );
	if ( pk > 0.89 ) gain( loop, 0.89 / pk );
	writeWav( `${ W }/${ name }.wav`, loop );
	encode( `${ W }/${ name }.wav`, `${ OUT }/${ name }.ogg`, 64, 1 );
	const M = momentary( decode( `${ OUT }/${ name }.ogg`, 1 ) ).sort( ( a, b ) => a - b );
	bank[ name ] = { file: `${ name }.ogg`, loop: true, lufs: + M[ Math.floor( M.length / 2 ) ].toFixed( 1 ), src: [ L.src ] };
	console.log( `loop   ${ name.padEnd( 12 ) } src ${ L.src }  ${ L.len } s  lufs(before) ${ m.I } -> -23  median M ${ bank[ name ].lufs }` );
}

// ---------------------------------------------------------------- sprites: [src, start, dur, fadeIn, fadeOut, highpass]
const SPRITES = {
	// rod swung through the air (cast)
	rod_swish: [ [ 371313, 0.66, 0.4 ], [ 371313, 2.58, 0.45 ], [ 371313, 5.12, 0.6 ], [ 371313, 15.9, 0.42 ], [ 725426, 0, 0.6 ] ],
	// the bail wire flipping open / snapping shut (a small sprung metal latch)
	bail_click: [ [ 523282, 1.79, 0.16 ], [ 523282, 3.03, 0.17 ], [ 523282, 4.28, 0.14 ], [ 523282, 9.32, 0.18 ] ],
	// line peeling off the spool as the cast flies out
	line_out: [ [ 464697, 0.0, 0.64, 0.01, 0.2, 150 ] ],
	// lure / bobber landing
	plop: [ [ 849752, 0.0, 0.62, 0.002, 0.2, 80 ], [ 464697, 0.9, 0.26, 0.002, 0.12, 80 ] ],
	// line snapping (strings breaking under tension)
	line_snap: [ [ 537084, 2.83, 0.55 ], [ 537084, 11.52, 0.5 ], [ 537084, 21.47, 0.5 ], [ 537084, 24.28, 0.5 ] ],
	// a hooked fish thrashing at the surface / splashes
	fish_splash: [ [ 507094, 0.36, 0.46 ], [ 507094, 0.76, 0.32 ], [ 507094, 1.05, 0.5 ], [ 507093, 0.15, 1.2, 0.05, 0.4 ], [ 507093, 1.6, 1.3, 0.05, 0.5 ] ],
	// the landed fish flapping / flopping
	fish_flop: [ [ 649003, 0.0, 1.35, 0.005, 0.3 ], [ 570208, 0.95, 0.3 ], [ 570208, 1.72, 0.3 ], [ 570208, 3.15, 0.32 ] ],
	// coins for the sale
	coins: [ [ 336585, 0.04, 1.6, 0.004, 0.3, 120 ] ],
};
const GAP = 0.08;
for ( const [ name, slices ] of Object.entries( SPRITES ) ) {
	const parts = [], table = [], lufs = [];
	let t = GAP;
	for ( const [ src, st, d, fi = 0.003, fo = Math.min( 0.12, d * 0.35 ), hpf = 60 ] of slices ) {
		const pre = 0.004;
		const [ x ] = decode( `raw/${ src }.ogg`, 1, Math.max( 0, st - pre ), d + pre, hp( hpf ) );
		fade( [ x ], Math.round( fi * SR ), Math.round( fo * SR ) );
		gain( [ x ], 0.89 / Math.max( peak( [ x ] ), 1e-6 ) );
		parts.push( x );
		table.push( [ + t.toFixed( 4 ), + ( x.length / SR ).toFixed( 4 ) ] );
		t += x.length / SR + GAP;
	}
	const buf = new Float32Array( Math.ceil( ( t + 0.02 ) * SR ) );
	let o = Math.round( GAP * SR );
	for ( const x of parts ) { buf.set( x, o ); o += x.length + Math.round( GAP * SR ); }
	writeWav( `${ W }/${ name }.wav`, [ buf ] );
	encode( `${ W }/${ name }.wav`, `${ OUT }/${ name }.ogg`, 64, 1 );
	const y = decode( `${ OUT }/${ name }.ogg`, 1 );
	for ( const [ ts, d ] of table ) lufs.push( + Math.max( ...momentary( [ y[ 0 ].slice( Math.floor( ts * SR ), Math.floor( ( ts + d ) * SR ) ) ] ) ).toFixed( 1 ) );
	bank[ name ] = { file: `${ name }.ogg`, slices: table, lufs, src: [ ...new Set( slices.map( ( s ) => s[ 0 ] ) ) ] };
	console.log( `sprite ${ name.padEnd( 12 ) } ${ table.length } slices  lufs ${ lufs.join( ' ' ) }` );
}
fs.writeFileSync( 'fishing-bank.json', JSON.stringify( bank, null, 1 ) );
