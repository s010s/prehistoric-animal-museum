import * as THREE from '../../engine/index.js';
import { G } from '../../core/Globals.js';
import { WORLD } from '../WorldLayout.js';
import { mulberry32 } from '../../util/Noise.js';
import { BIRD } from './BirdShapes.js';
import { Flyer } from './Flight.js';
import { groundPose, setHead, setWings, standHeight, storePrevious, resetPrevious } from './BirdPose.js';
import { TAU, clamp, lerp, smooth, angleDiff, approach } from './Kit.js';

// Sanderlings working the swash: small flocks that chase the backwash down the wet sand, probing
// as they go, and scurry up the beach ahead of every uprush (the edge of the water comes from
// SwashProbe: the exact run-up the water shader draws). They run from someone walking up, and
// flush when pressed: the flock bursts up and flies off low over the surf, wheels, and lands
// further along the beach. At night they roost in a tight group above the tide line.

const SLOPE = 0.066; // ShoreWaves' nominal beach slope (run-up is measured along it)
const DRAW = 190;
const WARY = 15, FLUSH = 8; // m

const _r = { runup: 0, inland: 0, speed: 0, tau: 0, x: 0, z: 0, age: 0 };
const _p = new THREE.Vector3(), _t = new THREE.Vector3();

export class Shorebirds {

	constructor( { terrain, probe = null, seed = 17 } ) {

		this.terrain = terrain;
		this.probe = probe;
		this.rng = mulberry32( seed );
		this.time = 0;
		this.birds = [];
		this.flocks = [
			{ x: 22, range: [ - 135, WORLD.pier.x - 9 ], n: 12 },
			{ x: 115, range: [ WORLD.pier.x + 9, WORLD.beach.xMax - 8 ], n: 9 },
		];
		for ( const F of this.flocks ) {

			F.birds = [];
			F.state = 'feed';
			F.drift = this.rng() < 0.5 ? - 1 : 1;
			F.alarm = 0;
			for ( let i = 0; i < F.n; i ++ ) {

				const b = this.newBird( F, this.birds.length );
				F.birds.push( b );
				this.birds.push( b );

			}

		}

	}

	newBird( F, index ) {

		const rng = this.rng;
		const f = new Flyer( BIRD.SANDERLING, rng(), mulberry32( Math.floor( rng() * 1e9 ) ) );
		f.windK = 0.25;
		const b = {
			F, f, index, state: 'feed', x: F.x + ( rng() - 0.5 ) * 10, z: - 42, y: 0, yaw: rng() * TAU, v: 0, vx: 0, vz: 0,
			offset: ( rng() - 0.5 ) * 11, margin: rng(), phase: rng() * TAU, peck: 0, peckT: rng(), head: 0,
			stop: 0, hop: 0, fold: 1, t: 0, lx: 0, lz: 0, form: [ ( rng() - 0.5 ) * 4, ( rng() - 0.5 ) * 1.2, ( rng() - 0.5 ) * 3 ],
		};
		b.z = this.frontGuess( b.x ) - 1 - rng() * 2;
		b.y = this.terrain.heightAt( b.x, b.z );
		return b;

	}

	// the z of the sand at height h along x (the beach runs along x, the sea is at +z)
	frontGuess( x, h = 0.35 ) {

		const T = this.terrain;
		let z = - 70;
		for ( ; z < - 10; z += 0.5 ) if ( T.heightAt( x, z ) < h ) break;
		return z;

	}

	// uphill direction and slope of the beach at (x, z)
	slopeAt( x, z, out ) {

		const T = this.terrain, e = 0.6;
		const gx = ( T.heightAt( x + e, z ) - T.heightAt( x - e, z ) ) / ( 2 * e );
		const gz = ( T.heightAt( x, z + e ) - T.heightAt( x, z - e ) ) / ( 2 * e );
		const g = Math.hypot( gx, gz );
		out.set( gx / ( g || 1 ), g, gz / ( g || 1 ) );
		return out;

	}

	update( dt, viewer, batch, camera, blobs = null ) {

		this.time += dt;
		const cp = camera.position;
		const night = G.night.value;
		for ( const F of this.flocks ) {

			// nothing to do while nobody is anywhere near
			let cx = 0;
			for ( const b of F.birds ) cx += b.x;
			cx /= F.birds.length;
			F.cx = cx;
			if ( Math.hypot( cx - cp.x, - 40 - cp.z ) > DRAW + 120 ) continue;
			this.updateFlock( F, dt, viewer, night );

		}

		for ( const b of this.birds ) {

			const P = b.f.P;
			const d = Math.hypot( P.pos[ 0 ] - cp.x, P.pos[ 1 ] - cp.y, P.pos[ 2 ] - cp.z );
			if ( d > DRAW ) continue;
			const k = b.scale0 || ( b.scale0 = P.scale );
			P.scale = k * smooth( DRAW, DRAW * 0.8, d );
			batch.write( P );
			P.scale = k;
			if ( blobs && b.state !== 'fly' ) {

				const s = this.slopeAt( b.x, b.z, _t );
				blobs.add( b.x, b.y, b.z, 0.06 * k, 0.06 * k, 0.85, s.x * s.y, s.z * s.y );

			}

		}

		if ( this.probe ) this.probe.update();

	}

	updateFlock( F, dt, viewer, night ) {

		// the viewer: wary birds run off along the beach, pressed ones flush
		let threat = 1e9, running = false;
		if ( viewer && viewer.mode !== 'boat' ) {

			for ( const b of F.birds ) if ( b.state !== 'fly' ) threat = Math.min( threat, Math.hypot( b.x - viewer.x, b.z - viewer.z ) );
			running = viewer.speed > 3.5;

		}

		F.away = viewer ? Math.sign( F.cx - viewer.x ) || 1 : F.drift;
		const flush = threat < FLUSH || ( running && threat < FLUSH * 1.7 );
		if ( F.state === 'feed' && flush ) {

			F.alarm += dt;
			if ( F.alarm > 0.15 ) this.flush( F, viewer );

		} else F.alarm = Math.max( 0, F.alarm - dt );
		F.wary = threat < WARY + ( running ? 6 : 0 );

		// the flock drifts slowly along the beach
		F.x = F.x ?? F.cx;
		if ( F.state === 'feed' ) {

			if ( this.rng() < dt / 25 ) F.drift = - F.drift;
			F.x += F.drift * 0.25 * dt + ( F.wary ? F.away * 1.4 * dt : 0 );
			F.x = clamp( F.x, F.range[ 0 ] + 8, F.range[ 1 ] - 8 );

		}

		if ( F.state === 'fly' ) this.flockFlight( F, dt );
		for ( const b of F.birds ) {

			if ( b.state === 'fly' ) this.flyBird( b, dt );
			else this.groundBird( b, dt, viewer, night );

		}

		// landed again: back to feeding once everyone is down
		if ( F.state === 'fly' && F.birds.every( ( b ) => b.state !== 'fly' ) ) {

			F.state = 'feed';
			F.x = F.cx;

		}

	}

	// ------------------------------------------------------------------ on the ground

	groundBird( b, dt, viewer, night ) {

		const F = b.F, T = this.terrain;
		const s = this.slopeAt( b.x, b.z, _t );
		const ux = s.x, uz = s.z, g = Math.max( s.y, 0.015 ); // uphill
		const tx = - uz, tz = ux; // along the shore
		const h = T.heightAt( b.x, b.z );

		// where is the water's edge relative to this bird (m along the ground, > 0: bird is dry)?
		let dm = 3, vf = 0, up = false;
		const r = this.probe ? this.probe.get( b.index, _r ) : null;
		if ( r && r.age < 1.5 ) {

			const Rt = r.runup;
			const inland = Math.max( h - G.seaLevel.value, 0 ) / SLOPE;
			dm = ( inland - Rt ) * SLOPE / g;
			vf = r.speed * SLOPE / g;
			up = r.speed > 0.05;

		} else {

			// no probe (yet): keep to a fixed band of the wet sand
			dm = ( h - 0.35 ) / g;

		}

		if ( this.probe ) this.probe.set( b.index, b.x, b.z );

		// wanted position relative to the edge: just above the retreating water, well ahead of an uprush
		let want = up ? 1.0 + b.margin * 1.2 : 0.15 + b.margin * 0.55;
		if ( night > 0.6 ) want = 6 + b.margin * 1.5; // roost above the tide line
		let vUp = clamp( ( up ? vf : 0 ) + ( want - dm ) * 2.2, - 1.3, 2.4 );
		// along the shore: keep the flock together, spaced out, running off when wary
		let vAl = clamp( ( F.x + b.offset - b.x ) * 0.6, - 0.9, 0.9 );
		if ( F.wary ) vAl = F.away * ( 1.3 + b.margin * 0.5 );
		for ( const o of F.birds ) {

			if ( o === b || o.state === 'fly' ) continue;
			const dx = b.x - o.x, dz = b.z - o.z;
			const d2 = dx * dx + dz * dz;
			if ( d2 < 0.25 && d2 > 1e-6 ) {

				const d = Math.sqrt( d2 );
				vAl += ( dx * tx + dz * tz ) / d * ( 0.5 - d ) * 3;
				vUp += ( dx * ux + dz * uz ) / d * ( 0.5 - d ) * 3;

			}

		}

		// stop-and-go: quick spurts, then a pause to probe the sand (they run again when the water
		// comes, when it has drained away from them, or when the flock moves on)
		const err = want - dm;
		const caught = dm < 0.25 && up;
		b.stop = Math.max( 0, b.stop - dt );
		if ( b.stop > 0 ) {

			if ( caught || F.wary || Math.abs( err ) > 0.8 + b.margin * 0.5 || Math.abs( vAl ) > 0.7 ) b.stop = 0;

		} else if ( Math.abs( err ) < 0.3 && Math.abs( vAl ) < 0.55 && ! caught && ! F.wary ) {

			b.stop = 0.5 + this.rng() * 1.6;

		}

		const go = b.stop > 0 ? 0 : 1;
		const vx = ( ux * vUp + tx * vAl ) * go, vz = ( uz * vUp + tz * vAl ) * go;
		const k = approach( 14, dt );
		b.vx += ( vx - b.vx ) * k;
		b.vz += ( vz - b.vz ) * k;
		b.v = Math.hypot( b.vx, b.vz );
		b.x += b.vx * dt;
		b.z += b.vz * dt;
		b.x = clamp( b.x, F.range[ 0 ], F.range[ 1 ] );
		if ( b.v > 0.15 ) b.yaw += angleDiff( Math.atan2( b.vx, b.vz ), b.yaw ) * approach( 16, dt );

		// caught by the water: a flutter hop up the beach
		if ( caught && dm < - 0.35 && b.hop <= 0 ) b.hop = 0.45;
		b.hop = Math.max( 0, b.hop - dt );

		// probing: quick jabs of the bill while stopped
		b.peckT += dt * ( b.stop > 0 ? 4.5 : 0 );
		const jab = b.stop > 0 ? Math.pow( Math.max( 0, Math.sin( b.peckT * Math.PI ) ), 0.6 ) : 0;
		b.head += ( jab - b.head ) * approach( 30, dt );

		// legs: sanderlings run with a blur of tiny, very fast steps
		const f = b.v > 0.05 ? clamp( 5 + b.v * 5, 5, 14 ) : 0;
		b.phase = ( b.phase + TAU * f * dt ) % TAU;
		b.y = T.heightAt( b.x, b.z );
		this.groundPoseOf( b, dt, f > 0 ? b.v / f : 0 );

	}

	groundPoseOf( b, dt, strideLen ) {

		const f = b.f, P = f.P, sp = f.sp;
		if ( P.fresh ) resetPrevious( P );
		else storePrevious( P );
		const hop = Math.sin( Math.PI * b.hop / 0.45 );
		const H = standHeight( sp );
		const lift = strideLen > 0 ? 0.012 : 0;
		groundPose( P, b.x, b.y + hop * 0.12, b.z, b.yaw, - 0.08 * b.head + ( strideLen > 0 ? - 0.05 : 0.04 ), H, b.phase, Math.min( strideLen, 0.07 ), lift );
		setHead( P, 0, - 0.1 + b.head * 1.15, 0, - 0.006 * b.head, 0.004 * b.head );
		// wings folded; a few quick beats when hopping clear of the water
		b.fold = Math.min( 1, b.fold + dt * 4 );
		if ( hop > 0 ) {

			const ph = this.time * 60;
			setWings( P, 0.4 + Math.cos( ph ) * 0.7, 0, 0, 0.3, 0.5, 0 );
			P.fold = 1 - hop;

		} else {

			setWings( P, 0.2, 0, 0.1, 0.5, 0.6, 0.1 );
			P.fold = b.fold;

		}

		P.tailPitch = 0.05;
		P.tailSpread = 1;
		f.x = P.pos[ 0 ]; f.y = P.pos[ 1 ]; f.z = P.pos[ 2 ];

	}

	// ------------------------------------------------------------------ flight

	// the whole flock bursts up: out over the surf, along the beach, back in to land further on
	flush( F, viewer ) {

		F.state = 'fly';
		const rng = this.rng;
		const cx = F.cx;
		let dir = F.away;
		let dest = cx + dir * ( 55 + rng() * 50 );
		if ( dest < F.range[ 0 ] + 10 || dest > F.range[ 1 ] - 10 ) {

			// no room that way: swing out to sea and back past the viewer
			dir = - dir;
			dest = clamp( ( viewer ? viewer.x : cx ) + dir * ( 50 + rng() * 40 ), F.range[ 0 ] + 10, F.range[ 1 ] - 10 );

		}

		const z0 = this.frontGuess( cx ), z1 = this.frontGuess( dest );
		const mid = ( cx + dest ) / 2;
		const pts = [
			[ cx, 0.6, z0 ], [ cx + dir * 10, 2.2, z0 + 7 ], [ mid - dir * 12, 3 + rng() * 2, z0 + 14 + rng() * 8 ],
			[ mid + dir * 14, 2.5 + rng() * 2, z1 + 12 + rng() * 8 ], [ dest - dir * 12, 1.4, z1 + 4 ], [ dest, 0.4, z1 - 1.5 ],
		];
		F.path = new THREE.CatmullRomCurve3( pts.map( ( p ) => new THREE.Vector3( p[ 0 ], p[ 1 ], p[ 2 ] ) ), false, 'centripetal' );
		F.len = F.path.getLength();
		F.s = 0;
		F.dest = dest;
		for ( const b of F.birds ) {

			b.state = 'fly';
			b.t = - rng() * 0.3; // take-off spread over a moment
			b.lx = dest + b.offset * 0.8;
			b.lz = z1 - 0.5 - b.margin * 2;
			const f = b.f;
			f.x = b.x; f.y = b.y + 0.06; f.z = b.z;
			f.yaw = Math.atan2( pts[ 1 ][ 0 ] - b.x, pts[ 1 ][ 2 ] - b.z );
			f.speed = 3;
			f.vy = 1.5;
			f.flap = 0;
			f.bank = 0;
			f.pitch = 0.3;
			f.fold = 1;

		}

	}

	flockFlight( F, dt ) {

		F.s = Math.min( F.len, F.s + dt * 12.5 );
		F.path.getPointAt( F.s / F.len, _p );
		F.path.getTangentAt( F.s / F.len, _t );
		F.px = _p.x; F.py = _p.y; F.pz = _p.z;
		F.hx = _t.x; F.hz = _t.z;

	}

	flyBird( b, dt ) {

		const F = b.F, f = b.f;
		b.t += dt;
		if ( b.t < 0 ) {

			// not off yet: keep standing
			this.groundPoseOf( b, dt, 0 );
			return;

		}

		f.fold = Math.max( 0, f.fold - dt * 8 );
		const hl = Math.hypot( F.hx, F.hz ) || 1;
		const hx = F.hx / hl, hz = F.hz / hl;
		const o = b.form;
		// formation around the flock point, turned with its heading
		let tx = F.px + hx * o[ 2 ] - hz * o[ 0 ], ty = F.py + o[ 1 ] * 0.6, tz = F.pz + hz * o[ 2 ] + hx * o[ 0 ];
		const end = F.s >= F.len - 0.01;
		const dl = Math.hypot( b.lx - f.x, b.lz - f.z );
		if ( end || F.s > F.len - 14 ) {

			// final approach to its own spot
			tx = b.lx; tz = b.lz;
			ty = this.terrain.heightAt( b.lx, b.lz ) + Math.min( 1.2, dl * 0.25 );

		}

		const ahead = Math.hypot( tx - f.x, tz - f.z );
		const speed = clamp( 9 + ( ahead - 2 ) * 1.2, 5, 16 );
		f.steer( dt, tx, ty, tz, speed, b.t < 0.6 ? 2 : 1, 2.2 );
		const ground = Math.max( this.terrain.heightAt( f.x, f.z ), 0 );
		if ( f.y < ground + 0.25 ) f.y = ground + 0.25;
		f.flare = smooth( 3, 0.8, dl ) * ( end ? 1 : 0.5 );
		f.legs = smooth( 2.5, 0.8, dl );
		f.animate( dt );
		if ( dl < 0.6 && f.y < ground + 0.45 && F.s > F.len - 14 ) {

			// touch down, running on a few steps
			b.state = 'feed';
			b.x = f.x; b.z = f.z;
			b.vx = f.vx * 0.3; b.vz = f.vz * 0.3;
			b.yaw = f.yaw;
			b.fold = 0;
			f.flare = 0; f.legs = 0;
			b.stop = 0;

		}

	}

}
