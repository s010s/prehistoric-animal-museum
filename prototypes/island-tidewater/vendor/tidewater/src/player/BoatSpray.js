import { Vector3, Matrix4, Box3, MathUtils } from '../engine/index.js';
import { GRAVITY } from '../core/Globals.js';
import { SPRAY } from '../fx/Spray.js';

const _a = new Vector3();
const _b = new Vector3();
const _m = new Vector3();
const _n = new Vector3();
const _v = new Vector3();
const _w = new Vector3();
const _r = new Vector3();
const _fwd = new Vector3();
const _M = new Matrix4();
const _la = new Vector3();
const _one = new Vector3( 1, 1, 1 );
const _opts = { to: null, spread: 0.3, jitter: 0.05, life: 0.8, sizeJitter: 0.5 };

// A spray source (after SpraySource in threejs-water-pro): the driving speed (m/s) above a
// threshold, scaled and bounded, drives both how much is thrown and how fast.
class Source {

	constructor( { speedThreshold, velocityScale, intensity, lifetime } ) {

		this.speedThreshold = speedThreshold;
		this.velocityScale = velocityScale;
		this.intensity = intensity;
		this.lifetime = lifetime;

	}

	response( speed ) {

		return Math.min( 30, Math.max( 0, speed - this.speedThreshold ) * this.velocityScale );

	}

}

const SEGMENTS = 3; // contact segments per side, stem -> shoulder
const EMIT_RATE = 300; // drops per unit of demand (m of waterline x m/s of response) per second
const MAX_PER_FRAME = 150; // particle cap per frame for the bow (both sides; the pool's CPU ring is 8192)
const FREE_REQUESTS = 8; // emit requests of the shared pool left to other emitters each frame

// Spray thrown off the hull, after the contact model of threejs-water-pro (SprayContacts /
// SpraySystem), adapted to this boat's lines and to the shared GPU particle pool (fx/Spray.js):
//
//  * contacts: the forebody waterline on each side, from the stem aft to the shoulder, in a few
//    segments. Each knows its outward normal, its velocity (rigid body: v + w x r) and how deep it
//    sits; only segments the water surface actually crosses throw spray
//  * two sources per segment: velocity-driven (the face pushing water aside: the normal speed
//    max( 0, v . n )) and impact-driven (the rate the segment is being immersed: the bow dropping
//    onto a wave or a wave running up it). response = min( 30, max( 0, speed - threshold ) * scale ),
//    demand = length x response x intensity, emission ~ demand
//  * launch: the hull's velocity along the face (the incoming normal part removed; the sheet keeps
//    part of it, the rest is the water streaming aft past the hull) + outward 0.65 r + upward
//    0.55 r (steady sheet) / 1.15 r (impact), randomised ~ +-30 %
//  * what is thrown: a thin clear sheet at the root (translucent, backlit, tearing into strands
//    and drop clusters: SPRAY.SHEET), real drops (3-7 mm, readable up close) and ligaments; on
//    impacts torn white water and a fine mist that the relative wind carries aft over the boat;
//    lifetimes 0.8 s steady / 1.4 s impact
//  * the particles collide with the hull and the wheelhouse (Spray.setBody: the hull outline from
//    the lines, flared from the waterline to the sheer, and the house as a box): spray never passes
//    through the boat
//  * motion, lighting and the water surface are the pool's (ballistic + drag toward the wind,
//    scattering per kind, drops die in the water and leave foam there)
//
// Also: slams (the bow dropping hard into a head sea) for the boat's onSlam hook (audio), and
// droplets kicked up by the propeller race when it runs near the surface.
export class BoatSpray {

	constructor( { boat, spray } ) {

		this.boat = boat;
		this.spray = spray;
		this.velocitySource = new Source( { speedThreshold: 0.4, velocityScale: 1.6, intensity: 1, lifetime: 0.8 } );
		this.impactSource = new Source( { speedThreshold: 0.6, velocityScale: 1.2, intensity: 3, lifetime: 1.4 } );

		// forebody waterline per side (boat frame, +X port, +Z forward): stations from the stem aft to
		// where the entrance has opened to ~92 % of the maximum beam
		const lines = boat.model.lines;
		const zStem = lines.wlEnd - 0.02;
		let maxHB = 0;
		for ( let z = lines.wlStart; z <= lines.wlEnd; z += 0.05 ) maxHB = Math.max( maxHB, lines.halfBeamAt( z ) );
		let zSh = zStem;
		while ( zSh > lines.wlStart && lines.halfBeamAt( zSh ) < 0.92 * maxHB ) zSh -= 0.05;
		this.contacts = [];
		for ( const s of [ 1, - 1 ] ) {

			const pts = [];
			for ( let i = 0; i <= SEGMENTS; i ++ ) {

				// stations bunched toward the stem, where the entrance is sharpest
				const f = ( i / SEGMENTS ) ** 1.3;
				const z = zStem + ( zSh - zStem ) * f;
				pts.push( new Vector3( s * ( lines.halfBeamAt( z ) + 0.03 ), 0.05, z ) );

			}

			for ( let i = 0; i < SEGMENTS; i ++ ) {

				const a = pts[ i ], b = pts[ i + 1 ];
				const t = _v.subVectors( b, a ).setY( 0 ).normalize();
				this.contacts.push( {
					side: s, a, b, mid: a.clone().add( b ).multiplyScalar( 0.5 ),
					length: a.distanceTo( b ),
					normal: new Vector3( - s * t.z, 0, s * t.x ), // outward (and forward)
					depth: 0, rate: 0, primed: false,
					carry: [ 0, 0, 0, 0, 0 ], // fractional particles: drops, sheet, ligaments, white water, mist
				} );

			}

		}

		// collision shape for the spray: hull outline at the waterline and at the sheer, the wheelhouse box
		let hbTop = 0;
		for ( let i = 0; i <= 200; i ++ ) hbTop = Math.max( hbTop, lines.sheerX( i / 200 ) );
		let zShTop = lines.zBow;
		while ( zShTop > lines.zAft && lines.sheerX( lines.tAtSheerZ( zShTop ) ) < 0.95 * hbTop ) zShTop -= 0.05;
		let zShWL = zStem;
		while ( zShWL > lines.wlStart && lines.halfBeamAt( zShWL ) < 0.95 * maxHB ) zShWL -= 0.05;
		const box = new Box3();
		for ( const c of boat.model.colliders || [] ) {

			if ( c.tag !== 'houseWall' && c.tag !== 'roof' ) continue;
			box.expandByPoint( _v.copy( c.center ).sub( c.half ) );
			box.expandByPoint( _v.copy( c.center ).add( c.half ) );

		}

		if ( box.isEmpty() ) box.set( new Vector3( 0, - 10, 0 ), new Vector3( 0, - 10, 0 ) );
		this.shape = {
			zAft: lines.zAft, zShoulder: zShTop, zStem: lines.zBow, halfBeam: hbTop + 0.02,
			wlShoulder: zShWL, wlStem: lines.wlEnd, wlHalfBeam: maxHB + 0.01,
			ySheerAft: lines.sheerY( 0 ) + 0.04, ySheerStem: lines.sheerY( 1 ) + 0.04, yBottom: - 0.8,
			boxMin: box.min.clone(), boxMax: box.max.clone(),
		};
		if ( spray.setBodyShape ) spray.setBodyShape( this.shape );

		this.stern = new Vector3( 0, 0.05, lines.wlStart + 0.1 );
		this.washCarry = 0;
		this.slamCooldown = 0;
		this.burst = 0;
		this.stats = { particles: 0, requests: 0, demandV: 0, demandI: 0 };

	}

	// half breadth of the spray collision outline at boat-frame z and height y (as Spray._collideBody)
	_halfBeam( z, y ) {

		const S = this.shape, cl = MathUtils.clamp, lerp = MathUtils.lerp;
		const sheer = lerp( S.ySheerAft, S.ySheerStem, cl( ( z - S.zAft ) / ( S.zStem - S.zAft ), 0, 1 ) );
		const f = cl( y / Math.max( sheer, 0.1 ), 0, 1 );
		const zSh = lerp( S.wlShoulder, S.zShoulder, f ), zSt = lerp( S.wlStem, S.zStem, f ), HB = lerp( S.wlHalfBeam, S.halfBeam, f );
		if ( z >= zSt ) return 0;
		const e = cl( ( z - zSh ) / Math.max( zSt - zSh, 0.01 ), 0, 1 );
		return HB * Math.sqrt( Math.max( 1 - e * e, 0.02 ) );

	}

	// emit the whole particles of a fractional count (per contact and kind), leaving the shared pool
	// its free requests
	_emit( c, k, count, kind, size, life, spread, jitter, vel ) {

		c.carry[ k ] += count;
		const m = Math.floor( c.carry[ k ] );
		if ( m <= 0 ) return;
		c.carry[ k ] -= m;
		if ( this.spray.nReq > 32 - FREE_REQUESTS ) return;
		_opts.to = _b;
		_opts.spread = spread;
		_opts.jitter = jitter;
		_opts.life = life;
		_opts.sizeJitter = 0.6;
		this.spray.emit( _a, vel, m, size, kind, _opts );
		this.stats.particles += m;
		this.stats.requests ++;

	}

	update( dt ) {

		const b = this.boat, spray = this.spray;
		this.stats.particles = this.stats.requests = 0;
		if ( spray.setBody ) spray.setBody( _M.compose( b.position, b.quaternion, _one ), b.velocity );
		if ( dt <= 0 || ! b.hasWater ) return;
		dt = Math.min( dt, 1 / 20 );
		b.forward( _fwd );
		const speed = Math.max( b.velocity.dot( _fwd ), 0 );
		const VS = this.velocitySource, IS = this.impactSource;
		this.slamCooldown = Math.max( 0, this.slamCooldown - dt );

		// ---- contacts: normal speed, immersion rate, demand
		let total = 0, slam = 0;
		let dV = 0, dI = 0;
		for ( const c of this.contacts ) {

			b.toWorld( c.mid, _m );
			const hw = b.sampleWaterAt( _m );
			const depth = hw - _m.y; // + = the design waterline is under water
			const rate = c.primed ? ( depth - c.depth ) / dt : 0;
			c.rate += ( rate - c.rate ) * Math.min( 1, dt / 0.03 ); // query noise
			c.depth = depth;
			c.primed = true;
			// the surface crosses this part of the hull (bow out of the water: dry; buried to the sheer: no sheet)
			const wet = MathUtils.smoothstep( depth, - 0.35, - 0.08 ) * ( 1 - MathUtils.smoothstep( depth, 0.7, 1.1 ) );
			c.wet = wet;
			// point velocity and the horizontal outward normal
			_r.subVectors( _m, b.position );
			_w.copy( b.angular ).cross( _r ).add( b.velocity );
			c.vel = c.vel || new Vector3();
			c.vel.copy( _w );
			c.n = c.n || new Vector3();
			c.n.copy( c.normal ).applyQuaternion( b.quaternion ).setY( 0 ).normalize();
			c.hw = hw;
			const vn = Math.max( 0, _w.x * c.n.x + _w.z * c.n.z );
			c.rV = VS.response( vn );
			c.rI = IS.response( c.rate );
			c.demandV = c.length * c.rV * VS.intensity * wet;
			c.demandI = c.length * c.rI * IS.intensity * wet * ( 0.15 + 0.85 * MathUtils.smoothstep( speed, 2, 6 ) );
			dV += c.demandV; dI += c.demandI;
			total += c.demandV + c.demandI;
			// slam: the stem dropping hard into the water in a head sea
			if ( c.a.z === this.contacts[ 0 ].a.z && wet > 0.3 && speed > 2.5 ) slam = Math.max( slam, Math.min( ( c.rate - 1.8 ) * 0.4 + speed * 0.02, 1 ) );

		}

		this.stats.demandV = dV; this.stats.demandI = dI;
		if ( slam > 0 && this.slamCooldown === 0 ) {

			this.slamCooldown = 0.4;
			if ( b.onSlam ) b.onSlam( slam );

		}

		// ---- emission, bounded per frame; a slam throws a burst
		this.burst = Math.max( this.burst * Math.exp( - dt / 0.15 ), slam );
		const burst = this.burst;
		const boost = 1 + 2.5 * burst;
		const budget = Math.min( 1, MAX_PER_FRAME / Math.max( 1e-6, total * EMIT_RATE * dt * boost * 1.3 ) );
		const fast = MathUtils.smoothstep( speed, 4, 10 );
		const making = MathUtils.smoothstep( speed, 3, 6 );
		// per side: the segment that throws most also throws the sheet, ligaments, white water and mist
		const side = this._side || ( this._side = [ { best: null, n: 0 }, { best: null, n: 0 } ] );
		side[ 0 ].best = side[ 1 ].best = null;
		side[ 0 ].n = side[ 1 ].n = 0;
		for ( const c of this.contacts ) {

			const d = c.demandV + c.demandI;
			const sd = side[ c.side > 0 ? 0 : 1 ];
			c.nEmit = d * EMIT_RATE * dt * budget * boost;
			sd.n += c.nEmit;
			if ( d > 1e-4 && ( ! sd.best || d > sd.best.demandV + sd.best.demandI ) ) sd.best = c;

		}

		for ( const c of this.contacts ) {

			if ( c.demandV + c.demandI <= 1e-4 ) continue;
			const n = c.nEmit;
			const imp = c.demandI / ( c.demandV + c.demandI ); // impact share
			const r = c.rV * ( 1 - imp ) + c.rI * imp;
			// launch: tangential hull velocity (part of it: the sheet streams aft past the hull),
			// outward and up (a slam throws it higher and wider)
			const vn = c.vel.x * c.n.x + c.vel.z * c.n.z;
			_v.copy( c.vel ).addScaledVector( c.n, - vn ).multiplyScalar( 0.6 );
			_v.y = c.vel.y * 0.3;
			const up = c.rV * 0.55 * ( 1 - imp ) + c.rI * 1.15 * imp + burst * 2.5;
			_v.addScaledVector( c.n, 0.8 * r + 0.4 + burst * 1.0 );
			_v.y += up;
			// the sheet leaves from where the surface meets the hull, raised by the stagnation rise
			// of the flow against the face
			const rise = Math.min( 0.5, ( vn * vn ) / ( 2 * GRAVITY ) * 0.5 );
			// just outside the collision outline at that height (the spray collides with it)
			const ya = Math.min( Math.max( c.hw + rise - b.position.y, - 0.3 ), 0.9 );
			const yb = Math.min( Math.max( c.hw + rise * 0.6 - b.position.y, - 0.3 ), 0.9 );
			b.toWorld( _la.set( c.side * ( this._halfBeam( c.a.z, ya ) + 0.05 ), ya, c.a.z ), _a );
			b.toWorld( _la.set( c.side * ( this._halfBeam( c.b.z, yb ) + 0.05 ), yb, c.b.z ), _b );
			_a.y = c.hw + rise;
			_b.y = c.hw + rise * 0.6;
			const spread = ( 0.3 * Math.hypot( 0.65 * r, up ) + 0.15 ) * ( 1 + burst );
			const life = VS.lifetime * ( 1 - imp ) + IS.lifetime * imp;
			// drops (3-7 mm) from every wetted segment
			this._emit( c, 0, n, SPRAY.DROPLET, 0.005 + 0.0006 * r, life, spread, 0.05, _v );
			const sd = side[ c.side > 0 ? 0 : 1 ];
			if ( sd.best !== c ) continue;
			const N = sd.n;
			// the clear sheet at the root, ligaments torn off it
			// a few fragments of the clear sheet at the root (they tear into strands and drop clusters)
			this._emit( c, 1, N * 0.025 * making * ( 1 - burst * 0.5 ), SPRAY.SHEET, 0.12 + 0.02 * r, 0.45, spread * 0.5, 0.06, _v );
			// ligaments torn off the sheet: the readable blobs of water
			this._emit( c, 2, N * 0.3 * MathUtils.smoothstep( r, 1.0, 5 ), SPRAY.LIGAMENT, 0.011 + 0.0012 * r, life, spread, 0.05, _v );
			// white water only on impacts: torn white sheets
			this._emit( c, 3, N * ( 0.06 * imp * MathUtils.smoothstep( c.rI, 1.5, 5 ) + 0.1 * burst ) * making, SPRAY.SPRAY, 0.04 + 0.004 * r + 0.03 * burst, 0.6 + 0.4 * imp, spread, 0.12, _v );
			// a fine, faint mist on impacts that the relative wind carries aft over the boat
			this._emit( c, 4, N * ( 0.04 * imp + 0.15 * burst ) * making, SPRAY.MIST, 0.3 + 0.2 * burst, 2.0, spread * 0.5, 0.15, _w.copy( _v ).multiplyScalar( 0.6 ) );

		}

		// ---- propeller race: drops kicked up when the churn is near the surface (pro: activity
		// sqrt( thrust / 1000 ) x e^( -depth / r ))
		b.toWorld( b.model.propeller, _m );
		const propDepth = b.sampleWaterAt( _m ) - _m.y;
		const activity = b.driven && propDepth > - 0.2 ? Math.sqrt( Math.abs( b.thrust || 0 ) / 1000 ) * Math.exp( - Math.max( propDepth, 0 ) / 0.45 ) : 0;
		if ( activity > 0.05 ) {

			b.toWorld( this.stern, _a );
			if ( b.sampleWaterAt( _a ) - _a.y > - 0.3 ) {

				this.washCarry += activity * 45 * dt;
				const m = Math.floor( this.washCarry );
				this.washCarry -= m;
				const dir = Math.sign( b.thrust || b.throttle ) || 1;
				_v.copy( b.velocity ).multiplyScalar( 0.6 ).addScaledVector( _fwd, - ( 0.8 + activity * 0.6 ) * dir );
				_v.y = 0.5 + activity * 0.5;
				if ( m > 0 && spray.nReq <= 32 - FREE_REQUESTS ) {

					_opts.to = null; _opts.spread = 0.8; _opts.jitter = 0.35; _opts.life = 0.8; _opts.sizeJitter = 0.5;
					spray.emit( _a, _v, m, 0.005, SPRAY.DROPLET, _opts );
					this.stats.particles += m;
					this.stats.requests ++;

				}

			}

		}

	}

}
