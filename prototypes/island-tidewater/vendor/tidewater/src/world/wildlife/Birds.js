import * as THREE from '../../engine/index.js';
import { G } from '../../core/Globals.js';
import { WORLD } from '../WorldLayout.js';
import { SPRAY } from '../../fx/Spray.js';
import { mulberry32 } from '../../util/Noise.js';
import { BIRD } from './BirdShapes.js';
import { Flyer } from './Flight.js';
import { setHead, groundPose, standHeight, storePrevious, resetPrevious, setWings, tuckLegs } from './BirdPose.js';
import { TAU, clamp, lerp, smooth, angleDiff, approach, qYawPitchRoll } from './Kit.js';

// Gulls, terns, pelicans and frigatebirds.
//
//   gulls        roam the bay (flap / glide, circling on updrafts), perch on the pier rails, the
//                fishing huts and the moored boat, loaf in small groups on the beach; they take
//                off when someone walks up, circle and settle again somewhere else
//   terns        patrol beyond the surf, hover into the wind and plunge for fish
//   pelicans     a line skimming the swell in ground effect (flap bouts ripple down the line),
//                foragers that circle, twist into a plunge dive with a splash, float and take off
//                again, and a few resting on the pier head
//   frigatebirds soar high over the bay and the island on motionless, crooked wings
//
// Every bird is a Flyer (Flight.js) while airborne; perched / floating poses are set here.

const DECK = WORLD.pier.deckHeight;
const RAIL_TOP = DECK + 0.95 + 0.0445;
const _v = new THREE.Vector3(), _w = new THREE.Vector3();

// flight initiation distances (m) by species when walking up to them
const FLUSH = { [ BIRD.GULL ]: 7, [ BIRD.PELICAN ]: 5.5, [ BIRD.TERN ]: 9 };

export class Birds {

	constructor( { terrain, village, colliders, boat, boatModel, water, spray, seed = 11 } ) {

		this.terrain = terrain;
		this.boat = boat;
		this.boatModel = boatModel;
		this.water = water; // water height service (Wildlife)
		this.spray = spray;
		this.rng = mulberry32( seed );
		this.time = 0;
		this.agents = [];
		this.perches = this.buildPerches( village, colliders );
		this.wind = new THREE.Vector2();

		const rng = this.rng;
		const add = ( kind, species, init ) => {

			const f = new Flyer( species, rng(), mulberry32( Math.floor( rng() * 1e9 ) ) );
			const a = { kind, f, state: 'fly', t: 0, perch: null, id: this.agents.length, hy: 0, hp: 0, hyT: 0, hpT: 0, headT: 0, visible: true };
			init( a );
			this.agents.push( a );
			return a;

		};

		// ---- gulls: perched on the pier and the huts, a loafing group on the beach, a few aloft
		const gullPerches = this.perches.filter( ( p ) => p.kinds.includes( 'gull' ) && p.kind !== 'sand' );
		for ( let i = 0; i < 7; i ++ ) add( 'gull', BIRD.GULL, ( a ) => this.settle( a, gullPerches[ Math.floor( i * gullPerches.length / 7 ) ] ) );
		const sand = this.perches.filter( ( p ) => p.kind === 'sand' );
		for ( let i = 0; i < 4 && i < sand.length; i ++ ) add( 'gull', BIRD.GULL, ( a ) => this.settle( a, sand[ i ] ) );
		for ( let i = 0; i < 4; i ++ ) add( 'gull', BIRD.GULL, ( a ) => this.startRoam( a, - 60 + rng() * 200, 10 + rng() * 25, - 40 + rng() * 100 ) );

		// ---- terns
		for ( let i = 0; i < 4; i ++ ) add( 'tern', BIRD.TERN, ( a ) => {

			a.lane = { x0: - 150 + i * 30, x1: 120 + i * 25, z: - 10 + i * 18 + rng() * 10, y: 8 + rng() * 4 };
			a.f.place( lerp( a.lane.x0, a.lane.x1, rng() ), a.lane.y, a.lane.z, rng() < 0.5 ? Math.PI / 2 : - Math.PI / 2 );
			a.state = 'patrol';
			a.t = 4 + rng() * 8;

		} );

		// ---- pelicans: a line skimming the swell, foragers, and resting birds on the pier head
		this.squad = [];
		this.squadPath = this.buildSquadPath();
		this.squadS = rng() * this.squadPath.length; // leader's distance along the loop
		for ( let i = 0; i < 5; i ++ ) this.squad.push( add( 'pelican', BIRD.PELICAN, ( a ) => {

			a.state = 'line';
			a.slot = i;

		} ) );
		this.squadFlap = 3;
		for ( let i = 0; i < 2; i ++ ) add( 'pelican', BIRD.PELICAN, ( a ) => this.startForage( a, 20 + i * 60, 35 + i * 20 ) );
		const pelPerches = this.perches.filter( ( p ) => p.kinds.includes( 'pelican' ) && ! p.bird );
		for ( let i = 0; i < 2 && i < pelPerches.length; i ++ ) add( 'pelican', BIRD.PELICAN, ( a ) => this.settle( a, pelPerches[ i ] ) );

		// ---- frigatebirds: circling high on the wind
		const circles = [ [ - 70, - 170, 120 ], [ 90, - 260, 160 ], [ 170, - 110, 95 ], [ 10, 40, 75 ], [ - 160, - 60, 135 ] ];
		for ( const c of circles ) add( 'frigate', BIRD.FRIGATE, ( a ) => {

			a.state = 'soar';
			a.home = { x: c[ 0 ], z: c[ 1 ] };
			a.circle = { x: c[ 0 ], y: c[ 2 ], z: c[ 1 ], r: 35 + rng() * 35, dir: rng() < 0.5 ? - 1 : 1, t: rng() * 100 };
			a.f.windK = 0.6;
			const ang = rng() * TAU;
			a.f.place( c[ 0 ] + Math.cos( ang ) * 40, c[ 2 ], c[ 1 ] + Math.sin( ang ) * 40, ang );

		} );

		for ( const a of this.agents ) a.f.P.fresh = true;

	}

	// ------------------------------------------------------------------ perches

	buildPerches( village, colliders ) {

		const P = [];
		const rng = this.rng;
		const add = ( x, y, z, kind, kinds, extra = {} ) => P.push( { x, y, z, kind, kinds, bird: null, yawJitter: ( rng() - 0.5 ) * 0.8, ...extra } );

		// pier rails: walkway (runs along z) and the T-head
		if ( colliders ) {

			const rails = colliders.boxes.filter( ( b ) => b.tag === 'pierRail' );
			const used = [];
			for ( const r of rails ) {

				const alongZ = r.half.z > r.half.x;
				const len = ( alongZ ? r.half.z : r.half.x ) * 2;
				for ( let k = 0; k < Math.max( 1, Math.floor( len / 3 ) ); k ++ ) {

					const t = ( k + 0.5 ) / Math.max( 1, Math.floor( len / 3 ) ) - 0.5;
					const x = r.center.x + ( alongZ ? 0 : t * len ), z = r.center.z + ( alongZ ? t * len : 0 );
					if ( used.some( ( u ) => Math.hypot( u[ 0 ] - x, u[ 1 ] - z ) < 6.5 ) ) continue;
					used.push( [ x, z ] );
					const head = z > WORLD.pier.zEnd - WORLD.pier.headDepth - 1;
					add( x, RAIL_TOP, z, 'rail', head ? [ 'gull', 'pelican' ] : [ 'gull' ] );

				}

			}

		}

		// ridges of the stilt huts by the pier
		if ( village && village.buildings ) {

			for ( const b of village.buildings ) {

				if ( ! b.stilts || ! b.roofTop ) continue;
				add( b.x, b.roofTop - 0.13, b.z, 'roof', [ 'gull' ] );

			}

		}

		// the moored boat's wheelhouse roof (follows the boat)
		if ( this.boat && this.boatModel && this.boatModel.dimensions ) {

			const local = new THREE.Vector3( - 0.5, this.boatModel.dimensions.houseRoofHeight, 0.15 );
			add( 0, 0, 0, 'boat', [ 'gull' ], { local } );

		}

		// loafing spots on the beach, just above the reach of the swash
		const T = this.terrain;
		for ( const x0 of [ - 38, - 31, - 35, - 27, 118, 124 ] ) {

			const x = x0 + ( rng() - 0.5 ) * 2;
			let z = - 60;
			for ( ; z < - 20; z += 0.25 ) if ( T.heightAt( x, z ) < 1.05 ) break;
			z -= 1.2 + rng() * 2.5;
			add( x, T.heightAt( x, z ), z, 'sand', [ 'gull' ] );

		}

		return P;

	}

	perchPosition( p, out ) {

		if ( p.kind === 'boat' ) {

			this.boat.toWorld( p.local, out );
			return out;

		}

		return out.set( p.x, p.y, p.z );

	}

	// ------------------------------------------------------------------ state changes

	settle( a, p ) {

		if ( ! p ) {

			this.startRoam( a, 0, 20, 0 );
			return;

		}

		a.state = 'perched';
		a.perch = p;
		p.bird = a;
		a.t = 20 + this.rng() * 120; // until it gets restless
		a.fold = 1;
		a.perchYaw = this.windYaw() + p.yawJitter;
		a.shuffle = 0;
		a.stretch = 0;
		a.f.P.fresh = true;

	}

	unperch( a ) {

		if ( a.perch ) a.perch.bird = null;
		a.perch = null;

	}

	startRoam( a, x, y, z ) {

		a.state = 'fly';
		a.goal = { x, y, z };
		a.t = 10 + this.rng() * 20;
		if ( a.f.P.fresh ) a.f.place( x, y, z, this.rng() * TAU );

	}

	startForage( a, x, z ) {

		a.state = 'forage';
		a.center = { x, z, y: 11 + this.rng() * 5, r: 25 + this.rng() * 20, dir: this.rng() < 0.5 ? 1 : - 1 };
		a.t = 15 + this.rng() * 25;
		if ( a.f.P.fresh ) a.f.place( x + a.center.r, a.center.y, z, 0 );

	}

	// flee from (ux, uz): open the wings, jump into the wind / away and climb out
	takeOff( a, ux, uz ) {

		const f = a.f;
		const P = f.P;
		const away = Math.atan2( ux, uz );
		const into = this.windYaw();
		// between straight away and into the wind (birds take off into the wind when they can)
		const yaw = away + clamp( angleDiff( into, away ), - 0.9, 0.9 );
		f.x = P.pos[ 0 ]; f.y = P.pos[ 1 ]; f.z = P.pos[ 2 ];
		f.yaw = yaw;
		f.speed = f.cfg.minSpeed * 0.55;
		f.vy = 1.6;
		f.bank = 0;
		f.pitch = 0.5;
		f.flap = 1;
		f.phase = 0.2;
		f.fold = a.fold;
		f.legs = 1;
		a.state = 'takeoff';
		a.t = 0;
		this.unperch( a );

	}

	windYaw() {

		// facing into the wind
		return Math.atan2( - this.wind.x, - this.wind.y );

	}

	// ------------------------------------------------------------------ update

	update( dt, viewer, batch, camera ) {

		this.time += dt;
		this.lastViewer = viewer;
		this.wind.set( G.windDir.value.x, G.windDir.value.y ).multiplyScalar( G.windSpeed.value );
		const day = 1 - G.night.value;
		this.updateSquad( dt );
		for ( const a of this.agents ) {

			switch ( a.kind ) {

				case 'gull': this.updateGull( a, dt, viewer, day ); break;
				case 'tern': this.updateTern( a, dt, viewer ); break;
				case 'pelican': this.updatePelican( a, dt, viewer ); break;
				case 'frigate': this.updateFrigate( a, dt ); break;

			}

		}

		// draw: everything within its draw distance, shrinking away the last stretch
		const cp = camera.position;
		for ( const a of this.agents ) {

			if ( ! a.visible ) continue;
			const P = a.f.P;
			const d = Math.hypot( P.pos[ 0 ] - cp.x, P.pos[ 1 ] - cp.y, P.pos[ 2 ] - cp.z );
			const far = a.kind === 'frigate' ? 1400 : a.kind === 'pelican' ? 800 : 550;
			if ( d > far ) continue;
			const k = a.f.scale0 || ( a.f.scale0 = P.scale );
			P.scale = k * smooth( far, far * 0.8, d );
			batch.write( P );
			P.scale = k;

		}

	}

	// threat from the viewer: distance and closing speed
	threat( viewer, x, y, z ) {

		if ( ! viewer ) return 1e9;
		const d = Math.hypot( viewer.x - x, ( viewer.y - y ) * 0.7, viewer.z - z );
		return d - viewer.speed * 0.6;

	}

	// head saccades while standing: quick turns toward something new every so often
	idleHead( a, dt, pitch0 = 0, range = 1.1 ) {

		a.headT -= dt;
		if ( a.headT <= 0 ) {

			a.headT = 0.4 + this.rng() * 2.2;
			a.hyT = ( this.rng() - 0.5 ) * 2 * range;
			a.hpT = pitch0 + ( this.rng() - 0.5 ) * 0.3;

		}

		a.hy += ( a.hyT - a.hy ) * approach( 14, dt );
		a.hp += ( a.hpT - a.hp ) * approach( 14, dt );

	}

	// standing on a perch / the sand: idle head, the odd shuffle, a wing stretch now and then
	perchedPose( a, dt ) {

		const f = a.f, P = f.P, sp = f.sp;
		if ( P.fresh ) resetPrevious( P );
		else storePrevious( P );
		const p = this.perchPosition( a.perch, _v );
		// turn to face into the wind, in a few shuffling steps
		const want = this.windYaw() + a.perch.yawJitter;
		const err = angleDiff( want, a.perchYaw );
		a.shuffle = Math.max( 0, a.shuffle - dt );
		if ( Math.abs( err ) > 0.5 && a.shuffle <= 0 ) a.shuffle = 0.6;
		let phase = 0, stride = 0;
		if ( a.shuffle > 0 ) {

			a.perchYaw += err * approach( 5, dt );
			phase = a.shuffle * 18;
			stride = sp.legs.toe * 0.8;

		}

		const isPel = f.species === BIRD.PELICAN;
		const yawBoat = a.perch.kind === 'boat' ? this.boatYaw() : 0;
		const h = standHeight( sp ) * ( isPel ? 0.92 : 1 );
		groundPose( P, p.x, p.y, p.z, a.perchYaw + yawBoat, isPel ? 0.12 : 0.24, h, phase, stride, sp.legs.toe * 0.3 );
		this.idleHead( a, dt, isPel ? 0.75 : - 0.12, isPel ? 0.6 : 1.2 );
		const L = sp.length;
		setHead( P, a.hy, a.hp, 0, ( isPel ? - 0.02 : 0.03 ) * L, ( isPel ? - 0.04 : 0.01 ) * L );

		// wings: folded; stretched up for a moment now and then (and just after landing)
		a.stretch = Math.max( 0, a.stretch - dt );
		if ( a.stretch <= 0 && this.rng() < dt / 90 ) a.stretch = 1.6;
		const s = Math.sin( Math.PI * clamp( a.stretch / 1.6, 0, 1 ) );
		a.fold = Math.min( 1, a.fold + dt * 2.5 );
		P.fold = a.fold * ( 1 - s * 0.85 );
		setWings( P, 0.2 + s * 0.9, - 0.2 * s, 0.1, 0.5 - s * 0.3, 0.6 - s * 0.4, 0.1 );
		P.tailPitch = 0.12;
		P.tailSpread = 0.9;
		f.x = P.pos[ 0 ]; f.y = P.pos[ 1 ]; f.z = P.pos[ 2 ];

	}

	boatYaw() {

		const q = this.boat.quaternion;
		return Math.atan2( 2 * ( q.w * q.y + q.x * q.z ), 1 - 2 * ( q.y * q.y + q.x * q.x ) );

	}

	// scripted take-off: wings open, a hop, hard flapping; then normal flight
	takeoffStep( a, dt, then ) {

		const f = a.f;
		a.t += dt;
		f.fold = Math.max( 0, 1 - a.t / 0.18 );
		f.legs = Math.max( 0, 1 - a.t / 0.7 );
		f.extraPitch = 0.35 * Math.max( 0, 1 - a.t / 0.9 );
		const fx = Math.sin( f.yaw ), fz = Math.cos( f.yaw );
		f.steer( dt, f.x + fx * 30, f.y + 6, f.z + fz * 30, f.cfg.speed, 2, 0.2, this.wind );
		f.animate( dt );
		if ( a.t > 1.1 ) {

			f.extraPitch = 0;
			f.legs = 0;
			f.fold = 0;
			then();

		}

	}

	// landing on a perch along a curve from the current flight state
	beginLanding( a, p ) {

		const f = a.f;
		const q = this.perchPosition( p, _w );
		const h = standHeight( f.sp ) * ( f.species === BIRD.PELICAN ? 0.92 : 1 );
		const dist = Math.hypot( q.x - f.x, q.y + h - f.y, q.z - f.z );
		const T = clamp( dist / Math.max( 4, f.speed ) * 1.7, 1.2, 4 );
		a.land = { x0: f.x, y0: f.y, z0: f.z, vx: f.vx, vy: f.vy, vz: f.vz, T, h };
		a.state = 'land';
		a.t = 0;
		a.perch = p;
		p.bird = a;

	}

	landStep( a, dt ) {

		const f = a.f, L = a.land;
		a.t += dt;
		const s = Math.min( 1, a.t / L.T );
		const q = this.perchPosition( a.perch, _w );
		const x1 = q.x, y1 = q.y + L.h, z1 = q.z;
		// cubic Hermite: arrive with a small velocity along the approach direction
		const h00 = 2 * s * s * s - 3 * s * s + 1, h10 = s * s * s - 2 * s * s + s, h01 = - 2 * s * s * s + 3 * s * s, h11 = s * s * s - s * s;
		const d00 = 6 * s * s - 6 * s, d10 = 3 * s * s - 4 * s + 1, d01 = - 6 * s * s + 6 * s, d11 = 3 * s * s - 2 * s;
		const T = L.T;
		const ex = ( x1 - L.x0 ) * 0.05, ez = ( z1 - L.z0 ) * 0.05;
		f.x = h00 * L.x0 + h10 * T * L.vx + h01 * x1 + h11 * T * ex;
		f.y = h00 * L.y0 + h10 * T * L.vy + h01 * y1 + h11 * T * 0.2;
		f.z = h00 * L.z0 + h10 * T * L.vz + h01 * z1 + h11 * T * ez;
		const vx = ( d00 * L.x0 + d10 * T * L.vx + d01 * x1 + d11 * T * ex ) / T;
		const vy = ( d00 * L.y0 + d10 * T * L.vy + d01 * y1 + d11 * T * 0.2 ) / T;
		const vz = ( d00 * L.z0 + d10 * T * L.vz + d01 * z1 + d11 * T * ez ) / T;
		const hs = Math.hypot( vx, vz );
		if ( hs > 0.3 ) {

			const yaw = Math.atan2( vx, vz );
			const dy = angleDiff( yaw, f.yaw );
			f.bank += ( clamp( dy / Math.max( dt, 1e-3 ) * hs / 9.81, - 0.6, 0.6 ) - f.bank ) * approach( 6, dt );
			f.yaw = yaw;

		}

		f.vx = vx; f.vy = vy; f.vz = vz;
		f.speed = Math.hypot( hs, vy );
		f.gamma = Math.atan2( vy, Math.max( hs, 0.1 ) );
		// flare: braking pose, legs forward, quick shallow beats in the last second
		f.flare = smooth( 0.45, 0.9, s );
		f.legs = smooth( 0.3, 0.75, s );
		f.flapWant = s > 0.55 ? 0.6 : 0.15;
		f.animate( dt );
		if ( s >= 1 ) {

			const p = a.perch;
			a.state = 'perched';
			a.t = 25 + this.rng() * 120;
			a.fold = 0;
			a.stretch = 0.8; // wings held up a moment after touching down
			a.perchYaw = f.yaw;
			f.flare = 0;
			f.legs = 0;
			p.bird = a;

		}

	}

	// ------------------------------------------------------------------ gulls

	updateGull( a, dt, viewer, day ) {

		const f = a.f;
		switch ( a.state ) {

			case 'perched': {

				this.perchedPose( a, dt );
				const P = f.P;
				const th = this.threat( viewer, P.pos[ 0 ], P.pos[ 1 ], P.pos[ 2 ] );
				const flush = FLUSH[ BIRD.GULL ] * ( a.perch.kind === 'sand' ? 1.6 : 1 );
				const boatGone = a.perch.kind === 'boat' && ( this.boat.driven || this.boat.speed > 0.8 );
				a.t -= dt * day;
				if ( th < flush || boatGone ) {

					a.alarm = ( a.alarm || 0 ) + dt;
					if ( a.alarm > 0.15 + ( a.id % 5 ) * 0.07 ) this.takeOff( a, P.pos[ 0 ] - ( viewer ? viewer.x : P.pos[ 0 ] ), P.pos[ 2 ] - ( viewer ? viewer.z : P.pos[ 2 ] + 1 ) );

				} else if ( a.t <= 0 ) {

					this.takeOff( a, Math.sin( a.perchYaw ), Math.cos( a.perchYaw ) );

				} else a.alarm = 0;

				break;

			}

			case 'takeoff':
				this.takeoffStep( a, dt, () => {

					// flushed beach gulls hop along the beach; others go roaming
					a.state = 'fly';
					a.t = 12 + this.rng() * 25;
					a.goal = { x: f.x + Math.sin( f.yaw ) * 60, y: f.y + 8 + this.rng() * 10, z: f.z + Math.cos( f.yaw ) * 60 };

				} );
				break;

			case 'fly': {

				a.t -= dt;
				const g = a.goal;
				const d = Math.hypot( g.x - f.x, g.z - f.z );
				if ( d < 12 || a.t <= 0 ) {

					// next: another waypoint, a spell of circling on an updraft, or a perch
					const r = this.rng();
					if ( r < 0.3 || day < 0.3 ) {

						const p = this.pickPerch( a, viewer, day < 0.3 );
						if ( p ) {

							a.state = 'approach';
							a.perch = p;
							p.bird = a;
							break;

						}

					}

					if ( r < 0.6 ) {

						a.state = 'circle';
						a.circle = { x: f.x + ( this.rng() - 0.5 ) * 30, z: f.z + ( this.rng() - 0.5 ) * 30, r: 14 + this.rng() * 14, dir: this.rng() < 0.5 ? - 1 : 1, y: f.y };
						a.t = 10 + this.rng() * 20;
						break;

					}

					this.newGullGoal( a );

				}

				this.flyTo( a, dt, g.x, g.y, g.z, f.cfg.speed, 1 );
				break;

			}

			case 'circle': {

				// soaring in circles on an updraft, wings held still, drifting and gaining height
				a.t -= dt;
				const c = a.circle;
				c.x += this.wind.x * 0.25 * dt;
				c.z += this.wind.y * 0.25 * dt;
				c.y = Math.min( c.y + dt * 0.5, 45 );
				const ang = Math.atan2( f.z - c.z, f.x - c.x ) + c.dir * 0.6;
				this.flyTo( a, dt, c.x + Math.cos( ang ) * c.r, c.y, c.z + Math.sin( ang ) * c.r, f.cfg.speed * 0.9, 0, 1.6 );
				if ( a.t <= 0 ) {

					a.state = 'fly';
					a.t = 15 + this.rng() * 20;
					this.newGullGoal( a );

				}

				break;

			}

			case 'approach': {

				// come in from downwind of the perch, a few metres above it
				const q = this.perchPosition( a.perch, _v );
				const wx = - this.wind.x, wz = - this.wind.y;
				const wl = Math.hypot( wx, wz ) || 1;
				const ax = q.x - wx / wl * 16, az = q.z - wz / wl * 16;
				const d = Math.hypot( ax - f.x, az - f.z );
				const busy = this.threat( viewer, q.x, q.y, q.z ) < FLUSH[ BIRD.GULL ] * 2.5 || ( a.perch.kind === 'boat' && this.boat.driven );
				if ( busy ) {

					this.unperch( a );
					a.state = 'fly';
					this.newGullGoal( a );
					break;

				}

				if ( d < 5 ) this.beginLanding( a, a.perch );
				else this.flyTo( a, dt, ax, q.y + 2.5, az, f.cfg.speed * 0.85, 1 );
				break;

			}

			case 'land':
				this.landStep( a, dt );
				break;

		}

	}

	newGullGoal( a, viewer = this.lastViewer ) {

		const r = this.rng;
		// mostly over the beach and the bay, now and then along the shore at low level, and often
		// somewhere near the people on the beach (gulls know where food comes from)
		const k = r();
		if ( viewer && k < 0.35 ) a.goal = { x: viewer.x + ( r() - 0.5 ) * 70, y: 7 + r() * 12, z: Math.max( viewer.z + ( r() - 0.5 ) * 50, - 75 ) };
		else if ( k < 0.6 ) a.goal = { x: - 120 + r() * 280, y: 4 + r() * 5, z: - 38 + r() * 12 };
		else a.goal = { x: - 150 + r() * 380, y: 8 + r() * 30, z: - 70 + r() * 190 };
		a.t = 20 + r() * 20;

	}

	pickPerch( a, viewer, roost ) {

		let best = null, bestS = - Infinity;
		for ( const p of this.perches ) {

			if ( p.bird || ! p.kinds.includes( a.kind ) ) continue;
			if ( p.kind === 'boat' && ( this.boat.driven || this.boat.speed > 0.5 ) ) continue;
			const q = this.perchPosition( p, _v );
			if ( this.threat( viewer, q.x, q.y, q.z ) < 18 ) continue;
			const d = Math.hypot( q.x - a.f.x, q.z - a.f.z );
			const s = - d * 0.01 + this.rng() * 2 + ( roost && p.kind !== 'sand' ? 1 : 0 );
			if ( s > bestS ) {

				bestS = s;
				best = p;

			}

		}

		return best;

	}

	// fly toward a point, keeping clear of the ground and of the viewer's head
	flyTo( a, dt, x, y, z, speed, power, turn = 1 ) {

		const f = a.f;
		const lx = f.x + f.vx * 2, lz = f.z + f.vz * 2;
		const ground = Math.max( this.terrain.heightAt( lx, lz ), this.terrain.heightAt( f.x, f.z ), 0 );
		const minY = ground + ( ground > 0.5 ? 6 : 2 );
		f.steer( dt, x, Math.max( y, minY ), z, speed, power, turn, this.wind );
		if ( f.y < minY - 1.5 ) f.y += ( minY - 1.5 - f.y ) * approach( 3, dt );
		f.animate( dt );

	}

	// ------------------------------------------------------------------ terns

	updateTern( a, dt, viewer ) {

		const f = a.f, L = a.lane;
		const wh = this.water.height( a, f.x, f.z );
		switch ( a.state ) {

			case 'patrol': {

				// back and forth along the lane, looking down for fish
				a.t -= dt;
				if ( f.x > L.x1 ) a.dir = - 1;
				else if ( f.x < L.x0 ) a.dir = 1;
				a.dir = a.dir || 1;
				f.headPitch += ( 0.7 - f.headPitch ) * approach( 3, dt );
				this.flyTo( a, dt, f.x + a.dir * 40, L.y + Math.sin( this.time * 0.4 + a.id ) * 1.5, L.z + Math.sin( this.time * 0.13 + a.id * 2 ) * 12, f.cfg.speed, 1, 0.8 );
				if ( a.t <= 0 ) {

					a.state = 'hover';
					a.t = 1.5 + this.rng() * 2.5;

				}

				break;

			}

			case 'hover': {

				// kiting into the wind: air speed ~ wind speed, fast shallow beats, tail fanned
				a.t -= dt;
				f.hover += ( 1 - f.hover ) * approach( 4, dt );
				const into = this.windYaw();
				const ws = Math.max( this.wind.length(), 3 );
				const tx = f.x + Math.sin( into ) * 10, tz = f.z + Math.cos( into ) * 10;
				f.windK = 1;
				f.steer( dt, tx, f.y, tz, ws * 0.95, 1, 1.5, this.wind );
				// cancel the remaining drift
				f.x -= ( f.vx ) * dt * 0.85;
				f.z -= ( f.vz ) * dt * 0.85;
				f.flapWant = 0.7;
				f.headPitch += ( 1.1 - f.headPitch ) * approach( 5, dt );
				f.animate( dt );
				if ( a.t <= 0 ) {

					f.windK = 0.35;
					if ( this.rng() < 0.45 ) {

						a.state = 'dive';
						a.t = 0;

					} else {

						a.state = 'patrol';
						a.t = 5 + this.rng() * 10;
						f.hover = 0;

					}

				}

				break;

			}

			case 'dive': {

				// plunge: wings swept back, steep, straight down into the water
				a.t += dt;
				f.hover = Math.max( 0, f.hover - dt * 4 );
				f.dive += ( 1 - f.dive ) * approach( 6, dt );
				f.flapWant = 0;
				f.speed = Math.min( 14, f.speed + 15 * dt );
				f.vy = - f.speed * 0.85;
				f.gamma = - 1.1;
				f.x += Math.sin( f.yaw ) * f.speed * 0.3 * dt;
				f.z += Math.cos( f.yaw ) * f.speed * 0.3 * dt;
				f.y += f.vy * dt;
				f.animate( dt );
				if ( f.y < wh + 0.05 ) {

					this.splash( f.x, wh, f.z, 0.35 );
					a.state = 'under';
					a.t = 0.35 + this.rng() * 0.3;
					a.visible = false;

				}

				break;

			}

			case 'under':
				a.t -= dt;
				f.y = wh - 0.3;
				if ( a.t <= 0 ) {

					// burst out of the water and climb away
					a.visible = true;
					f.P.fresh = true;
					f.dive = 0;
					f.y = wh + 0.05;
					f.speed = 4;
					f.vy = 2.5;
					f.pitch = 0.6;
					f.flap = 1.2;
					this.splash( f.x, wh, f.z, 0.15 );
					a.state = 'patrol';
					a.t = 6 + this.rng() * 10;

				}

				break;

		}

	}

	splash( x, y, z, k ) {

		if ( ! this.spray ) return;
		const s = this.spray;
		_v.set( x, y + 0.05, z );
		s.emit( _v, _w.set( 0, 3.5 * Math.sqrt( k ), 0 ), Math.round( 110 * k ), 0.03 + 0.02 * k, SPRAY.DROPLET, { spread: 1.6 + k * 1.5, jitter: 0.12 + 0.3 * k, life: 1.3 } );
		s.emit( _v, _w.set( 0, 2.2 * Math.sqrt( k ), 0 ), Math.round( 35 * k ), 0.08 + 0.1 * k, SPRAY.SPRAY, { spread: 0.9 + k, jitter: 0.15 + 0.3 * k, life: 1.1 } );
		s.emit( _v, _w.set( 0, 0.2, 0 ), Math.round( 18 * k ) + 2, 0.12 + 0.25 * k, SPRAY.FOAM, { spread: 0.5 + 0.6 * k, jitter: 0.1 + 0.4 * k, life: 3 } );
		if ( k > 0.5 ) s.emit( _v, _w.set( 0, 0.8, 0 ), 10, 0.35, SPRAY.MIST, { spread: 0.6, jitter: 0.5, life: 2.2 } );

	}

	// ------------------------------------------------------------------ pelicans

	buildSquadPath() {

		// closed loop: skimming leg along the swell just outside the break, a wide turn out to sea,
		// a higher return leg further out and back in (points: x, z, height above the water)
		const pts = [];
		// up and over the pier
		const pier = ( x ) => 5.8 * Math.exp( - Math.pow( ( x - WORLD.pier.x ) / 11, 2 ) );
		const leg = ( x0, x1, z, h, n ) => {

			for ( let i = 0; i <= n; i ++ ) {

				const x = lerp( x0, x1, i / n );
				pts.push( [ x, z + Math.sin( i * 0.9 ) * 3, h + ( z < 45 ? pier( x ) : 0 ) ] );

			}

		};

		leg( - 210, 230, 16, 1.1, 30 );
		for ( let i = 1; i < 8; i ++ ) {

			const a = - Math.PI / 2 + i / 8 * Math.PI;
			pts.push( [ 230 + Math.cos( a ) * 50, 66 + Math.sin( a ) * 50, 1.1 + i * 0.6 ] );

		}

		leg( 230, - 210, 116, 5, 22 );
		for ( let i = 1; i < 8; i ++ ) {

			const a = Math.PI / 2 + i / 8 * Math.PI;
			pts.push( [ - 210 + Math.cos( a ) * 50, 66 + Math.sin( a ) * 50, 5 - i * 0.55 ] );

		}

		const curve = new THREE.CatmullRomCurve3( pts.map( ( p ) => new THREE.Vector3( p[ 0 ], p[ 2 ], p[ 1 ] ) ), true, 'centripetal' );
		const length = curve.getLength();
		return { curve, length, pt: new THREE.Vector3(), tan: new THREE.Vector3() };

	}

	// the leader flies the loop; the others follow in its track, spaced out in time, flapping in
	// the same rhythm a moment later
	updateSquad( dt ) {

		const path = this.squadPath;
		const speed = 11;
		this.squadS = ( this.squadS + speed * dt ) % path.length;
		this.squadFlap -= dt;
		if ( this.squadFlap <= 0 ) {

			this.squadFlap = 5 + this.rng() * 7;
			this.squadBeat = this.time; // flap bout starts now at the leader
			this.squadBeats = 3 + Math.floor( this.rng() * 4 );

		}

	}

	squadMember( a, dt ) {

		const path = this.squadPath, f = a.f;
		const gap = 2.9 + ( a.slot % 2 ) * 0.4;
		let s = ( this.squadS - a.slot * gap + path.length ) % path.length;
		path.curve.getPointAt( s / path.length, path.pt );
		path.curve.getTangentAt( s / path.length, path.tan );
		const side = ( a.slot % 2 ? 1 : - 1 ) * Math.min( a.slot, 1 ) * 0.9;
		const tx = path.tan.x, tz = path.tan.z;
		const tl = Math.hypot( tx, tz ) || 1;
		const x = path.pt.x - tz / tl * side, z = path.pt.z + tx / tl * side;
		const wh = this.water.height( a, x, z );
		const y = Math.max( wh, 0 ) * 0.8 + path.pt.y + Math.sin( this.time * 0.7 + a.slot ) * 0.15;
		if ( f.P.fresh ) f.place( x, y, z, Math.atan2( tx, tz ) );
		const vx = ( x - f.x ) / Math.max( dt, 1e-4 ), vz = ( z - f.z ) / Math.max( dt, 1e-4 ), vy = ( y - f.y ) / Math.max( dt, 1e-4 );
		const yaw = Math.atan2( tx, tz );
		const rate = angleDiff( yaw, f.yaw ) / Math.max( dt, 1e-4 );
		f.bank += ( clamp( rate * 11 / 9.81, - 0.5, 0.5 ) - f.bank ) * approach( 3, dt );
		f.yaw = yaw;
		f.x = x; f.y = y; f.z = z;
		f.vx = vx; f.vz = vz; f.vy = clamp( vy, - 3, 3 );
		f.gamma = Math.atan2( f.vy, 11 );
		// flap bout travelling down the line
		const since = this.time - ( this.squadBeat ?? - 1e3 ) - a.slot * 0.38;
		const beats = this.squadBeats || 0;
		f.flapWant = since > 0 && since < beats / f.cfg.freq ? 0.8 : 0;
		if ( since > 0 && since < 0.1 ) f.phase = 0;
		f.animate( dt );

	}

	updatePelican( a, dt, viewer ) {

		const f = a.f;
		switch ( a.state ) {

			case 'line':
				this.squadMember( a, dt );
				break;

			case 'perched': {

				this.perchedPose( a, dt );
				const P = f.P;
				const th = this.threat( viewer, P.pos[ 0 ], P.pos[ 1 ], P.pos[ 2 ] );
				a.t -= dt;
				if ( th < FLUSH[ BIRD.PELICAN ] ) {

					a.alarm = ( a.alarm || 0 ) + dt;
					if ( a.alarm > 0.3 ) this.takeOff( a, P.pos[ 0 ] - viewer.x, P.pos[ 2 ] - viewer.z );

				} else a.alarm = 0;
				if ( a.t <= 0 && a.state === 'perched' ) this.takeOff( a, Math.sin( a.perchYaw ), Math.cos( a.perchYaw ) );
				break;

			}

			case 'takeoff':
				this.takeoffStep( a, dt, () => this.startForage( a, f.x + Math.sin( f.yaw ) * 40, f.z + Math.cos( f.yaw ) * 40 ) );
				break;

			case 'forage': {

				// circling over the bay, 10-16 m up, looking for fish
				a.t -= dt;
				const c = a.center;
				const ang = Math.atan2( f.z - c.z, f.x - c.x ) + c.dir * 0.5;
				f.headPitch += ( 0.35 - f.headPitch ) * approach( 2, dt );
				this.flyTo( a, dt, c.x + Math.cos( ang ) * c.r, c.y, c.z + Math.sin( ang ) * c.r, f.cfg.speed * 0.9, 1, 1.2 );
				if ( a.t <= 0 ) {

					if ( this.rng() < 0.6 ) {

						a.state = 'dive';
						a.t = 0;
						a.twist = ( this.rng() < 0.5 ? - 1 : 1 );

					} else {

						const p = this.pickPerch( a, viewer, false );
						if ( p ) {

							a.state = 'approach';
							a.perch = p;
							p.bird = a;

						} else this.startForage( a, - 60 + this.rng() * 200, 10 + this.rng() * 70 );

					}

				}

				break;

			}

			case 'dive': {

				// plunge: tip over, wings swept back, twisting just before impact
				a.t += dt;
				const wh = this.water.height( a, f.x, f.z );
				f.dive += ( 1 - f.dive ) * approach( 3.5, dt );
				f.flapWant = 0;
				f.speed = Math.min( 17, f.speed + 12 * dt );
				f.vy = - f.speed * Math.min( 0.9, 0.3 + a.t * 1.2 );
				f.gamma = Math.asin( clamp( f.vy / f.speed, - 0.95, 0 ) );
				const h = Math.max( f.speed * Math.cos( f.gamma ), 0 );
				f.x += Math.sin( f.yaw ) * h * dt;
				f.z += Math.cos( f.yaw ) * h * dt;
				f.y += f.vy * dt;
				f.twirl = a.twist * smooth( 3.5, 1.0, f.y - wh ) * 1.9;
				f.animate( dt );
				if ( f.y < wh + 0.3 ) {

					this.splash( f.x, wh, f.z, 1 );
					a.state = 'float';
					a.t = 0;
					a.floatYaw = f.yaw;
					f.twirl = 0;
					f.dive = 0;
					f.P.fresh = true;

				}

				break;

			}

			case 'float': {

				// bobbing on the water: bill down (draining the pouch), then up (swallowing), rest
				a.t += dt;
				const P = f.P;
				if ( P.fresh ) resetPrevious( P );
				else storePrevious( P );
				const wh = this.water.height( a, f.x, f.z );
				f.y += ( wh + 0.02 - f.y ) * approach( 6, dt );
				a.floatYaw += angleDiff( this.windYaw(), a.floatYaw ) * approach( 0.3, dt );
				f.yaw = a.floatYaw;
				qYawPitchRoll( P.q, f.yaw, 0.08 + Math.sin( this.time * 1.3 + a.id ) * 0.04, Math.sin( this.time * 0.9 + a.id ) * 0.05 );
				P.pos[ 0 ] = f.x; P.pos[ 1 ] = f.y; P.pos[ 2 ] = f.z;
				const drain = a.t < 3 ? 1.1 : a.t < 4.5 ? - 0.9 : 0.55;
				a.hp += ( drain - a.hp ) * approach( 3, dt );
				setHead( P, 0, a.hp, 0, - 0.02, - 0.03 );
				P.fold = 1;
				setWings( P, 0.2, 0, 0.1, 0.5, 0.6, 0.1 );
				tuckLegs( P );
				P.tailPitch = - 0.1;
				P.tailSpread = 0.9;
				const th = this.threat( viewer, f.x, f.y, f.z );
				if ( a.t > 10 + ( a.id % 4 ) * 3 || th < 9 ) {

					a.state = 'watertakeoff';
					a.t = 0;
					f.yaw = this.windYaw() + ( this.rng() - 0.5 ) * 0.6;
					f.speed = 1;
					f.vy = 0;
					f.pitch = 0.3;
					f.fold = 1;
					f.flap = 0.8;
					f.phase = 0.3;

				}

				break;

			}

			case 'watertakeoff': {

				// running over the water, heavy beats, splashes from the feet and wing tips
				a.t += dt;
				const wh = this.water.height( a, f.x, f.z );
				f.fold = Math.max( 0, 1 - a.t / 0.3 );
				f.speed = Math.min( 11, f.speed + dt * 4 );
				f.legs = a.t < 2 ? 1 : 0;
				f.flapWant = 1.25;
				f.x += Math.sin( f.yaw ) * f.speed * dt;
				f.z += Math.cos( f.yaw ) * f.speed * dt;
				f.vx = Math.sin( f.yaw ) * f.speed; f.vz = Math.cos( f.yaw ) * f.speed;
				const lift = smooth( 1.4, 2.6, a.t );
				f.vy = lift * 1.2;
				f.y = Math.max( f.y + f.vy * dt, wh + 0.12 );
				f.gamma = 0.1 * lift;
				f.extraPitch = 0.25 * ( 1 - lift );
				const prevPhase = f.phase;
				f.animate( dt );
				if ( lift < 0.9 && f.phase < prevPhase ) this.splash( f.x, wh, f.z, 0.12 );
				if ( a.t > 3 ) {

					f.extraPitch = 0;
					f.legs = 0;
					this.startForage( a, f.x + Math.sin( f.yaw ) * 50, f.z + Math.cos( f.yaw ) * 50 );

				}

				break;

			}

			case 'approach': {

				const q = this.perchPosition( a.perch, _v );
				const wx = - this.wind.x, wz = - this.wind.y;
				const wl = Math.hypot( wx, wz ) || 1;
				const ax = q.x - wx / wl * 22, az = q.z - wz / wl * 22;
				if ( this.threat( viewer, q.x, q.y, q.z ) < 12 ) {

					this.unperch( a );
					this.startForage( a, f.x, f.z );
					break;

				}

				if ( Math.hypot( ax - f.x, az - f.z ) < 6 ) this.beginLanding( a, a.perch );
				else this.flyTo( a, dt, ax, q.y + 3, az, f.cfg.speed * 0.85, 1 );
				break;

			}

			case 'land':
				this.landStep( a, dt );
				break;

		}

	}

	// ------------------------------------------------------------------ frigatebirds

	updateFrigate( a, dt ) {

		const f = a.f, c = a.circle;
		// the circle drifts downwind and is pulled back home; height breathes slowly
		c.t += dt;
		c.x += ( this.wind.x * 0.3 + ( a.home.x - c.x ) * 0.01 ) * dt;
		c.z += ( this.wind.y * 0.3 + ( a.home.z - c.z ) * 0.01 ) * dt;
		const y = c.y + Math.sin( c.t * 0.05 ) * 20;
		const ang = Math.atan2( f.z - c.z, f.x - c.x ) + c.dir * 0.45;
		f.headYaw += ( c.dir * 0.25 - f.headYaw ) * approach( 1, dt );
		this.flyTo( a, dt, c.x + Math.cos( ang ) * c.r, y, c.z + Math.sin( ang ) * c.r, f.cfg.speed, f.y < y - 25 ? 1 : 0, 1.4 );

	}

}
