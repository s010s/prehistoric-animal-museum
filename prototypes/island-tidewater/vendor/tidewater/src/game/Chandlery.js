import { Group, Mesh, Vector3, Matrix4 } from '../engine/index.js';
import { prepare, mergePrepared, box, cylinder, sphere, rod, torus, mat4 } from '../world/boat/GeoKit.js';
import { createPropMaterial, PAT } from './GameMaterials.js';
import { Vendor } from './Vendor.js';
import { loadStallAssets, KitBuilder, LAYER, ATLAS, place, Shapes } from './StallKit.js';

// The upgrade trader by the boathouse: a scanned work table with a tackle box, spools of line and
// reels, display shelves of rope and floats behind her, a rack of rods, jerrycans of diesel, fenders,
// a coil of mooring line and a hand-painted sign on posts (StallKit, Poly Haven CC0; the old
// procedural table is the fallback). Sells the gear levels in Gear.js and fuel.
export const CHANDLERY = { x: 85.5, z: - 60.5, yaw: - 1.9 }; // faces the beach and the pier

export class Chandlery {

	constructor( { scene, terrain, colliders, material = null } ) {

		const y = terrain.heightAt( CHANDLERY.x, CHANDLERY.z );
		this.material = material || createPropMaterial( 'chandlery' );
		this.group = new Group();
		this.group.name = 'Chandlery';
		this.group.position.set( CHANDLERY.x, y, CHANDLERY.z );
		this.group.rotation.y = CHANDLERY.yaw;
		scene.add( this.group );
		this.ready = loadStallAssets().then( ( a ) => {

			const mesh = new Mesh( buildChandleryKit( a ), a.material );
			mesh.name = 'ChandleryStall';
			mesh.castShadow = true;
			this.group.add( mesh );

		} ).catch( ( e ) => {

			console.error( 'Chandlery: stall assets failed, using the plain table', e );
			const mesh = new Mesh( buildTable(), this.material );
			mesh.castShadow = true;
			this.group.add( mesh );

		} );

		const local = new Vector3( 0, 0, - 0.75 ).applyAxisAngle( new Vector3( 0, 1, 0 ), CHANDLERY.yaw );
		const vx = CHANDLERY.x + local.x, vz = CHANDLERY.z + local.z;
		this.vendor = new Vendor( {
			name: 'Marta · Chandlery',
			kind: 'shop',
			position: new Vector3( vx, terrain.heightAt( vx, vz ), vz ),
			yaw: CHANDLERY.yaw,
			radius: 3.0,
			greeting: 'Line, reels, a bigger hold, diesel. What do you need?',
			material: this.material,
			// realistic character (Rocketbox, MIT): the stand-in shows until it has loaded
			character: { url: ( ( import.meta.env && import.meta.env.BASE_URL ) || '/' ) + 'models/characters/marta.glb', idle: 'idle_neutral_01', talk: 'gestic_talk_neutral_01', greet: 'wave_01' },
			look: { shirt: 0x8a3b32, trousers: 0x2f3b4a, apron: 0x3d5a4a, hat: 0x2c3a44, hair: 0x3a2c22, skin: 0x7a5236 },
		} );
		scene.add( this.vendor.group );
		if ( colliders ) {

			colliders.addBox( new Vector3( CHANDLERY.x, y + 0.45, CHANDLERY.z ), new Vector3( 1.0, 0.45, 0.4 ), CHANDLERY.yaw, { tag: 'chandlery' } );
			// shelves and sign posts behind her, the jerrycans and the rod rack
			for ( const [ lx, lz, hx, hz, hy ] of [ [ 0, - 1.4, 0.62, 0.22, 0.8 ], [ 1.25, 0.2, 0.3, 0.3, 0.26 ], [ - 1.35, - 0.9, 0.15, 0.3, 0.9 ] ] ) {

				const w = new Vector3( lx, 0, lz ).applyAxisAngle( new Vector3( 0, 1, 0 ), CHANDLERY.yaw );
				colliders.addBox( new Vector3( CHANDLERY.x + w.x, y + hy, CHANDLERY.z + w.z ), new Vector3( hx, hy, hz ), CHANDLERY.yaw, { tag: 'chandleryProps' } );

			}

		}

	}

	update( dt, player ) {

		this.vendor.update( dt, player );

	}

}

function buildTable() {

	const P = [];
	const add = ( g, o ) => P.push( prepare( g, o ) );
	let seed = 11;
	const rnd = () => ( ( seed = ( seed * 16807 ) % 2147483647 ) / 2147483647 );
	const jit = ( a ) => ( rnd() - 0.5 ) * a;
	const WOODX = ( c ) => ( { color: c, rough: 0.9, pattern: PAT.woodX } );
	const WOOD = ( c ) => ( { color: c, rough: 0.9, pattern: PAT.wood } );
	const V = ( x, y, z ) => new Vector3( x, y, z );
	// trestles and a top of three boards
	for ( const x of [ - 0.75, 0.75 ] ) for ( const s of [ - 1, 1 ] ) add( box( 0.06, 0.95, 0.06 ), { ...WOOD( 0x7a6b58 ), matrix: mat4( x, 0.43, s * 0.22, s * 0.28, 0, 0 ) } );
	for ( let i = 0; i < 3; i ++ ) add( box( 2.0, 0.035, 0.26 ), { ...WOODX( [ 0x8e7e68, 0x7d6d5a, 0x958670 ][ i ] ), matrix: mat4( jit( 0.02 ), 0.9, - 0.27 + i * 0.27, 0, jit( 0.02 ), 0 ) } );
	// tackle box (open), spools of line, two reels
	add( box( 0.5, 0.18, 0.3 ), { color: 0x2f6a4a, rough: 0.5, pattern: PAT.rusty, matrix: mat4( - 0.55, 1.01, 0.02 ) } );
	add( box( 0.5, 0.02, 0.3 ), { color: 0x2f6a4a, rough: 0.5, matrix: mat4( - 0.55, 1.2, - 0.16, - 1.2, 0, 0 ) } );
	for ( let i = 0; i < 4; i ++ ) add( cylinder( 0.045, 0.045, 0.05, 14 ), { color: [ 0xd8d4c8, 0x3aa0c8, 0xe0c040, 0xd8d4c8 ][ i ], rough: 0.5, matrix: mat4( 0.05 + i * 0.11, 0.945, 0.12, Math.PI / 2, 0, 0 ) } );
	for ( let i = 0; i < 2; i ++ ) {

		add( cylinder( 0.04, 0.04, 0.05, 16 ), { color: 0x7d8a90, rough: 0.3, metal: 1, matrix: mat4( 0.6 + i * 0.2, 0.96, - 0.1 ) } );
		add( rod( V( 0.6 + i * 0.2, 0.99, - 0.1 ), V( 0.64 + i * 0.2, 0.99, - 0.14 ), 0.004, 5 ), { color: 0x333333, rough: 0.4, metal: 1 } );

	}

	// jerrycans of diesel, a coil of rope and a stack of floats by the table
	for ( let i = 0; i < 3; i ++ ) add( box( 0.18, 0.34, 0.3 ), { color: i === 1 ? 0x1f5a2a : 0xb2261c, rough: 0.55, pattern: PAT.rusty, matrix: mat4( 1.25 + jit( 0.05 ), 0.17, - 0.2 + i * 0.22, 0, jit( 0.4 ), 0 ) } );
	for ( let i = 0; i < 4; i ++ ) add( torus( 0.2 - i * 0.012, 0.018, 6, 20 ), { color: 0xc9b48a, rough: 0.9, pattern: PAT.cloth, matrix: mat4( - 1.3, 0.02 + i * 0.035, 0.2, Math.PI / 2, 0, 0 ) } );
	for ( let i = 0; i < 3; i ++ ) add( sphere( 0.09, 10, 8 ), { color: [ 0xe2552a, 0xe8e2d0, 0xf2c230 ][ i ], rough: 0.5, matrix: mat4( - 1.1 + i * 0.12, 0.09, - 0.3 ) } );
	// a painted board leaning on the table (the price list)
	add( box( 0.7, 0.5, 0.025 ), { color: 0x2a302c, rough: 0.9, matrix: mat4( 0, 0.5, 0.33, - 0.2, 0, 0 ) } );
	add( box( 0.76, 0.56, 0.02 ), { ...WOODX( 0x7a6b58 ), matrix: mat4( 0, 0.5, 0.315, - 0.2, 0, 0 ) } );
	return mergePrepared( P );

}

// ---------------------------------------------------------------- the photoscanned stall

// Local frame: table centred at the origin (long side along x), the trader behind it at z -0.75,
// customers at +z.
function buildChandleryKit( assets ) {

	const K = new KitBuilder( assets, 11 );
	const { DECK, SIGN, PLAIN, ROPE, FLOAT } = LAYER;
	const V = ( x, y, z ) => new Vector3( x, y, z );
	const J = ( a ) => K.jit( a );
	const tone = () => { const t = 0.88 + K.rnd() * 0.2; return [ t, t, t * 0.97 ]; };
	const top = 0.83; // the table's top

	K.prop( 'WoodenTable_03', place( 0, 0, 0, 0.01 ) );
	// on the table: the tackle box, spools of line, two reels, lure packets, a coil of braid
	K.prop( 'metal_toolbox', place( - 0.38, top, - 0.02, 0.12 ) );
	const lineCols = [ [ 0.86, 0.86, 0.8 ], [ 0.18, 0.48, 0.72 ], [ 0.82, 0.68, 0.16 ], [ 0.16, 0.42, 0.2 ], [ 0.86, 0.86, 0.8 ] ];
	lineCols.forEach( ( c, i ) => {

		const x = 0.05 + i * 0.1, z = 0.12 + ( i % 2 ) * 0.03;
		K.geometry( Shapes.cylinder( 0.042, 0.042, 0.06, 20 ), place( x, top + 0.045, z, 0, 0, Math.PI / 2 ), { layer: ROPE, color: c, uvScale: [ 0.26, 3 ] } );
		for ( const s of [ - 1, 1 ] ) K.geometry( Shapes.cylinder( 0.05, 0.05, 0.006, 20 ), place( x + s * 0.033, top + 0.045, z, 0, 0, Math.PI / 2 ), { layer: PLAIN, color: [ 0.12, 0.12, 0.13 ], params: [ 0.4, 0 ] } );

	} );
	for ( let i = 0; i < 2; i ++ ) reel( K, place( 0.18 + i * 0.22, top, - 0.14, 0.5 + i * 0.4 ) );
	for ( let i = 0; i < 4; i ++ ) {

		K.box( 0.09, 0.14, 0.012, place( 0.5 + ( i % 2 ) * 0.1, top + 0.07, - 0.05 + ( i >> 1 ) * 0.02, 0.1, - 0.35 ), { layer: PLAIN, color: [ [ 0.8, 0.2, 0.15 ], [ 0.9, 0.75, 0.2 ], [ 0.2, 0.5, 0.75 ], [ 0.85, 0.85, 0.82 ] ][ i ], params: [ 0.35, 0 ] } );

	}

	K.coil( - 0.05, top, - 0.18, 0.1, 4, 0.005, [ 0.25, 0.5, 0.3 ] );

	// display shelves behind her: rope coils, floats, a crate of line
	K.prop( 'wooden_display_shelves_01', place( 0, 0, - 1.4, Math.PI / 2 ) );
	const shelfY = shelfLevels( K.bounds( 'wooden_display_shelves_01' ) );
	shelfY.forEach( ( y, k ) => {

		for ( let i = 0; i < 3; i ++ ) {

			const x = - 0.35 + i * 0.35;
			if ( ( k + i ) % 3 === 0 ) K.coil( x, y, - 1.4, 0.13, 4, 0.011, [ 0.7, 0.62, 0.45 ] );
			else if ( ( k + i ) % 3 === 1 ) for ( let f = 0; f < 3; f ++ ) K.geometry( floatGeo(), place( x - 0.08 + f * 0.08, y + 0.06, - 1.4 + J( 0.05 ), J( 0.4 ), Math.PI / 2, 0 ), { layer: FLOAT, color: [ [ 0.75, 0.22, 0.08 ], [ 0.82, 0.8, 0.74 ], [ 0.78, 0.6, 0.12 ] ][ ( f + k ) % 3 ] } );
			else K.geometry( Shapes.cylinder( 0.06, 0.06, 0.12, 18 ), place( x, y + 0.06, - 1.4 ), { layer: ROPE, color: [ 0.88, 0.86, 0.8 ], uvScale: [ 0.38, 3 ] } );

		}

	} );

	// the sign on two posts above the shelves, fenders hanging from the posts
	for ( const sx of [ - 1, 1 ] ) K.box( 0.09, 2.7, 0.09, place( sx * 1.08, 1.35, - 1.72, J( 0.2 ), J( 0.02 ), J( 0.02 ) ), { layer: DECK, along: 'y', color: tone() } );
	K.box( 2.3, 0.56, 0.04, place( 0, 2.28, - 1.66, 0, 0, J( 0.012 ) ), { layer: SIGN, along: 'x', uv2Rect: ATLAS.marta } );
	// a white fender and a blue one on the left post, the lifebuoy on the right one
	K.rope( [ V( - 1.08, 1.9, - 1.66 ), V( - 1.13, 1.62, - 1.58 ) ], 0.006 );
	K.geometry( fenderGeo(), place( - 1.14, 1.36, - 1.57, J( 1 ), 0, - 0.08 ), { layer: FLOAT, color: [ 0.84, 0.83, 0.8 ] } );
	K.rope( [ V( 1.08, 1.95, - 1.66 ), V( 1.08, 1.86, - 1.62 ) ], 0.006 );
	K.prop( 'lifebuoy', place( 1.08, 1.47, - 1.6, 0.04, 0, - 0.05 ) );

	// a lantern hanging from the sign's lower edge, left of Marta (lit from dusk, see App)
	K.rope( [ V( - 0.75, 2.0, - 1.62 ), V( - 0.75, 1.86, - 1.45 ) ], 0.004 );
	K.prop( 'wooden_lantern_01', place( - 0.75, 1.36, - 1.45, 0.3 ) );

	// the life jacket hangs from the left post
	K.prop( 'life_jacket', place( - 1.08, 1.05, - 1.6, 0.08 ) );

	// jerrycans of diesel on the right, a lifebuoy against the table, a big coil of mooring line
	K.prop( 'metal_jerrycan_green', place( 1.1, 0, 0.05, 0.3 ) );
	K.prop( 'metal_jerrycan_green', place( 1.38, 0, 0.32, - 0.25 ) );
	K.prop( 'plastic_jerrycan', place( 1.2, 0, 0.45, 1.3 ) );
	K.geometry( fenderGeo(), place( - 0.82, 0.1, 0.36, 0.3, 0, Math.PI / 2 - 0.1 ), { layer: FLOAT, color: [ 0.16, 0.3, 0.5 ] } );
	K.coil( - 1.15, 0, 0.55, 0.3, 6, 0.016, [ 0.72, 0.66, 0.5 ] );
	K.prop( 'wooden_crate_01', place( 1.35, 0, - 0.75, Math.PI / 2 + 0.2 ) );

	// a rack of rods on the left
	K.box( 0.06, 1.2, 0.06, place( - 1.35, 0.6, - 1.05 ), { layer: DECK, along: 'y', color: tone() } );
	K.box( 0.06, 1.2, 0.06, place( - 1.35, 0.6, - 0.6 ), { layer: DECK, along: 'y', color: tone() } );
	K.box( 0.06, 0.05, 0.6, place( - 1.35, 1.12, - 0.83 ), { layer: DECK, along: 'z', color: tone() } );
	K.box( 0.08, 0.04, 0.6, place( - 1.35, 0.1, - 0.83 ), { layer: DECK, along: 'z', color: tone() } );
	for ( let i = 0; i < 4; i ++ ) {

		const z = - 1.0 + i * 0.12, lean = - 0.08 - i * 0.02;
		const m = place( - 1.35, 0.12, z, 0, 0, lean );
		K.geometry( Shapes.cylinder( 0.0035, 0.009, 2.1, 8 ), m.clone().multiply( place( 0, 1.05, 0 ) ), { layer: PLAIN, color: [ 0.03, 0.03, 0.035 ], params: [ 0.2, 0 ] } );
		K.geometry( Shapes.cylinder( 0.014, 0.014, 0.3, 10 ), m.clone().multiply( place( 0, 0.2, 0 ) ), { layer: PLAIN, color: [ 0.55, 0.42, 0.28 ], params: [ 0.85, 0 ] } );
		reel( K, m.clone().multiply( place( 0, 0.42, 0.02, 0, Math.PI / 2 ) ), 0.7 );

	}

	return K.build();

}

// shelf board heights of the display shelves (y of each board's top), from its bounds
function shelfLevels( b ) {

	const h = b.max[ 1 ];
	return [ 0.08, 0.36, 0.64, 0.92, 1.2 ].map( ( f ) => f * h / 1.556 ).filter( ( y ) => y < h - 0.1 );

}

// a small spinning reel sitting on its foot at the matrix origin
function reel( K, m, s = 1 ) {

	const S = new Matrix4().makeScale( s, s, s );
	const mm = m.clone().multiply( S );
	const P = { layer: LAYER.PLAIN, color: [ 0.25, 0.26, 0.28 ], params: [ 0.35, 1 ] };
	K.box( 0.012, 0.03, 0.05, mm.clone().multiply( place( 0, 0.015, 0 ) ), P );
	K.geometry( Shapes.cylinder( 0.028, 0.028, 0.045, 16 ), mm.clone().multiply( place( 0, 0.05, 0, 0, Math.PI / 2 ) ), P );
	K.geometry( Shapes.cylinder( 0.022, 0.024, 0.03, 16 ), mm.clone().multiply( place( 0, 0.05, 0.035, 0, Math.PI / 2 ) ), { layer: LAYER.PLAIN, color: [ 0.7, 0.62, 0.45 ], params: [ 0.3, 1 ] } );
	K.box( 0.004, 0.05, 0.004, mm.clone().multiply( place( 0.028, 0.05, - 0.005 ) ), P );

}

function floatGeo() {

	const pts = [];
	for ( let i = 0; i <= 12; i ++ ) {

		const t = i / 12, e = Math.min( 1, Math.min( t, 1 - t ) / 0.25 );
		pts.push( [ 0.012 + 0.04 * Math.sqrt( e * ( 2 - e ) ), ( t - 0.5 ) * 0.15 ] );

	}

	return Shapes.lathe( pts, 12 );

}

// a boat fender: a long rounded cylinder with rope eyes at the ends
function fenderGeo() {

	const pts = [];
	for ( let i = 0; i <= 14; i ++ ) {

		const t = i / 14, e = Math.min( 1, Math.min( t, 1 - t ) / 0.18 );
		pts.push( [ 0.01 + 0.075 * Math.sqrt( e * ( 2 - e ) ), ( t - 0.5 ) * 0.5 ] );

	}

	return Shapes.lathe( pts, 16 );

}
