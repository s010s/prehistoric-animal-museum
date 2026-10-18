// Wildlife (birds, sanderlings, crabs, contact shadows) and gulls, headless at 2560x1267.
//   node test/life-wildlife.mjs [outDir]
import { setupLife } from './life-harness.mjs';
import * as E from '../src/engine/index.js';

const OUT = process.argv[ 2 ] || '/tmp';
const W = + ( process.env.W || 2560 ), H = + ( process.env.H || 1267 );
const T0 = performance.now();
const L = await setupLife( { W, H, ground: { center: [ 20, 0 ], size: 500 }, water: true } );
const { Wildlife } = await import( '../src/world/wildlife/Wildlife.js' );
const { Gulls } = await import( '../src/world/Gulls.js' );
const T = L.terrain;
const spray = { emit() {}, emitAlongPoints() {} };
// stubs of the terrain / shore stream modules for the swash probe (the real ones: TerrainGPU, ShoreWaves)
const { ShaderModule } = await import( '../src/engine/gpu/Shader.js' );
const terrainGPU = { module: new ShaderModule( { name: 'terrainStub', code: 'fn terrainHeightAt( xz: vec2f ) -> f32 { return 1.0 - xz.y * 0.03; }' } ) };
const shore = {
	period: { value: 9 },
	module: new ShaderModule( { name: 'shoreStub', code: `struct ShoreSample { runup: f32, inland: f32, dRdt: f32, tau: f32 };
fn shoreEvaluateNoNormal( xz: vec2f, depth: f32, groundH: f32 ) -> ShoreSample {
	var s: ShoreSample; s.runup = 1.5 + sin( frame.time ); s.inland = - depth / 0.066; s.dRdt = cos( frame.time ); s.tau = fract( frame.time / 9.0 ); return s; }` } ),
};
const wl = new Wildlife( { scene: L.scene, terrain: T, csm: L.shadows, spray, shore, terrainGPU } );
wl.blobs.mesh.userData.late = true;
const gulls = new Gulls( { scene: L.scene } );
console.log( 'constructed in', ( performance.now() - T0 ).toFixed( 0 ), 'ms; birds', wl.birds.agents.length );

// beach line at x: z where the sand is at height h
const beachZ = ( x, h ) => {

	let z0 = - 100, z1 = 120;
	for ( let i = 0; i < 40; i ++ ) {

		const zm = ( z0 + z1 ) / 2;
		if ( T.heightAt( x, zm ) > h ) z0 = zm; else z1 = zm;

	}

	return ( z0 + z1 ) / 2;

};

const cam = L.camera;
// warm up the simulations (CPU) with the camera on the beach
const zb = beachZ( 22, 1.2 );
cam.position.set( 22, T.heightAt( 22, zb - 8 ) + 1.7, zb - 8 );
cam.lookAt( 22, 0.5, zb + 6 );
cam.updateMatrixWorld();
const t1 = performance.now();
for ( let i = 0; i < 900; i ++ ) wl.update( 1 / 60, cam, null );
console.log( 'warm-up 900 updates', ( performance.now() - t1 ).toFixed( 0 ), 'ms; birds', wl.birdBatch.count, 'critters', wl.critterBatch.count, 'blobs', wl.blobs.records.count );
const upd = ( dt ) => wl.update( dt, cam, null );

// swash probe round trip (stub shore): a few rendered frames so the readback lands
await L.run( 12, ( dt ) => wl.update( dt, cam, null ) );
const pr = wl.shorebirds.probe;
console.log( 'swash probe', pr ? { valid: pr.valid, sample: Array.from( pr.cpu.slice( 0, 4 ) ).map( ( x ) => + x.toFixed( 3 ) ) } : 'none' );

// 1. sanderlings on the wet sand
const sb = wl.shorebirds.flocks[ 0 ];
const bird = sb.birds ? sb.birds[ 0 ] : null;
const bx = bird ? bird.x : 22, bz = bird ? bird.z : beachZ( 22, 0.3 );
cam.fov = 40;
cam.position.set( bx - 2.5, T.heightAt( bx - 2.5, bz - 5 ) + 1.2, bz - 5 );
cam.lookAt( bx, T.heightAt( bx, bz ) + 0.1, bz );
await L.run( 4, upd );
await L.save( OUT + '/wildlife-shorebirds.png' );

// 2. crabs + burrows close-up: a ghost crab out of its burrow and a hermit crab (tracked live)
const crabs = wl.crabs;
const pick = ( list ) => ( list || [] ).filter( ( x ) => x && x.visible !== false && ( x.out === undefined || x.out > 0.5 ) )
	.sort( ( a, b ) => Math.hypot( a.x - cam.position.x, a.z - cam.position.z ) - Math.hypot( b.x - cam.position.x, b.z - cam.position.z ) )[ 0 ];
for ( const [ name, list ] of [ [ 'ghost', crabs.ghosts ], [ 'hermit', crabs.hermits ] ] ) {

	if ( name === 'hermit' && crabs.homes.length ) {

		// hermit crabs come out near the viewer: walk the camera over to a home
		const h = crabs.homes[ 0 ];
		cam.position.set( h.x - 6, T.heightAt( h.x - 6, h.z ) + 1.7, h.z );
		cam.updateMatrixWorld();
		for ( let i = 0; i < 300; i ++ ) wl.update( 1 / 60, cam, null );

	}

	const c = pick( list );
	console.log( name, c ? [ c.x.toFixed( 1 ), c.z.toFixed( 1 ), c.state, c.out ] : 'none', ( list || [] ).length );
	if ( ! c ) continue;
	cam.fov = 14;
	const aim = () => {

		cam.position.set( c.x - 0.9, T.heightAt( c.x, c.z ) + 0.55, c.z - 1.1 );
		cam.lookAt( c.x, T.heightAt( c.x, c.z ) + 0.03, c.z );

	};

	for ( let i = 0; i < 4; i ++ ) {

		L.frame( 1 / 60, ( dt ) => {

			upd( dt );
			aim();

		} );
		await L.GPU.queue.onSubmittedWorkDone();

	}

	await L.save( OUT + `/wildlife-crab-${ name }.png` );

}

// 3. birds in flight: nearest flying bird of each kind, seen from 6 m
for ( const kind of [ 'gull', 'pelican', 'tern', 'frigate' ] ) {

	const a = wl.birds.agents.find( ( x ) => x.kind === kind && x.state !== 'perch' && x.f && x.f.P );
	if ( ! a ) continue;
	const P = a.f.P.pos || a.f.P.p || a.f.pos;
	const p = P ? new E.Vector3( P[ 0 ] ?? P.x, P[ 1 ] ?? P.y, P[ 2 ] ?? P.z ) : null;
	if ( ! p ) continue;
	cam.fov = 30;
	const d = kind === 'frigate' ? 9 : kind === 'pelican' ? 7 : 4;
	for ( let i = 0; i < 4; i ++ ) {

		cam.position.set( p.x + d, p.y + 1.0, p.z + d * 0.5 );
		cam.lookAt( p );
		L.frame( 1 / 60, ( dt ) => {

			upd( dt );
			const Q = a.f.P.pos || a.f.P.p || a.f.pos;
			p.set( Q[ 0 ] ?? Q.x, Q[ 1 ] ?? Q.y, Q[ 2 ] ?? Q.z );
			cam.position.set( p.x + d, p.y + 1.0, p.z + d * 0.5 );
			cam.lookAt( p );

		} );
		await L.GPU.queue.onSubmittedWorkDone();

	}

	await L.save( OUT + `/wildlife-${ kind }.png` );

}

// 4. overview of the bay (gulls soaring, pelican line)
cam.fov = 55;
cam.position.set( 20, 12, 60 );
cam.lookAt( 20, 8, - 40 );
await L.run( 3, upd );
await L.save( OUT + '/wildlife-bay.png' );

// cost: frames with and without the wildlife meshes
cam.position.set( bx - 2.5, T.heightAt( bx - 2.5, bz - 5 ) + 1.2, bz - 5 );
cam.lookAt( bx, T.heightAt( bx, bz ) + 0.1, bz );
const withMs = await L.gpuTime( 30, upd );
for ( const m of [ wl.birdBatch.mesh, wl.critterBatch.mesh, wl.blobs.mesh, gulls.mesh ] ) m.visible = false;
const without = await L.gpuTime( 30, upd );
console.log( `frame ms: with wildlife ${ withMs.toFixed( 2 ) }, without ${ without.toFixed( 2 ) }, cpu update ${ wl.cpuMs.toFixed( 3 ) } ms` );
await L.exit();
