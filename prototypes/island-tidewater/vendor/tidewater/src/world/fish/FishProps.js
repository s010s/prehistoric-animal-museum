import * as THREE from '../../engine/index.js';
import { ReefBatch } from '../reef/ReefBatch.js';
import { GPU } from '../../engine/gpu/GPU.js';
import { SPECIES } from './FishSpecies.js';
import { fishGeometry, splitFishGeometry, section, PART } from './FishGeometry.js';
import { createPropMaterial } from './FishMaterial.js';
import { bandFade } from '../../materials/LODFade.js';

// Fish as village props: whole fish lying on ice or hanging from the stall, split salted fish on
// the drying racks, a fish cut in two on a cleaning table, plus the crushed ice, banana leaves and
// spiny lobsters of the displays. Everything placed while the village is built (Props.js fish(),
// iceBed(), bananaLeaf(), lobster()) is drawn by one instanced mesh with the fish material:
// levels of detail by distance, and only the pieces near the camera cast shadows (low detail
// proxies). The culling runs once per frame, when the main camera renders the mesh.
//
// Instance record (see FishMaterial propVertex): r0 = ( position, length ), r1 = orientation,
// r2 = ( pattern + seed * 0.9, curl, sag, jaw ), r3 = ( cloudy eye, wet, dried, blood ).

const DRAW_RANGE = 90; // m
const SHADOW_RANGE = 22; // m: pieces closer than this cast shadows

const _m = new THREE.Matrix4(), _p = new THREE.Vector3(), _q = new THREE.Quaternion(), _s = new THREE.Vector3();
const _frustum = new THREE.Frustum(), _sphere = new THREE.Sphere();

// ---------------------------------------------------------------------------
// display geometry (unit size; aData as the fish: x along, y part, z / w pattern coordinates)

function build( pos, dat, idx ) {

	const g = new THREE.BufferGeometry();
	g.setAttribute( 'position', new THREE.Float32BufferAttribute( pos, 3 ) );
	g.setAttribute( 'aData', new THREE.Float32BufferAttribute( dat, 4 ) );
	g.setIndex( idx );
	g.computeVertexNormals();
	g.computeBoundingSphere();
	return g;

}

function mulberry( seed ) {

	let a = seed >>> 0;
	return () => {

		a = ( a + 0x6D2B79F5 ) >>> 0;
		let t = a;
		t = Math.imul( t ^ ( t >>> 15 ), t | 1 );
		t ^= t + Math.imul( t ^ ( t >>> 7 ), t | 61 );
		return ( ( t ^ ( t >>> 14 ) ) >>> 0 ) / 4294967296;

	};

}

// Crushed ice heaped in a round basin of radius 1 (the instance length is the radius): a lumpy
// mound with faceted chunks on top.
function iceGeometry( lod ) {

	const pos = [], dat = [], idx = [];
	const rnd = mulberry( 17 );
	const v = ( x, y, z, a, b ) => {

		pos.push( x, y, z );
		dat.push( 0, PART.ICE, a, b );
		return pos.length / 3 - 1;

	};

	// mound
	const rings = lod ? 3 : 6, segs = lod ? 12 : 24;
	const mound = ( r, a ) => 0.16 * ( 1 - r * r ) + 0.025 * Math.sin( a * 5 + r * 7 ) * r + 0.02;
	const c = v( 0, mound( 0, 0 ), 0, 0.5, 0.5 );
	const grid = [];
	for ( let i = 1; i <= rings; i ++ ) {

		const r = i / rings;
		const row = [];
		for ( let j = 0; j < segs; j ++ ) {

			const a = j / segs * Math.PI * 2;
			row.push( v( Math.cos( a ) * r, mound( r, a ), Math.sin( a ) * r, rnd(), rnd() ) );

		}

		grid.push( row );

	}

	// skirt down the basin wall (hidden by it: no gap between the ice and the wood)
	const skirt = [];
	for ( let j = 0; j < segs; j ++ ) {

		const a = j / segs * Math.PI * 2;
		skirt.push( v( Math.cos( a ) * 0.8, - 0.35, Math.sin( a ) * 0.8, rnd(), rnd() ) );

	}

	grid.push( skirt );
	for ( let j = 0; j < segs; j ++ ) idx.push( c, grid[ 0 ][ ( j + 1 ) % segs ], grid[ 0 ][ j ] );
	for ( let i = 0; i < rings; i ++ ) for ( let j = 0; j < segs; j ++ ) {

		const a = grid[ i ][ j ], b = grid[ i ][ ( j + 1 ) % segs ], cc = grid[ i + 1 ][ ( j + 1 ) % segs ], d = grid[ i + 1 ][ j ];
		idx.push( a, b, d, b, cc, d );

	}

	// chunks: irregular tetrahedra / wedges half sunk into the mound
	const n = lod ? 50 : 170;
	for ( let k = 0; k < n; k ++ ) {

		const r = Math.sqrt( rnd() ) * 0.92, a = rnd() * Math.PI * 2;
		const x = Math.cos( a ) * r, z = Math.sin( a ) * r, y = mound( r, a );
		const s = 0.06 + rnd() * 0.09;
		const q = new THREE.Quaternion().setFromEuler( new THREE.Euler( rnd() * 6, rnd() * 6, rnd() * 6 ) );
		const corners = [ [ 1, 0.2, 0.1 ], [ - 0.6, 0.9, 0.2 ], [ - 0.5, - 0.4, 0.9 ], [ 0.1, - 0.6, - 0.9 ], [ 0.3, 0.8, - 0.5 ] ].map( ( p ) => new THREE.Vector3( p[ 0 ] * ( 0.7 + rnd() * 0.6 ), p[ 1 ] * ( 0.7 + rnd() * 0.6 ), p[ 2 ] * ( 0.7 + rnd() * 0.6 ) ).multiplyScalar( s ).applyQuaternion( q ) );
		const faces = [ [ 0, 1, 2 ], [ 0, 2, 3 ], [ 0, 3, 4 ], [ 0, 4, 1 ], [ 1, 4, 3 ], [ 1, 3, 2 ] ];
		const ca = rnd(), cb = rnd();
		for ( const f of faces ) {

			// flat faces (own vertices) catch glints; winding fixed to face outward
			const A = corners[ f[ 0 ] ], B = corners[ f[ 1 ] ], C = corners[ f[ 2 ] ];
			const nrm = new THREE.Vector3().subVectors( B, A ).cross( new THREE.Vector3().subVectors( C, A ) );
			const ctr = new THREE.Vector3().add( A ).add( B ).add( C );
			const flip = nrm.dot( ctr ) < 0;
			const ids = [ A, B, C ].map( ( p ) => v( x + p.x, y + p.y * 0.8, z + p.z, ca, cb ) );
			if ( flip ) idx.push( ids[ 0 ], ids[ 2 ], ids[ 1 ] );
			else idx.push( ids[ 0 ], ids[ 1 ], ids[ 2 ] );

		}

	}

	return build( pos, dat, idx );

}

// Banana leaf (length 1 along +z from its stalk end, blade up +y): V-folded blade, curled edges,
// torn along the veins near the tips.
function leafGeometry( lod ) {

	const pos = [], dat = [], idx = [];
	const nz = lod ? 8 : 20, nx = lod ? 3 : 7;
	const rnd = mulberry( 5 );
	const tears = [];
	for ( let k = 0; k < 6; k ++ ) tears.push( [ 0.3 + rnd() * 0.6, rnd() < 0.5 ? - 1 : 1 ] );
	for ( const back of [ false, true ] ) {

		const base = pos.length / 3;
		for ( let i = 0; i <= nz; i ++ ) {

			const t = i / nz;
			const halfW = 0.19 * Math.sin( Math.PI * Math.min( 1, 0.08 + t * 0.95 ) ) + 0.012;
			for ( let j = - nx; j <= nx; j ++ ) {

				const a = j / nx;
				// torn strips: a split pulls the edge apart a little
				let x = a * halfW;
				for ( const [ tz, side ] of tears ) if ( Math.sign( a ) === side && Math.abs( a ) > 0.45 && t > tz ) x += side * 0.01 * Math.abs( a );
				const fold = Math.abs( a ) * halfW * 0.25; // V-fold along the midrib
				const curl = a * a * 0.04 * ( 1 - t );
				pos.push( x, fold + curl + 0.01 * Math.sin( t * 9 ) * a, t );
				dat.push( t, PART.LEAF, a, t );

			}

		}

		const row = 2 * nx + 1;
		for ( let i = 0; i < nz; i ++ ) for ( let j = 0; j < 2 * nx; j ++ ) {

			const a = base + i * row + j, b = a + 1, c = a + row + 1, d = a + row;
			if ( back ) idx.push( a, b, d, b, c, d );
			else idx.push( a, d, b, b, d, c );

		}

	}

	return build( pos, dat, idx );

}

// Caribbean spiny lobster, body length 1 (carapace + tail) along +z (head), legs below, long
// antennae sweeping back over the sides.
function lobsterGeometry( lod ) {

	const pos = [], dat = [], idx = [];
	const v = ( x, y, z, a, b ) => {

		pos.push( x, y, z );
		dat.push( 0.5 - z, PART.SHELL, a, b );
		return pos.length / 3 - 1;

	};

	const segs = lod ? 6 : 12;
	// shell of revolution around the body axis (z), flattened on the underside
	const shell = ( pts, flat ) => {

		const rows = [];
		for ( const [ z, r, h ] of pts ) {

			const row = [];
			for ( let j = 0; j <= segs; j ++ ) {

				const a = Math.PI * j / segs; // over the back, from one side to the other
				const x = Math.cos( a ) * r, y = Math.sin( a ) * h;
				row.push( v( x, y * ( y < 0 ? flat : 1 ), z, x * 3, z * 3 ) );

			}

			// underside
			rows.push( row );

		}

		for ( let i = 0; i < rows.length - 1; i ++ ) for ( let j = 0; j < segs; j ++ ) {

			const a = rows[ i ][ j ], b = rows[ i ][ j + 1 ], c = rows[ i + 1 ][ j + 1 ], d = rows[ i + 1 ][ j ];
			idx.push( a, d, b, b, d, c );

		}

		// flat belly
		for ( let i = 0; i < rows.length - 1; i ++ ) {

			const a = rows[ i ][ 0 ], b = rows[ i ][ segs ], c = rows[ i + 1 ][ segs ], d = rows[ i + 1 ][ 0 ];
			idx.push( a, b, d, b, c, d );

		}

	};

	// carapace (front 40 %) with the horns over the eyes
	shell( [ [ 0.5, 0.03, 0.03 ], [ 0.47, 0.09, 0.075 ], [ 0.4, 0.125, 0.105 ], [ 0.28, 0.135, 0.115 ], [ 0.15, 0.125, 0.11 ], [ 0.1, 0.115, 0.1 ] ], 0.25 );
	// horns over the eyes
	for ( const s of [ 1, - 1 ] ) {

		const b0 = v( s * 0.035, 0.07, 0.47, 0.5, 0.5 ), b1 = v( s * 0.075, 0.06, 0.46, 0.5, 0.5 ), b2 = v( s * 0.05, 0.03, 0.47, 0.5, 0.5 ), tip = v( s * 0.075, 0.1, 0.55, 0.5, 0.5 );
		idx.push( b0, b1, tip, b1, b2, tip, b2, b0, tip );
		if ( s < 0 ) idx.splice( idx.length - 9, 9, b0, tip, b1, b1, tip, b2, b2, tip, b0 );

	}

	// tail: six overlapping segments, curled slightly down toward the fan
	const tail = [];
	for ( let k = 0; k < 6; k ++ ) {

		const z0 = 0.1 - k * 0.075, r = 0.115 - k * 0.009;
		const dy = - k * k * 0.002;
		tail.push( [ z0, r, r * 0.8, dy ] );

	}

	for ( const [ z0, r, h, dy ] of tail ) {

		const base = pos.length / 3;
		shell( [ [ z0 + 0.005, r * 0.95, h * 0.95 ], [ z0 - 0.02, r, h ], [ z0 - 0.08, r * 0.96, h * 0.92 ] ], 0.3 );
		for ( let i = base; i < pos.length / 3; i ++ ) pos[ i * 3 + 1 ] += dy;

	}

	// tail fan
	for ( let k = - 2; k <= 2; k ++ ) {

		const a = k * 0.32;
		const z0 = - 0.36, y0 = - 0.05;
		const l = 0.13 - Math.abs( k ) * 0.012;
		const p0 = v( 0, y0, z0, 0, 0 ), p1 = v( Math.sin( a - 0.13 ) * l, y0 - 0.01, z0 - Math.cos( a - 0.13 ) * l, 1, 0 ), p2 = v( Math.sin( a + 0.13 ) * l, y0 - 0.01, z0 - Math.cos( a + 0.13 ) * l, 1, 1 );
		idx.push( p0, p2, p1, p0, p1, p2 );

	}

	// tapered tubes: antennae, legs, eye stalks
	const tube = ( pts, r0, r1, n ) => {

		const rows = [];
		const sides = lod ? 3 : 5;
		for ( let i = 0; i < pts.length; i ++ ) {

			const p = pts[ i ], q = pts[ Math.min( i + 1, pts.length - 1 ) ], o = pts[ Math.max( i - 1, 0 ) ];
			const d = new THREE.Vector3( q[ 0 ] - o[ 0 ], q[ 1 ] - o[ 1 ], q[ 2 ] - o[ 2 ] ).normalize();
			const s1 = new THREE.Vector3( 0, 1, 0 ).cross( d ).normalize();
			if ( s1.lengthSq() < 1e-6 ) s1.set( 1, 0, 0 );
			const s2 = new THREE.Vector3().crossVectors( d, s1 );
			const r = r0 + ( r1 - r0 ) * i / ( pts.length - 1 );
			const row = [];
			for ( let j = 0; j < sides; j ++ ) {

				const a = j / sides * Math.PI * 2;
				row.push( v( p[ 0 ] + ( s1.x * Math.cos( a ) + s2.x * Math.sin( a ) ) * r, p[ 1 ] + ( s1.y * Math.cos( a ) + s2.y * Math.sin( a ) ) * r, p[ 2 ] + ( s1.z * Math.cos( a ) + s2.z * Math.sin( a ) ) * r, n, i / pts.length ) );

			}

			rows.push( row );

		}

		for ( let i = 0; i < rows.length - 1; i ++ ) for ( let j = 0; j < sides; j ++ ) {

			const a = rows[ i ][ j ], b = rows[ i ][ ( j + 1 ) % sides ], c = rows[ i + 1 ][ ( j + 1 ) % sides ], d = rows[ i + 1 ][ j ];
			idx.push( a, b, d, b, c, d );

		}

	};

	for ( const s of [ 1, - 1 ] ) {

		// antennae: thick spiny bases, sweeping forward and out, then back along the sides
		const ant = [];
		for ( let i = 0; i <= ( lod ? 5 : 10 ); i ++ ) {

			const t = i / ( lod ? 5 : 10 );
			ant.push( [ s * ( 0.05 + Math.sin( t * 2.2 ) * 0.28 ), 0.05 + t * 0.06 - t * t * 0.1, 0.48 + Math.sin( t * 2.6 ) * 0.25 - t * t * 0.75 ] );

		}

		tube( ant, 0.042, 0.005, 2 );
		// walking legs
		for ( let k = 0; k < 5; k ++ ) {

			const z = 0.36 - k * 0.055;
			tube( [ [ s * 0.09, - 0.01, z ], [ s * 0.19, 0.025, z - 0.01 ], [ s * 0.26, - 0.01, z - 0.04 ], [ s * 0.29, - 0.07, z - 0.07 ] ], 0.013, 0.005, 3 );

		}

		tube( [ [ s * 0.03, 0.05, 0.47 ], [ s * 0.05, 0.08, 0.5 ] ], 0.012, 0.01, 4 );

	}

	return build( pos, dat, idx );

}

// ---------------------------------------------------------------------------

// JS mirror of the vertex shader's bends (FishMaterial propVertex): where a model point ends up
function bendPoint( x, y, z, curl, sag, out ) {

	const k1 = curl + ( curl >= 0 ? 1e-4 : - 1e-4 );
	const t1 = k1 * z;
	const h1 = Math.sin( t1 * 0.5 );
	const x1 = 2 * h1 * h1 / k1 + x * Math.cos( t1 );
	const z1 = Math.sin( t1 ) / k1 - x * Math.sin( t1 );
	const k2 = sag + ( sag >= 0 ? 1e-4 : - 1e-4 );
	const t2 = k2 * z1;
	const h2 = Math.sin( t2 * 0.5 );
	return out.set( x1, 2 * h2 * h2 / k2 + y * Math.cos( t2 ), Math.sin( t2 ) / k2 - y * Math.sin( t2 ) );

}

// model frame (nose +z, back +y, left flank +x) -> placement frame, per pose
const POSE = {
	// lying on its side, nose toward +x, left flank up
	side: new THREE.Matrix4().makeBasis( new THREE.Vector3( 0, 1, 0 ), new THREE.Vector3( 0, 0, 1 ), new THREE.Vector3( 1, 0, 0 ) ),
	// the other flank up
	sideFlip: new THREE.Matrix4().makeBasis( new THREE.Vector3( 0, - 1, 0 ), new THREE.Vector3( 0, 0, - 1 ), new THREE.Vector3( 1, 0, 0 ) ),
	// hanging by the tail: nose down, left flank toward +z, back toward -x
	tail: new THREE.Matrix4().makeBasis( new THREE.Vector3( 0, 0, 1 ), new THREE.Vector3( - 1, 0, 0 ), new THREE.Vector3( 0, - 1, 0 ) ),
	// split fish hung by the tail: nose down, the flesh side (model +y) toward +z
	tailFlat: new THREE.Matrix4().makeBasis( new THREE.Vector3( 1, 0, 0 ), new THREE.Vector3( 0, 0, 1 ), new THREE.Vector3( 0, - 1, 0 ) ),
	// hanging from a hook through the gills: nose up, left flank toward +z, back toward +x
	gill: new THREE.Matrix4().makeBasis( new THREE.Vector3( 0, 0, 1 ), new THREE.Vector3( 1, 0, 0 ), new THREE.Vector3( 0, 1, 0 ) ),
	// upright (belly down), nose toward +x: lobsters, leaves, ice
	flat: new THREE.Matrix4().makeBasis( new THREE.Vector3( 0, 0, - 1 ), new THREE.Vector3( 0, 1, 0 ), new THREE.Vector3( 1, 0, 0 ) ),
};

export { iceGeometry, leafGeometry, lobsterGeometry };

export class FishProps {

	constructor() {

		this.items = [];
		this.mesh = null;

	}

	// kind: 'whole' | 'split' | 'head' | 'trunk' | 'ice' | 'leaf' | 'lobster'. frame: world matrix of the
	// placement (see POSE: the pose rotation is applied here). anchor (model units): the model point
	// placed at the frame origin (after bending).
	add( kind, species, frame, pose, L, o = {} ) {

		const S = species ? SPECIES[ species ] : null;
		const curl = o.curl ?? 0, sag = o.sag ?? 0;
		_m.multiplyMatrices( frame, POSE[ pose ] );
		_m.decompose( _p, _q, _s );
		// the anchor point of the model sits at the frame origin
		const a = o.anchor || [ 0, 0, 0 ];
		const b = bendPoint( a[ 0 ], a[ 1 ], a[ 2 ], curl, sag, new THREE.Vector3() ).multiplyScalar( L ).applyQuaternion( _q );
		_p.sub( b );
		this.items.push( {
			kind, species, L,
			x: _p.x, y: _p.y, z: _p.z, q: _q.toArray(),
			pattern: S ? S.pattern : 0, seed: o.seed ?? Math.random(),
			curl, sag, jaw: o.jaw ?? 0,
			flags: [ o.cloudy ?? 0.4, o.wet ?? 1, o.dried ?? 0, o.blood ?? 0 ],
		} );

	}

	// half thickness of a fish lying on its side (m)
	static restHeight( species, L ) {

		const S = SPECIES[ species ];
		let w = 0;
		for ( let u = 0.1; u < 0.9; u += 0.05 ) w = Math.max( w, section( S, u ).W );
		return w * L * 0.85;

	}

	// model z of the caudal peduncle / the hook through the gill cover
	static tailAnchor( species ) {

		const S = SPECIES[ species ];
		return [ 0, 0, 0.5 - S.body * 0.985 ];

	}

	static gillAnchor( species ) {

		const S = SPECIES[ species ];
		return [ 0, S.mouth.y * 0.5, 0.5 - S.body * ( S.mouth.corner + 0.03 ) ];

	}

	build() {

		// models: two levels of detail per kind and species, plus a low detail shadow proxy
		const keys = new Map();
		for ( const it of this.items ) {

			const key = it.kind + ':' + ( it.species || '' );
			if ( ! keys.has( key ) ) keys.set( key, { kind: it.kind, species: it.species } );

		}

		const kinds = [];
		const base = new Map();
		for ( const [ key, k ] of keys ) {

			const S = k.species ? SPECIES[ k.species ] : null;
			const geo = ( lod ) => {

				switch ( k.kind ) {

					case 'split': return splitFishGeometry( S, { lod } );
					case 'head': return fishGeometry( S, { lod, pose: 'dead', u1: S.opercle + 0.02, eyes: lod === 0 } );
					case 'trunk': return fishGeometry( S, { lod, pose: 'dead', u0: S.opercle + 0.02 } );
					case 'ice': return iceGeometry( lod );
					case 'leaf': return leafGeometry( lod );
					case 'lobster': return lobsterGeometry( lod );
					default: return fishGeometry( S, { lod, pose: 'dead', eyes: lod === 0 } );

				}

			};

			base.set( key, kinds.length );
			const g1 = geo( 1 );
			kinds.push( { geometry: geo( 0 ) }, { geometry: g1 }, { geometry: g1, shadow: true, shadowOnly: true } );

		}

		const n = this.items.length;
		const batch = new ReefBatch( 'FishProps', kinds, { maxInstances: Math.max( 1, n ), fade: true } );
		const D = batch.data;
		this.kind0 = new Uint16Array( n );
		this.pos = new Float32Array( n * 4 );
		this.items.forEach( ( it, i ) => {

			const o = i * 16;
			D.set( [ it.x, it.y, it.z, it.L ], o );
			D.set( it.q, o + 4 );
			D.set( [ it.pattern + ( it.seed % 1 ) * 0.9, it.curl, it.sag, it.jaw ], o + 8 );
			D.set( it.flags, o + 12 );
			this.kind0[ i ] = base.get( it.kind + ':' + ( it.species || '' ) );
			this.pos.set( [ it.x, it.y, it.z, it.L ], i * 4 );

		} );
		batch.upload();
		this.batch = batch;
		this.material = createPropMaterial( batch );
		const mesh = batch.createMesh( this.material, { castShadow: true, receiveShadow: true } );
		mesh.name = 'village_fish';
		// level-of-detail cross-fades (dithered) as a child: it follows the prop mesh
		this.fadeMaterial = createPropMaterial( batch, { fade: true } );
		mesh.add( batch.createFadeMesh( this.fadeMaterial ) );
		const draw = mesh.onBeforeRender;
		this._frame = - 1;
		mesh.onBeforeRender = ( renderer, scene, camera, geometry, material, group ) => {

			// (three: renderer.info.calls; the engine has no renderer here: the GPU frame number)
			if ( camera.isPerspectiveCamera ) this.cull( camera, GPU.frame );
			draw( renderer, scene, camera, geometry, material, group );

		};

		this.mesh = mesh;
		this.items = null;
		return mesh;

	}

	cull( camera, frame ) {

		if ( frame === this._frame ) return;
		this._frame = frame;
		camera.updateMatrixWorld();
		_m.multiplyMatrices( camera.projectionMatrix, camera.matrixWorldInverse );
		_frustum.setFromProjectionMatrix( _m, camera.coordinateSystem, camera.reversedDepth );
		const c = camera.position, P = this.pos, batch = this.batch;
		const n = this.kind0.length;
		batch.begin();
		for ( let i = 0; i < n; i ++ ) {

			const dx = P[ i * 4 ] - c.x, dy = P[ i * 4 + 1 ] - c.y, dz = P[ i * 4 + 2 ] - c.z;
			const L = P[ i * 4 + 3 ];
			const d = Math.sqrt( dx * dx + dy * dy + dz * dz );
			if ( d > DRAW_RANGE ) continue;
			const k = this.kind0[ i ];
			if ( d < SHADOW_RANGE ) batch.add( k + 2, i );
			_sphere.center.set( P[ i * 4 ], P[ i * 4 + 1 ], P[ i * 4 + 2 ] );
			_sphere.radius = L * 0.8;
			if ( ! _frustum.intersectsSphere( _sphere ) ) continue;
			// level of detail by distance, cross-faded over a band; faded out near the draw range
			const s = L * 28, far = DRAW_RANGE * 0.9;
			if ( d > far ) batch.addFade( k + ( d < s ? 0 : 1 ), i, 1 - bandFade( d, far, DRAW_RANGE ), false );
			else if ( d > s * 0.88 && d < s ) {

				const f = bandFade( d, s * 0.88, s );
				batch.addFade( k, i, f, true );
				batch.addFade( k + 1, i, f, false );

			} else batch.add( k + ( d < s ? 0 : 1 ), i );

		}

		batch.commit();

	}

}
