import { Noise2D, smoothstep, clamp, lerp } from '../util/Noise.js';
import { WORLD } from './WorldLayout.js';
import { softRamp, erosionNoise, sampleGrid, upsample2, boxBlur } from './terrain/TerrainNoise.js';
import { ridgeEnvelope, SEA_STACKS, PATHS, polylineDistance } from './terrain/IslandShape.js';

const smin = ( a, b, k ) => {

	const h = clamp( 0.5 + 0.5 * ( b - a ) / k, 0, 1 );
	return lerp( b, a, h ) - k * h * ( 1 - h );

};

const ellipseDist = ( x, z, cx, cz, rx, rz ) => {

	const dx = ( x - cx ) / rx, dz = ( z - cz ) / rz;
	return ( Math.sqrt( dx * dx + dz * dz ) - 1 ) * Math.min( rx, rz );

};

// central bay: the beach and its underwater profile stay smooth (the surf is tuned for it)
const beachZoneAt = ( x, z ) => ( 1 - smoothstep( 120, 205, Math.abs( x - 10 ) ) ) * ( 1 - smoothstep( 40, 140, z + 40 ) ) * smoothstep( - 260, - 120, z );

const RES = 2048; // 1 m texels over the 2048 m domain

// volcanic plugs on the summit ridge: [x, z, radius, height above the envelope]
const PLUGS = [ [ - 42, - 505, 72, 62 ], [ 152, - 466, 46, 38 ], [ - 238, - 458, 40, 26 ] ];
const VILLAGE = WORLD.village.center;

// CPU-side procedural island heightmap plus bilinear queries.
//
// A volcanic high island: a hand-placed ridge skeleton (summit massif with rock plugs, spurs
// framing the village valley and the two headlands) carved by slope-aligned erosion noise into
// branching gullies and knife-edge ridges; sea cliffs, wave-cut platforms and sea stacks on the
// rocky coast; the bay keeps its tuned beach / surf-zone profile (only cusps, a zero-mean bar and
// dunes behind the beach are added).
//
// Generation runs on three grids:
//   A (8 m)  large, smooth fields: coast warp, deep-sea variation, the ridge envelope of the massif
//   B (2 m)  coast distance, beach / seabed profile (unchanged in the bay), coastal cliffs, the massif
//            carved by slope-aligned erosion noise, volcanic plugs
//   C (1 m)  Catmull-Rom upsample + fine relief (outcrops, crags, layered cliffs), sea stacks, rock
//            platforms, beach cusps / bar / berm, dune ridges, footpaths, seabed seagrass and
//            rubble, then the rock / sand / path / gully masks
export class TerrainData {

	constructor( seed = 7 ) {

		this.size = WORLD.terrainSize;
		this.res = RES;
		this.texel = this.size / this.res;
		this.origin = - this.size / 2;
		this.noise = new Noise2D( seed );
		this.noise2 = new Noise2D( seed * 31 + 5 );
		this.noise3 = new Noise2D( seed * 131 + 17 );
		const n = this.res * this.res;
		this.heights = new Float32Array( n );
		this.rock = new Float32Array( n ); // rockiness mask (0 sand/soil .. 1 bare rock)
		this.sand = new Uint8Array( n ); // loose sand cover (beach, dunes, seabed)
		this.path = new Uint8Array( n ); // worn footpaths
		this.gully = new Uint8Array( n ); // drainage lines carved by the erosion noise
		this.seagrass = new Uint8Array( n ); // seagrass meadows on the shallow seabed (1.5 - 12 m deep)
		this.rubble = new Uint8Array( n ); // dark coral rubble / rock heads on the seabed
		this.scarp = new Uint8Array( n ); // face of the eroded embankment behind the bay beach
		this.rockSites = []; // outcrops / stacks for the rock scatter: { x, z, r, h, kind }
		this.pads = []; // building pads flattened by the village (trampled ground in the splat map)
		this.paths = PATHS;
		this.timings = {};
		this._F = { wx: 0, wz: 0, f170: 0, und: 0, deep: 0, E: 0, gx: 0, gz: 0 };
		this._out = { h: 0, rock: 0, d: 0, bz: 0, carve: 0 };
		this.generate();
		this.buildMinMax();

	}

	// signed coast distance (m): > 0 water, < 0 land
	coastDistance( x, z ) {

		const F = this._fields( x, z, false );
		const beachZone = beachZoneAt( x, z );
		return { d: this._coast( x, z, F, beachZone ), beachZone };

	}

	// height before the 1 m detail pass (analytic, slow path of the grid pipeline)
	heightFn( x, z ) {

		const F = this._fields( x, z, true );
		const o = this._base( x, z, F, this._out );
		return { h: o.h, rock: o.rock };

	}

	// ------------------------------------------------------------------ generation

	// large-scale fields at a point (grid A computes the same on an 8 m lattice)
	_fields( x, z, withMassif, F = this._F ) {

		const n = this.noise;
		const ox = n.fbm( x / 300, z / 300, 3 ) * 60, oz = n.fbm( x / 300 + 7.1, z / 300 - 3.3, 3 ) * 60;
		F.wx = x + ox; F.wz = z + oz;
		F.f170 = n.fbm( F.wx / 170, F.wz / 170, 4 );
		F.und = n.fbm( x / 260, z / 90, 2 );
		F.deep = n.fbm( x / 220, z / 220, 4 );
		if ( withMassif ) {

			F.E = this._envelope( x, z );
			F.gx = ( this._envelope( x + 8, z ) - this._envelope( x - 8, z ) ) / 16;
			F.gz = ( this._envelope( x, z + 8 ) - this._envelope( x, z - 8 ) ) / 16;

		}

		return F;

	}

	_envelope( x, z ) {

		const n = this.noise, n3 = this.noise3;
		const wx = x + n.fbm( x / 300, z / 300, 3 ) * 60 + n3.fbm( x / 130, z / 130, 2 ) * 28;
		const wz = z + n.fbm( x / 300 + 7.1, z / 300 - 3.3, 3 ) * 60 + n3.fbm( x / 130 + 5.2, z / 130 - 1.7, 2 ) * 28;
		return ridgeEnvelope( wx, wz );

	}

	_coast( x, z, F, bz ) {

		const dBody = ellipseDist( x, z, 0, - 442, 565, 400 );
		const dW = ellipseDist( x, z, - 272, - 25, 92, 205 );
		const dE = ellipseDist( x, z, 288, - 12, 108, 228 );
		let d = smin( dBody, smin( dW, dE, 40 ), 75 );
		d += F.f170 * 34 * ( 1 - 0.9 * bz );
		if ( bz < 1 ) d += this.noise.fbm( x / 38, z / 38, 3 ) * 7 * ( 1 - bz );
		d += F.und * 5 * bz; // gentle beach undulation
		return d;

	}

	// grid B profile at a point
	_base( x, z, F, out ) {

		const n = this.noise, n2 = this.noise2;
		const bz = beachZoneAt( x, z );
		const d = this._coast( x, z, F, bz );

		// rocky headlands and outer coast
		const headland = Math.max(
			1 - smoothstep( 60, 140, Math.hypot( ( x + 272 ) * 0.9, ( z + 25 ) * 0.45 ) ),
			1 - smoothstep( 60, 150, Math.hypot( ( x - 288 ) * 0.9, ( z + 12 ) * 0.45 ) ) );
		const rm = Math.max( headland, 1 - bz * 1.4 );
		let rock = 0;
		if ( rm > 0.35 ) rock = smoothstep( 0.35, 0.75, clamp( rm * ( 0.55 + 0.45 * n2.fbm( x / 60, z / 60, 3 ) ), 0, 1 ) );

		let h, carve = 0;

		if ( d >= 0 ) {

			let depth;
			if ( d < 70 ) depth = d * 0.05;
			else if ( d < 260 ) depth = 3.5 + ( d - 70 ) * 0.06;
			else if ( d < 700 ) depth = 14.9 + ( d - 260 ) * 0.07;
			else depth = 45.7 + ( d - 700 ) * 0.05;
			depth = Math.min( depth, 85 );
			depth *= lerp( 1, 2.4, rock * ( 1 - smoothstep( 150, 400, d ) ) );

			// seabed variation (ripples skipped far offshore where nobody can see them)
			const sandRipple = d < 420 ? n.fbm( x / 45, z / 45, 3 ) * 0.6 * ( 1 - smoothstep( 380, 420, d ) ) : 0;
			const deepVar = F.deep * 6 * smoothstep( 60, 400, d );
			h = - depth + sandRipple * smoothstep( 8, 40, d ) + deepVar;

			// rocky seabed near cliffs
			if ( rock > 0 && d < 300 ) h += rock * n2.ridged( x / 25, z / 25, 4 ) * 5 * smoothstep( 0, 20, d ) * ( 1 - smoothstep( 120, 300, d ) );

			// coral reef platform
			const rc = WORLD.reef.center;
			const rd = Math.hypot( x - rc.x, z - rc.z );
			const reefMask = 1 - smoothstep( WORLD.reef.radius * 0.35, WORLD.reef.radius, rd );
			if ( reefMask > 0 ) {

				const bumps = n2.ridged( x / 11, z / 11, 4 ) * 2.8 + n.fbm( x / 5, z / 5, 2 ) * 0.5;
				h += reefMask * ( 1.2 + bumps );
				h = Math.min( h, - 1.4 );

			}

			// keep the swim/boat channel along the pier sandy
			const px = WORLD.pier.x;
			const pierMask = ( 1 - smoothstep( 6, 16, Math.abs( x - px - 4 ) ) ) * smoothstep( - 60, - 20, z );
			if ( pierMask > 0 ) h = lerp( h, - depth + sandRipple * 0.3, pierMask * 0.8 );

		} else {

			const e = - d;
			let beach;
			if ( e < 38 ) beach = e * 0.068;
			else if ( e < 70 ) beach = 2.584 + ( e - 38 ) * 0.03;
			else if ( e < 230 ) beach = 3.544 + ( e - 70 ) * 0.075;
			else beach = 15.544 + ( e - 230 ) * 0.04;

			const dunes = e > 25 && e < 240 ? smoothstep( 25, 60, e ) * ( 1 - smoothstep( 120, 240, e ) ) * n2.fbm( x / 30, z / 30, 3 ) * 0.9 : 0;
			h = beach + dunes;

			// sea cliffs on the rocky coast
			const cliffZone = rock * ( 1 - smoothstep( 90, 170, e ) );
			if ( cliffZone > 0 ) {

				const cliff = Math.min( e * 1.6, 18 + n2.ridged( x / 70, z / 70, 4 ) * 22 ) + n2.fbm( x / 12, z / 12, 3 ) * 2.5;
				h = lerp( h, Math.max( h, cliff ), cliffZone );

			}

			// the massif, carved by slope-aligned erosion noise; the village valley stays open
			// (an elongated valley reaching north into the massif, like the bays of Moorea)
			const bay = 1 - smoothstep( 120, 230, Math.abs( x - 22 - ( z + 100 ) * 0.08 + n.noise( z / 120, 3.7 ) * 30 ) );
			const open = bay * ( 1 - smoothstep( 70, 340, e + n.noise( x / 80, z / 80 ) * 30 ) );
			if ( F.E > 0.01 && open < 1 ) {

				let m = F.E;
				const slope = Math.sqrt( F.gx * F.gx + F.gz * F.gz );
				if ( slope > 0.005 ) {

					// meandering: warp the lookup a little so the gullies do not run dead straight
					const mx = x + n.noise( x / 45, z / 45 ) * 14, mz = z + n.noise( x / 45 + 9.1, z / 45 - 4.3 ) * 14;
					carve = erosionNoise( mx, mz, F.gx, F.gz, 5, 160, Math.min( 30, 0.16 * F.E ) );
					m += carve;

				}

				// volcanic plugs: sheer rock towers crowning the summit ridge
				for ( const [ px, pz, R, H ] of PLUGS ) {

					const dx = x - px, dz = z - pz;
					const r2 = dx * dx + dz * dz;
					if ( r2 > R * R * 1.8 ) continue;
					const a = Math.atan2( dz, dx );
					const ca = Math.cos( a ), sa = Math.sin( a );
					// lobed outline with vertical fluting (columnar jointing)
					const flute = Math.abs( n2.noise( ca * 4.5 + px * 0.1, sa * 4.5 ) ) * 0.14;
					const rr = R * ( 1 + 0.2 * n.noise( ca * 1.3 + px, sa * 1.3 + pz ) + 0.08 * n2.noise( x / 17, z / 17 ) - flute );
					const u = Math.sqrt( r2 ) / rr;
					// sheer walls, a talus apron at the foot and a craggy crown
					const wall = smoothstep( 1.0, 0.72, u );
					const apron = ( 1 - smoothstep( 0.9, 1.3, u ) ) * 0.12;
					const crown = 1 - 0.35 * u * u + n2.ridged( x / 19, z / 19, 3 ) * 0.35 - 0.15;
					m += H * ( wall * crown + apron );

				}

				// where the massif meets the sea it drops as a sea cliff (steep on the rocky coast,
				// gentle behind beaches) so heights stay continuous across the shoreline
				const S = 2.4 - 1.9 * bz;
				m *= 1 - open;
				m -= softRamp( m - e * S - n2.fbm( x / 9, z / 9, 2 ) * 1.5 * ( 1 - bz ), 3 );
				h = h + softRamp( m - h, 6 );

			}

		}

		out.h = h; out.rock = rock; out.d = d; out.bz = bz; out.carve = carve;
		return out;

	}

	generate() {

		const T = this.timings;
		let t = performance.now();
		const tick = ( name ) => {

			const now = performance.now();
			T[ name ] = Math.round( now - t );
			t = now;

		};

		const { origin } = this;
		const n = this.noise, n3 = this.noise3;

		// ---- grid A: 8 m
		const NA = 256, TA = this.size / NA;
		const Awx = new Float32Array( NA * NA ), Awz = new Float32Array( NA * NA );
		const Af170 = new Float32Array( NA * NA ), Aund = new Float32Array( NA * NA ), Adeep = new Float32Array( NA * NA );
		const AE = new Float32Array( NA * NA );
		for ( let j = 0; j < NA; j ++ ) {

			const z = origin + ( j + 0.5 ) * TA;
			for ( let i = 0; i < NA; i ++ ) {

				const x = origin + ( i + 0.5 ) * TA;
				const k = j * NA + i;
				const ox = n.fbm( x / 300, z / 300, 3 ) * 60, oz = n.fbm( x / 300 + 7.1, z / 300 - 3.3, 3 ) * 60;
				const wx = x + ox, wz = z + oz;
				Awx[ k ] = ox; Awz[ k ] = oz;
				Af170[ k ] = n.fbm( wx / 170, wz / 170, 4 );
				Aund[ k ] = n.fbm( x / 260, z / 90, 2 );
				Adeep[ k ] = n.fbm( x / 220, z / 220, 4 );
				// massif envelope only over the island body
				if ( ellipseDist( x, z, 0, - 442, 640, 470 ) < 0 || ellipseDist( x, z, - 272, - 25, 160, 280 ) < 0 || ellipseDist( x, z, 288, - 12, 170, 300 ) < 0 ) {

					AE[ k ] = ridgeEnvelope( wx + n3.fbm( x / 130, z / 130, 2 ) * 28, wz + n3.fbm( x / 130 + 5.2, z / 130 - 1.7, 2 ) * 28 );

				}

			}

		}

		// envelope gradient
		const Agx = new Float32Array( NA * NA ), Agz = new Float32Array( NA * NA );
		for ( let j = 1; j < NA - 1; j ++ ) for ( let i = 1; i < NA - 1; i ++ ) {

			const k = j * NA + i;
			Agx[ k ] = ( AE[ k + 1 ] - AE[ k - 1 ] ) / ( 2 * TA );
			Agz[ k ] = ( AE[ k + NA ] - AE[ k - NA ] ) / ( 2 * TA );

		}

		tick( 'gridA' );

		// ---- grid B: 2 m
		const NB = RES / 2, TB = this.size / NB;
		const Bh = new Float32Array( NB * NB ), Brock = new Float32Array( NB * NB ), Bd = new Float32Array( NB * NB );
		const Bbz = new Float32Array( NB * NB ), Bcarve = new Float32Array( NB * NB );
		const F = { wx: 0, wz: 0, f170: 0, und: 0, deep: 0, E: 0, gx: 0, gz: 0 };
		const out = { h: 0, rock: 0, d: 0, bz: 0, carve: 0 };
		for ( let j = 0; j < NB; j ++ ) {

			const z = origin + ( j + 0.5 ) * TB;
			for ( let i = 0; i < NB; i ++ ) {

				const x = origin + ( i + 0.5 ) * TB;
				F.wx = x + sampleGrid( Awx, NA, origin, TA, x, z );
				F.wz = z + sampleGrid( Awz, NA, origin, TA, x, z );
				F.f170 = sampleGrid( Af170, NA, origin, TA, x, z );
				F.und = sampleGrid( Aund, NA, origin, TA, x, z );
				F.deep = sampleGrid( Adeep, NA, origin, TA, x, z );
				F.E = sampleGrid( AE, NA, origin, TA, x, z );
				if ( F.E > 0.01 ) {

					F.gx = sampleGrid( Agx, NA, origin, TA, x, z );
					F.gz = sampleGrid( Agz, NA, origin, TA, x, z );

				}

				this._base( x, z, F, out );
				const k = j * NB + i;
				Bh[ k ] = out.h; Brock[ k ] = out.rock; Bd[ k ] = out.d; Bbz[ k ] = out.bz; Bcarve[ k ] = out.carve;

			}

		}

		tick( 'gridB' );

		// ---- grid C: 1 m
		const H = upsample2( Bh, NB, true );
		const D = upsample2( Bd, NB, false );
		const R0 = upsample2( Brock, NB, false );
		const BZ = upsample2( Bbz, NB, false );
		const CV = upsample2( Bcarve, NB, false );
		this.heights = H;
		tick( 'upsample' );

		this._detail( H, D, R0, BZ );
		tick( 'detail' );

		this._features( H, D, R0, BZ );
		tick( 'features' );

		this._scarp( H, D, R0, BZ );
		tick( 'scarp' );

		this._seabed( H, R0 );
		tick( 'seabed' );

		this._masks( H, D, R0, BZ, CV );
		// soften the 1 m masks so material transitions never show the texel grid
		this.rock = boxBlur( this.rock, RES, RES, 1 );
		tick( 'masks' );

		// fade to deep ocean floor at the domain border
		const res = RES;
		for ( let j = 0; j < res; j ++ ) {

			if ( Math.min( j, res - 1 - j ) > 121 ) {

				for ( let i = 0; i < 122; i ++ ) this._fadeBorder( H, i, j );
				for ( let i = res - 122; i < res; i ++ ) this._fadeBorder( H, i, j );

			} else {

				for ( let i = 0; i < res; i ++ ) this._fadeBorder( H, i, j );

			}

		}

		tick( 'border' );
		T.total = Object.values( T ).reduce( ( a, b ) => a + b, 0 );

	}

	_fadeBorder( H, i, j ) {

		const res = RES;
		const e = Math.min( i, j, res - 1 - i, res - 1 - j ) * this.texel;
		const t = smoothstep( 0, 120, e );
		const k = j * res + i;
		H[ k ] = lerp( - 90, H[ k ], t );

	}

	// 1 m relief on land: micro undulation and rock outcrops breaking through the slopes
	_detail( H, D, R0, BZ ) {

		const res = RES, o = this.origin, n2 = this.noise2, n3 = this.noise3;
		for ( let j = 1; j < res - 1; j ++ ) {

			const z = o + j + 0.5;
			if ( z > 320 || z < - 900 ) continue;
			for ( let i = 1; i < res - 1; i ++ ) {

				const k = j * res + i;
				const h = H[ k ];
				if ( h < - 6 ) continue;
				const x = o + i + 0.5;
				const d = D[ k ];
				const e = - d;
				const bz = BZ[ k ];
				// keep the bay beach, its dunes and the village smooth
				const vd = Math.hypot( x - VILLAGE.x, z - VILLAGE.z );
				const calm = Math.max( bz * ( 1 - smoothstep( 70, 130, e ) ), 1 - smoothstep( 105, 150, vd ) );
				const wild = 1 - calm;
				if ( wild <= 0.01 ) continue;
				const gx = H[ k + 1 ] - H[ k - 1 ], gz = H[ k + res ] - H[ k - res ];
				const slope = Math.sqrt( gx * gx + gz * gz ) * 0.5;

				// soft undulation on land (creep, root mounds)
				let add = 0;
				if ( e > 4 ) add += n3.fbm( x / 17, z / 17, 2 ) * 0.28 * smoothstep( 4, 30, e );

				const r0 = R0[ k ];

				// crags: broken, sharp-crested rock along the rocky waterline
				if ( r0 > 0.35 && e > - 25 && e < 40 ) {

					const crag = ( n2.ridged( x / 11 + 1.3, z / 11 - 4.4, 3 ) - 0.45 ) * 1.6 + ( n3.ridged( x / 4.3 + 8.8, z / 4.3, 2 ) - 0.45 ) * 0.5;
					add += crag * smoothstep( 0.35, 0.7, r0 ) * smoothstep( - 3, 1.5, h ) * ( 1 - smoothstep( 15, 38, e ) );

				}

				// layered cliffs: steep rocky ground steps into ledges and risers (lava flows)
				// (sea cliffs and headlands only; patchy so the bands never run for long)
				const layered = smoothstep( 0.45, 0.9, slope ) * r0 * ( 1 - smoothstep( 60, 140, e ) ) * smoothstep( 1, 5, h ) *
					smoothstep( - 0.1, 0.35, n3.noise( x / 53 + 4.1, z / 53 ) );
				if ( layered > 0.02 ) {

					// big, irregular ledges (6-11 m lifts) rather than fine steps that read as noise
					const warp = n2.noise( x / 41, z / 41 ) * 5 + n3.noise( x / 17, z / 17 ) * 1.5;
					const step = 6 + 5 * ( 0.5 + 0.5 * n3.noise( x / 97, z / 97 ) );
					const t = ( h + warp ) / step;
					const f = Math.floor( t ), fr = t - f;
					const ledge = ( f + smoothstep( 0.25, 0.9, fr ) ) * step - warp;
					add += ( ledge - h ) * 0.3 * layered;

				}

				// rock outcrops: blocky bumps on steeper ground and around the rocky coast
				const want = Math.max( smoothstep( 0.35, 0.8, slope ), r0 * 0.8 );
				if ( want > 0.05 ) {

					// steep walls, a gently domed top and joints splitting the outcrop into blocks
					const rid = n2.fbm( x / 24 + 3.1, z / 24 - 7.7, 3 ) + n3.noise( x / 6.3, z / 6.3 ) * 0.08;
					const wall = smoothstep( 0.3, 0.36, rid );
					if ( wall > 0 ) {

						const dome = smoothstep( 0.36, 0.6, rid );
						const joint = 1 - smoothstep( 0.03, 0.09, Math.abs( n3.noise( x / 4.6 + 7.3, z / 4.6 - 1.9 ) ) );
						add += want * ( 1.5 + 1.5 * r0 ) * ( wall * 0.7 + dome * 0.45 ) * ( 1 - 0.3 * joint * wall );

					}

				}

				H[ k ] = h + add * wild;

			}

		}

	}

	// discrete features: sea stacks, wave-cut rock platforms, beach cusps / bars, dune ridges, paths
	_features( H, D, R0, BZ ) {

		const res = RES, o = this.origin, n = this.noise, n2 = this.noise2, n3 = this.noise3;

		// ---- sea stacks: steep columns with a rubble skirt
		for ( const [ sx, sz, r, hgt ] of SEA_STACKS ) {

			const R = r * 2.4;
			const i0 = Math.max( 1, Math.floor( sx - R - o ) ), i1 = Math.min( res - 2, Math.ceil( sx + R - o ) );
			const j0 = Math.max( 1, Math.floor( sz - R - o ) ), j1 = Math.min( res - 2, Math.ceil( sz + R - o ) );
			for ( let j = j0; j <= j1; j ++ ) for ( let i = i0; i <= i1; i ++ ) {

				const x = o + i + 0.5, z = o + j + 0.5;
				const dx = x - sx, dz = z - sz;
				const a = Math.atan2( dz, dx );
				const rr = r * ( 1 + 0.22 * n3.noise( Math.cos( a ) * 1.7 + sx, Math.sin( a ) * 1.7 + sz ) + 0.08 * n2.noise( x / 2.5, z / 2.5 ) );
				const u = Math.hypot( dx, dz ) / rr;
				const k = j * res + i;
				// column: near vertical faces, rounded shoulder, craggy top
				const col = smoothstep( 1.0, 0.82, u );
				const top = hgt * ( 1 - 0.25 * u * u ) + n2.ridged( x / 6, z / 6, 3 ) * 2.2;
				const skirt = ( 1 - smoothstep( 0.9, 2.4, u ) ) * ( 1.6 + n2.ridged( x / 4, z / 4, 2 ) * 1.4 );
				const base = H[ k ];
				let h = base + skirt;
				h = lerp( h, Math.max( h, top ), col );
				H[ k ] = h;
				R0[ k ] = Math.max( R0[ k ], 1 - smoothstep( 1.6, 2.4, u ) );

			}

			this.rockSites.push( { x: sx, z: sz, r, h: hgt, kind: 'stack' } );

		}

		// ---- rocky coast: wave-cut platform just below the cliffs with tide pools
		for ( let j = 1; j < res - 1; j ++ ) {

			const z = o + j + 0.5;
			if ( z > 330 || z < - 880 ) continue;
			for ( let i = 1; i < res - 1; i ++ ) {

				const k = j * res + i;
				const d = D[ k ];
				if ( d < - 4 || d > 26 ) continue;
				const r0 = R0[ k ];
				if ( r0 < 0.3 ) continue;
				const x = o + i + 0.5;
				const width = 9 + 12 * ( 0.5 + 0.5 * n3.fbm( x / 45, z / 45, 2 ) );
				const inside = ( 1 - smoothstep( width * 0.7, width, d ) ) * smoothstep( 0.3, 0.6, r0 );
				if ( inside <= 0 ) continue;
				const pool = smoothstep( 0.2, 0.45, n2.noise( x / 3.1, z / 3.1 ) ) * 0.35;
				const shelf = - 0.35 + 0.35 * n.fbm( x / 7, z / 7, 2 ) + n2.ridged( x / 3, z / 3, 2 ) * 0.25 - pool;
				const h = H[ k ];
				if ( shelf > h ) {

					H[ k ] = lerp( h, shelf, inside );
					R0[ k ] = Math.max( R0[ k ], inside );

				}

			}

		}

		// ---- the bay beach: cusps in the swash zone, a longshore bar, a berm crest and dune ridges
		{

			const i0 = Math.floor( - 200 - o ), i1 = Math.ceil( 230 - o );
			const j0 = Math.floor( - 170 - o ), j1 = Math.ceil( 160 - o );
			for ( let j = j0; j <= j1; j ++ ) for ( let i = i0; i <= i1; i ++ ) {

				const k = j * res + i;
				const bz = BZ[ k ];
				if ( bz < 0.05 ) continue;
				const x = o + i + 0.5, z = o + j + 0.5;
				const d = D[ k ];
				const h = H[ k ];
				let add = 0;
				if ( d < 0 ) {

					const e = - d;
					// beach cusps: horns and embayments ~24 m apart in the upper swash
					const cusp = Math.sin( ( x + n.noise( x / 60, 3.3 ) * 9 ) * ( 2 * Math.PI / 24 ) );
					add += cusp * 0.09 * smoothstep( 4, 12, e ) * ( 1 - smoothstep( 20, 32, e ) );
					// berm crest at the top of the swash
					add += 0.14 * Math.exp( - Math.pow( ( e - 38 ) / 5, 2 ) );
					// dune ridges behind the beach, away from the village and the pier foot
					const vd = Math.hypot( ( x - VILLAGE.x ) * 0.8, z - VILLAGE.z );
					const away = smoothstep( 85, 125, vd ) * smoothstep( 14, 30, Math.abs( x - WORLD.pier.x ) );
					if ( away > 0 && e > 40 && e < 130 ) {

						const rid = 1 - Math.abs( n2.noise( x / 34, e / 15 + 11.3 ) );
						const hummock = n3.fbm( x / 9, z / 9, 2 );
						add += away * smoothstep( 44, 60, e ) * ( 1 - smoothstep( 95, 128, e ) ) * ( rid * rid * 1.3 + hummock * 0.35 );

					}

				} else {

					// longshore bar and trough (roughly zero mean over the profile)
					const bar = Math.exp( - Math.pow( ( d - 44 ) / 10, 2 ) ) * 0.28 - Math.exp( - Math.pow( ( d - 26 ) / 9, 2 ) ) * 0.31;
					add += bar * ( 0.7 + 0.3 * n.noise( x / 50, 7.7 ) ) * smoothstep( 5, 15, d );

				}

				H[ k ] = h + add * bz;

			}

		}

		// ---- footpaths: worn, slightly sunken
		for ( const p of PATHS ) {

			let x0 = Infinity, x1 = - Infinity, z0 = Infinity, z1 = - Infinity;
			for ( const [ px, pz ] of p.pts ) {

				x0 = Math.min( x0, px ); x1 = Math.max( x1, px ); z0 = Math.min( z0, pz ); z1 = Math.max( z1, pz );

			}

			const R = p.w * 2 + 2;
			const i0 = Math.floor( x0 - R - o ), i1 = Math.ceil( x1 + R - o );
			const j0 = Math.floor( z0 - R - o ), j1 = Math.ceil( z1 + R - o );
			for ( let j = j0; j <= j1; j ++ ) for ( let i = i0; i <= i1; i ++ ) {

				const x = o + i + 0.5, z = o + j + 0.5;
				const [ dist ] = polylineDistance( p.pts, x, z );
				const w = p.w * ( 1 + 0.25 * n2.noise( x / 6, z / 6 ) );
				const m = 1 - smoothstep( w * 0.6, w * 1.9, dist );
				if ( m <= 0 ) continue;
				const k = j * res + i;
				const v = Math.round( m * 255 );
				if ( v > this.path[ k ] ) this.path[ k ] = v;
				// sink up to 8 cm (none on the beach where it would disturb the swash)
				const sink = 0.08 * ( 1 - smoothstep( w * 0.4, w * 1.2, dist ) ) * smoothstep( 1.5, 3, H[ k ] );
				H[ k ] -= sink;

			}

		}

	}

	// Eroded embankment behind the bay beach: storms cut the foredune back into a low scarp (0.4 -
	// 1.2 m) just above the berm crest and the storm line, where the grass-bound ground meets the
	// open beach. Its position, height and steepness wander along the shore; slumped stretches are
	// lower and gentler, fallen chunks lie at the toe, and the raised lip settles back to the old
	// ground within ~20 - 30 m. Gaps where the village core, the pier foot, the footpaths and rock
	// come down to the beach. The toe stays above the berm (e > 41 m), so the swash and surf never
	// reach it. this.scarp marks the face (and the chunks) for the terrain material.
	_scarp( H, D, R0, BZ ) {

		const res = RES, o = this.origin, n = this.noise, n2 = this.noise2, n3 = this.noise3;
		const scarp = this.scarp;
		const i0 = Math.floor( - 200 - o ), i1 = Math.ceil( 230 - o );
		const j0 = Math.floor( - 190 - o ), j1 = Math.ceil( 0 - o );
		for ( let j = j0; j <= j1; j ++ ) for ( let i = i0; i <= i1; i ++ ) {

			const k = j * res + i;
			const bz = BZ[ k ];
			if ( bz < 0.3 ) continue;
			const e = - D[ k ];
			if ( e < 36 || e > 95 ) continue;
			const x = o + i + 0.5, z = o + j + 0.5;

			// gaps: village core, pier foot, footpaths, rock
			const vd = Math.hypot( ( x - VILLAGE.x ) * 0.8, z - VILLAGE.z );
			let gap = smoothstep( 45, 70, vd ) * smoothstep( 10, 22, Math.abs( x - WORLD.pier.x ) ) * ( 1 - smoothstep( 0.15, 0.4, R0[ k ] ) );
			for ( const p of PATHS ) {

				const [ dist ] = polylineDistance( p.pts, x, z );
				gap *= smoothstep( p.w + 1.5, p.w + 6, dist );

			}

			const Hs = ( 0.5 + 0.7 * smoothstep( - 0.4, 0.4, n3.noise( x / 38, 4.1 ) ) ) * gap * smoothstep( 0.3, 0.7, bz );
			if ( Hs < 0.02 ) continue;
			// slumped stretches: lower, wider, gentler faces
			const slump = smoothstep( 0.15, 0.6, n.noise( x / 23, 9.1 ) );
			const w = 1.1 + slump * 1.8;
			const hs = Hs * ( 1 - slump * 0.35 );
			const eS = Math.max( 44 + w * 0.5, 49 + n.noise( x / 45, 1.7 ) * 5 + n2.noise( x / 11, z / 11 ) * 1.5 );
			const t = e - eS;
			const face = smoothstep( - w * 0.5, w * 0.5, t );
			const back = 1 - smoothstep( 6, 24 + n2.noise( x / 30, 3.3 ) * 6, t );
			// fallen chunks and slumped sand at the toe
			const toe = smoothstep( - 4.5, - 2.5, t ) * ( 1 - smoothstep( - w * 0.5 - 0.4, - w * 0.5 + 0.3, t ) );
			const chunks = toe * Math.max( 0, n3.noise( x / 1.4, z / 1.4 ) + n2.noise( x / 3.1, z / 3.1 ) * 0.5 ) * 0.22 * hs;
			H[ k ] += hs * face * back + chunks;

			const faceM = smoothstep( - w * 0.5 - 0.35, - w * 0.5 + 0.25, t ) * ( 1 - smoothstep( w * 0.5 - 0.1, w * 0.5 + 0.7, t ) );
			// the mask climbs from ~0.55 at the toe to 1 at the lip (the material puts the root mat and
			// humus under the lip and an undercut shadow at the foot)
			const up = 0.55 + 0.45 * smoothstep( - w * 0.5, w * 0.5, t );
			const m = Math.max( faceM * up * smoothstep( 0.12, 0.35, hs ), toe * smoothstep( 0.02, 0.1, chunks ) * 0.3 );
			scarp[ k ] = Math.max( scarp[ k ], Math.round( clamp( m, 0, 1 ) * 255 ) );

		}

	}

	// Shallow seabed biomes: seagrass meadows (irregular, ragged, with sand blowouts) and dark
	// rubble / rock heads, 1.5 - 12 m deep. Nothing in the swash zone, the first ~1.2 m of depth,
	// the sandy channel along the pier or the reef core (the reef system dresses that). Meadows
	// sit a little proud of the sand (sediment trapped by the blades), rubble heads are knobbly.
	_seabed( H, R0 ) {

		const res = RES, o = this.origin, n = this.noise, n2 = this.noise2, n3 = this.noise3;
		const grass = this.seagrass, rubble = this.rubble;
		const rc = WORLD.reef.center, rr = WORLD.reef.radius;
		const px = WORLD.pier.x;
		for ( let j = 1; j < res - 1; j ++ ) {

			const z = o + j + 0.5;
			if ( z < - 900 || z > 420 ) continue;
			for ( let i = 1; i < res - 1; i ++ ) {

				const k = j * res + i;
				const h = H[ k ];
				if ( h > - 1.2 || h < - 14 ) continue;
				const x = o + i + 0.5;
				const depth = - h;
				const r0 = R0[ k ];

				// exclusions (with ragged edges): reef core, the sandy swim / boat channel along the pier
				const rag = n2.noise( x / 9, z / 9 ) * 5 + n3.noise( x / 3.1, z / 3.1 ) * 1.5;
				const reef = 1 - smoothstep( rr * 0.6, rr * 0.8, Math.hypot( x - rc.x, z - rc.z ) + rag * 2 );
				const channel = ( 1 - smoothstep( 9, 13, Math.abs( x - px - 4 ) + rag ) ) * smoothstep( - 70, - 55, z ) * ( 1 - smoothstep( 45, 60, z + rag * 2 ) );
				const keep = ( 1 - reef ) * ( 1 - channel );
				if ( keep <= 0 ) continue;

				// seagrass: warped large-scale field with ragged margins, favouring 3 - 8 m; the depth
				// limits wander so the meadows never trace the (straight) isobaths of the bay
				const wx = x + n3.fbm( x / 60, z / 60, 2 ) * 26, wz = z + n3.fbm( x / 60 + 3.7, z / 60 - 8.1, 2 ) * 26;
				const dj = depth + n.noise( x / 23 + 5.5, z / 23 ) * 1.1 + n3.noise( x / 7, z / 7 ) * 0.3;
				const win = smoothstep( 1.7, 2.8, dj ) * ( 1 - smoothstep( 8.5, 12.5, dj ) ) * smoothstep( 1.2, 1.6, depth );
				const f = n.fbm( wx / 85, wz / 85, 3 ) + n2.noise( x / 17, z / 17 ) * 0.22 + n3.noise( x / 6, z / 6 ) * 0.08
					+ 0.12 * ( 1 - Math.abs( depth - 5.5 ) / 4 ) - 0.2 * r0;
				let g = smoothstep( 0.1, 0.3, f ) * win * keep;
				if ( g > 0 ) {

					// blowouts: sand holes scoured inside the meadows
					const hole = smoothstep( 0.42, 0.62, n2.noise( x / 7.5 + 4.4, z / 7.5 ) + n3.noise( x / 2.7, z / 2.7 ) * 0.15 );
					g *= 1 - hole * 0.95;
					grass[ k ] = Math.round( g * 255 );
					H[ k ] = h + 0.12 * g * smoothstep( 2.2, 3.2, depth );

				}

				// rubble heads: sparse knobbly patches, more of them toward the rocky coasts
				const rw = smoothstep( 1.8, 3.0, depth ) * ( 1 - smoothstep( 11, 14, depth ) ) * keep;
				if ( rw > 0 ) {

					const b = n3.noise( x / 13 + 9.1, z / 13 - 2.2 ) + n.noise( x / 4.3, z / 4.3 ) * 0.3 + r0 * 0.35;
					const m = smoothstep( 0.52, 0.66, b ) * rw * ( 1 - g * 0.6 );
					if ( m > 0 ) {

						rubble[ k ] = Math.round( m * 255 );
						const knob = 0.5 + 0.5 * n2.ridged( x / 2.3, z / 2.3, 2 );
						H[ k ] = H[ k ] + 0.38 * m * knob * smoothstep( 2.4, 3.4, depth );

					}

				}

			}

		}

	}

	// rock / sand / gully masks from the final shape
	_masks( H, D, R0, BZ, CV ) {

		const res = RES, o = this.origin, n2 = this.noise2, n3 = this.noise3;
		const rock = this.rock, sand = this.sand, gully = this.gully;
		for ( let j = 1; j < res - 1; j ++ ) {

			const z = o + j + 0.5;
			for ( let i = 1; i < res - 1; i ++ ) {

				const k = j * res + i;
				const h = H[ k ];
				const d = D[ k ];
				const r0 = R0[ k ];
				if ( h < - 14 ) {

					rock[ k ] = r0 * ( 1 - smoothstep( 80, 260, d ) );
					sand[ k ] = 255;
					continue;

				}

				const x = o + i + 0.5;
				const gx = H[ k + 1 ] - H[ k - 1 ], gz = H[ k + res ] - H[ k - res ];
				const slope = Math.sqrt( gx * gx + gz * gz ) * 0.5;
				const bz = BZ[ k ];
				const nz = n2.noise( x / 23, z / 23 ) * 0.5 + n3.noise( x / 7, z / 7 ) * 0.25;

				// bare rock: steep faces, the rocky coast band, the seabed below cliffs
				// near the rocky shore even moderately steep ground is bare (sea cliffs, spray)
				const seaCliff = d < 0 ? r0 * ( 1 - smoothstep( 6, 38, - d ) ) : 0;
				const s0 = 1.45 - 0.75 * seaCliff + nz * 0.35;
				let steep = smoothstep( s0, s0 + 0.35, slope );
				// gully floors keep their soil and plants; spurs and faces between them go bare
				if ( steep > 0 && j > 5 && i > 5 && j < res - 6 && i < res - 6 ) {

					const cav = ( H[ k + 5 ] + H[ k - 5 ] + H[ k + 5 * res ] + H[ k - 5 * res ] - 4 * h ) / 25;
					steep *= 1 - 0.85 * smoothstep( 0.01, 0.08, cav );

				}
				const coast = d < 0 ? r0 * ( 1 - smoothstep( 2, 16 + nz * 12, - d ) ) : r0 * ( 1 - smoothstep( 80, 260, d ) );
				let rk = Math.max( steep, coast * ( 0.75 + nz * 0.5 ) );
				// rounded outcrops (detail pass bumps): convex and steep-ish
				if ( j > 3 && i > 3 && j < res - 4 && i < res - 4 ) {

					const lap = ( H[ k + 3 ] + H[ k - 3 ] + H[ k + 3 * res ] + H[ k - 3 * res ] - 4 * h ) / 9;
					rk = Math.max( rk, smoothstep( 0.55, 0.9, slope ) * smoothstep( - 0.12, - 0.3, lap ) * ( 1 - bz ) * 0.8 );

				}
				rock[ k ] = clamp( rk * ( 1 - this.scarp[ k ] / 255 ), 0, 1 );

				// loose sand: the bay beach and dunes, small coves, the seabed
				let sd;
				if ( d >= 0 ) sd = 1 - smoothstep( 0.4, 0.8, rk );
				else {

					const e = - d;
					// the beach proper runs just past the berm crest; behind it sandy soil grades
					// into the village lawn, while the dunes away from the village stay sandy
					const beach = bz * ( 1 - smoothstep( 36 + nz * 10, 50 + nz * 14, e ) );
					const backBeach = bz * 0.45 * ( 1 - smoothstep( 60 + nz * 20, 100 + nz * 20, e ) );
					const vd = Math.hypot( ( x - VILLAGE.x ) * 0.8, z - VILLAGE.z );
					const away = smoothstep( 80, 120, vd ) * smoothstep( 14, 30, Math.abs( x - WORLD.pier.x ) );
					const dune = bz * away * ( 1 - smoothstep( 4.5 + nz * 2, 7 + nz * 2, h ) ) * ( 1 - smoothstep( 110, 140, e ) );
					const cove = ( 1 - smoothstep( 6, 16, e ) ) * ( 1 - smoothstep( 0.25, 0.5, rk ) ) * ( 1 - smoothstep( 1.8, 3.2, h ) ) * ( 1 - smoothstep( 0.12, 0.3, slope ) );
					sd = Math.max( beach, backBeach, dune, cove ) * ( 1 - smoothstep( 0.3, 0.6, slope ) );

				}

				sand[ k ] = Math.round( clamp( sd, 0, 1 ) * 255 );
				gully[ k ] = Math.round( smoothstep( 4, 18, - CV[ k ] ) * 255 );

			}

		}

	}

	// ------------------------------------------------------------------ edits / queries

	// flatten a circular pad (for building foundations)
	flatten( x, z, radius, height, falloff = 4 ) {

		const { res, texel, origin } = this;
		const r = radius + falloff;
		this.pads.push( { x, z, radius, height } );
		const i0 = Math.max( 0, Math.floor( ( x - r - origin ) / texel ) ), i1 = Math.min( res - 1, Math.ceil( ( x + r - origin ) / texel ) );
		const j0 = Math.max( 0, Math.floor( ( z - r - origin ) / texel ) ), j1 = Math.min( res - 1, Math.ceil( ( z + r - origin ) / texel ) );
		for ( let j = j0; j <= j1; j ++ ) for ( let i = i0; i <= i1; i ++ ) {

			const px = origin + ( i + 0.5 ) * texel, pz = origin + ( j + 0.5 ) * texel;
			const d = Math.hypot( px - x, pz - z );
			const t = 1 - smoothstep( radius, r, d );
			const k = j * res + i;
			this.heights[ k ] = lerp( this.heights[ k ], height, t );
			this.rock[ k ] *= 1 - t;

		}

	}

	heightAt( x, z ) {

		const { res, texel, origin, heights } = this;
		const fx = ( x - origin ) / texel - 0.5, fz = ( z - origin ) / texel - 0.5;
		if ( fx < 0 || fz < 0 || fx >= res - 1 || fz >= res - 1 ) return - 90;
		const i = Math.floor( fx ), j = Math.floor( fz );
		const tx = fx - i, tz = fz - j;
		const k = j * res + i;
		const a = heights[ k ], b = heights[ k + 1 ], c = heights[ k + res ], d = heights[ k + res + 1 ];
		return ( a * ( 1 - tx ) + b * tx ) * ( 1 - tz ) + ( c * ( 1 - tx ) + d * tx ) * tz;

	}

	normalAt( x, z, out ) {

		const e = this.texel;
		const hx = this.heightAt( x + e, z ) - this.heightAt( x - e, z );
		const hz = this.heightAt( x, z + e ) - this.heightAt( x, z - e );
		out.set( - hx, 2 * e, - hz ).normalize();
		return out;

	}

	// distance (m) from (x, z) to the nearest footpath edge (negative inside a path)
	pathDistance( x, z ) {

		let best = Infinity;
		for ( const p of PATHS ) best = Math.min( best, polylineDistance( p.pts, x, z )[ 0 ] - p.w );
		return best;

	}

	// min/max pyramid for CDLOD culling bounds
	buildMinMax() {

		const tile = 8; // texels per tile at the finest level
		const n = this.res / tile;
		this.mmTile = tile;
		this.mmN = n;
		const mn0 = new Float32Array( n * n ), mx0 = new Float32Array( n * n );
		const H = this.heights, res = this.res;
		for ( let tj = 0; tj < n; tj ++ ) for ( let ti = 0; ti < n; ti ++ ) {

			let mn = Infinity, mx = - Infinity;
			const jEnd = Math.min( res - 1, ( tj + 1 ) * tile ), iEnd = Math.min( res - 1, ( ti + 1 ) * tile );
			for ( let j = tj * tile; j <= jEnd; j ++ ) {

				const row = j * res;
				for ( let i = ti * tile; i <= iEnd; i ++ ) {

					const h = H[ row + i ];
					if ( h < mn ) mn = h;
					if ( h > mx ) mx = h;

				}

			}

			mn0[ tj * n + ti ] = mn;
			mx0[ tj * n + ti ] = mx;

		}

		this.mmMin = mn0;
		this.mmMax = mx0;
		// coarser levels: level l has n >> l tiles per side
		this.mmLevels = [ { n, min: mn0, max: mx0 } ];
		let cur = this.mmLevels[ 0 ];
		while ( cur.n > 1 ) {

			const m = cur.n >> 1;
			const mn = new Float32Array( m * m ), mx = new Float32Array( m * m );
			for ( let j = 0; j < m; j ++ ) for ( let i = 0; i < m; i ++ ) {

				const a = ( 2 * j ) * cur.n + 2 * i, b = a + cur.n;
				mn[ j * m + i ] = Math.min( cur.min[ a ], cur.min[ a + 1 ], cur.min[ b ], cur.min[ b + 1 ] );
				mx[ j * m + i ] = Math.max( cur.max[ a ], cur.max[ a + 1 ], cur.max[ b ], cur.max[ b + 1 ] );

			}

			cur = { n: m, min: mn, max: mx };
			this.mmLevels.push( cur );

		}

	}

	boundsFor( x0, z0, x1, z1 ) {

		const { origin, texel, mmTile } = this;
		// pick the pyramid level where the box spans only a few tiles per side
		const span = Math.max( x1 - x0, z1 - z0 ) / ( texel * mmTile );
		const l = Math.max( 0, Math.min( this.mmLevels.length - 1, Math.ceil( Math.log2( Math.max( 1, span / 2 ) ) ) ) );
		const L = this.mmLevels[ l ];
		const ts = texel * mmTile * ( 1 << l );
		const i0 = Math.floor( ( x0 - origin ) / ts ), i1 = Math.floor( ( x1 - origin ) / ts );
		const j0 = Math.floor( ( z0 - origin ) / ts ), j1 = Math.floor( ( z1 - origin ) / ts );
		let mn = Infinity, mx = - Infinity;
		let outside = false;
		for ( let j = j0; j <= j1; j ++ ) for ( let i = i0; i <= i1; i ++ ) {

			if ( i < 0 || j < 0 || i >= L.n || j >= L.n ) {

				outside = true;
				continue;

			}

			const k = j * L.n + i;
			if ( L.min[ k ] < mn ) mn = L.min[ k ];
			if ( L.max[ k ] > mx ) mx = L.max[ k ];

		}

		if ( outside ) {

			mn = Math.min( mn, - 90 );
			mx = Math.max( mx, - 90 );

		}

		return [ mn - 1, mx + 2 ];

	}

}
