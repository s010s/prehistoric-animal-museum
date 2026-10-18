import { setupLife } from './life-harness.mjs';
const L = await setupLife( { W: 1280, H: 640, ground: { center: [ 20, -60 ], size: 400 }, water: true } );
L.camera.position.set( 60, 30, 40 ); L.camera.lookAt( 20, 0, -60 );
await L.run( 2 );
await L.save( process.argv[ 2 ] || '/tmp/life-check.png' );
console.log( 'ms/frame', ( await L.gpuTime( 5 ) ).toFixed( 1 ) );
await L.exit();
