import * as THREE from '../engine/index.js';
import { G } from '../core/Globals.js';
import { VegSite, scatterVegetation, buildGrassMask, RULES } from './vegetation/Scatter.js';
import { VegType, LodLevel } from './vegetation/InstanceLOD.js';
import { GrassField } from './vegetation/GrassField.js';
import { uCamPos, uGustOffset, UNDER_FERN_FADE } from './vegetation/VegNodes.js';

// WGSL variant index of an instance (VegNodes.vegVariantOf)
const variantOf = ( seed, isShrub ) => `vegVariantOf( ${ seed }, ${ isShrub } )`;
import {
	buildPalmNear, buildPalmFar, buildUnderstory, buildCanopyNear, buildTreeNear, buildShrubNear,
	lobeVariantGeometry, LOBE_TABLE, TREE_VARIANTS, SHRUB_VARIANTS, UNDERSTORY, buildBroadleaf, BROADLEAF, buildMonsteraMesh, buildBananas,
} from './vegetation/PlantGeometry.js';
import { createPlantLeafMaterial, createCanopyMaterial, createCanopyBakeMaterials, impostorColor, uCanopyNear } from './vegetation/VegMaterials.js';
import { ImpostorAtlas, buildImpostorQuad } from './vegetation/Impostors.js';
import { LeafAtlas } from './vegetation/LeafTextures.js';

// Island vegetation: coconut palms along the back of the beach (leaning to the sea), a closed
// rainforest canopy on the hillsides and gullies thinning into scattered trees and shrub
// thickets at the forest edge, banana groves, young palms and ferns in the understory, and a
// camera-following field of tall meadow grass, dune grass, sea oats and beach creeper.
//
// Everything is instanced and procedural. Wind (G.windDir / G.windSpeed) drives trunk sway,
// frond / branch bending, leaf flutter and travelling gusts across the grass.
//
// Draw calls (main pass): palm near, palm far, understory (young palms + ferns), bananas, monstera,
// broadleaf (elephant ear + heliconia + bird of paradise), canopy near (trees + shrubs), canopy impostors (octahedral,
// trees + shrubs), grass near / mid / far = 11 (fewer when a level is empty). Shadow casters: palm
// near, bananas, monstera, broadleaf, canopy near.
//
// Options: { scene, terrain, village? } - with a village (Village.js) its building footprints
// and boardwalks are kept clear; otherwise a default boardwalk polyline is used.
// The impostor atlases are baked on the first update() (recorded into the frame encoder; three.js
// picked up from the meshes' onBeforeRender); until then far trees are not drawn.

// Building footprints + boardwalk polylines from a Village instance (duck-typed).
function villageObstacles( village ) {

	if ( ! village ) return {};
	const footprints = typeof village.getFootprints === 'function' ? village.getFootprints() : [];
	const paths = [];
	for ( const p of [ village.path, ...( village.sidePaths || [] ) ] ) {

		if ( ! p || ! p.samples ) continue;
		const pts = [];
		for ( let i = 0; i < p.samples.length; i += 5 ) pts.push( [ p.samples[ i ].p.x, p.samples[ i ].p.z ] );
		const last = p.samples[ p.samples.length - 1 ];
		pts.push( [ last.p.x, last.p.z ] );
		paths.push( { points: pts, width: p.width ?? 1.8 } );

	}

	return { footprints, paths: paths.length ? paths : null };

}

// bounding sphere of a geometry around its vertical axis (impostor frames are centred on it)
function axisSphere( geometry ) {

	const p = geometry.attributes.position;
	const v = new THREE.Vector3();
	let y0 = Infinity, y1 = - Infinity;
	for ( let i = 0; i < p.count; i ++ ) {

		v.fromBufferAttribute( p, i );
		y0 = Math.min( y0, v.y );
		y1 = Math.max( y1, v.y );

	}

	const center = new THREE.Vector3( 0, ( y0 + y1 ) * 0.5, 0 );
	let r = 0, rh = 0;
	for ( let i = 0; i < p.count; i ++ ) {

		v.fromBufferAttribute( p, i );
		r = Math.max( r, v.distanceTo( center ) );
		rh = Math.max( rh, Math.hypot( v.x, v.z ) );

	}

	// radius: frame size of the atlas; rh / hv: horizontal radius and half height (quad extents)
	return { center, radius: r * 1.02, rh: rh * 1.03, hv: ( y1 - y0 ) * 0.5 * 1.03 };

}

const PALM_NEAR = 120; // m, full detail palms
const TREE_NEAR = 65; // m, trees: geometry -> impostor
const SHRUB_NEAR = 45;
const UNDER_FADE = [ 120, 140 ]; // young palms / bananas
const BROAD_FADE = [ 85, 105 ]; // monstera / elephant ear / heliconia
const BANANA_FADE = [ 100, 120 ];
const CANOPY_FAR = [ 2600, 2800 ];

export class Vegetation {

	constructor( { scene, terrain, village = null } ) {

		this.scene = scene;
		this.terrain = terrain;
		this.group = new THREE.Group();
		this.group.name = 'Vegetation';
		this.group.matrixAutoUpdate = false;

		const t0 = performance.now();
		const site = new VegSite( terrain, villageObstacles( village ) );
		this.site = site;
		const recs = scatterVegetation( site );
		this.records = recs;
		const t1 = performance.now();
		const grassMask = buildGrassMask( site );
		this.timings = { scatter: t1 - t0, mask: performance.now() - t1 };

		// materials (shared across meshes)
		const leafMat = createPlantLeafMaterial();
		this.leafAtlas = new LeafAtlas();
		const canopyMat = createCanopyMaterial( this.leafAtlas );
		uCanopyNear.value.set( TREE_NEAR, SHRUB_NEAR );

		// geometry
		const palmNear = buildPalmNear();
		const palmFar = buildPalmFar();
		const under = buildUnderstory();
		const broad = buildBroadleaf();
		const monsteraMesh = buildMonsteraMesh();
		const bananaMesh = buildBananas();
		const canopy = buildCanopyNear();

		// impostor atlas of the tree and shrub crown variants (same lobe tables as the near mesh)
		const treeGeo = buildTreeNear().geometry, shrubGeo = buildShrubNear().geometry;
		const treeVariants = [], shrubVariants = [];
		for ( let v = 0; v < TREE_VARIANTS; v ++ ) treeVariants.push( lobeVariantGeometry( treeGeo, LOBE_TABLE, v * 8 ) );
		for ( let v = 0; v < SHRUB_VARIANTS; v ++ ) shrubVariants.push( lobeVariantGeometry( shrubGeo, LOBE_TABLE, ( TREE_VARIANTS + v ) * 8 ) );
		this.atlas = new ImpostorAtlas( [
			{ variants: treeVariants, ...axisSphere( treeGeo ) },
			{ variants: shrubVariants, ...axisSphere( shrubGeo ) },
		], createCanopyBakeMaterials( this.leafAtlas ) );
		// (WGSL expressions: see ImpostorAtlas.createMaterial)
		const impostorMat = this.atlas.createMaterial( {
			isGroup1: ( iDat ) => `${ iDat }.y < 0.0`,
			variantOf: ( seed, isShrub ) => variantOf( seed, isShrub ),
			colorOf: ( { seed, cr, leaf, bright, isGroup1 } ) => `${ impostorColor }( ${ seed }, ${ cr }, ${ leaf }, ${ bright }, ${ isGroup1 } )`,
			nearDist: ( isShrub ) => `select( vegParams.canopyNear.x, vegParams.canopyNear.y, ${ isShrub } )`,
		} );
		this.materials = [ leafMat, canopyMat, impostorMat ];

		this.types = [];
		const add = ( t ) => {

			this.types.push( t );
			for ( const m of t.meshes ) this.group.add( m );
			return t;

		};

		this.palms = add( new VegType( 'palms', recs.palms, {
			nearRange: PALM_NEAR, margin: 10, refreshDistance: 6, farExcludeNear: true, sortNear: true,
			near: [ { geometry: palmNear.geometry, material: leafMat, castShadow: true, name: 'veg-palm' } ],
			far: { parts: [ { geometry: palmFar.geometry, material: leafMat, name: 'veg-palm-far' } ], fade: CANOPY_FAR },
		} ) );

		// understory: young palms and ferns in one mesh; the plant kind rides on the seed
		const underRecs = [
			...recs.youngPalms.map( ( r ) => ( { ...r, seed: UNDERSTORY.YOUNG + r.seed * 0.999, qr: UNDER_FADE[ 1 ] + 10 } ) ),
			...recs.ferns.map( ( r ) => ( { ...r, seed: UNDERSTORY.FERN + r.seed * 0.999, qr: UNDER_FERN_FADE[ 1 ] + 8 } ) ),
		];
		// banana clumps (two variants; their heights are in the mesh: H ~ 0)
		const bananaRecs = recs.bananas.map( ( r ) => ( { ...r, H: 0.02, seed: ( r.seed < 0.5 ? UNDERSTORY.BANANA : UNDERSTORY.BANANA_B ) + r.seed * 0.999, qr: BANANA_FADE[ 1 ] + 10 } ) );
		this.bananas = add( new VegType( 'bananas', bananaRecs, {
			fade: BANANA_FADE, margin: 10, sortNear: true,
			near: [ { geometry: bananaMesh.geometry, material: leafMat, castShadow: true, name: 'veg-banana' } ],
		} ) );
		this.understory = add( new VegType( 'understory', underRecs, {
			fade: UNDER_FADE, margin: 10, sortNear: true,
			near: [ { geometry: under.geometry, material: leafMat, castShadow: false, name: 'veg-understory' } ],
		} ) );

		// broadleaf understory: monstera (own mesh), elephant ear + heliconia (one mesh, kind on the seed)
		const monsteraRecs = recs.monsteras.map( ( r ) => ( { ...r, seed: BROADLEAF.MONSTERA + r.seed * 0.999, qr: BROAD_FADE[ 1 ] + 10 } ) );
		this.monsteras = add( new VegType( 'monsteras', monsteraRecs, {
			fade: BROAD_FADE, margin: 10, sortNear: true,
			near: [ { geometry: monsteraMesh.geometry, material: leafMat, castShadow: true, name: 'veg-monstera' } ],
		} ) );
		const broadRecs = [
			...recs.elephantEars.map( ( r ) => ( { ...r, seed: BROADLEAF.ELEPHANT + r.seed * 0.999, qr: BROAD_FADE[ 1 ] + 10 } ) ),
			...recs.heliconias.map( ( r ) => ( { ...r, seed: BROADLEAF.HELICONIA + r.seed * 0.999, qr: BROAD_FADE[ 1 ] + 10 } ) ),
			...recs.strelitzias.map( ( r ) => ( { ...r, seed: BROADLEAF.STRELITZIA + r.seed * 0.999, qr: BROAD_FADE[ 1 ] + 10 } ) ),
		];
		this.broadleaf = add( new VegType( 'broadleaf', broadRecs, {
			fade: BROAD_FADE, margin: 10, sortNear: true,
			near: [ { geometry: broad.geometry, material: leafMat, castShadow: true, name: 'veg-broadleaf' } ],
		} ) );

		// canopy: trees + shrubs (shrubs flagged by a negative vertical scale in iDat.y); near
		// geometry within TREE_NEAR / SHRUB_NEAR, octahedral impostors beyond
		const canopyRecs = [
			...recs.trees.map( ( r ) => ( { ...r, qr: TREE_NEAR + 10 } ) ),
			...recs.shrubs.map( ( r ) => ( { ...r, qr: SHRUB_NEAR + 10 } ) ),
		];
		this.canopy = add( new VegType( 'canopy', canopyRecs, {
			nearRange: TREE_NEAR, margin: 10, sortNear: true, sortFar: true, farRefresh: 16,
			near: [ { geometry: canopy.geometry, material: canopyMat, castShadow: true, name: 'veg-canopy' } ],
			far: { parts: [ { geometry: buildImpostorQuad(), material: impostorMat, name: 'veg-canopy-far' } ], fade: CANOPY_FAR },
		} ) );

		// alpha-tested foliage after the opaque ground (terrain, rocks, buildings) and the far crowns
		// after the near ones, so the early depth test rejects what those already cover
		for ( const t of [ this.palms, this.understory, this.bananas, this.monsteras, this.broadleaf, this.canopy ] ) for ( const m of t.meshes ) m.renderOrder = 1;
		for ( const m of this.canopy.far.meshes ) m.renderOrder = 2;

		// the impostor bake records into the frame encoder on the first update (the engine needs no
		// renderer handle; the atlas bakes with its own MeshRenderer)
		this.renderer = true;

		this.grass = new GrassField( { terrain, mask: grassMask } );
		for ( const m of this.grass.meshes ) this.group.add( m );

		this.geometryTriangles = {
			palmNear: palmNear.triangles, palmFar: palmFar.triangles, understory: under.triangles, understoryPerKind: under.perKind,
			broadleaf: broad.triangles, broadleafPerKind: broad.perKind, monstera: monsteraMesh.triangles, bananas: bananaMesh.triangles,
			canopy: canopy.triangles, tree: canopy.treeTriangles, shrub: canopy.shrubTriangles, impostor: 2,
			grassNearPatch: this.grass.patchTris[ 0 ], grassMidPatch: this.grass.patchTris[ 1 ], grassFarPatch: this.grass.patchTris[ 2 ],
		};

		this.group.updateMatrixWorld( true );
		scene.add( this.group );

		this._camPos = new THREE.Vector3();
		this.timings.total = performance.now() - t0;

	}

	update( dt, camera ) {

		if ( this.renderer && ! this.atlas.baked ) {

			const t = performance.now();
			this.leafAtlas.bake( this.renderer );
			this.atlas.bake( this.renderer );
			this.timings.bake = performance.now() - t;

		}

		camera.updateMatrixWorld();
		const p = camera.getWorldPosition( this._camPos );
		uCamPos.value.copy( p );

		// travelling gust field offset (integrated so speed/direction changes never jump)
		const wd = G.windDir.value;
		const speed = 0.7 * G.windSpeed.value + 1.5;
		uGustOffset.value.x += wd.x * speed * dt;
		uGustOffset.value.y += wd.y * speed * dt;

		// near-level refills happen only after the camera moved a few metres; at most two
		// types per frame (most overdue first) so fast flights never stack up refills.
		// Teleports (anything far past the margin) refill everything at once.
		let a = null, b = null, da = 0, db = 0;
		for ( const t of this.types ) {

			const d = t.overdue( p );
			if ( d > t.margin - t.refreshDistance ) t.update( p, true );
			else if ( d > da ) {

				b = a; db = da; a = t; da = d;

			} else if ( d > db ) {

				b = t; db = d;

			}

		}

		if ( a ) a.update( p, true );
		if ( b ) b.update( p, true );

		this.grass.update( camera );

	}

	// Re-upload the terrain height texture used by the grass after terrain.flatten() & co.
	// (plant placement is computed once in the constructor: build Vegetation after terrain edits).
	refreshTerrain() {

		this.grass.heightTex.needsUpdate = true;

	}

	stats() {

		const types = {};
		let tris = 0, draws = 0;
		for ( const t of this.types ) {

			const lv = {};
			for ( const [ name, l ] of [ [ 'near', t.near ], [ 'far', t.far ] ] ) {

				if ( ! l ) continue;
				lv[ name ] = { instances: l.count, triangles: l.triangles, meshes: l.meshes.length };
				tris += l.triangles;
				if ( l.count > 0 ) draws += l.meshes.length;

			}

			types[ t.name ] = { total: t.inst.count, ...lv };

		}

		const g = this.grass;
		types.grass = { nearCells: g.levels[ 0 ].count, midCells: g.levels[ 1 ].count, farCells: g.levels[ 2 ].count, triangles: g.triangles };
		tris += g.triangles;
		draws += g.levels.filter( ( l ) => l.count > 0 ).length;
		return { types, triangles: tris, drawCalls: draws, villagePalms: this.records.villagePalms, rules: RULES };

	}

	dispose() {

		this.scene.remove( this.group );
		for ( const t of this.types ) for ( const m of t.meshes ) m.geometry.dispose();
		for ( const m of this.materials ) m.dispose();
		this.atlas.rtA.dispose();
		this.leafAtlas.rt.dispose();
		this.atlas.rtB.dispose();
		this.atlas.depth.destroy();
		this.grass.dispose();

	}

}

export { LodLevel };
