// Humpback whale (rigged, procedural skin from the baked maps), headless at 2560x1267:
// at the surface (from the air) and underwater (side view), plus a close-up of the head.
//   node test/life-whale.mjs [outDir]
import { readFileSync } from 'node:fs';
import { setupLife, groundMesh } from './life-harness.mjs';
import * as E from '../src/engine/index.js';

const OUT = process.argv[ 2 ] || '/tmp';
const W = + ( process.env.W || 2560 ), H = + ( process.env.H || 1267 );
// local files through fetch (the browser path of Whale.load / loadTexture)
const ROOT = new URL( '../public', import.meta.url ).pathname;
globalThis.fetch = async ( url ) => {

	const buf = readFileSync( ROOT + url );
	return { json: async () => JSON.parse( buf.toString() ), arrayBuffer: async () => buf.buffer.slice( buf.byteOffset, buf.byteOffset + buf.byteLength ) };

};

const L = await setupLife( { W, H, water: true } );
const { Whale } = await import( '../src/world/marine/Whale.js' );
let emitted = 0;
const spray = { emit( p, v, n ) { emitted += n; } };
const whale = new Whale( { scene: L.scene, terrain: L.terrain, spray } );
const t0 = performance.now();
await whale.load();
console.log( 'loaded in', ( performance.now() - t0 ).toFixed( 0 ), 'ms; lods', whale.meshes.map( ( m ) => m.geometry.index.count / 3 ) );
const b = whale.brain;
const cam = L.camera;

// run the brain until the whale is at the surface
let t = 0;
for ( ; t < 600; t += 0.1 ) {

	// (effects need dt > 0: the spout and fluke water go through the stub spray)

	whale.update( 0.1, cam );
	if ( t > 20 && b.backDepth < 0.3 ) break;

}

console.log( 'spray particles emitted', emitted );
console.log( 'surface after', t.toFixed( 1 ), 's at', b.position.toArray().map( ( x ) => x.toFixed( 1 ) ), 'backDepth', b.backDepth.toFixed( 2 ) );
L.scene.add( groundMesh( L.terrain, b.position.x, b.position.z, 400, 2 ) );
const upd = ( dt ) => whale.update( dt, cam );
const P = b.position;
const fwd = new E.Vector3( Math.sin( b.yaw ), 0, Math.cos( b.yaw ) );
const side = new E.Vector3( fwd.z, 0, - fwd.x );
const view = async ( name, off, look, fov = 50, n = 4 ) => {

	cam.fov = fov;
	for ( let i = 0; i < n; i ++ ) {

		L.frame( 1 / 60, ( dt ) => {

			upd( dt );
			const p = b.position;
			cam.position.set( p.x + off( fwd, side ).x, off( fwd, side ).y, p.z + off( fwd, side ).z );
			cam.lookAt( p.x + look( fwd ).x, look( fwd ).y, p.z + look( fwd ).z );

		} );
		await L.GPU.queue.onSubmittedWorkDone();

	}

	await L.save( OUT + `/whale-${ name }.png` );

};

// 1. at the surface, from the air, three-quarter view
await view( 'surface', ( f, s ) => f.clone().multiplyScalar( 12 ).add( s.clone().multiplyScalar( 14 ) ).setY( 7 ), ( f ) => f.clone().multiplyScalar( - 1 ).setY( 0 ), 45 );
// 2. underwater side view (the stub sea surface is translucent)
L.water.material.side = 'double';
await view( 'underwater', ( f, s ) => s.clone().multiplyScalar( - 18 ).setY( P.y - 1.5 ), () => new E.Vector3( 0, P.y - 1, 0 ), 50 );
// 3. close-up of the head (tubercles, skin maps)
await view( 'head', ( f, s ) => f.clone().multiplyScalar( 7 ).add( s.clone().multiplyScalar( 3.5 ) ).setY( P.y + 2.5 ), ( f ) => f.clone().multiplyScalar( 3 ).setY( P.y + 0.3 ), 40 );
// 4. motion vectors (swimming)
// (static camera, no sea: only the whale's own motion shows)
L.showVelocity = true;
L.water.visible = false;
cam.position.set( P.x - side.x * 18, P.y + 3, P.z - side.z * 18 );
cam.lookAt( P );
await L.run( 3, upd );
await L.save( OUT + '/whale-velocity.png' );
L.showVelocity = false;
L.water.visible = true;

// cost (lod0 close up)
cam.position.set( P.x + side.x * 10, P.y + 3, P.z + side.z * 10 );
cam.lookAt( P );
const withMs = await L.gpuTime( 30, upd );
for ( const m of whale.meshes ) m.layers.mask = 0;
const without = await L.gpuTime( 30, ( dt ) => {} );
console.log( `frame ms: with whale ${ withMs.toFixed( 2 ) } without ${ without.toFixed( 2 ) } (lod ${ whale.lod })` );
// long CPU run of the brain + effects (blows, slaps, fluke-up dives) through the stub spray
emitted = 0;
for ( let i = 0; i < 6000; i ++ ) whale.update( 0.1, cam );
console.log( 'spray particles emitted over 10 min', emitted, 'slaps', whale.brain.slaps );
await L.exit();
