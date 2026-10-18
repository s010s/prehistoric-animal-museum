import { Mesh, BufferGeometry, Float32BufferAttribute, Matrix4, Quaternion, Vector3, Vector4, MathUtils } from '../engine/index.js';
import { prepare, mergePrepared, cylinder, torus, sphere, rod, mat4, lathe, roundedBox, tube } from '../world/boat/GeoKit.js';
import { createPropMaterial, createLineMaterial, PAT } from './GameMaterials.js';

// The fishing rod in the player's hands, its line and the bobber.
//
// A 7 ft medium saltwater spinning combo at real scale: a tapered carbon blank under clear coat,
// split EVA grip, screw-down reel seat with hoods, eight graduated guides with ceramic inserts and
// thread wraps, a hook keeper and tip-top; and a 3000-size spinning reel hanging under the seat
// (gearbox body, rotor with a bail arm and line roller, spool wound with braid, front drag knob,
// crank handle with a T-knob).
//
// Rod frame: +Y along the blank (butt at 0, tip at ROD_L), the reel hangs toward -Z, +X to the
// right. Held in first person by the reel seat (SEAT_Y), relative to the camera: a pose (elevation
// of the rod above the view direction, sideways swing, hand position) is eased between idle /
// wind-up / flick / fighting.
//
// Everything is one merged mesh; the moving parts are tagged in aux.w and animated in the vertex
// shader: 1 rotor, 2 bail (opens about its pivots, turns with the rotor), 3 crank handle, 4 spool
// and drag knob (oscillates in and out as you crank, turns backwards when the drag slips), 5 braid
// on the spool (as 4, its radius follows the line left on the spool). The blank bends toward the
// line with a fast action: under a light load only the tip section bends, under a heavy one the
// bend works down into the butt. The same curve is evaluated here for the tip the line leaves from.
//
// States: 'stowed' -> 'idle' -> ( hold ) 'windup' -> ( release ) 'flick' -> 'flying' (bobber in the
// air) -> 'floating' (on the water; bites come here) -> 'fighting' (fish on) -> back to 'idle';
// 'retrieving' reels an empty line in.
export const ROD_L = 2.13; // 7 ft
const BLANK_START = 0.535; // front of the fore grip: the blank bends from here
const SEAT_Y = 0.405; // the hand holds the reel seat (reel foot between the fingers)
const REEL_Z = - 0.092; // reel axis below the blank
const BODY_Y = 0.327; // crank axis height along the rod
const PIVOT_Y = 0.403; // bail pivots at the rotor arm ends
const GEAR = 5.2; // rotor turns per crank turn
const LINE_PER_CRANK = 0.8; // m of line per crank turn
const LINE_SEGS = 48;
const GRAV = 9.81;

// guides: position along the rod, ring inner radius, ring centre height below the blank's axis
const GUIDES = [
	[ 0.86, 0.0125, 0.068 ], [ 1.1, 0.0085, 0.046 ], [ 1.31, 0.0058, 0.031 ], [ 1.49, 0.0045, 0.023 ],
	[ 1.65, 0.004, 0.0195 ], [ 1.8, 0.0036, 0.0165 ], [ 1.93, 0.0034, 0.0145 ], [ 2.035, 0.0032, 0.0125 ],
];

const blankR = ( y ) => MathUtils.lerp( 0.0074, 0.0011, Math.pow( MathUtils.clamp( ( y - BLANK_START ) / ( ROD_L - BLANK_START ), 0, 1 ), 0.85 ) );

// bend of the blank at rod height y (same curve in the vertex shader): lateral deflection along the
// bend direction and the drop along the rod that keeps its length about constant
const BEND_P = ( load ) => MathUtils.lerp( 3.4, 1.7, MathUtils.clamp( load, 0, 1 ) );
function bendAt( y, bend, p, out ) {

	const s = MathUtils.clamp( ( y - BLANK_START ) / ( ROD_L - BLANK_START ), 0, 1 );
	const lat = bend * ROD_L * Math.pow( s, p );
	out.lat = lat;
	out.drop = 0.5 * lat * lat / ( y - BLANK_START + 0.06 );
	return out;

}

const _b = { lat: 0, drop: 0 };
const _m = new Matrix4(), _q = new Quaternion(), _v = new Vector3(), _w = new Vector3(), _x = new Vector3(), _y = new Vector3(), _z = new Vector3();
const _tipOld = new Vector3(); // last frame's tip: its own vector (the scratch vectors are reused during update)
const _up = new Vector3( 0, 1, 0 );
const _h = new Vector3();

export const POSES = {
	stowed: { elev: - 0.9, side: 0.35, hand: [ 0.3, - 0.62, - 0.25 ] },
	idle: { elev: 0.46, side: 0.22, hand: [ 0.15, - 0.05, - 0.45 ] },
	windup: { elev: 2.0, side: 0.12, hand: [ 0.22, - 0.08, - 0.2 ] },
	flick: { elev: 0.16, side: 0.14, hand: [ 0.18, - 0.12, - 0.55 ] },
	follow: { elev: 0.24, side: 0.02, hand: [ 0.17, - 0.1, - 0.56 ] }, // follow-through: the rod points along the cast
	floating: { elev: 0.4, side: 0.18, hand: [ 0.15, - 0.06, - 0.46 ] },
	fighting: { elev: 0.9, side: 0.12, hand: [ 0.14, - 0.03, - 0.43 ] },
	landing: { elev: 0.85, side: 0.3, hand: [ 0.16, - 0.08, - 0.46 ] }, // rod up, the fish swinging in view
};

export class FishingRod {

	constructor( { scene, camera, query, terrain, audio = null } ) {

		this.camera = camera;
		this.query = query;
		this.terrain = terrain;
		this.audio = audio;
		this.slot = query.allocate( 'bobber', 1 );

		this.state = 'stowed';
		this.equipped = false;
		this.power = 0; // cast charge 0..1
		this.castM = 22;
		this.reelSpeed = 1.1;
		this.t = 0; // time in state
		this.pose = { elev: POSES.stowed.elev, side: POSES.stowed.side, hand: new Vector3( ...POSES.stowed.hand ) };
		this.bend = 0; // 0..~0.3 (tip deflection / length)
		this.bendDir = new Vector3( 0, 0, - 1 );

		this.bobber = new Vector3();
		this.bobberVel = new Vector3();
		this.dip = 0; // bobber pulled under (bite cues / fish on)
		this.waterY = 0;
		this.depth = 0; // water depth under the bobber (from the query's floor)
		this.lineOut = 0; // m of line out
		this.slack = 1;
		this.fishPos = new Vector3(); // where the hooked fish is (fighting)
		this._wander = 0;
		this.onLand = null; // callback( 'water' | 'ground' ) when the bobber lands
		this.tip = new Vector3();

		// reel / bend animation state
		this.bendVel = 0;
		this.load = 0; // 0..1: how deep the bend works into the blank
		this.rotor = 0; this.crank = 0; this.spoolAng = 0; this.spoolOsc = 0;
		this.bail = 0; // 0 closed .. 1 open
		this.bailTarget = 0;
		this.crankRate = 0; // crank turns / s (smoothed)
		this.lineFill = 1; // line left on the spool (1 = full)
		this._lastOut = 0;

		// ---- meshes
		const f = ( x ) => x.toFixed( 4 );
		this.rodMat = createPropMaterial( 'fishingRod', {
			clearcoat: true,
			uniforms: {
				rodBend: [ 'vec4f', new Vector4() ], // xyz bend direction (rod space), w bend
				rodShape: [ 'vec4f', new Vector4( 3, 0, 0, 0 ) ], // x: bend exponent (fast action)
				reelAnim: [ 'vec4f', new Vector4() ], // rotor angle, bail open 0..1, crank angle, spool angle
				reelAnim2: [ 'vec4f', new Vector4( 0, 1, 0, 0 ) ], // spool oscillation (m), line fill
			},
			vertex: /* wgsl */`
	{
		var P = v.position;
		var Nn = v.normal;
		let part = v.aux.w;
		let axisC = vec3f( 0.0, 0.0, ${ f( REEL_Z ) } );
		if ( part > 0.5 ) {
			if ( part < 2.5 ) {
				if ( part > 1.5 ) {
					// the bail flips back about the line through its two pivots
					let a = - mat.reelAnim.y * 1.95;
					let c = vec3f( 0.0, ${ f( PIVOT_Y ) }, ${ f( REEL_Z ) } );
					let ca = cos( a ); let sa = sin( a );
					let q = P - c;
					P = c + vec3f( q.x, q.y * ca - q.z * sa, q.y * sa + q.z * ca );
					Nn = vec3f( Nn.x, Nn.y * ca - Nn.z * sa, Nn.y * sa + Nn.z * ca );
				}
				// rotor (and the bail on it) turn about the reel axis
				let a = mat.reelAnim.x;
				let ca = cos( a ); let sa = sin( a );
				let q = P - axisC;
				P = vec3f( q.x * ca + q.z * sa, P.y, - q.x * sa + q.z * ca ) + vec3f( 0.0, 0.0, axisC.z );
				Nn = vec3f( Nn.x * ca + Nn.z * sa, Nn.y, - Nn.x * sa + Nn.z * ca );
			} else if ( part < 3.5 ) {
				// crank handle about its shaft (along x)
				let a = mat.reelAnim.z;
				let c = vec3f( 0.0, ${ f( BODY_Y ) }, ${ f( REEL_Z ) } );
				let ca = cos( a ); let sa = sin( a );
				let q = P - c;
				P = c + vec3f( q.x, q.y * ca - q.z * sa, q.y * sa + q.z * ca );
				Nn = vec3f( Nn.x, Nn.y * ca - Nn.z * sa, Nn.y * sa + Nn.z * ca );
			} else {
				// spool: in and out with the crank, turning back when the drag slips; the braid on it
				// shrinks as line goes out
				var q = P - axisC;
				if ( part > 4.5 ) {
					let r = length( q.xz );
					let r2 = mix( 0.0205, r, mat.reelAnim2.y );
					q = vec3f( q.x * r2 / max( r, 1e-5 ), q.y, q.z * r2 / max( r, 1e-5 ) );
				}
				let a = mat.reelAnim.w;
				let ca = cos( a ); let sa = sin( a );
				P = vec3f( q.x * ca + q.z * sa, P.y + mat.reelAnim2.x, - q.x * sa + q.z * ca ) + vec3f( 0.0, 0.0, axisC.z );
				Nn = vec3f( Nn.x * ca + Nn.z * sa, Nn.y, - Nn.x * sa + Nn.z * ca );
			}
		}
		// the blank bends toward the line (fast action: rodShape.x = exponent of the deflection)
		let span = ${ f( ROD_L - BLANK_START ) };
		let s = clamp( ( P.y - ${ f( BLANK_START ) } ) / span, 0.0, 1.0 );
		let p = mat.rodShape.x;
		let lat = mat.rodBend.w * ${ f( ROD_L ) } * pow( s, p );
		let slope = mat.rodBend.w * ${ f( ROD_L ) } * p * pow( max( s, 1e-4 ), p - 1.0 ) / span;
		let drop = 0.5 * lat * lat / ( max( P.y - ${ f( BLANK_START ) }, 0.0 ) + 0.06 );
		P = P + mat.rodBend.xyz * lat - vec3f( 0.0, drop, 0.0 );
		Nn = normalize( Nn - vec3f( 0.0, slope * dot( Nn, mat.rodBend.xyz ), 0.0 ) );
		v.position = P;
		v.normal = Nn;
	}
`,
		} );
		this.rodMesh = new Mesh( buildRodGeometry(), this.rodMat );
		this.rodMesh.name = 'FishingRod';
		this.rodMesh.frustumCulled = false;
		this.rodMesh.castShadow = false;
		this.rodMesh.matrixAutoUpdate = false;
		this.rodMesh.visible = false;

		this.bobberMat = createPropMaterial( 'bobber' );
		this.bobberMesh = new Mesh( buildBobberGeometry(), this.bobberMat );
		this.bobberMesh.name = 'Bobber';
		this.bobberMesh.frustumCulled = false;
		this.bobberMesh.castShadow = false;
		this.bobberMesh.visible = false;

		this.lineMat = createLineMaterial( LINE_SEGS );
		this.lineMesh = new Mesh( buildLineGeometry( LINE_SEGS ), this.lineMat );
		this.lineMesh.name = 'FishingLine';
		this.lineMesh.frustumCulled = false;
		this.lineMesh.castShadow = false;
		this.lineMesh.visible = false;

		scene.add( this.rodMesh, this.bobberMesh, this.lineMesh );

	}

	setGear( { castM, reelSpeed } ) {

		this.castM = castM;
		this.reelSpeed = reelSpeed;

	}

	equip( on ) {

		this.equipped = on;
		if ( on && this.state === 'stowed' ) this.setState( 'idle' );
		if ( on && this.audio && this.audio.rodReady ) this.audio.rodReady();
		if ( ! on ) this.setState( 'stowed' );

	}

	setState( s ) {

		this.state = s;
		this.t = 0;

	}

	get lineInWater() {

		return this.state === 'floating' || this.state === 'fighting' || this.state === 'retrieving' || this.state === 'flying' || this.state === 'landing';

	}

	// ---- actions (from the game)
	startWindup() {

		if ( this.state !== 'idle' ) return false;
		this.setState( 'windup' );
		this.power = 0;
		return true;

	}

	release() {

		if ( this.state !== 'windup' ) return false;
		this.setState( 'flick' );
		return true;

	}

	retrieve() {

		if ( this.state === 'floating' || this.state === 'flying' ) this.setState( 'retrieving' );

	}

	hook() {

		if ( this.state !== 'floating' ) return false;
		this.setState( 'fighting' );
		this.fishPos.copy( this.bobber );
		return true;

	}

	// fish landed: swing it up out of the water on a short line (the game hangs the fish on the end)
	land() {

		this.setState( 'landing' );
		this._landFrom = this.bobber.clone();

	}

	// fish lost: line back to the rod
	endFight() {

		this.setState( this.lineOut > 3 ? 'retrieving' : 'idle' );

	}

	// ---- per frame. fight: { distance, tension, surge } while fighting
	update( dt, { visible, fight = null } ) {

		this.t += dt;
		const cam = this.camera;
		const tipOld = _tipOld.copy( this.tip );

		// charge while winding up
		if ( this.state === 'windup' ) this.power = Math.min( 1, this.power + dt / 1.1 );

		// ---- rod pose
		let target = POSES[ this.state ] || POSES.idle;
		if ( this.state === 'flying' ) target = POSES.follow;
		if ( this.state === 'retrieving' ) target = POSES.floating;
		if ( this.state === 'flick' && this.t < 0.06 ) target = POSES.windup;
		const speed = this.state === 'flick' ? 28 : this.state === 'windup' ? 7 : 5;
		const k = 1 - Math.exp( - speed * dt );
		const p = this.pose;
		p.elev += ( target.elev - p.elev ) * k;
		p.side += ( target.side - p.side ) * k;
		p.hand.x += ( target.hand[ 0 ] - p.hand.x ) * k;
		p.hand.y += ( target.hand[ 1 ] - p.hand.y ) * k;
		p.hand.z += ( target.hand[ 2 ] - p.hand.z ) * k;
		// fighting: the rod dips and sways with the fish
		let elev = p.elev, side = p.side;
		if ( this.state === 'fighting' && fight ) {

			elev += - 0.35 * fight.surge + 0.12 * Math.sin( this.t * 2.3 );
			side += 0.12 * Math.sin( this.t * 1.1 + fight.surge * 2 );

		}

		// a live hand: breathing sway, and the tip twitching with each crank turn
		elev += Math.sin( this.t * 1.3 ) * 0.012 + Math.sin( this.crank ) * 0.006 * Math.min( 1, this.crankRate );
		side += Math.sin( this.t * 0.9 + 1.7 ) * 0.01;

		// rod basis in camera space: +Y along the rod, +Z roughly up (the reel hangs below the rod);
		// the hand holds the reel seat, the butt runs back under the forearm
		_y.set( 0, 0, - 1 ).applyAxisAngle( _x.set( 1, 0, 0 ), elev ).applyAxisAngle( _up, side ).normalize();
		_z.set( 0, 1, 0 ).addScaledVector( _y, - _y.y ).normalize();
		_x.crossVectors( _y, _z ).normalize();
		_m.makeBasis( _x, _y, _z ).setPosition( _h.copy( p.hand ).addScaledVector( _y, - SEAT_Y ) );
		cam.updateMatrixWorld();
		this.rodMesh.matrix.multiplyMatrices( cam.matrixWorld, _m );
		this.rodMesh.matrixWorldNeedsUpdate = true;
		this.rodMesh.visible = visible && ( this.equipped || p.elev > POSES.stowed.elev + 0.1 );

		// ---- bend: a damped spring toward the load (the flick loads the blank back, then it whips
		// through; bites nod the tip), direction toward the line when it is out
		let bendT = 0, loadT = 0.15;
		if ( this.state === 'fighting' && fight ) {

			bendT = 0.06 + 0.3 * Math.min( fight.tension, 1.1 ) + 0.05 * fight.surge;
			loadT = Math.min( 1, fight.tension * 1.1 );

		} else if ( this.state === 'retrieving' ) bendT = 0.035;
		else if ( this.state === 'windup' ) bendT = 0.02 + 0.03 * this.power;
		else if ( this.state === 'flick' ) {

			bendT = this.t < 0.09 ? - 0.2 * ( 0.4 + this.power ) : 0; // loaded back, then released
			loadT = 0.55;

		} else if ( this.state === 'floating' ) bendT = 0.012 + this.dip * 0.07;
		else if ( this.state === 'landing' ) {

			bendT = 0.14;
			loadT = 0.5;

		}

		const K = 250, C = 8; // ~2.5 Hz, lightly damped
		this.bendVel += ( ( bendT - this.bend ) * K - this.bendVel * C ) * dt;
		this.bend += this.bendVel * dt;
		this.load += ( loadT - this.load ) * ( 1 - Math.exp( - dt * 6 ) );
		// bend direction: toward the bobber (rod space, across the blank) when the line is out,
		// otherwise down toward the reel side (negative bend = loaded back up)
		if ( this.lineInWater && this.state !== 'flying' ) {

			_v.copy( this.bobber ).applyMatrix4( _m.copy( this.rodMesh.matrix ).invert() ).setY( 0 );
			if ( _v.lengthSq() > 1e-6 ) this.bendDir.lerp( _v.normalize(), 1 - Math.exp( - dt * 10 ) ).normalize();

		} else this.bendDir.lerp( _w.set( 0, 0, - 1 ), 1 - Math.exp( - dt * 10 ) ).normalize();
		const P = BEND_P( this.load );
		this.rodMat.uniforms.rodBend.value.set( this.bendDir.x, 0, this.bendDir.z, this.bend );
		this.rodMat.uniforms.rodShape.value.set( P, 0, 0, 0 );

		// tip in world space (same curve as the shader)
		bendAt( ROD_L, this.bend, P, _b );
		this.tip.set( this.bendDir.x * _b.lat, ROD_L - _b.drop, this.bendDir.z * _b.lat ).applyMatrix4( this.rodMesh.matrix );

		// ---- reel: the bail opens as you wind up (finger on the line) and snaps shut on the first
		// crank; the handle and rotor turn with the line coming in, the spool slips back when a fish
		// takes line against the drag
		this.bailTarget = this.state === 'windup' || this.state === 'flick' || this.state === 'flying' ? 1 : 0;
		if ( this.bailTarget !== this._bailSnd ) {

			if ( this._bailSnd !== undefined && this.audio && this.audio.bail ) this.audio.bail( this.bailTarget === 1 );
			this._bailSnd = this.bailTarget;

		}
		const bailRate = this.bailTarget > this.bail ? 6 : 16;
		this.bail += Math.sign( this.bailTarget - this.bail ) * Math.min( Math.abs( this.bailTarget - this.bail ), bailRate * dt );
		const outNow = this.state === 'fighting' && fight ? fight.distance : this.lineOut;
		const dOut = this.lineInWater && dt > 0 ? outNow - this._lastOut : 0;
		this._lastOut = outNow;
		let rateT = 0;
		if ( ( this.state === 'fighting' || this.state === 'retrieving' || this.state === 'landing' ) && dt > 0 ) {

			if ( dOut < 0 ) rateT = Math.min( 1.6, - dOut / dt / LINE_PER_CRANK );
			else if ( this.state === 'fighting' ) this.spoolAng -= Math.min( dOut, 0.5 ) / 0.023; // drag slipping
			if ( this.state === 'landing' ) rateT = this.t < 0.5 ? 1.2 : 0;

		}

		this.crankRate += ( rateT - this.crankRate ) * ( 1 - Math.exp( - dt * 10 ) );
		const dCrank = this.crankRate * Math.PI * 2 * dt;
		this.crank += dCrank;
		// the rotor turns GEAR times faster; shown at most ~3 turns a second (it would strobe)
		this.rotor += Math.min( dCrank * GEAR, 3.1 * Math.PI * 2 * dt );
		this.spoolOsc = Math.sin( this.crank * 0.5 ) * 0.0035;
		this.lineFill = 1 - Math.min( 1, this.lineOut / 220 ) * 0.5;
		this.rodMat.uniforms.reelAnim.value.set( this.rotor, this.bail, this.crank, this.spoolAng );
		if ( this.audio && this.audio.rodLoop ) this.audio.rodLoop( this.crankRate, this.state === 'fighting' && dOut > 0 && dt > 0 ? dOut / dt : 0, this.state === 'fighting' && fight ? fight.tension : 0 );
		this.rodMat.uniforms.reelAnim2.value.set( this.spoolOsc, this.lineFill, 0, 0 );

		// ---- flick: the bobber leaves the tip half way through
		if ( this.state === 'flick' && this.t > 0.09 ) {

			const v0 = 7 + 13 * this.power * ( this.castM / 22 ) ** 0.5;
			// toward where you aim: the heading runs from the tip (off to the side of the view) to the
			// point on the water straight ahead at the cast's reach, so the line leaves along the rod
			// toward the crosshair instead of parallel to the view from the tip
			const d = cam.getWorldDirection( _v );
			const hl = Math.max( Math.hypot( d.x, d.z ), 1e-3 );
			const reach = this.castM * ( 0.35 + 0.65 * this.power );
			const tx = cam.position.x + d.x / hl * reach - this.tip.x, tz = cam.position.z + d.z / hl * reach - this.tip.z;
			const tl = Math.max( Math.hypot( tx, tz ), 1e-3 );
			d.set( tx / tl * hl, Math.max( d.y, - 0.2 ) + 0.35, tz / tl * hl ).normalize();
			this.bobber.copy( this.tip );
			this.bobberVel.copy( d ).multiplyScalar( v0 );
			this.setState( 'flying' );
			if ( this.audio && this.audio.whoosh ) this.audio.whoosh( this.power );
			if ( this.audio && this.audio.lineOut ) this.audio.lineOut( this.power );

		}

		// water at the bobber (read back from last frame's query)
		this.query.setPoint( this.slot, this.bobber.x, this.bobber.z );
		if ( this.query.cpuValid ) {

			const h = this.query.cpu[ this.slot * 4 ], f = this.query.cpu[ this.slot * 4 + 3 ];
			if ( Number.isFinite( h ) ) this.waterY = h;
			if ( Number.isFinite( f ) ) this.depth = Math.max( 0, h - f );

		}

		const ground = this.terrain.heightAt( this.bobber.x, this.bobber.z );
		if ( this.state === 'flying' ) {

			// ballistic with a little drag, capped by the rod's casting range
			this.bobberVel.y -= GRAV * dt;
			this.bobberVel.multiplyScalar( Math.exp( - dt * 0.25 ) );
			this.bobber.addScaledVector( this.bobberVel, dt );
			const range = Math.hypot( this.bobber.x - this.tip.x, this.bobber.z - this.tip.z );
			if ( range > this.castM ) {

				this.bobberVel.x *= 0.5;
				this.bobberVel.z *= 0.5;

			}

			const surf = Math.max( this.waterY, ground );
			if ( this.bobber.y <= surf ) {

				this.bobber.y = surf;
				const onWater = this.waterY > ground + 0.05;
				this.setState( onWater ? 'floating' : 'retrieving' );
				this.bobberVel.set( 0, 0, 0 );
				if ( onWater && this.audio && this.audio.plop ) this.audio.plop( this.bobber );
				if ( this.onLand ) this.onLand( onWater ? 'water' : 'ground' );

			}

		} else if ( this.state === 'floating' ) {

			// riding the waves; dips with the bite cues
			const bob = Math.sin( this.t * 2.1 ) * 0.008;
			const yT = this.waterY + 0.012 + bob - this.dip * 0.09;
			this.bobber.y += ( yT - this.bobber.y ) * ( 1 - Math.exp( - dt * 12 ) );

		} else if ( this.state === 'fighting' && fight ) {

			// the fish runs about at the fight's distance, the bobber dragged under near it
			this._wander += dt * ( 0.4 + fight.surge * 1.5 );
			_v.copy( this.fishPos ).sub( this.tip ).setY( 0 );
			const d0 = _v.length() || 1;
			_v.multiplyScalar( 1 / d0 );
			const sideways = _x.set( - _v.z, 0, _v.x ).multiplyScalar( Math.sin( this._wander ) * 0.9 * dt * ( 1 + fight.surge ) );
			const dist = Math.max( 1, fight.distance );
			this.fishPos.set( this.tip.x + _v.x * dist, 0, this.tip.z + _v.z * dist ).add( sideways );
			this.bobber.x += ( this.fishPos.x - this.bobber.x ) * ( 1 - Math.exp( - dt * 6 ) );
			this.bobber.z += ( this.fishPos.z - this.bobber.z ) * ( 1 - Math.exp( - dt * 6 ) );
			this.bobber.y += ( this.waterY - 0.05 - 0.2 * fight.surge - this.bobber.y ) * ( 1 - Math.exp( - dt * 8 ) );

		} else if ( this.state === 'landing' ) {

			// lifted out and swung in to hang in front of you, a little right of centre and below eye level
			const k = Math.min( 1, this.t / 0.6 );
			const e = k * k * ( 3 - 2 * k );
			const fwd = cam.getWorldDirection( _x ).setY( 0 ).normalize();
			_v.copy( cam.position ).addScaledVector( fwd, 1.25 ).add( _h.set( - fwd.z, 0, fwd.x ).multiplyScalar( 0.15 ) );
			_v.y += 0.12;
			this.bobber.lerpVectors( this._landFrom || this.bobber, _v, e );
			this.bobber.y += Math.sin( e * Math.PI ) * 0.8;

		} else if ( this.state === 'retrieving' ) {

			// reel an empty line in: the bobber skims back to the rod
			_v.copy( this.tip ).sub( this.bobber ).setY( 0 );
			const d = _v.length();
			const step = Math.min( d, ( 3 + this.reelSpeed * 3 ) * dt );
			if ( d > 1e-3 ) this.bobber.addScaledVector( _v.multiplyScalar( 1 / d ), step );
			this.bobber.y += ( Math.max( this.waterY + 0.02, ground ) - this.bobber.y ) * ( 1 - Math.exp( - dt * 10 ) );
			if ( d < 2.2 ) this.setState( 'idle' );

		}

		// ---- line
		const out = this.lineInWater;
		this.lineOut = out ? this.tip.distanceTo( this.bobber ) : 0;
		const lm = this.lineMat.uniforms;
		lm.lineA.value.copy( this.tip );
		lm.lineB.value.copy( this.bobber );
		const taut = this.state === 'fighting' ? Math.min( 1, ( fight ? fight.tension : 0 ) * 1.5 ) : this.state === 'retrieving' ? 0.6 : 0;
		const sag = this.lineOut * ( this.state === 'flying' ? 0.03 : 0.07 ) * ( 1 - taut ) + 0.02;
		lm.lineCtl.value.copy( this.tip ).lerp( this.bobber, 0.5 ).y -= sag;
		// the line near the rod follows the rod's motion a little (whips on the flick)
		if ( this.state === 'flying' ) lm.lineCtl.value.addScaledVector( _v.copy( this.tip ).sub( tipOld ), - 2 );
		lm.lineShow.value = 1;
		this.lineMesh.visible = visible && out;
		this.bobberMesh.visible = visible && out && this.state !== 'landing';
		this.bobberMesh.position.copy( this.bobber );
		// a real float is a few pixels at casting range: grow it with distance so it stays readable
		const camD = this.bobber.distanceTo( cam.position );
		this.bobberMesh.scale.setScalar( Math.max( 1, camD / 7 ) );
		// bobber tilts toward the pull
		this.bobberMesh.rotation.set( this.dip * 0.4, 0, 0 );

	}

}

// ---- geometry

function buildRodGeometry() {

	const L = ROD_L;
	const parts = [];
	const M = ( x, y, z, rx = 0, ry = 0, rz = 0, sx = 1, sy = sx, sz = sx ) => mat4( x, y, z, rx, ry, rz, sx, sy, sz );
	const add = ( g, o ) => parts.push( prepare( g, o ) );
	const V = ( x, y, z ) => new Vector3( x, y, z );
	// materials ( colour, roughness, metalness, pattern )
	const BLANK = { color: 0x15191e, rough: 0.42, metal: 0.15, pattern: PAT.carbon };
	const WRAP = { color: 0x0c0d10, rough: 0.35, metal: 0, pattern: PAT.thread };
	const TRIM = { color: 0x8a6a2a, rough: 0.3, metal: 0.4, pattern: PAT.thread }; // gold metallic trim thread
	const EVA = { color: 0x2a2b2d, rough: 0.82, metal: 0, pattern: PAT.eva };
	const RUBBER = { color: 0x151515, rough: 0.8, metal: 0, pattern: PAT.rubber };
	const GUN = { color: 0x2d3034, rough: 0.32, metal: 0.85, pattern: PAT.machined }; // gunmetal
	const SEAT = { color: 0x1c1e21, rough: 0.45, metal: 0.2, pattern: PAT.plain }; // graphite reel seat
	const KNURL = { color: 0x3a3d42, rough: 0.35, metal: 0.9, pattern: PAT.knurl };
	const FRAME = { color: 0x2a2c2f, rough: 0.25, metal: 1, pattern: PAT.machined }; // guide frames
	const INSERT = { color: 0x55595e, rough: 0.12, metal: 0.3, pattern: PAT.plain }; // SiC insert
	const STAINLESS = { color: 0xb7bcc0, rough: 0.16, metal: 1, pattern: PAT.machined };
	const CHAMP = { color: 0xa88d5a, rough: 0.24, metal: 1, pattern: PAT.machined }; // champagne anodised
	const BLACK = { color: 0x111214, rough: 0.4, metal: 0.3, pattern: PAT.plain };
	const BRAID = { color: 0x7f9a5a, rough: 0.7, metal: 0, pattern: PAT.braid }; // moss-green braid

	// ---------------------------------------------------------------- rod
	// butt cap
	add( lathe( [ [ 0, 0 ], [ 0.012, 0.001 ], [ 0.0152, 0.006 ], [ 0.0156, 0.016 ], [ 0.0149, 0.022 ] ], 24 ), RUBBER );
	// rear grip (EVA), swelling a little in the middle
	add( lathe( [ [ 0.0147, 0.022 ], [ 0.0151, 0.07 ], [ 0.0152, 0.13 ], [ 0.0144, 0.2 ], [ 0.0131, 0.248 ] ], 24 ), EVA );
	// winding check, a short bare blank (split grip) with a trim ring
	add( lathe( [ [ 0.0128, 0.248 ], [ 0.0128, 0.252 ], [ 0.0098, 0.256 ] ], 20 ), CHAMP );
	add( cylinder( 0.0086, 0.009, 0.074, 16 ), { ...BLANK, matrix: M( 0, 0.293, 0 ) } );
	add( cylinder( 0.0093, 0.0093, 0.006, 16 ), { ...TRIM, matrix: M( 0, 0.305, 0 ) } );
	// reel seat: knurled lock nut, threads, rear hood, barrel (foot on the -Z side), front hood
	add( cylinder( 0.0128, 0.0128, 0.024, 24 ), { ...KNURL, matrix: M( 0, 0.342, 0 ) } );
	add( lathe( [ [ 0.0105, 0.354 ], [ 0.0118, 0.358 ], [ 0.0121, 0.372 ], [ 0.0112, 0.38 ] ], 20 ), GUN );
	add( cylinder( 0.0104, 0.0104, 0.056, 20 ), { ...SEAT, matrix: M( 0, 0.405, 0 ) } );
	add( lathe( [ [ 0.0112, 0.43 ], [ 0.0121, 0.438 ], [ 0.0118, 0.448 ], [ 0.0102, 0.452 ] ], 20 ), GUN );
	// fore grip (EVA) and winding check
	add( lathe( [ [ 0.0112, 0.452 ], [ 0.0118, 0.462 ], [ 0.0112, 0.5 ], [ 0.0095, 0.53 ] ], 20 ), EVA );
	add( lathe( [ [ 0.0095, 0.53 ], [ 0.0095, 0.533 ], [ 0.0078, 0.536 ] ], 16 ), CHAMP );
	// the blank: tapered, many rings so it bends smoothly
	{
		const prof = [];
		const n = 70;
		for ( let i = 0; i <= n; i ++ ) {

			const y = MathUtils.lerp( BLANK_START, L - 0.004, i / n );
			prof.push( [ blankR( y ), y ] );

		}

		add( lathe( prof, 12 ), BLANK );

	}

	// decal band and trim ahead of the fore grip
	add( cylinder( blankR( 0.6 ) + 0.0004, blankR( 0.56 ) + 0.0004, 0.05, 12 ), { ...WRAP, matrix: M( 0, 0.585, 0 ) } );
	add( cylinder( blankR( 0.61 ) + 0.0006, blankR( 0.61 ) + 0.0006, 0.003, 12 ), { ...TRIM, matrix: M( 0, 0.612, 0 ) } );
	// hook keeper: a small wire loop under the blank
	add( torus( 0.0035, 0.0006, 5, 14, Math.PI ), { ...STAINLESS, matrix: M( 0, 0.572, - blankR( 0.572 ) - 0.0005, 0, Math.PI / 2, Math.PI / 2 ) } );
	add( cylinder( blankR( 0.572 ) + 0.0005, blankR( 0.572 ) + 0.0005, 0.012, 10 ), { ...WRAP, matrix: M( 0, 0.572, 0 ) } );

	// guides: frame ring with a ceramic insert, two legs to a foot on the blank, thread wraps
	for ( let i = 0; i < GUIDES.length; i ++ ) {

		const [ y, r, hgt ] = GUIDES[ i ];
		const br = blankR( y );
		const zc = - hgt;
		const fr = r + Math.max( 0.0011, r * 0.16 ); // frame ring radius
		const t = Math.max( 0.0006, r * 0.07 );
		add( torus( fr, t * 1.3, 6, 22 ), { ...FRAME, matrix: M( 0, y, zc, Math.PI / 2, 0, 0 ) } );
		add( torus( r + t * 0.6, t * 0.9, 6, 22 ), { ...INSERT, matrix: M( 0, y, zc, Math.PI / 2, 0, 0 ) } );
		// legs splay from the foot to either side of the ring
		const footL = Math.max( 0.012, hgt * 0.55 );
		const yf = y - footL * 0.7;
		for ( const sx of [ - 1, 1 ] ) {

			const top = V( sx * fr * 0.72, y - 0.0005, zc + fr * 0.69 );
			add( rod( V( 0, yf, - br - 0.0008 ), top, Math.max( 0.0007, r * 0.09 ), 5, Math.max( 0.0005, r * 0.07 ) ), FRAME );

		}

		// the foot on the blank and its wrap
		add( roundedBox( 0.0035, footL, 0.0012, 0.0005, 1 ), { ...FRAME, matrix: M( 0, yf, - br - 0.0006 ) } );
		add( cylinder( blankR( yf + footL * 0.6 ) + 0.0007, blankR( yf - footL * 0.6 ) + 0.0007, footL * 1.25, 10 ), { ...WRAP, matrix: M( 0, yf, 0 ) } );
		add( cylinder( blankR( yf + footL * 0.64 ) + 0.00085, blankR( yf + footL * 0.64 ) + 0.00085, 0.0016, 10 ), { ...TRIM, matrix: M( 0, yf + footL * 0.64, 0 ) } );

	}

	// tip-top: tube over the blank end and a small ring
	add( cylinder( 0.0014, 0.0016, 0.012, 8 ), { ...FRAME, matrix: M( 0, L - 0.006, 0 ) } );
	add( torus( 0.0029, 0.0007, 6, 16 ), { ...FRAME, matrix: M( 0, L, - 0.004, Math.PI / 2, 0, 0 ) } );
	add( torus( 0.0023, 0.0005, 6, 16 ), { ...INSERT, matrix: M( 0, L, - 0.004, Math.PI / 2, 0, 0 ) } );

	// the line from the spool through every guide to the tip (bends with the blank)
	{
		const pts = [ V( 0, 0.425, REEL_Z + 0.022 ) ];
		for ( const [ y, , hgt ] of GUIDES ) pts.push( V( 0, y, - hgt + 0.0005 ) );
		pts.push( V( 0, L, - 0.004 ) );
		const LINE = { color: 0x9fb07e, rough: 0.6, metal: 0 };
		for ( let i = 0; i < pts.length - 1; i ++ ) add( rod( pts[ i ], pts[ i + 1 ], 0.00028, 3 ), LINE );

	}

	// ---------------------------------------------------------------- reel (axis along +Y at z = REEL_Z)
	const RZ = REEL_Z;
	// foot in the seat and the stem down to the body
	add( roundedBox( 0.011, 0.062, 0.004, 0.0015, 2 ), { ...GUN, matrix: M( 0, 0.405, - 0.0118 ) } );
	// the stem: one flat blade, wide along the rod, raked forward from the body to the foot
	add( roundedBox( 0.0072, 0.02, 0.08, 0.0032, 3 ), { ...GUN, matrix: M( 0, 0.377, - 0.045, - 0.675, 0, 0 ) } );
	add( roundedBox( 0.0082, 0.03, 0.012, 0.004, 3 ), { ...GUN, matrix: M( 0, 0.352, RZ + 0.02, - 0.35, 0, 0 ) } );
	// gearbox body: one smooth teardrop shell from the rotor neck back to the tail, flattened at
	// the sides where the side plates sit
	add( lathe( [ [ 0, 0.279 ], [ 0.006, 0.28 ], [ 0.0125, 0.286 ], [ 0.0185, 0.298 ], [ 0.0225, 0.314 ], [ 0.0238, 0.33 ], [ 0.0228, 0.342 ], [ 0.0198, 0.35 ], [ 0.018, 0.352 ] ], 32 ), { ...GUN, matrix: M( 0, 0, RZ, 0, 0, 0, 0.82, 1, 1 ) } );
	// side plates: slim inset discs with a machined trim ring (the handle side carries the crank boss)
	for ( const sx of [ - 1, 1 ] ) {

		add( cylinder( 0.0142, 0.0148, 0.0022, 28 ), { ...BLACK, matrix: M( sx * 0.0188, BODY_Y, RZ, 0, 0, Math.PI / 2 ) } );
		add( torus( 0.0145, 0.0007, 6, 32 ), { ...CHAMP, matrix: M( sx * 0.0197, BODY_Y, RZ, 0, Math.PI / 2, 0 ) } );

	}

	add( cylinder( 0.0068, 0.0085, 0.011, 18 ), { ...GUN, matrix: M( - 0.025, BODY_Y, RZ, 0, 0, Math.PI / 2 ) } );
	add( cylinder( 0.0045, 0.0045, 0.004, 12 ), { ...CHAMP, matrix: M( 0.021, BODY_Y, RZ, 0, 0, Math.PI / 2 ) } ); // screw cap
	// neck and trim ring between body and rotor
	add( lathe( [ [ 0.018, 0.348 ], [ 0.0205, 0.353 ], [ 0.0208, 0.357 ] ], 28 ), { ...CHAMP, matrix: M( 0, 0, RZ ) } );

	// rotor (anim 1): a cup open to the front, two arms carrying the bail
	const ROT = { ...BLACK, anim: 1 };
	add( lathe( [ [ 0.006, 0.356 ], [ 0.017, 0.358 ], [ 0.0235, 0.362 ], [ 0.0268, 0.37 ], [ 0.0275, 0.381 ], [ 0.0262, 0.386 ] ], 32 ), { ...ROT, matrix: M( 0, 0, RZ ) } );
	add( lathe( [ [ 0.0262, 0.386 ], [ 0.0248, 0.3865 ] ], 32 ), { ...CHAMP, anim: 1, matrix: M( 0, 0, RZ ) } );
	for ( const sx of [ - 1, 1 ] ) {

		add( roundedBox( 0.0065, 0.044, 0.013, 0.002, 2 ), { ...ROT, matrix: M( sx * 0.0285, 0.382, RZ ) } );
		// bail arm plates at the pivots (anim 2: they flip with the bail)
		add( roundedBox( 0.003, 0.012, 0.008, 0.001, 1 ), { ...STAINLESS, anim: 2, matrix: M( sx * 0.0322, PIVOT_Y, RZ ) } );

	}

	// bail wire (anim 2): around the spool from one arm to the other, and the line roller
	{
		const pts = [];
		for ( let i = 0; i <= 16; i ++ ) {

			const a = Math.PI * i / 16;
			pts.push( V( 0.0322 * Math.cos( a ), PIVOT_Y + 0.006 * Math.sin( a ), RZ - 0.0322 * Math.sin( a ) ) );

		}

		add( tube( pts, 0.0011, 40, 6 ), { ...STAINLESS, anim: 2 } );
		add( cylinder( 0.0032, 0.0032, 0.006, 12 ), { ...CHAMP, anim: 2, matrix: M( 0.0302, PIVOT_Y + 0.0015, RZ - 0.0035, Math.PI / 2, 0, 0 ) } );

	}

	// spool (anim 4) with braid (anim 5), front lip and drag knob
	const SP = ( o ) => ( { ...o, anim: 4, matrix: M( 0, 0, RZ ) } );
	add( lathe( [ [ 0.0282, 0.375 ], [ 0.0288, 0.381 ], [ 0.0285, 0.388 ], [ 0.0252, 0.392 ], [ 0.0238, 0.393 ] ], 36 ), SP( CHAMP ) );
	add( lathe( [ [ 0.0236, 0.3925 ], [ 0.0238, 0.395 ], [ 0.0238, 0.41 ], [ 0.0236, 0.4125 ] ], 36 ), { ...BRAID, anim: 5, matrix: M( 0, 0, RZ ) } );
	add( lathe( [ [ 0.0205, 0.3922 ], [ 0.0205, 0.4128 ] ], 24 ), SP( CHAMP ) ); // arbor under the braid
	add( lathe( [ [ 0.0236, 0.4125 ], [ 0.0262, 0.4135 ], [ 0.0266, 0.4155 ], [ 0.0235, 0.418 ], [ 0.016, 0.4195 ], [ 0.012, 0.42 ] ], 36 ), SP( CHAMP ) );
	add( lathe( [ [ 0.012, 0.42 ], [ 0.0125, 0.422 ], [ 0.0126, 0.431 ], [ 0.0118, 0.434 ], [ 0.009, 0.4355 ], [ 0, 0.436 ] ], 24 ), SP( { ...BLACK, pattern: PAT.knurl } ) );

	// crank handle (anim 3): shaft cap, arm, T-knob (on the left, cranked with the other hand)
	const CR = ( o, m ) => ( { ...o, anim: 3, matrix: m } );
	add( cylinder( 0.0052, 0.0052, 0.008, 12 ), CR( GUN, M( - 0.0315, BODY_Y, RZ, 0, 0, Math.PI / 2 ) ) );
	add( roundedBox( 0.0038, 0.058, 0.0075, 0.0018, 2 ), CR( CHAMP, M( - 0.036, BODY_Y - 0.026, RZ ) ) );
	add( cylinder( 0.0026, 0.0026, 0.01, 8 ), CR( STAINLESS, M( - 0.042, BODY_Y - 0.052, RZ, 0, 0, Math.PI / 2 ) ) );
	add( lathe( [ [ 0.003, 0 ], [ 0.0062, 0.0015 ], [ 0.0071, 0.007 ], [ 0.0068, 0.018 ], [ 0.0048, 0.0225 ], [ 0, 0.0235 ] ], 16 ), CR( { ...RUBBER, color: 0x1d1e20 }, M( - 0.046, BODY_Y - 0.052, RZ, 0, 0, Math.PI / 2 ) ) );

	return mergePrepared( parts );

}

function buildBobberGeometry() {

	const parts = [];
	parts.push( prepare( sphere( 0.028, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2 ), { color: 0xc8261c, rough: 0.35 } ) );
	parts.push( prepare( sphere( 0.028, 16, 8, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2 ), { color: 0xeeeae0, rough: 0.35 } ) );
	parts.push( prepare( cylinder( 0.004, 0.004, 0.07, 6 ), { color: 0xd9d4c8, rough: 0.5, matrix: mat4( 0, 0.055, 0 ) } ) );
	parts.push( prepare( cylinder( 0.0035, 0.0045, 0.03, 6 ), { color: 0xffd400, rough: 0.4, matrix: mat4( 0, 0.1, 0 ) } ) );
	return mergePrepared( parts );

}

function buildLineGeometry( n ) {

	const pos = new Float32Array( ( n + 1 ) * 2 * 3 );
	const line = new Float32Array( ( n + 1 ) * 2 * 2 );
	const idx = [];
	for ( let i = 0; i <= n; i ++ ) {

		for ( let s = 0; s < 2; s ++ ) {

			const j = i * 2 + s;
			line[ j * 2 ] = i / n;
			line[ j * 2 + 1 ] = s ? 1 : - 1;

		}

		if ( i < n ) {

			const a = i * 2;
			idx.push( a, a + 1, a + 2, a + 1, a + 3, a + 2 );

		}

	}

	const g = new BufferGeometry();
	g.setAttribute( 'position', new Float32BufferAttribute( pos, 3 ) );
	g.setAttribute( 'aLine', new Float32BufferAttribute( line, 2 ) );
	g.setIndex( idx );
	return g;

}
