// Boat stream test: builds the procedural lobster boat (BoatModel) over a plain ground plane and
// renders it from a few angles at 2560x1267 with engine sun shadows.
//   node test/world-boat.mjs [outPrefix]     -> <outPrefix>-{side,deck,helm,stern,bow}.png
import './headless.mjs';
import { worldHarness, done } from './world-harness.mjs';
import { Material } from '../src/engine/render/Material.js';
import { BoatModel } from '../src/world/BoatModel.js';

const out = process.argv[ 2 ] || '/tmp/claude-boat';
const H = await worldHarness( { width: 2560, height: 1267 } );
const { E, G, scene } = H;

const t0 = performance.now();
const boat = new BoatModel();
console.log( 'boat built in', ( performance.now() - t0 ).toFixed( 0 ), 'ms, triangles', boat.triangleCount, 'draft', boat.dimensions.draft.toFixed( 2 ) );

// the boat floats on its design waterline (y = 0): put a sandy "sea floor" plane just under the keel
const ground = new E.Mesh( new E.PlaneGeometry( 200, 200 ).rotateX( - Math.PI / 2 ), new Material( { name: 'ground', color: 0x8f8a78, roughness: 0.95 } ) );
ground.position.y = - boat.dimensions.draft - 0.02;
ground.receiveShadow = true;
scene.add( ground, boat.group );
boat.group.rotation.y = 0.15;
boat.group.position.set( 0.3, 0, - 0.2 );
boat.group.updateMatrixWorld( true );

// animated state: helm over a bit, throttle ahead, prop spinning, flag in the breeze
boat.setSteering( 0.3 );
boat.setThrottle( 0.5 );
boat.setPropellerRPM( 900 );
if ( G.time ) G.time.value = 3.7;
for ( let i = 0; i < 30; i ++ ) boat.update( 1 / 30 );
boat.group.updateMatrixWorld( true );

const W = ( x, y, z ) => { const v = new E.Vector3( x, y, z ).applyMatrix4( boat.group.matrixWorld ); return [ v.x, v.y, v.z ]; };
const eye = boat.helmEye;

await H.shot( `${ out }-side.png`, { pos: W( - 10, 2.0, 1.5 ), target: W( 0, 0.6, 0 ), fov: 50 } );
await H.shot( `${ out }-deck.png`, { pos: W( - 0.6, 3.1, - 6.2 ), target: W( 0, 1.0, - 1.6 ), fov: 50 } );
await H.shot( `${ out }-helm.png`, { pos: W( eye.x, eye.y, eye.z - 0.3 ), target: W( eye.x * 0.5, 1.25, 1.6 ), fov: 60 } );
await H.shot( `${ out }-stern.png`, { pos: W( 3.0, 1.4, - 8.5 ), target: W( 0, 0.2, - 3.5 ), fov: 45 } );
await H.shot( `${ out }-bow.png`, { pos: W( 5.5, 3.5, 8.5 ), target: W( 0, 1.2, 1.0 ), fov: 50 } );

H.setView( { pos: W( - 10, 2.0, 1.5 ), target: W( 0, 0.6, 0 ), fov: 50 } );
const t = await H.timeMain( 20 );
console.log( `main pass (side view): min ${ t.min.toFixed( 2 ) } ms, median ${ t.median.toFixed( 2 ) } ms` );
await done();
