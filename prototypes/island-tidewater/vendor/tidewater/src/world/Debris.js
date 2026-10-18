import { Group, BufferGeometry, Mesh } from '../engine/index.js';
import { Builder, Batch } from './village/GeoBuilder.js';
import { InstancedProps } from './Props.js';
import { LAYERS } from '../core/SceneRenderer.js';
import { DebrisPlacer } from './debris/DebrisPlacement.js';
import { createNatureMaterial } from './debris/NatureMaterial.js';
import { PebbleField } from './debris/PebbleField.js';
import { KIND } from './debris/DebrisShapes.js';
import { ScannedDebris } from './debris/ScannedDebris.js';

// Ground clutter and debris: the shoreline wrack line (driftwood, seaweed, coconuts, shells,
// coral, rope, net scraps, floats, a little litter), rocky-cove stones, fallen palm fronds, and
// the lived-in details around the village (crate stacks, barrels, lobster traps, floats, tyres,
// buckets, boards, firewood, skiffs, a wheelbarrow, dry-stone walls),
// plus a camera-following field of pebbles, cobbles and shell grit (debris/PebbleField).
//
// Placement: debris/DebrisPlacement (keeps clear of boardwalks, the pier, paths, doorways, the
// spawn point, colliders, plant trunks and rocks; adds colliders for the larger items).
// Geometry: debris/DebrisShapes and the village prop emitters, merged per material.
//
// Draw calls: 5 + 3 shadow = 8.
//   wood (village wood material: driftwood, boards, crates, traps, barrels' staves)
//   hard (village hard material + rope: tyres, floats, metal, plastic, rope)
//   nature (NatureMaterial: stones, coconuts, weed, shells, coral, fronds)
//   fabric (village fabric material: net scraps and trap nets; late transparent layer)
//   pebbles (PebbleField)
// The opaque merged geometry shares one vertex / index buffer (like the village): the wood mesh
// is the only shadow caster and widens its draw range in the shadow passes to cover wood, hard
// and the larger natural items (stones, coconuts). Small items and the pebbles cast no shadows.
// The village materials are shared (same pipelines, textures baked once); the new materials use
// the static-world velocity and the terrain's heightfield sun shadow.

export class Debris {

	constructor( { scene, terrain, village, vegetation = null, rocks = null, colliders = null, seed = 5150 } ) {

		this.scene = scene;
		this.terrainData = terrain.data || terrain;
		this.gpu = terrain.gpu;
		this.group = new Group();
		this.group.name = 'Debris';
		this.group.matrixAutoUpdate = false;
		const t0 = performance.now();

		const B = new Builder();
		const inst = new InstancedProps( B );
		const placer = new DebrisPlacer( { B, inst, terrain: this.terrainData, village, vegetation, rocks, colliders, seed } ).run();
		this.counts = placer.counts;
		this.newColliders = placer.newColliders;
		const t1 = performance.now();

		this._assemble( B, village );
		const t2 = performance.now();

		this.pebbles = new PebbleField( { terrain: this.terrainData, gpu: this.gpu, mask: placer.mask } );
		this.group.add( this.pebbles.mesh );
		this.meshes.push( this.pebbles.mesh );
		// photoscanned logs, branches and shells (loaded asynchronously, added when ready)
		this.scanned = new ScannedDebris( { gpu: this.gpu, instances: placer.scanned, parent: this.group } );
		this.timings = { place: t1 - t0, ...placer.timings, assemble: t2 - t1, pebbles: performance.now() - t2, total: performance.now() - t0 };
		scene.add( this.group );

	}

	_assemble( B, village ) {

		const take = ( key ) => {

			const b = B.batches[ key ];
			delete B.batches[ key ];
			return b;

		};

		const wood = B.batch( 'wood' ), hard = B.batch( 'hard' ), nature = B.batch( 'nature' );
		const rope = take( 'rope' ), net = take( 'net' );
		if ( rope ) hard.append( rope, ( d ) => [ d[ 0 ], 0, 0, 2 + d[ 1 ] ] );
		const fabric = new Batch();
		if ( net ) fabric.append( net, ( d ) => [ d[ 0 ], d[ 1 ], Math.max( 0.02, d[ 2 ] ), 0 ] );

		// contact occlusion: darken what touches the ground (sides and undersides more than tops)
		for ( const b of [ wood, hard, nature, fabric ] ) this._bakeContact( b );

		// nature triangles: shadow casters (bigger stones, whole coconuts) first, then the rest
		{

			const cast = [], small = [];
			const D = nature.data, I = nature.idx;
			for ( let t = 0; t < I.length; t += 3 ) {

				const v = I[ t ] * 4;
				const kind = D[ v + 1 ], size = D[ v + 3 ];
				const caster = ( kind === KIND.STONE && size >= 0.2 ) || ( kind === KIND.DRIFT && size >= 0.1 ) || ( kind === KIND.CORAL && size >= 0.15 && D[ v + 2 ] >= 2 );
				( caster ? cast : small ).push( I[ t ], I[ t + 1 ], I[ t + 2 ] );

			}

			nature.idx = cast.concat( small );
			this.natureCasterTris = cast.length / 3;

		}

		const opaque = new Batch();
		const ranges = {};
		for ( const key of [ 'wood', 'hard', 'nature' ] ) {

			const b = key === 'wood' ? wood : key === 'hard' ? hard : nature;
			if ( b.vcount === 0 ) continue;
			const start = opaque.idx.length;
			opaque.append( b );
			ranges[ key ] = { start, count: opaque.idx.length - start };

		}

		const shared = opaque.build();
		const shadowCount = ( ranges.wood ? ranges.wood.count : 0 ) + ( ranges.hard ? ranges.hard.count : 0 ) + this.natureCasterTris * 3;
		const shadowStart = ranges.wood ? ranges.wood.start : 0;
		const natureMat = createNatureMaterial( this.gpu );
		this.materials = { nature: natureMat };
		const mats = { wood: village.materials.wood, hard: village.materials.hard, nature: natureMat };
		this.meshes = [];
		// the village materials' baked textures: the TSL materials baked on first use (a trigger node);
		// the engine's village meshes call bake() themselves, so the debris meshes drawn with those
		// materials do too (records into the frame encoder during collection, once)
		const bakeVillage = () => {

			if ( village.textures && village.textures.bake ) village.textures.bake();

		};

		for ( const key in ranges ) {

			const geo = new BufferGeometry();
			for ( const name in shared.attributes ) geo.setAttribute( name, shared.attributes[ name ] );
			geo.setIndex( shared.index );
			geo.boundingBox = shared.boundingBox;
			geo.boundingSphere = shared.boundingSphere;
			const r = ranges[ key ];
			geo.setDrawRange( r.start, r.count );
			const mesh = new Mesh( geo, mats[ key ] );
			mesh.name = 'debris_' + key;
			mesh.receiveShadow = true;
			mesh.castShadow = key === 'wood';
			if ( key === 'wood' ) {

				// the shadow passes draw wood, hard and the nature casters with this mesh. (The
				// engine has no onBeforeShadow / onAfterShadow: onBeforeRender runs per pass with that
				// pass's camera, and the shadow cascade cameras are the only ones with standard depth.)
				const range = geo.drawRange;
				mesh.onBeforeRender = ( renderer, scene, camera ) => {

					bakeVillage();
					const shadow = !! camera && ( camera.isShadowCamera === true || camera.reversedDepth === false );
					range.start = shadow ? shadowStart : r.start;
					range.count = shadow ? shadowCount : r.count;

				};

			} else if ( key === 'hard' ) mesh.onBeforeRender = bakeVillage;

			// (the TSL version used staticVelocityMRT on the nature material)
			mesh.staticVelocity = true;
			this.meshes.push( mesh );

		}

		this.shadowTriangles = shadowCount / 3;

		if ( fabric.vcount > 0 ) {

			const mesh = new Mesh( fabric.build(), village.materials.fabric );
			mesh.name = 'debris_fabric';
			mesh.receiveShadow = true;
			mesh.castShadow = false;
			// alpha-tested nets are drawn in the late pass (see App: village_fabric)
			mesh.layers.set( LAYERS.TRANSPARENT );
			mesh.staticVelocity = true;
			mesh.onBeforeRender = bakeVillage;
			this.meshes.push( mesh );

		}

		for ( const mesh of this.meshes ) {

			// never culled: the pipelines compile with the village's during the loading screen
			mesh.frustumCulled = false;
			mesh.matrixAutoUpdate = false;
			mesh.updateMatrix();
			this.group.add( mesh );

		}

	}

	// multiply the vertex tint by a ground-contact occlusion term
	_bakeContact( b ) {

		const T = this.terrainData;
		const P = b.pos, N = b.nrm, C = b.tint;
		for ( let i = 0; i < b.vcount; i ++ ) {

			const x = P[ i * 3 ], y = P[ i * 3 + 1 ], z = P[ i * 3 + 2 ];
			const above = y - T.heightAt( x, z );
			if ( above > 0.14 ) continue;
			const t = Math.max( 0, Math.min( 1, above / 0.14 ) );
			const k = 1 - t * t * ( 3 - 2 * t );
			const up = Math.max( 0, N[ i * 3 + 1 ] );
			const ao = 1 - 0.38 * k * ( 1 - 0.8 * up );
			C[ i * 3 ] *= ao; C[ i * 3 + 1 ] *= ao; C[ i * 3 + 2 ] *= ao;

		}

	}

	update( camera ) {

		this.pebbles.update( camera );
		this.scanned.update( camera );

	}

	stats() {

		let triangles = 0;
		for ( const m of this.meshes ) {

			if ( m === this.pebbles.mesh ) continue;
			const total = m.geometry.index ? m.geometry.index.count : m.geometry.attributes.position.count;
			triangles += Math.min( total, m.geometry.drawRange.count ) / 3;

		}

		return {
			triangles, pebbleTriangles: this.pebbles.triangles, pebbleCells: this.pebbles.count, occupiedCells: this.pebbles.occupiedCells,
			scannedInstances: this.scanned.instances.length, scannedTriangles: this.scanned.triangles, scannedReady: this.scanned.ready,
			drawCalls: this.meshes.length, shadowCasters: 1, shadowTriangles: this.shadowTriangles, colliders: this.newColliders,
			counts: this.counts, timings: this.timings,
		};

	}

	dispose() {

		for ( const m of this.meshes ) if ( m !== this.pebbles.mesh ) m.geometry.dispose();
		this.materials.nature.dispose();
		this.pebbles.dispose();
		this.scanned.dispose();
		this.scene.remove( this.group );

	}

}
