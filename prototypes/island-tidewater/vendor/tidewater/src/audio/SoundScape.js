// Sample-based sound for the island: real field recordings only (public/audio, sources and licences in
// public/audio/CREDITS.md). Nothing is synthesised. Files are fetched and decoded after the first user
// gesture (resume()); boat, underwater, pier and night sounds load the first time they become audible.
//
// Surf is wave by wave, driven by the game's own shore waves (ShoreWaves): a CPU mirror of their phase
// (the travel-time field + the per-wave heights) at a row of stations along the waterline near the
// listener tells when each wave breaks (a crash at its break point), when its bore reaches the sand
// (the wash running up) and when the swash turns (the backwash draining down), each a random slice
// of real recordings, HRTF-placed where it happens. A quiet distant-surf bed carries the sound further.
//
// Birds: songbirds and doves sing short bouts from random perches in the island's trees near the
// listener (none on the open sea; more inland), by time of day - a dawn chorus (plus a diffuse chorus
// bed), a midday lull, sparse at dusk, silent at night. Gulls and terns call from the wildlife's real
// birds near the listener. The humpback (window.__app.whale): its song at the whale (clear underwater,
// faint and dull from above), and one-shots on its real events - blow, breach, re-entry, fluke-up dive -
// all only within 100 m of it.
//
// Signal flow
//   one-shots + beds above water → above ─→ muffle LP ×2 ─→ aboveOut ─┐
//     surf events → per event HRTF panner (+ air absorption) → above   │
//     engine → engine LP ─┐                                            │
//     hull / rush / slaps ┴→ boatSum ─┬→ HRTF panner (at the boat) → above   (from outside)
//                                     └→ unpanned → above                    (at the helm)
//     pier lapping → HRTF panner (under the pier, nearest point) → above
//     footsteps → foot (dry, no reverb) → above
//     birds, gulls, terns, whale blow / splashes → per event HRTF panner → above
//   whale song → HRTF panner (at the whale) → song LP + gain (open underwater) ─────┤
//   underwater bed + strokes → under (× underwater) ──────────────────────┤
//   submerge / emerge → near (unfiltered) ────────────────────────────────┤
//   master (volume, mute) → safety limiter → destination ←────────────────┘
//
// Levels: every sound has a target loudness (LUFS, momentary) for its reference situation in MIX below;
// the gain is target minus the file's measured loudness (soundBank.js).

import { WORLD } from '../world/WorldLayout.js';
import { BANK } from './soundBank.js';

const clamp = ( v, a, b ) => ( v < a ? a : v > b ? b : v );
const lerp = ( a, b, t ) => a + ( b - a ) * t;
const num = ( v, d ) => ( typeof v === 'number' && Number.isFinite( v ) ? v : d );
const smooth = ( a, b, x ) => {

	const t = clamp( ( x - a ) / ( b - a ), 0, 1 );
	return t * t * ( 3 - 2 * t );

};

const dB = ( d ) => Math.pow( 10, d / 20 );
const MONO = dB( - 3 ); // a mono file plays on both channels: +3 dB against its (mono) measured loudness

// Target loudness (LUFS, momentary) of each sound in its reference situation.
//   beds: at full weight; one-shots: per event (maximum momentary loudness)
export const MIX = {
	crash: - 15, // a wave breaking 10 m away (average wave; ±6 dB with the wave's height; line source: -4 dB per doubling)
	wash: - 20, // the bore running up the sand, 5 m away
	backwash: - 23, // the swash draining back down, 5 m away
	surfFar: - 31, // distant roar at 50 m from the shore (falls off slowly)
	wind: - 36, // 7 m/s, at the top of a gust (gusts come and go; lulls are near silent)
	palms: - 39, // inland among the trees in a gust
	crickets: - 33, // inland at night
	pierLap: - 32, // water lapping the piles, 3 m away
	reef: - 43, // underwater: snapping-shrimp crackle and low rumble (hydrophone), kept well in the background
	engineIdle: - 30, // at the helm
	engineRun: - 22, // at the helm, full rpm
	boatRush: - 27, // water past the hull at ~9 m/s
	boatLap: - 34, // lapping on the hull, boat at rest
	hullSlap: - 24, // hard slam at the helm (chop slaps while running are 6-14 dB quieter)
	spray: - 30, // spray layer on hard slams
	step: - 56, // footsteps: ~30 dB under the surf at the beach
	swim: - 43, // surface stroke
	uwSwim: - 43, // underwater stroke
	splashSoft: - 38, // wading out of your depth
	splash: - 30, // dropping into the water
	submerge: - 36,
	emerge: - 38,
	gull: - 21, // at 10 m (they call from 25-80 m)
	tern: - 25, // at 10 m
	bird: - 31, // a songbird in the trees, at 10 m (they sing from 10-80 m: ~-35 to -50)
	dove: - 34, // a dove cooing, at 10 m
	birdChorus: - 35, // dawn chorus bed, inland at its peak
	whaleSong: - 26, // humpback song underwater, 30 m from the whale (heard only within WHALE_RANGE)
	whaleBlow: - 20, // the blow at 10 m
	whaleBurst: - 17, // breaching: bursting out of the water, at 10 m
	whaleSplash: - 11, // breach re-entry, at 12 m
	whaleDrip: - 30, // water sheeting off the raised flukes, at 8 m
	whaleFluke: - 22, // the flukes slipping under, at 10 m
	// fishing: the rod and reel are in your hands (close, a little to the right), the bobber out on the water
	rodSwish: - 30, // a full-power cast whooshing past (weaker casts quieter)
	bail: - 40, // the bail wire flipping open / snapping shut
	lineOut: - 38, // line peeling off the spool as the cast flies out
	plop: - 30, // the bobber landing, at 4 m (falls off with distance)
	reelWind: - 36, // cranking steadily
	reelDrag: - 29, // the drag screaming under a fast run
	lineStrain: - 44, // line creaking at the breaking point
	lineSnap: - 24, // the line parting
	fishSplash: - 24, // a hooked fish thrashing at the surface, at 6 m
	fishFlop: - 32, // the landed fish flapping on the line in front of you
	coins: - 30, // paid at the stand
};

// the fishing sounds (loaded when the rod comes out)
const FISHING = [ 'reel_wind', 'reel_drag', 'line_strain', 'rod_swish', 'bail_click', 'line_out', 'plop', 'line_snap', 'fish_splash', 'fish_flop' ];

// forest bird sprite: slices per source recording (a singer sings from one of them)
const FOREST = [ [ 0, 1, 2, 3, 4, 5, 6 ], [ 7, 8, 9, 10, 11, 12 ] ];
const WHALE_SET = [ 'whale_blow', 'big_splash', 'emerge' ];
// the whale is only heard within this distance (m), faded out over its last 30 m
const WHALE_RANGE = 100;

// per-surface footstep trims (dB)
const STEP = {
	sand: [ 'step_sand', 0 ], wetsand: [ 'step_wetsand', 0 ], wood: [ 'step_wood', 2 ],
	water: [ 'step_water', 0 ], grass: [ 'step_grass', 2 ], rock: [ 'step_rock', 1 ],
};

// max simultaneous one-shot voices per category (oldest is faded out beyond this)
const LIMITS = { step: 3, swim: 2, splash: 3, trans: 2, hull: 3, gull: 2, crash: 7, wash: 5, back: 5, bird: 4, tern: 2, whale: 4, rod: 4, fish: 3, coin: 1 };

// loaded at resume(); everything else on first use
const CORE = [ 'surf_crash', 'surf_wash', 'surf_backwash', 'surf_far', 'wind', 'palms', 'step_sand', 'step_wetsand', 'step_wood', 'step_water', 'step_grass', 'splash', 'swim' ];

// surf stations: a row along the waterline around the listener
const ST_N = 9, ST_GAP = 11, TRANSECT = 110, SWASH_UP = 0.4;

const EMPTY = {};

export class SoundScape {

	// Does not touch Web Audio: the context is created on the first resume() (autoplay policy).
	// shore (optional): { shore: ShoreWaves, field: shore field { res, data }, terrain: TerrainData }; found
	// on window.__app when not given (see attachShore()).
	constructor( { baseUrl = ( ( import.meta.env && import.meta.env.BASE_URL ) || '/' ) + 'audio/', shore = null } = {} ) {

		this.baseUrl = baseUrl;
		this.ctx = null;
		this._failed = false;
		this._muted = false;
		this._volume = 0.8;
		this._buffers = new Map(); // name -> AudioBuffer
		this._loading = new Map(); // name -> Promise
		this._beds = new Map(); // name -> { src, gain, trim }
		this._voices = {}; // category -> [ { src, gain, end } ]
		this._last = {}; // bank -> last slice index
		this._acc = 0;
		this._gullT = 6;
		this._ternT = 4;
		this._birdT = 2;
		this._singers = [];
		this._wh = { blow: false, breaches: - 1, splashes: - 1, fluke: 0, sing: 1 };
		this._slapT = 0;
		this._engine = 0; // 0..1 engine running (ramped in the mixer)
		this._engineOn = false;
		this._gust = { v: 0.4, target: 0.6, t: 0 };
		this._shore = shore;
		this._stations = null;
		this._stAt = { x: 1e9, z: 1e9, t: - 1e9 };
		this._fakeT = 3;
		this._warned = new Set();
		this.env = {
			lx: 0, ly: 1.7, lz: 0, fx: 0, fy: 0, fz: - 1, ux: 0, uy: 1, uz: 0,
			u: 0, depth: 0, surf: 0.5, shoreDist: 60, onLand: true, wind: 7, day: 1, nearPier: false, hour: null,
			shoreX: 0, shoreZ: 1,
			boat: { active: false, rpm: 0, speed: 0, x: 0, y: 0, z: 0, inside: false },
		};
		const sw = WORLD.swellDir || { x: - 0.12, y: - 1 };
		const l = Math.hypot( sw.x, sw.y ) || 1;
		this._swell = { x: sw.x / l, z: sw.y / l }; // travel direction of the swell = towards the beach

	}

	// ------------------------------------------------------------------ public API

	// Optional: the game's shore waves (else taken from window.__app on first use).
	attachShore( { shore, field, terrain } ) {

		this._shore = shore && field && terrain ? { shore, field, terrain } : null;
		this._stations = null;

	}

	// Call from a user gesture: creates the context and graph, starts loading the core sounds.
	async resume() {

		if ( this._failed ) return false;
		if ( ! this.ctx ) {

			const AC = globalThis.AudioContext || globalThis.webkitAudioContext;
			if ( typeof AC !== 'function' ) {

				this._failed = true;
				return false;

			}

			try {

				this.ctx = new AC( { latencyHint: 'balanced' } );
				this._build();

			} catch ( e ) {

				this._warn( e );
				this._failed = true;
				return false;

			}

			for ( const n of CORE ) this._want( n );

		}

		try {

			if ( this.ctx.state === 'suspended' ) await Promise.race( [ this.ctx.resume(), new Promise( ( r ) => setTimeout( r, 1500 ) ) ] );

		} catch ( e ) {

			this._warn( e );

		}

		return this.enabled;

	}

	get enabled() {

		return !! this.ctx && ! this._failed && this.ctx.state === 'running';

	}

	get muted() {

		return this._muted;

	}

	get volume() {

		return this._volume;

	}

	setMuted( m ) {

		this._muted = !! m;
		this._applyVolume();

	}

	// 0..1 (perceptual taper)
	setMasterVolume( v ) {

		this._volume = clamp( num( v, this._volume ), 0, 1 );
		this._applyVolume();

	}

	// Per frame: listener pose, mixer ramps and surf / life events at ~30 Hz. Cheap.
	update( dt, state ) {

		if ( ! this.ctx || this._failed ) return;
		try {

			this._readState( state && typeof state === 'object' ? state : EMPTY );
			if ( this.ctx.state !== 'running' ) return;
			this._acc += clamp( num( dt, 1 / 60 ), 0, 0.25 );
			if ( this._acc < 1 / 30 ) return;
			const step = Math.min( this._acc, 0.25 );
			this._acc = 0;
			const now = this.ctx.currentTime;
			this._placeListener();
			this._mix( now, step );
			this._surf( step );
			this._life( step );
			this._birds( now, step );
			this._whale( now, step );
			this._reel( now );

		} catch ( e ) {

			this._warn( e );

		}

	}

	// 'sand' | 'wetsand' | 'wood' | 'water' | 'grass' | 'rock'
	footstep( surface ) {

		const [ bank, trim ] = STEP[ surface ] || STEP.sand;
		this._shot( bank, 'step', this.foot, MIX.step + trim + ( Math.random() - 0.5 ) * 3, 0.94 + Math.random() * 0.12 );

	}

	// the player dropping into / wading out of their depth (strength 0..1)
	splash( strength ) {

		const s = clamp( num( strength, 0.5 ), 0, 1 );
		if ( s < 0.6 ) this._shot( 'swim', 'splash', this.above, MIX.splashSoft + s * 6, 0.9 + Math.random() * 0.1 );
		else this._shot( 'splash', 'splash', this.above, MIX.splash - ( 1 - s ) * 8, 0.95 + Math.random() * 0.1 );

	}

	swimStroke() {

		if ( this.env.u > 0.5 ) this._shot( 'uw_swim', 'swim', this.under, MIX.uwSwim + ( Math.random() - 0.5 ) * 3, 0.9 + Math.random() * 0.2 );
		else this._shot( 'swim', 'swim', this.above, MIX.swim + ( Math.random() - 0.5 ) * 3, 0.92 + Math.random() * 0.16 );

	}

	submerge() {

		this._shot( 'submerge', 'trans', this.near, MIX.submerge, 0.95 + Math.random() * 0.1 );

	}

	emerge() {

		this._shot( 'emerge', 'trans', this.near, MIX.emerge, 0.95 + Math.random() * 0.1 );

	}

	engineStart() {

		this._engineOn = true;
		for ( const n of [ 'boat_engine', 'boat_rush', 'boat_lap', 'hull_slap' ] ) this._want( n );

	}

	engineStop() {

		this._engineOn = false;

	}

	// the bow slamming into a sea (strength 0..1): slap on the hull + spray
	hullSlap( strength ) {

		const s = clamp( num( strength, 0.5 ), 0, 1 );
		this._shot( 'hull_slap', 'hull', this.boatSum, MIX.hullSlap - ( 1 - s ) * 10, 0.85 + Math.random() * 0.2 );
		if ( s > 0.45 ) this._shot( 'splash', 'hull', this.boatSum, MIX.spray - ( 1 - s ) * 6, 1.15 + Math.random() * 0.2 );

	}

	// ------------------------------------------------------------------ fishing (src/game)

	// the rod came out: load its sounds
	rodReady() {

		for ( const n of FISHING ) this._want( n );

	}

	// the cast: the rod whooshing through the air (power 0..1)
	whoosh( power = 1 ) {

		const p = clamp( num( power, 1 ), 0, 1 );
		this._shot( 'rod_swish', 'rod', this.rod, MIX.rodSwish - ( 1 - p ) * 9, 0.9 + p * 0.2 + Math.random() * 0.06 );

	}

	// the bail wire: flipped open for the cast, snapped shut when reeling starts
	bail( open ) {

		this._shot( 'bail_click', 'rod', this.rod, MIX.bail + ( open ? 0 : 2 ), open ? 1.08 + Math.random() * 0.06 : 0.92 + Math.random() * 0.06 );

	}

	// line paying out off the spool as the bobber flies (power 0..1: farther casts run longer)
	lineOut( power = 1 ) {

		const p = clamp( num( power, 1 ), 0, 1 );
		this._shot( 'line_out', 'rod', this.rod, MIX.lineOut - ( 1 - p ) * 6, 1.25 - p * 0.35 );

	}

	// the bobber landing on the water at p ({ x, y, z })
	plop( p ) {

		if ( ! p ) return;
		this._shotAt( 'plop', 'fish', p.x, p.y, p.z, MIX.plop, 0.95 + Math.random() * 0.15, 0, 4, 1 );

	}

	// a hooked fish thrashing at p (strength 0..1)
	fishSplash( p, strength = 0.5 ) {

		if ( ! p ) return;
		const s = clamp( num( strength, 0.5 ), 0, 1 );
		this._shotAt( 'fish_splash', 'fish', p.x, p.y, p.z, MIX.fishSplash - ( 1 - s ) * 10, 0.9 + Math.random() * 0.2 + ( 1 - s ) * 0.15, 0, 6, 1 );

	}

	// the landed fish flapping on the line in front of you
	fishFlop() {

		this._shot( 'fish_flop', 'rod', this.near, MIX.fishFlop, 0.9 + Math.random() * 0.2 );

	}

	lineSnap() {

		this._shot( 'line_snap', 'rod', this.rod, MIX.lineSnap, 0.95 + Math.random() * 0.1 );

	}

	// paid at the fish stand
	coin() {

		this._shot( 'coins', 'coin', this.near, MIX.coins, 0.97 + Math.random() * 0.06 );

	}

	// continuous reel sounds, every frame: crankRate (crank turns / s: the gear ticking follows it),
	// dragSpeed (m/s of line a fish takes against the drag), tension (0..1+, the line creaks near 1)
	rodLoop( crankRate, dragSpeed, tension ) {

		const r = this._rod || ( this._rod = { crank: 0, drag: 0, tension: 0 } );
		r.crank = clamp( num( crankRate, 0 ), 0, 3 );
		r.drag = clamp( num( dragSpeed, 0 ), 0, 5 );
		r.tension = clamp( num( tension, 0 ), 0, 2 );

	}

	_reel( now ) {

		const r = this._rod;
		if ( ! r ) return;
		// the recorded crank ticks ~16 times a second: about 1.4 crank turns a second
		const wind = smooth( 0.05, 0.35, r.crank );
		if ( wind > 0 || this._beds.has( 'reel_wind' ) ) this._bed( 'reel_wind', dB( MIX.reelWind ) * wind * ( 0.8 + 0.2 * Math.min( 1, r.crank ) ) / dB( BANK.reel_wind.lufs ), now, 0.08, clamp( r.crank / 1.4, 0.45, 1.3 ) );
		const drag = smooth( 0.05, 0.7, r.drag );
		if ( drag > 0 || this._beds.has( 'reel_drag' ) ) this._bed( 'reel_drag', dB( MIX.reelDrag ) * drag / dB( BANK.reel_drag.lufs ), now, 0.06, clamp( 0.7 + r.drag * 0.25, 0.7, 1.25 ) );
		const strain = smooth( 0.7, 1.0, r.tension );
		if ( strain > 0 || this._beds.has( 'line_strain' ) ) this._bed( 'line_strain', dB( MIX.lineStrain ) * strain / dB( BANK.line_strain.lufs ), now, 0.1, 0.9 + 0.2 * strain );

	}

	// kept for API compatibility with the old synthesised system (no bubble sounds any more)
	bubbles() {}

	waveBreak() {}

	dispose() {

		if ( ! this.ctx ) return;
		try {

			const p = this.ctx.close();
			if ( p && p.catch ) p.catch( () => {} );

		} catch ( e ) { /* ignore */ }

		this.ctx = null;
		this._failed = true;

	}

	// ------------------------------------------------------------------ graph

	_build() {

		const c = this.ctx;
		const gain = ( v, dest ) => {

			const g = c.createGain();
			g.gain.value = v;
			if ( dest ) g.connect( dest );
			return g;

		};

		const lowpass = ( f, q, dest ) => {

			const b = c.createBiquadFilter();
			b.type = 'lowpass';
			b.frequency.value = f;
			b.Q.value = q;
			if ( dest ) b.connect( dest );
			return b;

		};

		const panner = ( dest, ref, rolloff ) => {

			const p = c.createPanner();
			p.panningModel = 'HRTF';
			p.distanceModel = 'inverse';
			p.refDistance = ref;
			p.rolloffFactor = rolloff;
			p.maxDistance = 10000;
			p.connect( dest );
			return p;

		};

		this._panner = panner;
		this.limiter = c.createDynamicsCompressor();
		this.limiter.threshold.value = - 4;
		this.limiter.knee.value = 4;
		this.limiter.ratio.value = 16;
		this.limiter.attack.value = 0.003;
		this.limiter.release.value = 0.25;
		this.limiter.connect( c.destination );
		this.master = gain( 0, this.limiter );
		this._applyVolume();

		this.aboveOut = gain( 1, this.master );
		const muffle2 = lowpass( 20000, 0.54, this.aboveOut );
		const muffle1 = lowpass( 20000, 0.707, muffle2 );
		this.muffle = [ muffle1, muffle2 ];
		this.above = gain( 1, muffle1 );
		this.under = gain( 0, this.master );
		this.near = gain( 1, this.master );
		this.foot = gain( 1, this.above );

		// distant surf: from the shore direction
		this.surfPan = panner( this.above, 1, 0 );
		this.surfFar = gain( 1, this.surfPan );

		// the boat: positional from outside; at the helm it surrounds you (through the hull), unpanned
		this.boatPan = panner( this.above, 3, 1 );
		this.boatOut = gain( 1, this.boatPan );
		this.boatIn = gain( 0, this.above );
		this.boatSum = gain( 1, this.boatOut );
		this.boatSum.connect( this.boatIn );
		this.engineLP = lowpass( 1200, 0.6, this.boatSum );
		this.pierPan = panner( this.above, 3, 1.3 );
		this.windLP = lowpass( 1400, 0.5, this.above );

		// the rod and reel: held in front of you, a little to the right (the reel hangs lower right)
		this.rodPan = c.createStereoPanner ? c.createStereoPanner() : null;
		if ( this.rodPan ) {

			this.rodPan.pan.value = 0.25;
			this.rodPan.connect( this.above );

		}

		this.rod = gain( 1, this.rodPan || this.above );

		// whale song: positional at the whale, its own path (open underwater, faint and dull from above)
		this.songOut = gain( dB( - 20 ), this.master );
		this.songLP = lowpass( 420, 0.6, this.songOut );
		this.songPan = panner( this.songLP, 30, 0.5 );

		this._dest = {
			surf_far: this.surfFar, wind: this.windLP, palms: this.above, crickets: this.above, pier_lap: this.pierPan,
			under_reef: this.under, birds_dawn: this.above, whale_song: this.songPan,
			boat_engine: this.engineLP, boat_rush: this.boatSum, boat_lap: this.boatSum,
			reel_wind: this.rod, reel_drag: this.rod, line_strain: this.rod,
		};

	}

	_applyVolume() {

		if ( ! this.master ) return;
		const v = this._muted ? 0 : this._volume * this._volume;
		this._ramp( this.master.gain, v, 0.05 );

	}

	// ------------------------------------------------------------------ loading

	// the buffer if decoded; otherwise starts loading it (once) and returns null
	_want( name ) {

		const b = this._buffers.get( name );
		if ( b ) return b;
		if ( ! this._loading.has( name ) && BANK[ name ] && this.ctx ) {

			const p = fetch( this.baseUrl + BANK[ name ].file )
				.then( ( r ) => {

					if ( ! r.ok ) throw new Error( `audio ${ name }: HTTP ${ r.status }` );
					return r.arrayBuffer();

				} )
				.then( ( a ) => this.ctx.decodeAudioData( a ) )
				.then( ( buf ) => {

					this._buffers.set( name, buf );
					return buf;

				} )
				.catch( ( e ) => this._warn( e ) );
			this._loading.set( name, p );

		}

		return null;

	}

	// ------------------------------------------------------------------ beds

	// sets a looping bed's gain (linear) and playback rate; starts it (random offset) when first audible
	_bed( name, g, now, tau = 0.25, rate = 1 ) {

		let bed = this._beds.get( name );
		if ( ! bed ) {

			if ( g < 1e-4 ) return;
			const buf = this._want( name );
			if ( ! buf ) return;
			const c = this.ctx;
			const src = c.createBufferSource();
			src.buffer = buf;
			src.loop = true;
			src.playbackRate.value = rate;
			const gn = c.createGain();
			gn.gain.value = 0;
			src.connect( gn ).connect( this._dest[ name ] );
			src.start( now + 0.02, Math.random() * buf.duration );
			bed = { src, gain: gn, trim: buf.numberOfChannels === 1 ? MONO : 1 };
			this._beds.set( name, bed );
			if ( this._dest[ name ] !== this.rod ) tau = Math.max( tau, 0.8 ); // fade in on first start (the reel follows the crank at once)

		}

		this._ramp( bed.gain.gain, g * bed.trim, tau );
		this._ramp( bed.src.playbackRate, rate, 0.15 );

	}

	// ------------------------------------------------------------------ one-shots

	// plays a random slice of a sprite bank (never the same one twice in a row) at a target loudness;
	// `at`: context time (default now); `pick`: slice index (default random)
	_shot( bank, cat, dest, targetLufs, rate = 1, at = 0, pick = - 1 ) {

		if ( ! this.enabled || ! dest ) return null;
		const info = BANK[ bank ];
		const buf = this._want( bank );
		if ( ! buf || ! info ) return null;
		const n = info.slices.length;
		let i = pick >= 0 && pick < n ? pick : Math.floor( Math.random() * n );
		if ( pick < 0 && n > 1 && i === this._last[ bank ] ) i = ( i + 1 + Math.floor( Math.random() * ( n - 1 ) ) ) % n;
		this._last[ bank ] = i;
		const [ start, dur ] = info.slices[ i ];
		const c = this.ctx, t = Math.max( c.currentTime + 0.005, at );
		const src = c.createBufferSource();
		src.buffer = buf;
		src.playbackRate.value = rate;
		const g = c.createGain();
		g.gain.value = dB( clamp( targetLufs - info.lufs[ i ], - 80, 24 ) ) * ( buf.numberOfChannels === 1 ? MONO : 1 );
		src.connect( g ).connect( dest );
		src.start( t, start, dur );

		const list = this._voices[ cat ] || ( this._voices[ cat ] = [] );
		const v = { src, gain: g, end: t + dur / rate, extra: null };
		list.push( v );
		src.onended = () => {

			const k = list.indexOf( v );
			if ( k >= 0 ) list.splice( k, 1 );
			g.disconnect();
			if ( v.extra ) for ( const x of v.extra ) x.disconnect();

		};

		while ( list.length > ( LIMITS[ cat ] || 3 ) ) {

			const old = list.shift();
			old.gain.gain.setTargetAtTime( 0, c.currentTime, 0.05 );
			try {

				old.src.stop( c.currentTime + 0.3 );

			} catch ( e ) { /* already stopped */ }

		}

		return v;

	}

	// a one-shot placed in the world: HRTF panner at (x, y, z) + air absorption with distance
	_shotAt( bank, cat, x, y, z, targetLufs, rate, at, ref, rolloff = 1, pick = - 1 ) {

		if ( ! this.enabled || ! this._want( bank ) ) return null;
		const c = this.ctx, e = this.env;
		const d = Math.hypot( x - e.lx, y - e.ly, z - e.lz );
		const p = this._panner( this.above, ref, rolloff );
		p.positionX.value = x;
		p.positionY.value = y;
		p.positionZ.value = z;
		const air = c.createBiquadFilter();
		air.type = 'lowpass';
		air.frequency.value = clamp( 18000 / ( 1 + d / 45 ), 1500, 18000 );
		air.connect( p );
		const v = this._shot( bank, cat, air, targetLufs, rate, at, pick );
		if ( ! v ) {

			air.disconnect();
			p.disconnect();
			return null;

		}

		v.extra = [ air, p ];
		return v;

	}

	// a gull call somewhere over the shore: 25-80 m out, 6-25 m up
	_gull() {

		const e = this.env;
		const a = Math.atan2( e.shoreZ, e.shoreX ) + ( Math.random() - 0.5 ) * 2.4;
		const d = 25 + Math.random() * 55;
		this._shotAt( 'gull', 'gull', e.lx + Math.cos( a ) * d, e.ly + 6 + Math.random() * 19, e.lz + Math.sin( a ) * d,
			MIX.gull + ( Math.random() - 0.5 ) * 4, 0.93 + Math.random() * 0.14, 0, 10 );

	}

	// ------------------------------------------------------------------ surf, wave by wave

	_shoreSrc() {

		if ( this._shore ) return this._shore;
		const app = globalThis.__app;
		if ( app && app.shore && app.shoreField && app.shoreField.data && app.terrainData ) {

			this._shore = { shore: app.shore, field: app.shoreField, terrain: app.terrainData };

		}

		return this._shore;

	}

	// shore field at (x, z): travel time T, direction (dx, dz) × exposure, time to the shoreline Ts
	_field( x, z, o ) {

		const { field, terrain } = this._shore;
		const res = field.res, data = field.data;
		const fx = clamp( ( x - terrain.origin ) / terrain.size * res - 0.5, 0, res - 1.001 );
		const fz = clamp( ( z - terrain.origin ) / terrain.size * res - 0.5, 0, res - 1.001 );
		const i = Math.floor( fx ), j = Math.floor( fz ), tx = fx - i, tz = fz - j;
		const k = ( j * res + i ) * 4, kr = k + res * 4;
		for ( let c = 0; c < 4; c ++ ) {

			const a = data[ k + c ], b = data[ k + 4 + c ], cc = data[ kr + c ], d = data[ kr + 4 + c ];
			o[ c ] = ( a * ( 1 - tx ) + b * tx ) * ( 1 - tz ) + ( cc * ( 1 - tx ) + d * tx ) * tz;

		}

		return o;

	}

	// CPU mirrors of ShoreWaves.wobble / waveAmp / break depth
	_wobble( along ) {

		return Math.sin( along * 0.029 + 0.7 ) * 0.07 + Math.sin( along * 0.083 + 2.1 ) * 0.035;

	}

	_waveAmp( m, along ) {

		const sh = this._shore.shore;
		const amp = sh.amplitude.value, vari = sh.variation.value;
		const set = Math.abs( Math.sin( m * Math.PI / 7 ) ) * 0.6 + 0.55;
		const h = Math.sin( m * 127.1 + 311.7 ) * 43758.5453;
		const rnd = ( h - Math.floor( h ) - 0.5 ) * 2;
		const warp = Math.sin( along * 0.016 + m * 0.9 ) * 1.6;
		const a1 = Math.sin( along * 0.062 + m * 1.7 + warp );
		const a2 = Math.sin( along * 0.13 + m * 4.1 + 1.3 - warp * 0.7 );
		const alongV = a1 * 0.6 + a2 * 0.4;
		return Math.max( 0.02, amp * set * ( 1 + rnd * vari * 0.5 + alongV * vari * 0.7 ) );

	}

	// a row of stations along the waterline near the listener, each with its transect out to sea
	_buildStations() {

		const e = this.env, { terrain } = this._shore, f = [ 0, 0, 0, 0 ];
		const sea = 0;
		const h = ( x, z ) => terrain.heightAt( x, z ) - sea;
		this._field( e.lx, e.lz, f );
		let ex = Math.hypot( f[ 1 ], f[ 2 ] );
		let dx = ex > 1e-3 ? f[ 1 ] / ex : this._swell.x, dz = ex > 1e-3 ? f[ 2 ] / ex : this._swell.z;
		// the waterline on the line through the listener (seaward from land, landward from the water)
		const h0 = h( e.lx, e.lz ), sgn = h0 > 0 ? - 1 : 1;
		let w0 = null;
		for ( let r = 1; r < 400; r += 1.5 ) {

			const x = e.lx + dx * sgn * r, z = e.lz + dz * sgn * r;
			if ( ( h( x, z ) > 0 ) !== ( h0 > 0 ) ) {

				w0 = { x, z };
				break;

			}

		}

		const out = [];
		if ( w0 ) {

			for ( let k = 0; k < ST_N; k ++ ) {

				const o = ( k - ( ST_N - 1 ) / 2 ) * ST_GAP;
				let x = w0.x - dz * o, z = w0.z + dx * o;
				// snap to the waterline along the local wave direction
				this._field( x, z, f );
				ex = Math.hypot( f[ 1 ], f[ 2 ] );
				if ( ex < 0.03 ) continue;
				const ldx = f[ 1 ] / ex, ldz = f[ 2 ] / ex;
				const s0 = h( x, z ) > 0 ? - 1 : 1;
				let ok = false;
				for ( let r = 0; r < 60; r += 0.5 ) {

					const xx = x + ldx * s0 * r, zz = z + ldz * s0 * r;
					if ( ( h( xx, zz ) > 0 ) !== ( s0 < 0 ) ) {

						x = xx; z = zz; ok = true;
						break;

					}

				}

				if ( ! ok ) continue;
				this._field( x, z, f );
				const st = {
					x, z, dx: ldx, dz: ldz, Ts: f[ 3 ], exposure: clamp( ex * 1.4, 0, 1 ),
					along: - x * ldz + z * ldx, depth: new Float32Array( TRANSECT ), T: new Float32Array( TRANSECT ),
					last: { crash: - 1e9, wash: - 1e9, back: - 1e9 },
				};
				for ( let r = 0; r < TRANSECT; r ++ ) {

					const xx = x - ldx * r, zz = z - ldz * r;
					st.depth[ r ] = - h( xx, zz );
					st.T[ r ] = this._field( xx, zz, f )[ 0 ];

				}

				if ( st.T[ 0 ] < 1e4 && st.Ts < 1e4 ) out.push( st );

			}

		}

		this._stations = out;

	}

	_surf( dt ) {

		const e = this.env;
		const src = this._shoreSrc();
		if ( ! src || ! src.shore.enabled || src.shore.enabled.value < 0.5 ) {

			this._fakeSurf( dt, src ? 0 : 1 );
			return;

		}

		const sh = src.shore;
		const moved = Math.hypot( e.lx - this._stAt.x, e.lz - this._stAt.z );
		if ( ! this._stations || moved > 12 ) {

			this._stAt.x = e.lx;
			this._stAt.z = e.lz;
			this._buildStations();

		}

		const P = Math.max( 1, sh.period.value ), tNow = sh.time.value, gamma = sh.gamma.value;
		const audioNow = this.ctx.currentTime, LOOK = 0.2;
		const A0 = Math.max( 0.05, sh.amplitude.value );
		for ( const st of this._stations ) {

			const d = Math.hypot( st.x - e.lx, st.z - e.lz );
			if ( d > 160 ) continue;
			const wob = this._wobble( st.along );
			const mw = Math.floor( ( tNow - st.Ts ) / P + wob );
			for ( let m = mw; m <= mw + 2; m ++ ) {

				const A = this._waveAmp( m, st.along );
				const rel = A / A0, lvl = 16 * Math.log10( clamp( rel * st.exposure, 0.05, 3 ) );
				// breaking: the crest reaches the depth where this wave plunges (H = gamma d, lip lands ~8% in)
				const db = Math.pow( A * 3.556 / gamma, 0.8 ) * 0.92;
				let rb = 0;
				while ( rb < TRANSECT - 1 && st.depth[ rb ] < db ) rb ++;
				const tc = st.T[ rb ] + ( m - wob ) * P;
				if ( m > st.last.crash && tc >= tNow - 0.1 && tc < tNow + LOOK ) {

					st.last.crash = m;
					const x = st.x - st.dx * rb, z = st.z - st.dz * rb;
					if ( Math.hypot( x - e.lx, z - e.lz ) < 150 && A > 0.06 ) {

						this._shotAt( 'surf_crash', 'crash', x, 0.4, z, MIX.crash + lvl + ( Math.random() - 0.5 ) * 3,
							clamp( 1.06 - 0.25 * rel, 0.82, 1.08 ) * ( 0.96 + Math.random() * 0.08 ), audioNow + Math.max( 0, tc - tNow ), 10, 0.65 );

					}

				}

				// the bore reaches the sand and runs up; then the swash turns and drains back
				const tw = st.Ts + ( m - wob ) * P, tb = tw + SWASH_UP * P;
				if ( m > st.last.wash && tw >= tNow - 0.1 && tw < tNow + LOOK ) {

					st.last.wash = m;
					if ( d < 70 ) this._shotAt( 'surf_wash', 'wash', st.x - st.dx, 0.1, st.z - st.dz, MIX.wash + lvl + ( Math.random() - 0.5 ) * 3,
						0.95 + Math.random() * 0.1, audioNow + Math.max( 0, tw - tNow ), 5, 0.8 );

				}

				if ( m > st.last.back && tb >= tNow - 0.1 && tb < tNow + LOOK ) {

					st.last.back = m;
					if ( d < 60 ) this._shotAt( 'surf_backwash', 'back', st.x - st.dx * 2, 0, st.z - st.dz * 2, MIX.backwash + lvl + ( Math.random() - 0.5 ) * 3,
						0.95 + Math.random() * 0.1, audioNow + Math.max( 0, tb - tNow ), 5, 0.8 );

				}

			}

		}

	}

	// without the game's shore waves (tests, or before init): waves on a ~9 s cycle along the shore direction
	_fakeSurf( dt, on ) {

		if ( ! on ) return;
		const e = this.env;
		this._fakeT -= dt;
		if ( this._fakeT > 0 ) return;
		this._fakeT = 2.5 + Math.random() * 4;
		const d = Math.max( 6, e.shoreDist ), side = ( Math.random() - 0.5 ) * 60;
		const x = e.lx + e.shoreX * ( d + 12 ) - e.shoreZ * side, z = e.lz + e.shoreZ * ( d + 12 ) + e.shoreX * side;
		const at = this.ctx.currentTime;
		this._shotAt( 'surf_crash', 'crash', x, 0.4, z, MIX.crash + ( Math.random() - 0.5 ) * 6, 0.92 + Math.random() * 0.12, at, 10 );
		const wx = e.lx + e.shoreX * d - e.shoreZ * side, wz = e.lz + e.shoreZ * d + e.shoreX * side;
		if ( d < 70 ) {

			this._shotAt( 'surf_wash', 'wash', wx, 0.1, wz, MIX.wash + ( Math.random() - 0.5 ) * 4, 1, at + 3.5, 5 );
			this._shotAt( 'surf_backwash', 'back', wx, 0, wz, MIX.backwash + ( Math.random() - 0.5 ) * 4, 1, at + 7, 5 );

		}

	}

	// ------------------------------------------------------------------ per-frame

	_readState( s ) {

		const e = this.env;
		const L = s.listener || EMPTY, p = L.position || EMPTY, f = L.forward || EMPTY, up = L.up || EMPTY;
		e.lx = num( p.x, e.lx );
		e.ly = num( p.y, e.ly );
		e.lz = num( p.z, e.lz );
		let fx = num( f.x, 0 ), fy = num( f.y, 0 ), fz = num( f.z, - 1 );
		const fl = Math.hypot( fx, fy, fz ) || 1;
		fx /= fl; fy /= fl; fz /= fl;
		let ux = num( up.x, 0 ), uy = num( up.y, 1 ), uz = num( up.z, 0 );
		const ul = Math.hypot( ux, uy, uz ) || 1;
		ux /= ul; uy /= ul; uz /= ul;
		e.fx = fx; e.fy = fy; e.fz = fz; e.ux = ux; e.uy = uy; e.uz = uz;

		e.u = clamp( num( s.underwater, 0 ), 0, 1 );
		e.depth = Math.max( 0, num( s.depthBelowSurface, 0 ) );
		e.surf = clamp( num( s.surfIntensity, 0.5 ), 0, 1 );
		e.shoreDist = Math.max( 0, num( s.distanceToShore, 60 ) );
		e.wind = clamp( num( s.windSpeed, 7 ), 0, 40 );
		e.day = clamp( num( s.daylight, 1 ), 0, 1 );
		e.nearPier = !! s.nearPier;
		e.hour = typeof s.timeOfDay === 'number' && Number.isFinite( s.timeOfDay ) ? ( ( s.timeOfDay % 24 ) + 24 ) % 24 : null;
		const b = s.boat || EMPTY, bp = b.position || EMPTY, eb = e.boat;
		eb.active = !! b.active;
		eb.rpm = clamp( num( b.rpm, 0 ), 0, 1 );
		eb.speed = Math.abs( num( b.speed, 0 ) );
		eb.x = num( bp.x, eb.x );
		eb.y = num( bp.y, eb.y );
		eb.z = num( bp.z, eb.z );
		eb.inside = !! b.listenerInside;
		e.onLand = typeof s.coastDistance === 'number' && Number.isFinite( s.coastDistance ) ? s.coastDistance < 0 : true;
		if ( e.u > 0.01 || eb.active ) e.onLand = false;

		// towards the surf: seaward on land, towards the beach from the water (the bay faces the swell)
		const sw = this._swell;
		const inland = e.lx * sw.x + ( e.lz + 42 ) * sw.z > 0;
		e.shoreX = inland ? - sw.x : sw.x;
		e.shoreZ = inland ? - sw.z : sw.z;

	}

	_placeListener() {

		const L = this.ctx.listener, e = this.env;
		if ( L.positionX ) {

			this._ramp( L.positionX, e.lx, 0.03 );
			this._ramp( L.positionY, e.ly, 0.03 );
			this._ramp( L.positionZ, e.lz, 0.03 );
			this._ramp( L.forwardX, e.fx, 0.02 );
			this._ramp( L.forwardY, e.fy, 0.02 );
			this._ramp( L.forwardZ, e.fz, 0.02 );
			this._ramp( L.upX, e.ux, 0.02 );
			this._ramp( L.upY, e.uy, 0.02 );
			this._ramp( L.upZ, e.uz, 0.02 );

		} else {

			L.setPosition( e.lx, e.ly, e.lz );
			L.setOrientation( e.fx, e.fy, e.fz, e.ux, e.uy, e.uz );

		}

		this._pos( this.surfPan, e.lx + e.shoreX * 40, e.ly - 1.5, e.lz + e.shoreZ * 40 );
		this._pos( this.boatPan, e.boat.x, e.boat.y + 0.3, e.boat.z );
		this._ramp( this.boatIn.gain, e.boat.inside ? 1 : 0, 0.1 );
		this._ramp( this.boatOut.gain, e.boat.inside ? 0 : 1, 0.1 );
		const pier = WORLD.pier;
		this._pos( this.pierPan, pier.x, 0, clamp( e.lz, Math.max( pier.zStart, - 40 ), pier.zEnd ) );

	}

	_mix( now, dt ) {

		const e = this.env, u = e.u, d = e.shoreDist, eb = e.boat;
		const deep = clamp( e.depth / 12, 0, 1 );

		// underwater: steep low-pass on everything above the surface, the reef bed faded in
		const f = Math.exp( lerp( Math.log( 20000 ), Math.log( lerp( 520, 260, deep ) ), u ) );
		this._ramp( this.muffle[ 0 ].frequency, f, 0.04 );
		this._ramp( this.muffle[ 1 ].frequency, Math.min( 20000, f * 1.4 ), 0.04 );
		this._ramp( this.aboveOut.gain, lerp( 1, 0.4 / ( 1 + e.depth / 5 ), u ), 0.05 );
		this._ramp( this.under.gain, u, 0.06 );
		const wantUnder = u > 0 || ( ! e.onLand && e.ly < 2.5 );
		this._bed( 'under_reef', wantUnder ? dB( MIX.reef ) * ( 0.8 + 0.3 * deep ) / dB( BANK.under_reef.lufs ) : 0, now, 0.5 );
		if ( wantUnder ) {

			this._want( 'uw_swim' );
			this._want( 'submerge' );
			this._want( 'emerge' );

		}

		// distant surf (the waves themselves are events, see _surf)
		const lvl = 0.6 + 0.7 * e.surf;
		this._bed( 'surf_far', dB( MIX.surfFar ) * 1.25 / ( 1 + d / 200 ) * lvl / dB( BANK.surf_far.lufs ), now, 0.5 );

		// wind in gusts: a random target every 2-8 s (lulls near silent), eased towards
		const g = this._gust;
		g.t -= dt;
		if ( g.t <= 0 ) {

			g.target = Math.random() < 0.35 ? 0.03 + Math.random() * 0.12 : 0.3 + Math.random() * 0.7;
			g.t = 2 + Math.random() * 6;

		}

		g.v += ( g.target - g.v ) * ( 1 - Math.exp( - dt / 1.4 ) );
		const w = Math.hypot( e.wind, eb.active ? eb.speed * 0.9 : 0 );
		const gw = eb.active && eb.speed > 3 ? Math.max( g.v, 0.5 ) : g.v; // apparent wind on a running boat is steady
		this._bed( 'wind', dB( MIX.wind ) * clamp( w / 7, 0, 2.5 ) * gw / dB( BANK.wind.lufs ), now, 0.3 );
		this._ramp( this.windLP.frequency, 400 + ( 80 + 60 * gw ) * w, 0.4 );

		// trees inland rustle in the gusts; crickets inland at night (daylight < 0.3)
		const veg = e.onLand ? smooth( 6, 30, d ) : 0;
		this._bed( 'palms', dB( MIX.palms ) * veg * clamp( e.wind / 7, 0.2, 1.8 ) * g.v * ( 0.3 + 0.7 * e.day ) / dB( BANK.palms.lufs ), now, 0.5 );
		const night = smooth( 0.3, 0.12, e.day );
		this._bed( 'crickets', dB( MIX.crickets ) * night * ( e.onLand ? 0.35 + 0.65 * smooth( 5, 40, d ) : 0.1 ) / dB( BANK.crickets.lufs ), now, 1 );

		// water lapping the pier piles
		this._bed( 'pier_lap', ( e.nearPier ? dB( MIX.pierLap ) : 0 ) / dB( BANK.pier_lap.lufs ), now, 0.6 );

		// boat: one engine recording, pitched and opened up with rpm; water past the hull with speed,
		// lapping at rest, chop slapping the hull while running
		this._engine += ( ( this._engineOn ? 1 : 0 ) - this._engine ) * ( 1 - Math.exp( - dt * ( this._engineOn ? 3 : 1.2 ) ) );
		const bd = Math.hypot( eb.x - e.lx, eb.z - e.lz );
		const nearBoat = eb.active || bd < 60;
		const eng = this._engine, rpm = eb.rpm;
		this._bed( 'boat_engine', dB( lerp( MIX.engineIdle, MIX.engineRun, Math.pow( rpm, 0.8 ) ) ) * eng / dB( BANK.boat_engine.lufs ), now, 0.12,
			( 0.8 + 0.85 * rpm ) * lerp( 0.75, 1, eng ) );
		this._ramp( this.engineLP.frequency, 900 + 6500 * Math.pow( rpm, 1.3 ), 0.12 );
		const sp = eb.speed;
		this._bed( 'boat_rush', nearBoat ? dB( MIX.boatRush ) * smooth( 0.4, 9, sp ) / dB( BANK.boat_rush.lufs ) : 0, now, 0.3, 0.85 + 0.02 * Math.min( sp, 12 ) );
		this._bed( 'boat_lap', nearBoat ? dB( MIX.boatLap ) * ( 1 - smooth( 1.5, 5, sp ) ) / dB( BANK.boat_lap.lufs ) : 0, now, 0.5 );
		if ( nearBoat && sp > 1.2 && e.u < 0.5 ) {

			this._slapT -= dt;
			if ( this._slapT <= 0 ) {

				const k = smooth( 1.2, 9, sp );
				this._slapT = 0.3 + Math.random() * ( 2.2 - 1.6 * k );
				this._shot( 'hull_slap', 'hull', this.boatSum, MIX.hullSlap - 14 + 8 * k + ( Math.random() - 0.5 ) * 4, 0.85 + Math.random() * 0.3 );

			}

		}

	}

	// gulls and terns: each call from a real bird of the wildlife near the listener (the nearer, the
	// likelier - and louder); without the wildlife, gulls from somewhere over the shore
	_life( dt ) {

		const e = this.env;
		if ( e.day < 0.35 || e.u > 0.5 ) return;
		const flock = this._flock();
		this._gullT -= dt;
		if ( this._gullT <= 0 ) {

			if ( flock ) {

				const a = this._pickBird( flock, 'gull', 170 );
				this._gullT = a ? 5 + Math.random() * 15 : 3;
				if ( a ) {

					const P = a.f.P.pos;
					this._shotAt( 'gull', 'gull', P[ 0 ], P[ 1 ], P[ 2 ], MIX.gull + ( Math.random() - 0.5 ) * 4, 0.93 + Math.random() * 0.14, 0, 10 );

				}

			} else if ( e.shoreDist < 300 ) {

				this._gullT = 7 + Math.random() * 18 + e.shoreDist * 0.05;
				if ( this._want( 'gull' ) ) this._gull();

			}

		}

		this._ternT -= dt;
		if ( this._ternT <= 0 ) {

			const a = flock ? this._pickBird( flock, 'tern', 190 ) : null;
			this._ternT = a ? 7 + Math.random() * 18 : 4;
			if ( a ) {

				const P = a.f.P.pos;
				this._shotAt( 'tern', 'tern', P[ 0 ], P[ 1 ], P[ 2 ], MIX.tern + ( Math.random() - 0.5 ) * 4, 0.95 + Math.random() * 0.1, 0, 10 );

			}

		}

	}

	// the wildlife's flying / perched sea birds (window.__app.wildlife.birds.agents), if any
	_flock() {

		const app = globalThis.__app, w = app && app.wildlife, b = w && w.birds;
		return b && Array.isArray( b.agents ) && b.agents.length ? b.agents : null;

	}

	// a random bird of this kind within `range` m of the listener, weighted to the near ones
	_pickBird( agents, kind, range ) {

		const e = this.env, c = this._cand || ( this._cand = [] );
		c.length = 0;
		let tot = 0;
		for ( const a of agents ) {

			if ( a.kind !== kind || a.visible === false || ! a.f || ! a.f.P || ! a.f.P.pos ) continue;
			const P = a.f.P.pos;
			const d = Math.hypot( P[ 0 ] - e.lx, P[ 1 ] - e.ly, P[ 2 ] - e.lz );
			if ( ! ( d < range ) ) continue;
			const w = 1 / ( 15 + d );
			c.push( a, w );
			tot += w;

		}

		if ( tot <= 0 ) return null;
		let r = Math.random() * tot;
		for ( let i = 0; i < c.length; i += 2 ) {

			r -= c[ i + 1 ];
			if ( r <= 0 ) return c[ i ];

		}

		return c[ c.length - 2 ];

	}

	// ------------------------------------------------------------------ island birds

	// hour of the day (state.timeOfDay, else the app's settings); null if unknown
	_hour() {

		if ( this.env.hour !== null ) return this.env.hour;
		const app = globalThis.__app, h = app && app.settings && app.settings.timeOfDay;
		return typeof h === 'number' && Number.isFinite( h ) ? ( ( h % 24 ) + 24 ) % 24 : null;

	}

	// songbird activity: { act: singers relative to a normal morning, chorus: dawn chorus 0..1, lull }
	_birdActivity() {

		const h = this._hour();
		if ( h === null ) return { act: smooth( 0.35, 0.6, this.env.day ), chorus: 0, lull: 0 };
		const on = smooth( 4.9, 5.7, h ) * ( 1 - smooth( 18.2, 19.3, h ) ); // awake: first light to dusk
		const chorus = smooth( 5.0, 5.8, h ) * ( 1 - smooth( 6.6, 7.9, h ) );
		const lull = smooth( 10.5, 12, h ) * ( 1 - smooth( 14.5, 16, h ) ); // the heat of the day
		const dusk = smooth( 17.2, 18.6, h );
		return { act: on * Math.max( 0, 1 + 2.5 * chorus - 0.6 * lull - 0.55 * dusk ), chorus: on * chorus, lull };

	}

	// a perch in the island's trees near the listener: 10-80 m away, 8 m+ inland (likelier deeper in),
	// 3-12 m above the ground; null when there is no land near (out at sea)
	_perch() {

		const e = this.env, app = globalThis.__app;
		const terrain = ( this._shore && this._shore.terrain ) || ( app && app.terrainData );
		for ( let k = 0; k < 8; k ++ ) {

			const a = Math.random() * Math.PI * 2, r = 10 + Math.random() * 70;
			const x = e.lx + Math.cos( a ) * r, z = e.lz + Math.sin( a ) * r;
			let inland, ground;
			if ( terrain && terrain.coastDistance && terrain.heightAt ) {

				const c = terrain.coastDistance( x, z );
				inland = - num( c && c.d, 1 );
				ground = num( terrain.heightAt( x, z ), 0 );

			} else {

				// no terrain (tests): the listener's own distance inland stands in
				inland = e.onLand ? e.shoreDist + ( Math.random() - 0.5 ) * r : - 1;
				ground = e.ly - 1.7;

			}

			if ( inland < 8 || Math.random() > 0.25 + 0.75 * smooth( 8, 45, inland ) ) continue;
			return { x, y: ground + 3 + Math.random() * 9, z };

		}

		return null;

	}

	// songbirds and doves: a new singer every few seconds (at dawn often, at midday rarely, at night
	// never), each a bout of 1-4 phrases from one perch - a different slice of one recording each time
	_birds( now, dt ) {

		const e = this.env, { act, chorus, lull } = this._birdActivity();
		const inland = e.onLand ? smooth( 0, 45, e.shoreDist ) : 0;
		const hab = e.onLand ? 0.25 + 0.75 * inland : 0.25 * ( 1 - smooth( 20, 90, e.shoreDist ) );

		// the dawn chorus: many birds at once, diffuse; inland at full, from the beach distant, gone at sea
		const cg = chorus * ( e.onLand ? 0.3 + 0.7 * inland : 0.3 * ( 1 - smooth( 20, 150, e.shoreDist ) ) ) * ( 1 - e.u );
		this._bed( 'birds_dawn', dB( MIX.birdChorus ) * cg / dB( BANK.birds_dawn.lufs ), now, 2 );

		this._birdT -= dt;
		const rate = act * hab;
		if ( this._birdT <= 0 ) {

			this._birdT = rate > 0.02 ? ( 4 + Math.random() * 20 ) / rate : 3;
			if ( rate > 0.02 && e.u < 0.5 && this._singers.length < 3 ) {

				const p = this._perch();
				if ( p ) {

					const dove = Math.random() < 0.15 + 0.25 * lull;
					const bank = dove ? 'bird_dove' : 'bird_forest';
					const group = dove ? null : FOREST[ Math.floor( Math.random() * FOREST.length ) ];
					this._want( bank );
					p.bank = bank;
					p.group = group;
					p.n = 1 + Math.floor( Math.random() * ( dove ? 2 : 4 ) );
					p.t = Math.random() * 0.5;
					p.rate = 0.93 + Math.random() * 0.14;
					p.lvl = ( dove ? MIX.dove : MIX.bird ) + ( Math.random() - 0.5 ) * 6;
					this._singers.push( p );

				}

			}

		}

		for ( let i = this._singers.length - 1; i >= 0; i -- ) {

			const s = this._singers[ i ];
			s.t -= dt;
			if ( s.t > 0 ) continue;
			if ( s.n <= 0 || e.u > 0.5 || act < 0.01 ) {

				this._singers.splice( i, 1 );
				continue;

			}

			const info = BANK[ s.bank ];
			if ( ! this._want( s.bank ) ) {

				s.t = 1; // still loading
				continue;

			}

			let k = - 1;
			if ( s.group ) {

				k = s.group[ Math.floor( Math.random() * s.group.length ) ];
				if ( k === this._last[ s.bank ] ) k = s.group[ ( s.group.indexOf( k ) + 1 ) % s.group.length ];

			}

			const v = this._shotAt( s.bank, 'bird', s.x, s.y, s.z, s.lvl + ( Math.random() - 0.5 ) * 2, s.rate * ( 0.98 + Math.random() * 0.04 ), 0, 10, 1, k );
			const d = v ? info.slices[ this._last[ s.bank ] ][ 1 ] / s.rate : 0;
			s.n --;
			s.t = d + 0.8 + Math.random() * 4.5;

		}

	}

	// ------------------------------------------------------------------ the humpback (window.__app.whale)

	_whale( now, dt ) {

		const e = this.env, s = this._wh, app = globalThis.__app;
		const w = app && app.whale, b = w && w.ready && w.brain;
		if ( ! b || ! b.position ) {

			if ( this._beds.has( 'whale_song' ) ) this._bed( 'whale_song', 0, now, 1 );
			return;

		}

		const p = b.position, u = e.u;
		const d = Math.hypot( p.x - e.lx, p.y - e.ly, p.z - e.lz );

		// song: sung at depth while cruising (it stops to breathe); from above the surface only faint and
		// dull. Only heard near the whale.
		s.sing += ( ( b.state === 'cruise' ? 1 : 0.1 ) - s.sing ) * ( 1 - Math.exp( - dt / 4 ) );
		const audible = d < WHALE_RANGE;
		if ( audible || this._beds.has( 'whale_song' ) ) {

			this._pos( this.songPan, p.x, p.y, p.z );
			this._ramp( this.songLP.frequency, Math.exp( lerp( Math.log( 420 ), Math.log( 16000 ), u ) ), 0.08 );
			this._ramp( this.songOut.gain, lerp( dB( - 20 ), 1, u ), 0.08 );
			this._bed( 'whale_song', audible ? dB( MIX.whaleSong ) * s.sing * ( 1 - smooth( WHALE_RANGE - 30, WHALE_RANGE, d ) ) / dB( BANK.whale_song.lufs ) : 0, now, 1.5 );

		}

		const wl = num( b.water, 0 ), fx = Math.sin( num( b.yaw, 0 ) ), fz = Math.cos( num( b.yaw, 0 ) );
		const blowing = b.blow > 0, fl = num( b.flukeUp, 0 );
		const near = d < WHALE_RANGE;
		if ( d < WHALE_RANGE * 1.5 ) for ( const n of WHALE_SET ) this._want( n );
		if ( near && s.breaches >= 0 ) {

			// the blow: an explosive exhale as the blowholes clear the water, at the head
			if ( blowing && ! s.blow ) this._shotAt( 'whale_blow', 'whale', p.x + fx * 4, wl + 1, p.z + fz * 4, MIX.whaleBlow + ( Math.random() - 0.5 ) * 3, 0.72 + Math.random() * 0.12, 0, 10 );
			// breach: bursting clear of the surface, then the crash back in
			if ( b.breaches > s.breaches ) this._shotAt( 'big_splash', 'whale', p.x, wl + 1, p.z, MIX.whaleBurst, 0.6 + Math.random() * 0.1, 0, 10 );
			if ( b.splashes > s.splashes ) {

				this._shotAt( 'big_splash', 'whale', p.x, wl + 0.5, p.z, MIX.whaleSplash, 0.5 + Math.random() * 0.08, 0, 12 );
				this._shotAt( 'surf_crash', 'whale', p.x + fx * 3, wl + 0.5, p.z + fz * 3, MIX.whaleSplash - 4, 0.72 + Math.random() * 0.08, now + 0.06, 12 );

			}

			// fluke-up dive: water sheeting off the raised flukes, then the flukes slipping under
			const tx = p.x - fx * 9, tz = p.z - fz * 9;
			if ( fl > 0.05 && s.fluke <= 0.05 ) this._shotAt( 'emerge', 'whale', tx, wl + 2, tz, MIX.whaleDrip, 0.7 + Math.random() * 0.1, 0, 8 );
			if ( fl === 0 && s.fluke > 0.8 ) this._shotAt( 'big_splash', 'whale', tx, wl, tz, MIX.whaleFluke, 0.78 + Math.random() * 0.1, 0, 10 );

		}

		s.blow = blowing;
		s.fluke = fl;
		s.breaches = num( b.breaches, 0 );
		s.splashes = num( b.splashes, 0 );

	}

	// ------------------------------------------------------------------ helpers

	// smooth parameter ramp; skips negligible changes to keep the automation timeline short
	_ramp( param, v, tau ) {

		if ( ! Number.isFinite( v ) ) return;
		const last = param._t;
		if ( last !== undefined && Math.abs( v - last ) <= Math.abs( last ) * 0.004 + 1e-6 ) return;
		param._t = v;
		param.setTargetAtTime( v, this.ctx.currentTime, tau );

	}

	_pos( p, x, y, z ) {

		if ( p.positionX ) {

			this._ramp( p.positionX, x, 0.05 );
			this._ramp( p.positionY, y, 0.05 );
			this._ramp( p.positionZ, z, 0.05 );

		} else p.setPosition( x, y, z );

	}

	_warn( e ) {

		const msg = ( e && e.message ) || String( e );
		if ( this._warned.has( msg ) || this._warned.size > 20 ) return;
		this._warned.add( msg );
		console.warn( '[SoundScape]', e );

	}

}
