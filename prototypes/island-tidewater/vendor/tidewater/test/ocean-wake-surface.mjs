// WakeSim inside the real water surface (WaterSurface vertex + fragment, WaterMaterial, WaterQuery).
import { makeOceanScene, terrainStub } from './ocean-scene.mjs';
import { Vector3 } from '../src/engine/index.js';
import { WakeSim } from '../src/ocean/WakeSim.js';
import { WaterQuery } from '../src/ocean/WaterQuery.js';

const out = process.argv[ 2 ] || '/tmp';
const lines = {
	zAft: - 3.4, wlEnd: 3.6,
	bottomAt( x, z ) {

		if ( z < this.zAft || z > this.wlEnd ) return NaN;
		const t = ( z - this.zAft ) / ( this.wlEnd - this.zAft );
		const hb = 1.1 * Math.sqrt( Math.max( 0, 1 - Math.pow( Math.max( 0, t - 0.55 ) / 0.45, 2 ) ) );
		if ( Math.abs( x ) > hb ) return NaN;
		return - 0.45 * ( 1 - ( x / Math.max( hb, 1e-3 ) ) ** 2 ) * ( 0.6 + 0.4 * ( 1 - t ) );

	},
};
let yaw = Math.PI / 2;
const boat = { model: { lines }, position: new Vector3( - 80, 0, 0 ), velocity: new Vector3(), driven: true, throttle: 0.8, rpm: 1, forward: ( v ) => v.set( Math.sin( yaw ), 0, Math.cos( yaw ) ) };
let wake, query;
const s = await makeOceanScene( { extra: ( { surface } ) => {

	wake = new WakeSim( null, { terrainGPU: terrainStub, boat } );
	surface.wake = wake;
	query = new WaterQuery( null, surface );

} } );
s.before.push( ( dt ) => {

	yaw += dt * 0.1;
	boat.velocity.set( Math.sin( yaw ) * 8, 0, Math.cos( yaw ) * 8 );
	boat.position.addScaledVector( boat.velocity, dt );
	wake.update( dt );
	query.setCamera( s.camera.position.x, s.camera.position.z );
	query.update();

} );
s.camera.position.set( - 70, 12, 30 ); s.camera.lookAt( - 30, 0, - 10 );
for ( let i = 0; i < 360; i ++ ) s.frame();
await s.save( `${ out }/ocean-wake-surface.png` );
console.log( 'boat at', boat.position.toArray().map( ( v ) => v.toFixed( 1 ) ).join( ',' ), 'frame ms', ( await s.time( 20 ) ).toFixed( 2 ) );
process.exit( 0 );
