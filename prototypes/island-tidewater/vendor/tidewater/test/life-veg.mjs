// Vegetation headless render: palms on the beach, the forest canopy + impostors on the hillside,
// understory, grass. Usage: node test/life-veg.mjs [outDir]   (VEG_STUB_GRASS=1 stubs the grass)
import { register } from 'node:module';
register( './life-veg-stubs.mjs', import.meta.url );
const { setupLife } = await import( './life-harness.mjs' );
const { Vegetation } = await import( '../src/world/Vegetation.js' );
const out = process.argv[ 2 ] || '.';
const W = +( process.env.W || 2560 ), H = +( process.env.H || 1267 );
const L = await setupLife( { W, H, ground: { center: [ 20, - 160 ], size: 900, res: 1 }, water: true, shadowSplits: [ 15, 80, 500 ] } );
const t0 = performance.now();
const veg = new Vegetation( { scene: L.scene, terrain: L.terrain } );
console.log( 'veg build ms', ( performance.now() - t0 ).toFixed( 0 ), JSON.stringify( veg.timings ) );
const upd = ( dt ) => veg.update( dt, L.camera );
const gy = ( x, z, dy ) => L.terrain.heightAt( x, z ) + dy;
const views = {
	beach: [ [ 10, gy( 10, - 52, 1.7 ), - 52 ], [ 30, gy( 30, - 80, 4 ), - 80 ] ],
	palms: [ [ - 40, gy( - 40, - 55, 1.7 ), - 55 ], [ - 60, gy( - 60, - 75, 5 ), - 75 ] ],
	forest: [ [ 20, 60, 20 ], [ 20, 60, - 300 ] ],
	under: [ [ 60, gy( 60, - 200, 1.7 ), - 200 ], [ 60, gy( 60, - 230, 2 ), - 230 ] ],
	trunk: 'palm',
	aerial: [ [ 150, 160, 150 ], [ 0, 20, - 250 ] ],
};
for ( const [ name, v ] of Object.entries( views ) ) {

	const [ p, t ] = v === 'palm' ? [ 'palm' ] : v;

	if ( process.env.VIEW && process.env.VIEW !== name ) continue;
	if ( p === 'palm' ) {

		// close to the palm nearest the beach view
		const r = veg.records.palms.reduce( ( a, b ) => ( Math.hypot( b.x - 10, b.z + 60 ) < Math.hypot( a.x - 10, a.z + 60 ) ? b : a ) );
		L.camera.position.set( r.x + 2.2, r.y + 1.6, r.z + 2.2 ); L.camera.lookAt( r.x, r.y + 2.5, r.z );

	} else {

		L.camera.position.set( ...p ); L.camera.lookAt( ...t );

	}
	await L.run( 4, upd );
	await L.save( `${ out }/veg-${ name }.png` );
	const st = veg.stats();
	console.log( name, 'tris', st.triangles, 'draws', st.drawCalls, 'mr draws', L.mr.stats.draws, JSON.stringify( Object.fromEntries( Object.entries( st.types ).map( ( [ k, v ] ) => [ k, v.near ? v.near.instances : v.nearCells ] ) ) ) );
	if ( process.env.TIME && name === process.env.TIME ) {

		const withV = await L.gpuTime( 20, upd );
		veg.group.visible = false;
		const without = await L.gpuTime( 20 );
		veg.group.visible = true;
		console.log( `frame ms with vegetation ${ withV.toFixed( 2 ) } without ${ without.toFixed( 2 ) }` );

	}

}
if ( process.env.DUMP ) {

	const { readTexture } = await import( '../src/engine/gpu/Readback.js' );
	const { writePNG } = await import( './headless.mjs' );
	for ( const [ n, t ] of [ [ 'atlasA', veg.atlas.rtA.texture ], [ 'atlasB', veg.atlas.rtB.texture ], [ 'leaf', veg.leafAtlas.texture ] ] ) {

		const img = await readTexture( t );
		const d = new Uint8Array( img.data );
		for ( let i = 3; i < d.length; i += 4 ) d[ i ] = 255;
		writePNG( `${ out }/veg-${ n }.png`, t.width, t.height, d );

	}

}
await L.exit();
