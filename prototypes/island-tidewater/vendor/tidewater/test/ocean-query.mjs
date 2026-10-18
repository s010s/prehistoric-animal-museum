// WaterQuery: GPU heights read back to the CPU; compare against a CPU sample of the displacement map.
import { makeOceanScene } from './ocean-scene.mjs';
import { WaterQuery } from '../src/ocean/WaterQuery.js';

const s = await makeOceanScene( { W: 640, H: 360 } );
const q = new WaterQuery( null, s.surface );
const b = q.allocate( 'line', 20 );
for ( let i = 0; i < 20; i ++ ) q.setPoint( b + i, - 100 + i * 10, 5 );
q.setCamera( 0, 0 );
s.before.push( () => q.update() );
s.camera.position.set( 0, 5, 20 ); s.camera.lookAt( 0, 0, 0 );
for ( let i = 0; i < 10; i ++ ) s.frame();
await new Promise( ( r ) => setTimeout( r, 300 ) );
s.frame();
await new Promise( ( r ) => setTimeout( r, 300 ) );
console.log( 'valid', q.cpuValid, 'version', q.version, 'latency', q.latency.toFixed( 3 ) );
const o = {};
for ( let i = 0; i < 20; i += 3 ) console.log( 'x', - 100 + i * 10, JSON.stringify( q.get( b + i, o ) ) );
console.log( 'camera', JSON.stringify( q.get( 0, o ) ) );
process.exit( 0 );
