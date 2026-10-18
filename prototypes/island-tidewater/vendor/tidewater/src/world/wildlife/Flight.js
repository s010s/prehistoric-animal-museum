import { BIRD, SPECIES } from './BirdShapes.js';
import { createPose, flapWings, tuckLegs, setHead, storePrevious, resetPrevious } from './BirdPose.js';
import { TAU, clamp, lerp, angleDiff, approach, qYawPitchRoll } from './Kit.js';

// Flight model shared by every flying bird: a point mass flying coordinated turns (bank from the
// turn rate), climbing / sinking toward a target height, flapping when it needs power (climbing,
// slow, taking off) and gliding otherwise. The owner steers it (target point, height, speed and
// how much it wants to flap) and reads back the pose for the renderer.

const GRAV = 9.81;

// per species: cruise airspeed (m/s), min speed, max bank, roll rate, climb / sink rates, flap
// frequency (Hz) and amplitude, glide articulation (see BirdPose.setWings), flapping duty cycle
export const FLIGHT = {
	[ BIRD.GULL ]: {
		speed: 10.5, minSpeed: 6, maxBank: 0.85, roll: 2.6, climb: 2.4, sink: 0.7, freq: 3.1, amp: 0.85,
		glide: { elev: 0.1, sweep: - 0.12, twist: 0.02, elbow: 0.22, wrist: 0.5, hand: - 0.22 }, duty: 0.35,
	},
	[ BIRD.TERN ]: {
		speed: 9, minSpeed: 5, maxBank: 0.95, roll: 3, climb: 2.2, sink: 0.8, freq: 2.7, amp: 0.95,
		glide: { elev: 0.12, sweep: - 0.1, twist: 0.02, elbow: 0.25, wrist: 0.55, hand: - 0.12 }, duty: 0.85,
	},
	[ BIRD.PELICAN ]: {
		speed: 11, minSpeed: 7, maxBank: 0.6, roll: 1.4, climb: 1.6, sink: 0.55, freq: 1.6, amp: 0.62,
		glide: { elev: 0.02, sweep: - 0.05, twist: 0.02, elbow: 0.12, wrist: 0.12, hand: 0.06 }, duty: 0.2,
	},
	[ BIRD.FRIGATE ]: {
		speed: 9, minSpeed: 6, maxBank: 0.55, roll: 1.2, climb: 1.2, sink: 0.45, freq: 2.0, amp: 0.55,
		glide: { elev: 0.1, sweep: - 0.18, twist: 0.03, elbow: 0.42, wrist: 0.85, hand: - 0.28 }, duty: 0.02,
	},
	[ BIRD.SANDERLING ]: {
		speed: 13, minSpeed: 6, maxBank: 1.0, roll: 4, climb: 2.5, sink: 1.2, freq: 11, amp: 0.8,
		glide: { elev: 0.08, sweep: - 0.05, twist: 0.02, elbow: 0.3, wrist: 0.55, hand: - 0.15 }, duty: 0.8,
	},
};

const _g = { elev: 0, sweep: 0, twist: 0, elbow: 0, wrist: 0, hand: 0 };

export class Flyer {

	constructor( species, seed, rng ) {

		this.species = species;
		this.sp = SPECIES[ species ];
		this.cfg = FLIGHT[ species ];
		this.rng = rng;
		this.P = createPose( species, seed );
		this.P.scale = 0.92 + rng() * 0.16;
		this.x = 0; this.y = 0; this.z = 0;
		this.vx = 0; this.vy = 0; this.vz = 0; // ground velocity
		this.yaw = 0; // heading of the air velocity (forward = ( sin, cos ))
		this.gamma = 0; // flight path angle
		this.bank = 0;
		this.pitch = 0; // body pitch
		this.speed = this.cfg.speed;
		this.phase = rng() * TAU;
		this.flap = 0; // current flapping amplitude (0..1 of the species' amplitude)
		this.flapWant = 0;
		this.burst = rng() * 3; // flap / glide rhythm timer
		this.bursting = false;
		this.freqMul = 0.94 + rng() * 0.12;
		this.wander = rng() * 100;
		this.headYaw = 0; this.headPitch = 0;
		this.tailSpread = 1; this.tailPitch = 0;
		this.legs = 0; // lowered legs (landing)
		this.flare = 0; // landing / braking pose
		this.dive = 0; // wings swept back for a plunge
		this.hover = 0;
		this.windK = 0.35; // how much the wind drifts it
		this.fold = 0;
		this.extraPitch = 0;
		this.twirl = 0; // roll offset (pelican twisting into its dive)

	}

	place( x, y, z, yaw ) {

		this.x = x; this.y = y; this.z = z;
		this.yaw = yaw;
		this.vx = Math.sin( yaw ) * this.speed;
		this.vz = Math.cos( yaw ) * this.speed;
		this.vy = 0;
		this.P.fresh = true;

	}

	// Steer toward (tx, ty, tz) at airspeed `speed`; power: 0 glide only .. 1 flap as needed ..
	// 2 flap hard (take-off). turnGain scales how eagerly it turns toward the target.
	steer( dt, tx, ty, tz, speed, power = 1, turnGain = 1, wind = null ) {

		const c = this.cfg;
		// heading toward the target, with a gentle wander so paths never look ruled
		this.wander += dt * 0.35;
		const wob = Math.sin( this.wander * 1.3 ) * 0.12 + Math.sin( this.wander * 0.47 + 2 ) * 0.1;
		const want = Math.atan2( tx - this.x, tz - this.z ) + wob * turnGain;
		const err = angleDiff( want, this.yaw );
		const V = Math.max( this.speed, 1 );
		const maxRate = GRAV * Math.tan( c.maxBank ) / V;
		const rate = clamp( err * 1.2 * turnGain, - maxRate, maxRate );
		const bankWant = Math.atan( rate * V / GRAV );
		this.bank += clamp( bankWant - this.bank, - c.roll * dt, c.roll * dt );
		this.yaw += GRAV * Math.tan( this.bank ) / V * dt;

		// height: climb or sink toward the target height
		const dy = ty - this.y;
		const climbWant = clamp( dy * 0.6, - c.sink * 3.5, c.climb * ( power > 1.5 ? 1.6 : 1 ) );
		const vyWant = climbWant;
		this.vy += ( vyWant - this.vy ) * approach( 2.5, dt );
		this.gamma = Math.asin( clamp( this.vy / V, - 0.9, 0.9 ) );

		// speed: slower when climbing hard, faster when descending
		this.speed += ( speed - this.vy * 0.4 - this.speed ) * approach( 1.2, dt );
		this.speed = Math.max( this.speed, c.minSpeed * 0.5 );

		// power: flap when climbing or slow; otherwise the species' flap / glide rhythm
		let need = clamp( this.vy / c.climb, 0, 1 ) * 1.1 + clamp( ( speed - this.speed ) / 2, 0, 1 ) * 0.6;
		if ( power > 1.5 ) need = 1.3;
		this.burst -= dt;
		if ( this.burst <= 0 ) {

			this.bursting = this.rng() < c.duty;
			this.burst = this.bursting ? 0.8 + this.rng() * 2.2 : 1.5 + this.rng() * 4;

		}

		const rhythm = this.bursting ? 0.75 : 0;
		this.flapWant = power <= 0 ? 0 : clamp( Math.max( need, rhythm * power ), 0, power > 1.5 ? 1.25 : 1 );

		// integrate (ground velocity = air velocity + some wind drift)
		const h = Math.cos( this.gamma ) * this.speed;
		this.vx = Math.sin( this.yaw ) * h;
		this.vz = Math.cos( this.yaw ) * h;
		if ( wind ) {

			this.vx += wind.x * this.windK;
			this.vz += wind.y * this.windK;

		}

		this.x += this.vx * dt;
		this.y += this.vy * dt;
		this.z += this.vz * dt;

	}

	// Advance the wing beat and write the pose (world position, orientation, articulation).
	animate( dt ) {

		const c = this.cfg, P = this.P;
		if ( P.fresh ) resetPrevious( P );
		else storePrevious( P );

		this.flap += ( this.flapWant - this.flap ) * approach( this.flapWant > this.flap ? 6 : 2.5, dt );
		// a beat only stops at the top or bottom of the stroke (the phase keeps running until then)
		const f = c.freq * this.freqMul * ( 0.85 + 0.3 * Math.min( this.flap, 1.25 ) );
		if ( this.flap > 0.02 ) this.phase = ( this.phase + TAU * f * dt ) % TAU;
		else {

			// ease toward the glide phase (quarter stroke, wings level)
			const d = angleDiff( Math.PI / 2, this.phase );
			this.phase += clamp( d, - TAU * f * dt, TAU * f * dt );

		}

		// glide pose, bent further when diving / flaring
		const g = c.glide;
		const dv = this.dive, fl = this.flare;
		_g.elev = lerp( g.elev, 0.25, dv ) + fl * 0.45;
		_g.sweep = lerp( g.sweep, 0.35, dv ) - fl * 0.3;
		_g.twist = g.twist - fl * 0.2;
		_g.elbow = lerp( g.elbow, 1.0, dv );
		_g.wrist = lerp( g.wrist, 1.4, dv ) + fl * 0.2;
		_g.hand = g.hand + fl * 0.25;
		flapWings( P, _g, this.phase, c.amp * Math.min( this.flap, 1.25 ) * ( 1 - dv ) );

		// body: along the flight path, banked; small heave with the wing beat
		const heave = - Math.cos( this.phase ) * 0.012 * this.sp.length * this.flap;
		const pitchWant = this.gamma * 0.7 + fl * 0.6 + this.hover * 0.45 + this.extraPitch - dv * 1.1;
		this.pitch += ( pitchWant - this.pitch ) * approach( 4, dt );
		qYawPitchRoll( P.q, this.yaw, this.pitch, - this.bank + this.twirl );
		P.pos[ 0 ] = this.x; P.pos[ 1 ] = this.y + heave; P.pos[ 2 ] = this.z;

		// tail: spread when turning, braking, hovering; frigatebirds scissor theirs
		let spread = 1 + Math.abs( this.bank ) * 0.9 + fl * 0.9 + this.hover * 0.8;
		if ( this.species === BIRD.FRIGATE ) spread = 1 + Math.abs( this.bank ) * 3.5 + 0.8 * Math.max( 0, Math.sin( this.wander * 1.7 ) ) + fl * 2;
		this.tailSpread += ( spread - this.tailSpread ) * approach( 3, dt );
		P.tailSpread = this.tailSpread * ( 1 - dv * 0.6 );
		P.tailPitch = fl * 0.35 + this.hover * 0.3 - this.gamma * 0.2;
		P.fold = this.fold;
		setHead( P, this.headYaw, this.headPitch );
		tuckLegs( P, this.legs );

	}

}
