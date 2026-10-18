// Gulls.js close-up (vertex-shader flight) and the whale's LOD1 / LOD2 at their switch distances.
//   node test/life-gulls-whale-lod.mjs [outDir]
import { readFileSync } from 'node:fs';
import { setupLife } from './life-harness.mjs';
import * as E from '../src/engine/index.js';

const OUT = process.argv[ 2 ] || '/tmp';
const ROOT = new URL( '../public', import.meta.url ).pathname;
globalThis.fetch = async ( url ) => {

	const buf = readFileSync( ROOT + url );
	return { json: async () => JSON.parse( buf.toString() ), arrayBuffer: async () => buf.buffer.slice( buf.byteOffset, buf.byteOffset + buf.byteLength ) };

};

const L = await setupLife( { W: 2560, H: 1267, ground: { center: [ 35, - 10 ], size: 500, res: 2 }, water: true } );
const { Gulls } = await import( '../src/world/Gulls.js' );
const gulls = new Gulls( { scene: L.scene } );
const cam = L.camera;

// CPU copy of the shader's flight state for instance 0
const gA = gulls.mesh.geometry.attributes.gA.array, gB = gulls.mesh.geometry.attributes.gB.array;
const state = ( t, i = 0 ) => {

	const R = gA[ i * 4 + 2 ], dir = gB[ i * 4 + 3 ];
	const th = gB[ i * 4 ] + t * gB[ i * 4 + 1 ] / R * dir;
	return {
		p: new E.Vector3( gA[ i * 4 ] + Math.cos( th ) * R, gA[ i * 4 + 3 ] + Math.sin( th * 2 + gB[ i * 4 + 2 ] ) * 3, gA[ i * 4 + 1 ] + Math.sin( th ) * R ),
		fwd: new E.Vector3( - Math.sin( th ) * dir, 0, Math.cos( th ) * dir ),
	};

};

for ( const [ name, offs ] of [ [ 'side', ( s ) => new E.Vector3( s.fwd.z * 2.2, 0.4, - s.fwd.x * 2.2 ) ], [ 'below', ( s ) => new E.Vector3( s.fwd.x * 1.5, - 1.8, s.fwd.z * 1.5 ) ], [ 'above', ( s ) => new E.Vector3( - s.fwd.x * 1.2, 1.6, - s.fwd.z * 1.2 ) ] ] ) {

	cam.fov = 40;
	for ( let i = 0; i < 3; i ++ ) {

		L.frame( 1 / 60, ( dt, t ) => {

			const s = state( t );
			cam.position.copy( s.p ).add( offs( s ) );
			cam.lookAt( s.p );

		} );
		await L.GPU.queue.onSubmittedWorkDone();

	}

	await L.save( OUT + `/gulls-${ name }.png` );

}

gulls.mesh.visible = false;

// whale LODs
const { Whale } = await import( '../src/world/marine/Whale.js' );
const whale = new Whale( { scene: L.scene, terrain: L.terrain } );
await whale.load();
const b = whale.brain;
for ( let t = 0; t < 600; t += 0.1 ) {

	whale.update( 0.1, cam );
	if ( t > 20 && b.backDepth < 0.3 ) break;

}

const P = b.position.clone();
const side = new E.Vector3( Math.cos( b.yaw ), 0, - Math.sin( b.yaw ) );
// just inside / beyond each switch distance (48 m, 170 m; 8% hysteresis)
for ( const [ name, d, fov ] of [ [ 'lod0-47m', 47, 14 ], [ 'lod1-54m', 54, 12 ], [ 'lod1-160m', 160, 5 ], [ 'lod2-190m', 190, 4.2 ] ] ) {

	cam.fov = fov;
	whale._lod = d > 100 ? 1 : 0;
	for ( let i = 0; i < 3; i ++ ) {

		L.frame( 1 / 60, ( dt ) => {

			whale.update( dt, cam );
			const p = b.position;
			cam.position.set( p.x + side.x * d, p.y + d * 0.25, p.z + side.z * d );
			cam.lookAt( p );

		} );
		await L.GPU.queue.onSubmittedWorkDone();

	}

	console.log( name, 'lod', whale.lod, 'dist', cam.position.distanceTo( b.position ).toFixed( 1 ) );
	await L.save( OUT + `/whale-${ name }.png` );

}

await L.exit();
