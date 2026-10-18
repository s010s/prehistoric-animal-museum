import { Group, Mesh, Vector3, BoxGeometry, Matrix4, Quaternion } from '../engine/index.js';
import { mergeGeometries } from '../engine/geometry/BufferGeometryUtils.js';
import { prepare, mergePrepared, box, cylinder, sphere, rod, mat4 } from '../world/boat/GeoKit.js';
import { createPropMaterial, PAT } from './GameMaterials.js';
import { Vendor } from './Vendor.js';
import { loadStallAssets, KitBuilder, LAYER, ATLAS, place, Shapes } from './StallKit.js';
import { FishProps } from '../world/fish/FishProps.js';
import { FISH } from './FishTable.js';

// The fish buyer's stall on the beach by the pier: a weathered plank shack with a rusty tin roof,
// a wooden fish box of crushed ice on the counter, a hanging spring scale, floats, crates, a
// chalkboard of prices and a hand-painted sign, and the buyer behind it. Built from photoscanned
// surfaces and props (StallKit, Poly Haven CC0); the old procedural stall is the fallback if they
// fail to load.
export const STAND = { x: 49.9, z: - 74.6, yaw: 1.45 }; // beside the boardwalk up from the pier foot, facing it

const STALL_FLOOR = 0.06; // top of the stall's plank floor (local y)
const ICE_TOP = 1.27; // top of the ice in the chest on the counter (local y)

export class FishStand {

	constructor( { scene, terrain, colliders } ) {

		const y = terrain.heightAt( STAND.x, STAND.z );
		this.material = createPropMaterial( 'fishStand' );
		this.group = new Group();
		this.group.name = 'FishStand';
		this.group.position.set( STAND.x, y, STAND.z );
		this.group.rotation.y = STAND.yaw;
		scene.add( this.group );
		this.ready = loadStallAssets().then( ( a ) => {

			const mesh = new Mesh( buildStallKit( a ), a.material );
			mesh.name = 'FishStandStall';
			mesh.castShadow = true;
			this.group.add( mesh );

		} ).catch( ( e ) => {

			console.error( 'FishStand: stall assets failed, using the plain stall', e );
			const mesh = new Mesh( buildStall(), this.material );
			mesh.castShadow = true;
			this.group.add( mesh );

		} );

		// the buyer stands behind the counter (local -Z), facing out (+Z)
		// (local z 0.12: clear of the shelf at -0.78..-0.48 and the counter top from 0.58)
		const local = new Vector3( 0.2, 0, 0.12 ).applyAxisAngle( new Vector3( 0, 1, 0 ), STAND.yaw );
		this.vendor = new Vendor( {
			name: 'Joe · Fish buyer',
			kind: 'buyer',
			position: new Vector3( STAND.x + local.x, y + STALL_FLOOR, STAND.z + local.z ),
			yaw: STAND.yaw,
			radius: 3.2,
			greeting: 'Let\'s see what you caught. Fair prices, cash.',
			idle: 'Nothing to sell? The grunts are biting off the pier.',
			material: this.material,
			// realistic character (Rocketbox, MIT): the stand-in shows until it has loaded
			character: { url: ( ( import.meta.env && import.meta.env.BASE_URL ) || '/' ) + 'models/characters/joe.glb', idle: 'idle_neutral_01', talk: 'gestic_talk_relaxed_01', greet: 'wave_01' },
		} );
		scene.add( this.vendor.group );

		// the stall is solid (counter front and the side walls)
		if ( colliders ) {

			colliders.addBox( new Vector3( STAND.x, y + 1.2, STAND.z ), new Vector3( 1.45, 1.2, 0.95 ), STAND.yaw, { tag: 'fishStand' } );
			// the crates, the bucket and the chalkboard around it
			for ( const [ lx, lz, hx, hz, hy ] of [ [ - 1.85, 0.25, 0.45, 0.25, 0.35 ], [ 1.8, - 0.2, 0.3, 0.6, 0.23 ], [ 1.55, 1.05, 0.2, 0.2, 0.28 ], [ 1.95, 1.45, 0.35, 0.25, 0.42 ] ] ) {

				const w = new Vector3( lx, 0, lz ).applyAxisAngle( new Vector3( 0, 1, 0 ), STAND.yaw );
				colliders.addBox( new Vector3( STAND.x + w.x, y + hy, STAND.z + w.z ), new Vector3( hx, hy, hz ), STAND.yaw, { tag: 'fishStandProps' } );

			}

		}

	}

	// fish laid on the ice chest (world frames for CatchDisplay): { species, frame, L, pose }
	iceFish() {

		const out = [];
		const list = [ [ 'jack', 0.36 ], [ 'redSnapper', 0.34 ], [ 'yellowtail', 0.3 ], [ 'grunt', 0.26 ], [ 'mullet', 0.33 ] ];
		const base = new Matrix4().makeRotationY( STAND.yaw ).setPosition( STAND.x, this.group.position.y, STAND.z );
		list.forEach( ( [ species, L ], i ) => {

			// across the chest, nose toward the customer's right, alternating flanks, a little askew. The
			// frame origin is the fish's body axis: lift it by the half thickness of the fish lying on its
			// side so it rests on the ice instead of sinking into it; later fish lie a little higher,
			// overlapping the one before like a real display.
			const rest = FishProps.restHeight( FISH[ species ].model, L );
			const local = new Matrix4().makeRotationY( ( i % 2 ? 0.12 : - 0.1 ) ).setPosition( - 0.55 + ( i % 2 ? 0.04 : - 0.04 ), ICE_TOP + rest + 0.006 * i, 0.7 + i * 0.085 );
			out.push( { species, frame: new Matrix4().multiplyMatrices( base, local ), L, pose: i % 2 ? 'sideFlip' : 'side' } );

		} );
		return out;

	}

	update( dt, player ) {

		this.vendor.update( dt, player );

	}

}

// Stall in local space: 2.6 m wide (x), 1.6 m deep (z, counter at +z), roof sloping back.
function buildStall() {

	const P = [];
	const add = ( g, o ) => P.push( prepare( g, o ) );
	const WOOD = ( c = 0x8a7a66 ) => ( { color: c, rough: 0.9, pattern: PAT.wood } );
	const WOODX = ( c = 0x8a7a66 ) => ( { color: c, rough: 0.9, pattern: PAT.woodX } );
	const TIN = { color: 0x8c9296, rough: 0.55, metal: 0.7, pattern: PAT.rusty };
	const V = ( x, y, z ) => new Vector3( x, y, z );
	let seed = 7;
	const rnd = () => ( ( seed = ( seed * 16807 ) % 2147483647 ) / 2147483647 );
	const jit = ( a ) => ( rnd() - 0.5 ) * a;

	// four posts, slightly out of true; front ones taller for the roof slope
	for ( const [ x, z, hgt ] of [ [ - 1.25, 0.75, 2.45 ], [ 1.25, 0.75, 2.42 ], [ - 1.25, - 0.75, 2.12 ], [ 1.25, - 0.75, 2.15 ] ] ) {

		add( box( 0.1, hgt, 0.1 ), { ...WOOD( 0x7d6c58 ), matrix: mat4( x, hgt / 2, z, jit( 0.03 ), 0, jit( 0.03 ) ) } );

	}

	// counter front: horizontal planks of uneven width and tone, one missing near the bottom
	let yy = 0.12;
	for ( let i = 0; i < 7; i ++ ) {

		const w = 0.12 + rnd() * 0.04;
		if ( i !== 1 ) add( box( 2.56 + jit( 0.05 ), w - 0.012, 0.025 ), { ...WOODX( [ 0x8e7e68, 0x7a6b58, 0x9a8c78, 0x6f624f ][ i % 4 ] ), matrix: mat4( jit( 0.03 ), yy + w / 2, 0.8, 0, jit( 0.02 ), jit( 0.015 ) ) } );
		yy += w;

	}

	// counter top (thick, scrubbed boards) and a shelf behind it
	for ( let i = 0; i < 4; i ++ ) add( box( 2.7, 0.045, 0.15 ), { ...WOODX( i % 2 ? 0x9b8b74 : 0x8d7d68 ), matrix: mat4( jit( 0.02 ), 1.02, 0.66 + i * 0.155, 0, jit( 0.015 ), 0 ) } );
	add( box( 2.5, 0.035, 0.3 ), { ...WOODX( 0x7a6b58 ), matrix: mat4( 0, 0.7, - 0.63 ) } );
	// plank floor inside the stall (the buyer stands on it, between the shelf and the counter)
	for ( let i = 0; i < 9; i ++ ) add( box( 2.52, 0.04, 0.165 + jit( 0.01 ) ), { ...WOODX( [ 0x7a6b58, 0x6f624f, 0x857562 ][ i % 3 ] ), matrix: mat4( jit( 0.02 ), STALL_FLOOR - 0.02, - 0.7 + i * 0.172, 0, jit( 0.02 ), 0 ) } );
	// side walls: vertical planks, half height
	for ( const s of [ - 1, 1 ] ) for ( let i = 0; i < 11; i ++ ) {

		const z = - 0.72 + i * 0.145;
		add( box( 0.022, 1.0 + jit( 0.06 ), 0.13 ), { ...WOOD( [ 0x857562, 0x77684f, 0x928470 ][ i % 3 ] ), matrix: mat4( s * 1.3, 0.52, z, 0, 0, jit( 0.02 ) ) } );

	}

	// back wall planks up to the roof
	for ( let i = 0; i < 18; i ++ ) {

		const x = - 1.25 + i * 0.147;
		add( box( 0.135, 2.05 + jit( 0.05 ), 0.022 ), { ...WOOD( [ 0x7f6f5b, 0x8a7a64, 0x6d604e ][ i % 3 ] ), matrix: mat4( x, 1.03, - 0.8, jit( 0.01 ), 0, 0 ) } );

	}

	// roof: rafters and corrugated tin sheets, one lifted and rusted through at the edge
	for ( const x of [ - 1.25, 0, 1.25 ] ) add( box( 0.07, 0.09, 2.0 ), { ...WOOD( 0x6d604e ), matrix: mat4( x, 2.33, 0, - 0.16 ) } );
	for ( let i = 0; i < 4; i ++ ) {

		const x = - 1.14 + i * 0.76;
		const g = corrugated( 0.8, 2.1, 9 );
		add( g, { ...TIN, matrix: mat4( x, 2.4 + ( i === 3 ? 0.03 : 0 ), 0.04, - 0.16 + ( i === 3 ? 0.03 : 0 ), jit( 0.02 ), jit( 0.02 ) ) } );

	}

	// ice chest on the counter with fish on ice
	add( box( 0.9, 0.22, 0.5 ), { color: 0x2f6f8f, rough: 0.5, matrix: mat4( - 0.55, 1.15, 0.85 ) } );
	add( box( 0.84, 0.03, 0.44 ), { color: 0xe7eef0, rough: 0.15, matrix: mat4( - 0.55, 1.255, 0.85 ) } );
	// (the fish on the ice are real fish models: FishStand.iceFish / CatchDisplay)

	// hanging scale
	add( rod( V( 0.6, 2.25, 0.62 ), V( 0.6, 1.75, 0.62 ), 0.006, 4 ), { color: 0x555a5c, rough: 0.4, metal: 1 } );
	add( cylinder( 0.1, 0.1, 0.05, 18 ), { color: 0xc9c2b0, rough: 0.5, metal: 0.4, pattern: PAT.rusty, matrix: mat4( 0.6, 1.66, 0.62, Math.PI / 2, 0, 0 ) } );
	add( cylinder( 0.14, 0.11, 0.05, 16 ), { color: 0xa9b0b3, rough: 0.35, metal: 1, matrix: mat4( 0.6, 1.45, 0.62 ) } );
	// floats hanging from the eave, a coiled line and a bucket
	for ( let i = 0; i < 5; i ++ ) add( sphere( 0.06, 10, 8 ), { color: [ 0xe2552a, 0xf2c230, 0xe8e2d0, 0x2f8f6f, 0xe2552a ][ i ], rough: 0.5, matrix: mat4( - 1.1 + i * 0.5, 2.05 + jit( 0.1 ), 0.95 ) } );
	for ( let i = 0; i < 5; i ++ ) add( rod( V( - 1.1 + i * 0.5, 2.4, 0.95 ), V( - 1.1 + i * 0.5, 2.1, 0.95 ), 0.004, 3 ), { color: 0xcbb999, rough: 0.9 } );
	add( cylinder( 0.16, 0.13, 0.3, 14, 1, true ), { color: 0x3d6d8a, rough: 0.6, pattern: PAT.rusty, matrix: mat4( 1.6, 0.15, 0.9 ) } );
	add( cylinder( 0.15, 0.15, 0.02, 14 ), { color: 0x2a2a2a, rough: 0.9, matrix: mat4( 1.6, 0.02, 0.9 ) } );
	// a board propped against the front: the price chalkboard
	add( box( 0.55, 0.75, 0.03 ), { color: 0x2a302c, rough: 0.9, matrix: mat4( 1.75, 0.4, 1.0, - 0.28, 0.3, 0 ) } );
	add( box( 0.6, 0.8, 0.02 ), { ...WOOD( 0x7a6b58 ), matrix: mat4( 1.75, 0.4, 0.985, - 0.28, 0.3, 0 ) } );
	return mergePrepared( P );

}

// Corrugated sheet in the xz plane (ribs along z), width w, length l.
function corrugated( w, l, ribs ) {

	const g = new BoxGeometry( w, 0.012, l, Math.max( 2, ribs * 4 ), 1, 1 );
	const p = g.attributes.position;
	for ( let i = 0; i < p.count; i ++ ) {

		const x = p.getX( i );
		p.setY( i, p.getY( i ) + Math.sin( ( x / w + 0.5 ) * ribs * Math.PI * 2 ) * 0.012 );

	}

	g.computeVertexNormals();
	return g;

}

// ---------------------------------------------------------------- the photoscanned stall

// Local frame as above: 2.6 m wide (x), 1.6 m deep (z), counter and customers at +z, roof sloping
// back. Joe stands on the floor between the shelf (z -0.78..-0.48) and the counter (top from 0.58).
function buildStallKit( assets ) {

	const K = new KitBuilder( assets, 7 );
	const { WALL, DECK, TIN, SIGN, CHALK, PLAIN, FLOAT, DIAL } = LAYER;
	const V = ( x, y, z ) => new Vector3( x, y, z );
	const J = ( a ) => K.jit( a );
	const tone = () => { const t = 0.86 + K.rnd() * 0.22; return [ t, t * ( 0.97 + K.rnd() * 0.05 ), t * ( 0.94 + K.rnd() * 0.06 ) ]; };

	// floor: dark nailed boards along x, the buyer stands on it
	K.box( 2.6, 0.04, 1.62, place( 0, STALL_FLOOR - 0.02, - 0.02 ), { layer: DECK, along: 'x', color: tone() } );
	// posts, a little out of true; front ones taller for the roof slope
	for ( const [ x, z, h ] of [ [ - 1.25, 0.75, 2.45 ], [ 1.25, 0.75, 2.42 ], [ - 1.25, - 0.75, 2.12 ], [ 1.25, - 0.75, 2.15 ] ] ) {

		K.box( 0.1, h, 0.1, place( x, h / 2, z, J( 0.2 ), J( 0.03 ), J( 0.03 ) ), { layer: DECK, along: 'y', color: tone() } );

	}

	// eave beams
	K.box( 2.72, 0.12, 0.07, place( 0, 2.36, 0.8, 0, 0, J( 0.01 ) ), { layer: DECK, along: 'x', color: tone() } );
	K.box( 2.72, 0.1, 0.07, place( 0, 2.06, - 0.8 ), { layer: DECK, along: 'x', color: tone() } );
	// back wall, side walls and the counter front: weathered horizontal boards
	K.box( 2.6, 2.05, 0.03, place( 0, 1.05, - 0.815 ), { layer: WALL, along: 'x', color: tone() } );
	for ( const sx of [ - 1, 1 ] ) K.box( 0.03, 1.05, 1.55, place( sx * 1.3, 0.55, 0 ), { layer: WALL, along: 'z', color: tone() } );
	K.box( 2.6, 0.98, 0.03, place( 0, 0.53, 0.815 ), { layer: WALL, along: 'x', color: tone() } );
	// corner battens on the counter front
	for ( const sx of [ - 1, 1 ] ) K.box( 0.08, 0.98, 0.03, place( sx * 1.24, 0.53, 0.84 ), { layer: DECK, along: 'y', color: tone() } );
	// counter top (thick scrubbed boards) and the shelf behind
	K.box( 2.72, 0.05, 0.56, place( 0, 1.02, 0.86, 0, 0, J( 0.008 ) ), { layer: DECK, along: 'x', color: tone() } );
	K.box( 2.5, 0.035, 0.3, place( 0, 0.7, - 0.63 ), { layer: DECK, along: 'x', color: tone() } );
	for ( const x of [ - 1.1, 0, 1.1 ] ) K.box( 0.03, 0.18, 0.26, place( x, 0.6, - 0.66 ), { layer: DECK, along: 'y', color: tone() } );

	// roof: rafters and three corrugated sheets, overlapping, one lifted a little
	for ( const x of [ - 1.25, 0, 1.25 ] ) K.box( 0.07, 0.09, 2.0, place( x, 2.33, 0, 0, - 0.16 ), { layer: DECK, along: 'z', color: tone() } );
	for ( let i = 0; i < 3; i ++ ) {

		const x = - 0.9 + i * 0.9;
		K.corrugated( 0.98, 2.12, place( x, 2.405 + i * 0.006 + ( i === 2 ? 0.02 : 0 ), 0.04, J( 0.02 ), - 0.16 + ( i === 2 ? 0.02 : 0 ), J( 0.02 ) ), K.rnd(), [ 1, 1, 1 ] );

	}

	// hand-painted sign on the front eave
	K.box( 2.3, 0.32, 0.035, place( 0, 2.13, 0.855, 0, 0, J( 0.01 ) ), { layer: SIGN, along: 'x', uv2Rect: ATLAS.joe } );

	// the fish box on the counter: weathered boards, galvanised corners, crushed ice (the fish on
	// it are real fish models: FishStand.iceFish / CatchDisplay)
	const bx = - 0.55, bz = 0.86, b0 = 1.045, bh = 0.25, bw = 0.98, bd = 0.54, t = 0.025;
	K.box( bw, 0.025, bd, place( bx, b0 + 0.0125, bz ), { layer: DECK, along: 'x', color: tone() } );
	for ( const s of [ - 1, 1 ] ) {

		K.box( bw, bh, t, place( bx, b0 + bh / 2, bz + s * ( bd / 2 - t / 2 ) ), { layer: DECK, along: 'x', color: tone() } );
		K.box( t, bh, bd - 2 * t, place( bx + s * ( bw / 2 - t / 2 ), b0 + bh / 2, bz ), { layer: DECK, along: 'z', color: tone() } );

	}

	for ( const sx of [ - 1, 1 ] ) for ( const sz of [ - 1, 1 ] ) {

		K.box( 0.05, bh - 0.02, 0.05, place( bx + sx * ( bw / 2 - 0.012 ), b0 + bh / 2, bz + sz * ( bd / 2 - 0.012 ) ), { layer: PLAIN, color: [ 0.55, 0.57, 0.56 ], params: [ 0.45, 1 ] } );

	}

	K.ice( bw - 2 * t - 0.01, bd - 2 * t - 0.01, place( bx, 1.245, bz ), 0.02 );

	// cutting board and a filleting knife by the box
	K.prop( 'wooden_cutting_board', place( 0.32, b0, 0.88, 0.12 ) );
	K.prop( 'fish_knife', place( 0.3, b0 + 0.041 + 0.008, 0.84, 1.1, - Math.PI / 2 ) );

	// hanging spring scale: hook, red enamelled body with the dial, steel pan on three chains
	const sx0 = 0.62, sz0 = 0.84;
	const steel = { layer: PLAIN, color: [ 0.52, 0.53, 0.52 ], params: [ 0.38, 1 ] };
	K.geometry( Shapes.cylinder( 0.004, 0.004, 0.5, 6 ), place( sx0, 2.06, sz0 ), steel );
	K.geometry( Shapes.torus( 0.018, 0.004, 6, 14 ), place( sx0, 1.82, sz0, Math.PI / 2 ), steel );
	K.geometry( Shapes.cylinder( 0.1, 0.1, 0.05, 28 ), place( sx0, 1.7, sz0, 0, Math.PI / 2 ), { layer: FLOAT, color: [ 0.55, 0.1, 0.07 ] } );
	K.geometry( Shapes.torus( 0.093, 0.009, 8, 32 ), place( sx0, 1.7, sz0 + 0.026 ), { layer: PLAIN, color: [ 0.62, 0.6, 0.56 ], params: [ 0.36, 1 ] } );
	K.disc( 0.088, place( sx0, 1.7, sz0 + 0.0265 ), { layer: DIAL, uv2Rect: ATLAS.dial } );
	K.box( 0.005, 0.075, 0.003, place( sx0, 1.7, sz0 + 0.032, 0, 0, - 0.9 ).multiply( new Matrix4().makeTranslation( 0, 0.03, 0 ) ), { layer: PLAIN, color: [ 0.08, 0.07, 0.06 ], params: [ 0.4, 0 ] } );
	K.geometry( Shapes.cylinder( 0.003, 0.003, 0.1, 6 ), place( sx0, 1.6, sz0 ), steel );
	K.geometry( Shapes.lathe( [ [ 0.0, 0.0 ], [ 0.12, 0.008 ], [ 0.15, 0.035 ], [ 0.155, 0.04 ] ], 24 ), place( sx0, 1.43, sz0 ), { layer: PLAIN, color: [ 0.72, 0.72, 0.7 ], params: [ 0.5, 1 ] } );
	for ( let k = 0; k < 3; k ++ ) {

		const a = k / 3 * Math.PI * 2;
		K.geometry( chainGeo( V( sx0, 1.55, sz0 ), V( sx0 + Math.cos( a ) * 0.145, 1.47, sz0 + Math.sin( a ) * 0.145 ) ), new Matrix4(), steel );

	}

	// floats tied in a bunch on the left post, two on the right; a lifebuoy on the right post
	const floatCols = [ [ 0.75, 0.22, 0.08 ], [ 0.82, 0.8, 0.74 ], [ 0.78, 0.6, 0.12 ], [ 0.75, 0.22, 0.08 ] ];
	for ( let i = 0; i < 4; i ++ ) {

		const p = V( - 1.36 - ( i % 2 ) * 0.07, 1.95 - i * 0.2, 0.82 + ( i % 2 ) * 0.05 );
		K.geometry( floatGeo(), place( p.x, p.y, p.z, K.rnd() * 3, J( 0.3 ), J( 0.3 ) ), { layer: FLOAT, color: floatCols[ i ] } );
		K.rope( [ V( - 1.31, 2.25 - i * 0.05, 0.8 ), V( p.x, p.y + 0.11, p.z ) ], 0.005 );

	}

	K.prop( 'lifebuoy', place( 1.345, 1.05, - 0.3, Math.PI / 2 + 0.03, 0, 0.1 ) );

	// a lantern under the roof, the old hat on a nail, a coil of line on the floor
	K.rope( [ V( - 0.9, 2.32, 0.1 ), V( - 0.9, 2.16, 0.1 ) ], 0.004 );
	K.prop( 'wooden_lantern_01', place( - 0.9, 1.64, 0.1, 0.4 ) );
	K.prop( 'fishermans_hat', place( - 0.4, 1.72, - 0.73, 0.2, Math.PI / 2 - 0.3 ) );
	K.coil( - 0.95, STALL_FLOOR, - 0.5, 0.2, 5, 0.012, [ 0.66, 0.58, 0.42 ] );
	// an old net drying over the outside of the left wall, a few floats still on its head rope
	net( K, - 1.335, 1.08, - 0.68, 0.62, 0.8 );

	// outside: crates stacked on the left, a long crate on the right, a bucket, the price board
	K.prop( 'wooden_crate_01', place( - 1.85, 0, 0.25, Math.PI / 2 + 0.06 ) );
	K.prop( 'wooden_crate_01', place( - 1.84, 0.335, 0.28, Math.PI / 2 - 0.1 ) );
	K.prop( 'wooden_crate_02', place( 1.8, 0, - 0.2, 0.03 ) );
	K.prop( 'wooden_bucket_01', place( 1.55, 0, 1.05, 0.7 ) );
	chalkboard( K, place( 1.95, 0, 1.45, - 0.35 ), { layer: DECK, color: tone() } );
	return K.build();

}

// A-frame chalkboard, its feet at the matrix origin, the price side facing +z
function chalkboard( K, m, wood ) {

	const panel = ( tilt, face ) => {

		const pm = m.clone().multiply( place( 0, 0, 0, face ? 0 : Math.PI, tilt ) );
		// frame
		K.box( 0.62, 0.035, 0.025, pm.clone().multiply( place( 0, 0.86, 0 ) ), { ...wood, along: 'x' } );
		K.box( 0.62, 0.035, 0.025, pm.clone().multiply( place( 0, 0.05, 0 ) ), { ...wood, along: 'x' } );
		for ( const s of [ - 1, 1 ] ) K.box( 0.035, 0.88, 0.025, pm.clone().multiply( place( s * 0.29, 0.44, 0 ) ), { ...wood, along: 'y' } );
		// slate (both sides: the back panel shows a blank board)
		K.box( 0.55, 0.78, 0.012, pm.clone().multiply( place( 0, 0.455, 0 ) ), { layer: LAYER.CHALK, uv2Rect: face ? ATLAS.prices : [ 0.99, 0.99, 1.0, 1.0 ] } );

	};

	panel( - 0.24, true );
	panel( - 0.24, false );

}

// a trawl float, 0.19 m, along y
function floatGeo() {

	const pts = [];
	// a barrel with rounded ends and a rope hole through it
	for ( let i = 0; i <= 12; i ++ ) {

		const t = i / 12, e = Math.min( t, 1 - t ) / 0.25;
		pts.push( [ 0.014 + 0.05 * Math.sqrt( Math.min( 1, e ) * ( 2 - Math.min( 1, e ) ) ), ( t - 0.5 ) * 0.19 ] );

	}

	return Shapes.lathe( pts, 14 );

}

// a short chain of oval links between two points
function chainGeo( a, b ) {

	const out = [];
	const d = b.clone().sub( a ), L = d.length(), n = Math.max( 2, Math.round( L / 0.018 ) );
	const q = new Quaternion().setFromUnitVectors( new Vector3( 0, 1, 0 ), d.clone().normalize() );
	const g = [];
	for ( let i = 0; i < n; i ++ ) {

		const t = Shapes.torus( 0.006, 0.0015, 4, 8 );
		t.scale( 1, 1.6, 1 );
		const m = new Matrix4().compose( a.clone().addScaledVector( d, ( i + 0.5 ) / n ), q.clone().multiply( new Quaternion().setFromAxisAngle( new Vector3( 0, 1, 0 ), i % 2 ? Math.PI / 2 : 0 ) ), new Vector3( 1, 1, 1 ) );
		t.applyMatrix4( m );
		g.push( t );

	}

	return mergeGeometries( g );

}

// a knotted net hanging from a head rope along z at (x, top), width 2 * hw, drop h, sagging outward
function net( K, x, top, z0, hw, h ) {

	const cols = 16, rows = 12, V = ( a, b, c ) => new Vector3( a, b, c );
	const P = [];
	for ( let j = 0; j <= rows; j ++ ) {

		const row = [];
		for ( let i = 0; i <= cols; i ++ ) {

			const u = i / cols, v = j / rows;
			const z = z0 + hw + ( u - 0.5 ) * 2 * hw * ( 1 - v * 0.18 ) + K.jit( 0.012 );
			const y = top - v * h - Math.sin( u * Math.PI ) * 0.06 * v + K.jit( 0.01 );
			row.push( V( x - 0.015 - Math.sin( v * Math.PI * 0.5 ) * 0.03 - K.rnd() * 0.01, y, z ) );

		}

		P.push( row );

	}

	const col = [ 0.33, 0.36, 0.26 ];
	for ( let j = 0; j <= rows; j ++ ) K.rope( P[ j ], 0.0022, col, 3 );
	for ( let i = 0; i <= cols; i ++ ) K.rope( P.map( ( r ) => r[ i ] ), 0.0022, col, 3 );
	K.rope( P[ 0 ].map( ( p ) => p.clone().add( V( 0, 0.012, 0 ) ) ), 0.006, [ 0.6, 0.53, 0.38 ] );
	for ( let k = 0; k < 3; k ++ ) {

		const p = P[ 0 ][ 3 + k * 5 ];
		K.geometry( floatGeo(), place( p.x - 0.03, p.y - 0.02, p.z, 0, 0, Math.PI / 2 ), { layer: LAYER.FLOAT, color: [ 0.8, 0.78, 0.7 ] } );

	}

}
