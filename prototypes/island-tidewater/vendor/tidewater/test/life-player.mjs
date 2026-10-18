// Player / BoatController / FlyCamera on the CPU (node, no GPU) with stubs: a gentle analytic
// swell behind the WaterQuery API, empty colliders, a boat model with the BoatModel anchor API.
// Simulates walking, swimming, boarding + driving the boat, leaving it, and the fly camera, and
// asserts finite, plausible states.
//   node test/life-player.mjs
import * as E from '../src/engine/index.js';
import { TerrainData } from '../src/world/TerrainData.js';
import { WORLD } from '../src/world/WorldLayout.js';
import { Player } from '../src/player/Player.js';
import { BoatController } from '../src/player/BoatController.js';
import { FlyCamera } from '../src/player/FlyCamera.js';

let fails = 0;
const check = ( ok, msg ) => {

	console.log( ( ok ? 'ok   ' : 'FAIL ' ) + msg );
	if ( ! ok ) fails ++;

};
const finite = ( v ) => [ v.x, v.y, v.z ].every( Number.isFinite );

const terrain = new TerrainData();

// ---- WaterQuery stub: swell h = 0.25 sin( k x + w t ) + 0.15 sin( k2 z - w2 t ); cpu = ( h, nx, nz, 0 )
let time = 0;
const swell = ( x, z, t ) => 0.25 * Math.sin( 0.18 * x + 0.9 * t ) + 0.15 * Math.sin( 0.11 * z - 0.7 * t );
const swellGrad = ( x, z, t ) => [ 0.25 * 0.18 * Math.cos( 0.18 * x + 0.9 * t ), 0.15 * 0.11 * Math.cos( 0.11 * z - 0.7 * t ) ];
const query = {
	n: 0, slots: {}, points: new Float32Array( 1024 * 4 ), cpu: new Float32Array( 1024 * 4 ), resultInputs: new Float32Array( 1024 * 4 ),
	cpuValid: false, version: 0, resultTime: 0, latency: 2 / 60,
	allocate( name, n ) {

		const s = this.n;
		this.n += n;
		this.slots[ name ] = s;
		return s;

	},
	setPoint( i, x, z ) {

		this.points[ i * 4 ] = x;
		this.points[ i * 4 + 1 ] = z;

	},
	// "read-back": evaluate the swell at the queued points (a frame late, as the GPU would)
	tick() {

		for ( let i = 0; i < this.n; i ++ ) {

			const x = this.points[ i * 4 ], z = this.points[ i * 4 + 1 ];
			const [ gx, gz ] = swellGrad( x, z, time );
			const l = Math.hypot( gx, 1, gz );
			this.cpu[ i * 4 ] = swell( x, z, time );
			this.cpu[ i * 4 + 1 ] = - gx / l;
			this.cpu[ i * 4 + 2 ] = - gz / l;
			this.resultInputs[ i * 4 ] = x;
			this.resultInputs[ i * 4 + 1 ] = z;

		}

		this.cpuValid = true;
		this.version ++;
		this.resultTime = time;

	},
};

// ---- colliders stub (no pier / buildings)
const colliders = { boxes: [], groundHeightAt: () => - Infinity, resolveCapsule: () => false };

// ---- boat model stub (BoatModel's anchor / hydro API, an 8.2 m hull as a 5 x 3 waterplane grid)
const hullSamples = [];
for ( let i = 0; i < 5; i ++ ) for ( let j = 0; j < 3; j ++ ) hullSamples.push( { position: new E.Vector3( ( j - 1 ) * 0.95, - 0.22, - 3.2 + i * 1.5 ), area: 1.1, bottomY: - 0.6 } );
const volume = hullSamples.reduce( ( a, s ) => a + s.area * - s.position.y, 0 );
const calls = { throttle: 0, steer: 0, rpm: 0 };
const model = {
	group: new E.Group(),
	hullSamples,
	hydro: { suggestedMass: Math.round( 1025 * volume ), centerOfMass: new E.Vector3( 0, 0.3, - 0.2 ), centerOfBuoyancy: new E.Vector3( 0, - 0.11, - 0.2 ), inertia: new E.Vector3( 14600, 15700, 3500 ) },
	helmEye: new E.Vector3( 0.4, 1.85, 0.3 ),
	boardPoint: new E.Vector3( 0, 0.9, - 1.75 ),
	exitPoints: [ new E.Vector3( 1.3, 0.95, - 1 ), new E.Vector3( - 1.3, 0.95, - 1 ) ],
	propeller: new E.Vector3( 0, - 0.55, - 3.3 ),
	rudder: new E.Vector3( 0, - 0.5, - 3.6 ),
	dimensions: { houseRoofHeight: 2.5 },
	setThrottle( v ) { calls.throttle = v; },
	setSteering( v ) { calls.steer = v; },
	setPropellerRPM( v ) { calls.rpm = v; },
};

// ---- input stub (Input's API)
class InputStub {

	constructor() { this.keys = new Set(); this.pressed = new Set(); this.look = { x: 0, y: 0 }; this.wheel = 0; this.enabled = true; }
	down( c ) { return this.keys.has( c ); }
	hit( c ) { return this.pressed.has( c ); }
	press( c ) { this.pressed.add( c ); }
	consumeLook() { const l = { ...this.look }; this.look.x = this.look.y = 0; return l; }
	consumeWheel() { const w = this.wheel; this.wheel = 0; return w; }
	endFrame() { this.pressed.clear(); }

}

const input = new InputStub();
const camera = new E.PerspectiveCamera( 60, 2, 0.1, 5000 );
const boat = new BoatController( { model, query, terrain, colliders } );
const player = new Player( { camera, input, terrain, colliders, query, boat } );

const dt = 1 / 60;
const run = ( sec, each = null ) => {

	for ( let t = 0; t < sec; t += dt ) {

		time += dt;
		if ( each ) each();
		player.update( dt );
		boat.queueQueries();
		boat.update( dt );
		query.tick();
		input.endFrame();

	}

};

// ---- boat settles at the mooring
run( 4 );
check( finite( boat.position ) && Math.abs( boat.position.y ) < 0.6, `boat floats at the mooring: y ${ boat.position.y.toFixed( 3 ) } m (mass ${ boat.mass } kg)` );
check( boat.position.distanceTo( WORLD.boatDock.position ) < 3, `boat stays moored: ${ boat.position.distanceTo( WORLD.boatDock.position ).toFixed( 2 ) } m from the dock` );

// ---- walk
const p0 = player.position.clone();
input.keys.add( 'KeyW' );
run( 3 );
input.keys.delete( 'KeyW' );
run( 0.5 );
const walked = Math.hypot( player.position.x - p0.x, player.position.z - p0.z );
const g = terrain.heightAt( player.position.x, player.position.z );
check( player.mode === 'walk' && walked > 3 && walked < 30, `walk: moved ${ walked.toFixed( 2 ) } m in 3 s, mode ${ player.mode }` );
check( Math.abs( player.position.y - g ) < 0.3, `walk: feet on the ground (y ${ player.position.y.toFixed( 2 ) }, ground ${ g.toFixed( 2 ) })` );
check( finite( camera.position ) && Math.abs( camera.position.y - player.position.y - 1.62 ) < 0.3, `walk: eye at ${ ( camera.position.y - player.position.y ).toFixed( 2 ) } m` );

// ---- swim: drop the player into deep water off the beach
let sx = 20, sz = 80;
while ( terrain.heightAt( sx, sz ) > - 6 && sz < 400 ) sz += 5;
player.position.set( sx, 0, sz );
player.mode = 'swim';
player.velocity.set( 0, 0, 0 );
run( 3 );
check( player.mode === 'swim' && finite( player.position ), `swim: mode ${ player.mode } at depth ${ terrain.heightAt( sx, sz ).toFixed( 1 ) } m` );
check( Math.abs( player.position.y - swell( player.position.x, player.position.z, time ) ) < 1.0, `swim: floats at the surface (y ${ player.position.y.toFixed( 2 ) }, water ${ swell( player.position.x, player.position.z, time ).toFixed( 2 ) })` );
input.keys.add( 'KeyW' );
player.pitch = - 0.9; // look down + W: dive
run( 2 );
input.keys.delete( 'KeyW' );
check( player.position.y < swell( player.position.x, player.position.z, time ) - 0.5, `swim: dives (y ${ player.position.y.toFixed( 2 ) })` );
input.keys.add( 'Space' );
run( 4 );
input.keys.delete( 'Space' );
check( player.position.y > - 1.2, `swim: rises again (y ${ player.position.y.toFixed( 2 ) })` );

// ---- board the boat
const bp = boat.toWorld( model.boardPoint, new E.Vector3() );
player.position.set( bp.x + 1, bp.y, bp.z );
player.mode = 'walk';
run( 0.1 );
check( player.nearBoat(), 'boat: near the board point' );
input.press( 'KeyE' );
run( dt );
check( player.mode === 'boat' && boat.driven && ! boat.moored, `boat: boarded (mode ${ player.mode })` );

// ---- drive: full ahead, then a turn
const b0 = boat.position.clone();
input.keys.add( 'KeyW' );
input.keys.add( 'ShiftLeft' );
run( 12 );
const straight = boat.speed;
input.keys.add( 'KeyA' );
const yaw0 = boat.getYaw();
run( 6 );
input.keys.delete( 'KeyA' );
const turned = Math.atan2( Math.sin( boat.getYaw() - yaw0 ), Math.cos( boat.getYaw() - yaw0 ) );
input.keys.delete( 'KeyW' );
input.keys.delete( 'ShiftLeft' );
check( finite( boat.position ) && finite( boat.velocity ) && boat.isFinite(), 'boat: state finite' );
check( straight > 3 && straight < 16, `boat: speed after 12 s full ahead ${ straight.toFixed( 2 ) } m/s (${ ( straight * 1.944 ).toFixed( 1 ) } kn)` );
check( Math.abs( turned ) > 0.3, `boat: turns (${ ( turned * 180 / Math.PI ).toFixed( 0 ) } deg in 6 s)` );
check( boat.position.distanceTo( b0 ) > 30, `boat: travelled ${ boat.position.distanceTo( b0 ).toFixed( 1 ) } m` );
check( Math.abs( boat.position.y ) < 1.0, `boat: at the surface (y ${ boat.position.y.toFixed( 2 ) })` );
const up = new E.Vector3( 0, 1, 0 ).applyQuaternion( boat.quaternion );
check( up.y > 0.9, `boat: upright (up.y ${ up.y.toFixed( 3 ) })` );
check( calls.rpm !== 0 && calls.throttle > 0.5, `boat: model animated (throttle ${ calls.throttle.toFixed( 2 ) }, prop rpm ${ calls.rpm.toFixed( 0 ) })` );
check( finite( camera.position ) && camera.position.distanceTo( boat.position ) < 45, `boat: chase camera ${ camera.position.distanceTo( boat.position ).toFixed( 1 ) } m from the boat` );
input.press( 'KeyV' );
run( 1 );
check( player.camMode === 'first' && camera.position.distanceTo( boat.toWorld( model.helmEye, new E.Vector3() ) ) < 0.4, 'boat: helm camera at the helm eye (within one boat step)' );

// ---- coast, then leave the boat (out at sea: swim)
run( 15 );
input.press( 'KeyE' );
run( 1 );
check( player.mode === 'swim' || player.mode === 'walk', `boat: left the boat (mode ${ player.mode })` );
check( ! boat.driven && finite( player.position ), 'boat: no longer driven' );
run( 5 );
check( finite( boat.position ) && boat.speed < straight, `boat: drifts (speed ${ boat.speed.toFixed( 2 ) } m/s)` );

// ---- fly camera
const fly = new FlyCamera( camera, { addEventListener() {} }, input );
fly.setPose( new E.Vector3( 0, 20, 0 ), 0, 0 );
input.keys.add( 'KeyW' );
for ( let i = 0; i < 60; i ++ ) fly.update( dt );
input.keys.delete( 'KeyW' );
check( camera.position.z < - 3 && Math.abs( camera.position.x ) < 1e-3, `fly: moves forward along -z (${ camera.position.toArray().map( ( v ) => v.toFixed( 2 ) ) })` );
input.look.x = 100;
fly.update( dt );
check( Math.abs( fly.yaw + 0.22 ) < 1e-6, `fly: mouse look (yaw ${ fly.yaw.toFixed( 3 ) })` );

console.log( fails ? `${ fails } FAILED` : 'all passed' );
process.exit( fails ? 1 : 0 );
