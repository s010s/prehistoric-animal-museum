// Reef (ReefBatch + ReefMaterials) headless render: views from above the water and underwater,
// velocity view, GPU time. Usage: node test/life-reef.mjs [outDir]   (REEF_STUB_FISH=1 stubs the fish)
import { register } from 'node:module';
register( './life-reef-stubs.mjs', import.meta.url );
const { setupLife } = await import( './life-harness.mjs' );
const { Reef } = await import( '../src/world/Reef.js' );
const out = process.argv[ 2 ] || '.';
const W = +( process.env.W || 2560 ), H = +( process.env.H || 1267 );
const L = await setupLife( { W, H, ground: { center: [ - 78, 58 ], size: 320, res: 0.5 }, water: true } );
const t0 = performance.now();
const reef = new Reef( { scene: L.scene, terrain: L.terrain } );
console.log( 'reef build ms', ( performance.now() - t0 ).toFixed( 0 ), JSON.stringify( reef.stats.instances ), 'kinds', JSON.stringify( reef.stats.kinds ) );
const upd = ( dt ) => reef.update( dt, L.camera.position );
const fy = ( x, z, dy ) => reef.floorHeightAt( x, z ) + dy;
const views = {
	above: [ [ - 60, 9, 95 ], [ - 78, - 4, 58 ] ],
	under: [ [ - 70, fy( - 70, 70, 2.2 ), 70 ], [ - 82, fy( - 82, 52, 0.3 ), 52 ] ],
	close: [ [ - 76, fy( - 76, 62, 1.3 ), 62 ], [ - 79, fy( - 79, 58, 0.2 ), 58 ] ],
	fans: [ [ - 60, fy( - 60, 40, 1.8 ), 40 ], [ - 70, fy( - 70, 34, 0.8 ), 34 ] ],
};
for ( const [ name, [ p, t ] ] of Object.entries( views ) ) {

	if ( process.env.VIEW && process.env.VIEW !== name ) continue;
	L.camera.position.set( ...p ); L.camera.lookAt( ...t );
	L.water.visible = name === 'above';
	await L.run( 4, upd );
	await L.save( `${ out }/reef-${ name }.png` );
	console.log( name, JSON.stringify( { visible: reef.stats.visible, tris: reef.stats.triangles, sub: reef.stats.subDraws, shadowSub: reef.stats.shadowSubDraws } ), 'draws', L.mr.stats.draws );
	if ( name === 'under' ) {

		L.showVelocity = true; await L.run( 1, upd ); await L.save( `${ out }/reef-${ name }-velocity.png` ); L.showVelocity = false;
		const withReef = await L.gpuTime( 20, upd );
		reef.group.visible = false;
		const without = await L.gpuTime( 20 );
		reef.group.visible = true;
		console.log( `frame ms with reef ${ withReef.toFixed( 2 ) } without ${ without.toFixed( 2 ) } (whole frame incl. shadows, ${ W }x${ H })` );

	}

}

await L.exit();
