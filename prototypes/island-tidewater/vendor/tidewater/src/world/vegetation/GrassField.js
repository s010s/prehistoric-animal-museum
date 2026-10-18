import * as THREE from '../../engine/index.js';
import { Texture } from '../../engine/gpu/Texture.js';
import { ShaderModule } from '../../engine/gpu/Shader.js';
import { Material } from '../../engine/render/Material.js';
import { mulberry32 } from '../../util/Noise.js';
import { vegModule, uCamPos, C, f } from './VegNodes.js';

// Camera-following ground flora: tall meadow grass (knee to waist high), dune grass, sea oats and
// beach creeper.
//
// The world is divided into CELL x CELL metre cells. Every visible cell near the camera draws one
// instance of a "patch": a fixed blue-noise set of clump slots. In the vertex shader each slot is
// placed at cellOrigin + slot offset, its height comes from the terrain heightmap (manual bilinear
// textureLoad) and its presence / size from an RGBA density mask (R dune grass, G meadow grass,
// B sea oats, A creeper). Empty cells are skipped on the CPU and cells are frustum culled.
//
// Three levels share the same clumps and blades (identical parameters), so switching a cell
// between them never moves a blade:
//   near (< R_NEAR): every blade, 3 segments        mid (< R_MID): tiers 0-1, 2 segments
//   far (< R_FAR): tier 0, one triangle per blade
// Every blade has a tier; tier 2 blades fade out (narrow to nothing) before R_NEAR, tier 1 before
// R_MID, and tier 0 thins out (random per-blade cut-off) towards R_FAR where the terrain's meadow
// shading takes over. The remaining blades widen as the others fade, so the grass covers the
// ground equally at every distance (constant blade density x width).

export const CELL = 8;
export const R_NEAR = 18;
export const R_MID = 46;
export const R_FAR = 88;
export const FADE_T2 = [ 11, 17 ];
export const FADE_T1 = [ 36, 45 ];
export const FADE_T0 = [ 62, 87 ]; // tier 0 blades drop out at random distances in this range
const MAX_NEAR = 48;
const MAX_MID = 160;
const MAX_FAR = 420;
const CLUMPS = 384; // meadow / dune clump slots per cell (6 per m^2)
const BLADES = 7; // per clump
const BLADE_TIER = [ 0, 0, 1, 1, 2, 2, 2 ];
// blades per clump in each tier (coverage compensation)
const TIER_N = [ 2, 2, 3 ];
const OATS = 12; // sea oat slots per cell
const VINES = 28; // creeper slots per cell

const KIND = { GRASS: 0, OAT_STALK: 1, OAT_HEAD: 2, CREEPER: 3, FLOWER: 4 };

// Mitchell's best-candidate blue noise on a torus; any prefix is also well distributed.
function blueNoise( rand, n, size, k = 10 ) {

	const pts = [];
	for ( let i = 0; i < n; i ++ ) {

		let best = null, bestD = - 1;
		for ( let c = 0; c < ( i === 0 ? 1 : k ); c ++ ) {

			const x = rand() * size, z = rand() * size;
			let dmin = Infinity;
			for ( const p of pts ) {

				let dx = Math.abs( p[ 0 ] - x ), dz = Math.abs( p[ 1 ] - z );
				dx = Math.min( dx, size - dx );
				dz = Math.min( dz, size - dz );
				dmin = Math.min( dmin, dx * dx + dz * dz );

			}

			if ( dmin > bestD ) {

				bestD = dmin;
				best = [ x, z ];

			}

		}

		pts.push( best );

	}

	return pts;

}

class PatchBuilder {

	constructor() {

		this.pos = [];
		this.nor = [];
		this.side = [];
		this.slot = [];
		this.bladeData = [];
		this.idx = [];

	}

	get count() {

		return this.pos.length / 3;

	}

	// side: xyz offset direction * half width, w: across coordinate (-1 left edge, 1 right, 0 tip)
	v( p, n, side, slot, blade ) {

		this.pos.push( p[ 0 ], p[ 1 ], p[ 2 ] );
		this.nor.push( n[ 0 ], n[ 1 ], n[ 2 ] );
		this.side.push( side[ 0 ], side[ 1 ], side[ 2 ], side[ 3 ] ?? 0 );
		this.slot.push( slot[ 0 ], slot[ 1 ], slot[ 2 ], slot[ 3 ] );
		this.bladeData.push( blade[ 0 ], blade[ 1 ], blade[ 2 ], blade[ 3 ] );
		return this.count - 1;

	}

	// blade: centre-line points with half widths; tip row has zero width (single vertex).
	// w4: aBlade.w (grass: tier)
	blade( slot, kind, rows, width, dirX, dirZ, lean, height, curve, rnd, base = [ 0, 0 ], w4 = 0 ) {

		const sx = - dirZ, sz = dirX; // horizontal side direction
		const ids = [];
		for ( let r = 0; r < rows.length; r ++ ) {

			const h = rows[ r ];
			const out = ( Math.sin( lean ) * h + curve * h * h ) * height;
			const up = ( Math.cos( lean ) * h - curve * 0.35 * h * h ) * height;
			const p = [ base[ 0 ] + dirX * out, up, base[ 1 ] + dirZ * out ];
			// tangent for the normal
			const dOut = Math.sin( lean ) + 2 * curve * h, dUp = Math.cos( lean ) - 0.7 * curve * h;
			const tl = Math.hypot( dOut, dUp );
			const tx = dirX * dOut / tl, ty = dUp / tl, tz = dirZ * dOut / tl;
			// normal = side x tangent
			const nx = - sz * ty, ny = sz * tx - sx * tz, nz = sx * ty;
			const nl = Math.hypot( nx, ny, nz ) || 1;
			const n = [ nx / nl, ny / nl, nz / nl ];
			const hw = width * ( 1 - Math.pow( h, 1.6 ) ) * ( 0.75 + 0.25 * ( 1 - h ) );
			const blade = [ h, kind, rnd, w4 ];
			if ( r === rows.length - 1 ) {

				ids.push( [ this.v( p, n, [ 0, 0, 0, 0 ], slot, blade ) ] );

			} else {

				ids.push( [
					this.v( p, n, [ - sx * hw, 0, - sz * hw, - 1 ], slot, blade ),
					this.v( p, n, [ sx * hw, 0, sz * hw, 1 ], slot, blade ),
				] );

			}

		}

		for ( let r = 0; r < ids.length - 1; r ++ ) {

			const a = ids[ r ], b = ids[ r + 1 ];
			if ( b.length === 1 ) this.idx.push( a[ 0 ], a[ 1 ], b[ 0 ] );
			else this.idx.push( a[ 0 ], a[ 1 ], b[ 1 ], a[ 0 ], b[ 1 ], b[ 0 ] );

		}

	}

	// small leaf / flower lying on the ground: triangle fan around a centre point.
	// outline(a) gives the radius factor for angle a (0 = pointing along dir).
	fan( slot, kind, center, radius, dirX, dirZ, tilt, sides, outline, rnd, lift, hf = 0.1 ) {

		const c = this.v( [ center[ 0 ], lift, center[ 1 ] ], [ 0, 1, 0 ], [ 0, 0, 0, 0 ], slot, [ hf, kind, rnd, 1 ] );
		const ring = [];
		for ( let i = 0; i < sides; i ++ ) {

			const a = ( i / sides ) * Math.PI * 2;
			const r = radius * outline( a );
			const lx = Math.cos( a ) * r, lz = Math.sin( a ) * r * 0.85;
			const x = center[ 0 ] + lx * dirX - lz * dirZ;
			const z = center[ 1 ] + lx * dirZ + lz * dirX;
			const along = lx / radius;
			const y = lift + ( along + 0.6 ) * radius * tilt;
			ring.push( this.v( [ x, y, z ], [ 0, 1, 0 ], [ 0, 0, 0, 0 ], slot, [ hf + 0.05 * Math.max( 0, along ), kind, rnd, 0 ] ) );

		}

		for ( let i = 0; i < sides; i ++ ) this.idx.push( c, ring[ ( i + 1 ) % sides ], ring[ i ] );

	}

	// thin ribbon lying on the ground (creeper runner)
	ribbon( slot, kind, pts, width, rnd ) {

		const ids = [];
		for ( let i = 0; i < pts.length; i ++ ) {

			const p = pts[ i ], q = pts[ Math.min( pts.length - 1, i + 1 ) ], o = pts[ Math.max( 0, i - 1 ) ];
			let dx = q[ 0 ] - o[ 0 ], dz = q[ 2 ] - o[ 2 ];
			const l = Math.hypot( dx, dz ) || 1;
			dx /= l; dz /= l;
			const sx = - dz * width, sz = dx * width;
			ids.push( [
				this.v( [ p[ 0 ] - sx, p[ 1 ], p[ 2 ] - sz ], [ 0, 1, 0 ], [ 0, 0, 0, 0 ], slot, [ 0.05, kind, rnd, 0 ] ),
				this.v( [ p[ 0 ] + sx, p[ 1 ], p[ 2 ] + sz ], [ 0, 1, 0 ], [ 0, 0, 0, 0 ], slot, [ 0.05, kind, rnd, 0 ] ),
			] );

		}

		for ( let i = 0; i < ids.length - 1; i ++ ) {

			const a = ids[ i ], b = ids[ i + 1 ];
			this.idx.push( a[ 0 ], b[ 1 ], a[ 1 ], a[ 0 ], b[ 0 ], b[ 1 ] );

		}

	}

	build() {

		const g = new THREE.InstancedBufferGeometry();
		g.setAttribute( 'position', new THREE.Float32BufferAttribute( this.pos, 3 ) );
		g.setAttribute( 'normal', new THREE.Float32BufferAttribute( this.nor, 3 ) );
		g.setAttribute( 'aSide', new THREE.Float32BufferAttribute( this.side, 4 ) );
		g.setAttribute( 'aSlot', new THREE.Float32BufferAttribute( this.slot, 4 ) );
		g.setAttribute( 'aBlade', new THREE.Float32BufferAttribute( this.bladeData, 4 ) );
		g.setIndex( this.count > 65535 ? new THREE.Uint32BufferAttribute( this.idx, 1 ) : new THREE.Uint16BufferAttribute( this.idx, 1 ) );
		g.boundingSphere = new THREE.Sphere( new THREE.Vector3(), 1e7 );
		g.boundingBox = new THREE.Box3( new THREE.Vector3( - 1e7, - 1e7, - 1e7 ), new THREE.Vector3( 1e7, 1e7, 1e7 ) );
		return g;

	}

	get triangles() {

		return this.idx.length / 3;

	}

}

// Clump / blade parameters shared by all levels (same seeds -> identical blades).
function clumpParams( seed ) {

	const rand = mulberry32( seed );
	const slots = blueNoise( mulberry32( seed + 1 ), CLUMPS, CELL );
	return slots.map( ( [ x, z ] ) => {

		const slotRand = rand();
		const az0 = rand() * Math.PI * 2;
		const blades = [];
		for ( let k = 0; k < BLADES; k ++ ) {

			// golden-angle azimuths: any prefix of the blades spreads around the clump; the first
			// two (kept at every distance) lean away from each other
			const az = az0 + k * 2.39996 + ( rand() - 0.5 ) * 0.5;
			const outer = k === 0 ? 0.1 + 0.3 * rand() : k === 1 ? 0.35 + 0.4 * rand() : rand();
			blades.push( {
				dx: Math.cos( az ), dz: Math.sin( az ),
				lean: 0.06 + 0.55 * outer * ( 0.6 + 0.8 * rand() ),
				h: ( 0.7 + 0.5 * rand() ) * ( 1.06 - 0.22 * outer ),
				curve: 0.12 + 0.5 * outer * ( 0.5 + rand() ),
				rnd: rand(),
				base: [ Math.cos( az ) * 0.09 * rand(), Math.sin( az ) * 0.09 * rand() ],
				tier: BLADE_TIER[ k ],
			} );

		}

		return { x, z, slotRand, blades };

	} );

}

// level: 0 near, 1 mid, 2 far
function buildPatch( level, clumps, seed = 7 ) {

	const b = new PatchBuilder();
	const rows = [ [ 0, 0.3, 0.62, 1 ], [ 0, 0.55, 1 ], [ 0, 1 ] ][ level ];
	const maxTier = 2 - level;

	for ( const c of clumps ) {

		const slot = [ c.x, c.z, c.slotRand, 0 ];
		for ( const bl of c.blades ) {

			if ( bl.tier > maxTier ) continue;
			b.blade( slot, KIND.GRASS, rows, 0.012, bl.dx, bl.dz, bl.lean, bl.h, bl.curve, bl.rnd, bl.base, bl.tier );

		}

	}

	if ( level === 2 ) return b;

	// sea oats (tier 1: fade out before the far level) and, near only, beach creeper. Every slot
	// has its own random stream, so the near and mid versions of a plant are identical.
	const oatSlots = blueNoise( mulberry32( seed + 2 ), OATS, CELL );
	const near = level === 0;
	oatSlots.forEach( ( [ x, z ], si ) => {

		const rand = mulberry32( seed * 7919 + si * 131 + 17 );
		const slot = [ x, z, rand(), 1 ];
		const stalks = near ? 3 : 1;
		for ( let q = 0; q < 3; q ++ ) {

			const az = rand() * Math.PI * 2;
			const dx = Math.cos( az ), dz = Math.sin( az );
			const lean = 0.06 + 0.14 * rand();
			const hq = 0.8 + 0.3 * rand();
			const rnd = rand();
			const bx = q === 0 ? 0 : ( rand() - 0.5 ) * 0.22, bz = q === 0 ? 0 : ( rand() - 0.5 ) * 0.22;
			const hs = [ rand(), rand(), rand(), rand(), rand(), rand(), rand(), rand() ];
			if ( q >= stalks ) continue;
			const qTier = q === 0 ? 0 : 2;
			// stalk (unit height, scaled in the shader)
			b.blade( slot, KIND.OAT_STALK, near ? [ 0, 0.3, 0.6, 0.85, 1 ] : [ 0, 0.6, 1 ], near ? 0.0075 : 0.014, dx, dz, lean, hq, 0.2, rnd, [ bx, bz ], qTier );
			// drooping panicle: flat spikelets hanging off the upper stalk
			const heads = near ? 8 : 3;
			for ( let k = 0; k < heads; k ++ ) {

				const hf = 0.7 + 0.3 * ( k / Math.max( 1, heads - 1 ) );
				const out = ( Math.sin( lean ) * hf + 0.2 * hf * hf ) * hq;
				const up = ( Math.cos( lean ) * hf - 0.07 * hf * hf ) * hq;
				const sa = az + ( k % 2 ? 1 : - 1 ) * ( 0.45 + 0.6 * hs[ k ] );
				const sdx = Math.cos( sa ), sdz = Math.sin( sa );
				const cx = bx + dx * out + sdx * 0.02, cz = bz + dz * out + sdz * 0.02;
				const L = near ? 0.085 : 0.13, W = near ? 0.022 : 0.04;
				const n = [ 0, 1, 0 ];
				const slotB = [ hf, KIND.OAT_HEAD, rnd, qTier ];
				const a = b.v( [ cx, up + 0.01, cz ], n, [ 0, 0, 0, 0 ], slot, slotB );
				const l = b.v( [ cx + sdx * L * 0.45 - sdz * W, up - L * 0.4, cz + sdz * L * 0.45 + sdx * W ], n, [ 0, 0, 0, 0 ], slot, slotB );
				const r = b.v( [ cx + sdx * L * 0.45 + sdz * W, up - L * 0.4, cz + sdz * L * 0.45 - sdx * W ], n, [ 0, 0, 0, 0 ], slot, slotB );
				const t = b.v( [ cx + sdx * L * 0.8, up - L * 0.95, cz + sdz * L * 0.8 ], n, [ 0, 0, 0, 0 ], slot, slotB );
				b.idx.push( a, l, t, a, t, r );

			}

		}

		if ( near ) {

			for ( let k = 0; k < 4; k ++ ) {

				const la = ( k / 4 ) * Math.PI * 2 + rand();
				b.blade( slot, KIND.GRASS, [ 0, 0.45, 0.8, 1 ], 0.01, Math.cos( la ), Math.sin( la ), 0.55 + 0.4 * rand(), 0.45, 0.35, rand(), [ 0, 0 ], 2 );

			}

		}

	} );

	if ( ! near ) return b;

	// beach creeper (railroad vine): a runner crawling over the sand with notched leaves
	const notched = ( a ) => {

		const d = Math.min( Math.abs( a ), Math.abs( a - Math.PI * 2 ) );
		return 1 - 0.38 * Math.exp( - ( d * d ) / 0.12 ) - 0.15 * Math.pow( Math.sin( a * 0.5 ), 8 );

	};
	const petals = ( a ) => 0.82 + 0.18 * Math.cos( a * 5 );
	const vineSlots = blueNoise( mulberry32( seed + 3 ), VINES, CELL );
	vineSlots.forEach( ( [ x, z ], si ) => {

		const rand = mulberry32( seed * 3571 + si * 197 + 5 );
		const slot = [ x, z, rand(), 2 ];
		let az = rand() * Math.PI * 2;
		const pts = [];
		const n = 12;
		let px = - Math.cos( az ) * 1.1, pz = - Math.sin( az ) * 1.1;
		for ( let i = 0; i < n; i ++ ) {

			pts.push( [ px, 0.01, pz ] );
			az += ( rand() - 0.5 ) * 0.5;
			px += Math.cos( az ) * 0.19;
			pz += Math.sin( az ) * 0.19;

		}

		b.ribbon( slot, KIND.CREEPER, pts, 0.011, rand() );
		for ( let i = 1; i < pts.length; i ++ ) {

			const side = i % 2 ? 1 : - 1;
			const p0 = pts[ i - 1 ], p1 = pts[ i ];
			let dx = p1[ 0 ] - p0[ 0 ], dz = p1[ 2 ] - p0[ 2 ];
			const l = Math.hypot( dx, dz ) || 1;
			dx /= l; dz /= l;
			// leaves stand on short petioles, angled forward off the runner, tilted up
			const la = Math.atan2( dz, dx ) + side * ( 0.7 + 0.5 * rand() );
			const ldx = Math.cos( la ), ldz = Math.sin( la );
			const r = ( 0.07 + 0.04 * rand() ) * ( 0.6 + 0.4 * Math.sin( Math.PI * i / n ) );
			b.fan( slot, KIND.CREEPER, [ p1[ 0 ] + ldx * r * 0.9, p1[ 2 ] + ldz * r * 0.9 ], r, ldx, ldz, 0.3 + 0.3 * rand(), 7, notched, rand(), 0.015 );

		}

		const fp = pts[ 3 + Math.floor( rand() * 4 ) ];
		b.fan( slot, KIND.FLOWER, [ fp[ 0 ] + 0.03, fp[ 2 ] + 0.03 ], 0.036, 1, 0, 1.4, 10, petals, rand(), 0.07, 0.2 );

	} );

	return b;

}

export class GrassField {

	constructor( { terrain, mask } ) {

		this.terrain = terrain;
		const res = terrain.res;
		const maskData = mask.data, mres = mask.res;

		// terrain heights (float, loaded + bilinearly filtered manually) and density mask
		this.heightTex = new Texture( { label: 'grassHeights', width: res, height: res, format: 'r32float', data: terrain.heights } );
		// three-style handle: `heightTex.needsUpdate = true` re-uploads terrain.heights (Vegetation.refreshTerrain)
		Object.defineProperty( this.heightTex, 'needsUpdate', { set: ( v ) => {

			if ( v ) this.heightTex.upload( terrain.heights );

		} } );
		this.maskTex = new Texture( { label: 'grassMask', width: mres, height: mres, format: 'rgba8unorm', data: maskData, sampler: 'linearClamp' } );

		// per-cell occupancy + height range (for skipping empty cells and frustum tests)
		const cellsPerSide = Math.ceil( terrain.size / CELL );
		this.cellsPerSide = cellsPerSide;
		this.cellFlags = new Uint8Array( cellsPerSide * cellsPerSide );
		this.cellMinY = new Float32Array( cellsPerSide * cellsPerSide );
		this.cellMaxY = new Float32Array( cellsPerSide * cellsPerSide );
		const mpc = CELL / ( terrain.size / mres ); // mask texels per cell
		const hpc = CELL / terrain.texel; // height texels per cell
		for ( let cj = 0; cj < cellsPerSide; cj ++ ) {

			for ( let ci = 0; ci < cellsPerSide; ci ++ ) {

				let any = 0, mn = Infinity, mx = - Infinity;
				const i0 = Math.max( 0, Math.floor( ci * mpc ) - 1 ), i1 = Math.min( mres - 1, Math.ceil( ( ci + 1 ) * mpc ) + 1 );
				const j0 = Math.max( 0, Math.floor( cj * mpc ) - 1 ), j1 = Math.min( mres - 1, Math.ceil( ( cj + 1 ) * mpc ) + 1 );
				for ( let j = j0; j <= j1 && ! any; j ++ ) for ( let i = i0; i <= i1; i ++ ) {

					const o = ( j * mres + i ) * 4;
					if ( maskData[ o ] > 8 || maskData[ o + 1 ] > 8 || maskData[ o + 2 ] > 8 || maskData[ o + 3 ] > 8 ) {

						any = 1;
						break;

					}

				}

				const c = cj * cellsPerSide + ci;
				this.cellFlags[ c ] = any;
				if ( ! any ) continue;
				const hi0 = Math.max( 0, Math.floor( ci * hpc ) - 1 ), hi1 = Math.min( res - 1, Math.ceil( ( ci + 1 ) * hpc ) + 1 );
				const hj0 = Math.max( 0, Math.floor( cj * hpc ) - 1 ), hj1 = Math.min( res - 1, Math.ceil( ( cj + 1 ) * hpc ) + 1 );
				for ( let j = hj0; j <= hj1; j ++ ) for ( let i = hi0; i <= hi1; i ++ ) {

					const h = terrain.heights[ j * res + i ];
					if ( h < mn ) mn = h;
					if ( h > mx ) mx = h;

				}

				this.cellMinY[ c ] = mn;
				this.cellMaxY[ c ] = mx;

			}

		}

		this.material = this._createMaterial();

		const clumps = clumpParams( 7 );
		const patches = [ buildPatch( 0, clumps ), buildPatch( 1, clumps ), buildPatch( 2, clumps ) ];
		this.patchTris = patches.map( ( p ) => p.triangles );
		this.levels = [
			this._createMesh( patches[ 0 ].build(), MAX_NEAR, 'veg-grass-near' ),
			this._createMesh( patches[ 1 ].build(), MAX_MID, 'veg-grass-mid' ),
			this._createMesh( patches[ 2 ].build(), MAX_FAR, 'veg-grass-far' ),
		];
		this.meshes = this.levels.map( ( l ) => l.mesh );

		this._frustum = new THREE.Frustum();
		this._mat = new THREE.Matrix4();
		this._box = new THREE.Box3();
		this._last = new Float64Array( 8 ).fill( NaN );

	}

	// back-compat accessors (stats)
	get near() {

		return this.levels[ 0 ];

	}

	get far() {

		return this.levels[ 2 ];

	}

	get nearTris() {

		return this.patchTris[ 0 ];

	}

	get farTris() {

		return this.patchTris[ 2 ];

	}

	_createMesh( geometry, max, name ) {

		const arr = new Float32Array( max * 4 );
		const attr = new THREE.InstancedBufferAttribute( arr, 4 );
		attr.setUsage( THREE.DynamicDrawUsage );
		geometry.setAttribute( 'iCell', attr );
		geometry.instanceCount = 0;
		const mesh = new THREE.Mesh( geometry, this.material );
		mesh.name = name;
		mesh.frustumCulled = false;
		mesh.castShadow = false;
		mesh.receiveShadow = true;
		mesh.matrixAutoUpdate = false;
		return { mesh, geometry, attr, arr, max, count: 0 };

	}

	_createMaterial() {

		return createGrassMaterial( this );

	}

	// Recompute visible cells (cheap; skipped when the camera did not change).
	update( camera ) {

		// skip when the camera has not moved / turned noticeably
		const e = camera.matrixWorld.elements;
		const L = this._last;
		const pe = camera.projectionMatrix.elements;
		if ( Math.abs( e[ 12 ] - L[ 0 ] ) < 0.05 && Math.abs( e[ 13 ] - L[ 1 ] ) < 0.05 && Math.abs( e[ 14 ] - L[ 2 ] ) < 0.05 &&
			Math.abs( e[ 8 ] - L[ 3 ] ) < 1e-3 && Math.abs( e[ 9 ] - L[ 4 ] ) < 1e-3 && Math.abs( e[ 10 ] - L[ 5 ] ) < 1e-3 &&
			pe[ 0 ] === L[ 6 ] && pe[ 5 ] === L[ 7 ] ) return false;
		L[ 0 ] = e[ 12 ]; L[ 1 ] = e[ 13 ]; L[ 2 ] = e[ 14 ];
		L[ 3 ] = e[ 8 ]; L[ 4 ] = e[ 9 ]; L[ 5 ] = e[ 10 ];
		L[ 6 ] = pe[ 0 ]; L[ 7 ] = pe[ 5 ];

		this._mat.multiplyMatrices( camera.projectionMatrix, camera.matrixWorldInverse );
		this._frustum.setFromProjectionMatrix( this._mat, camera.coordinateSystem, camera.reversedDepth );

		const cx = e[ 12 ], cy = e[ 13 ], cz = e[ 14 ];
		const t = this.terrain;
		const n = this.cellsPerSide;
		const i0 = Math.max( 0, Math.floor( ( cx - R_FAR - t.origin ) / CELL ) ), i1 = Math.min( n - 1, Math.floor( ( cx + R_FAR - t.origin ) / CELL ) );
		const j0 = Math.max( 0, Math.floor( ( cz - R_FAR - t.origin ) / CELL ) ), j1 = Math.min( n - 1, Math.floor( ( cz + R_FAR - t.origin ) / CELL ) );
		const [ near, mid, far ] = this.levels;
		let nc = 0, mc = 0, fc = 0;

		for ( let j = j0; j <= j1; j ++ ) {

			for ( let i = i0; i <= i1; i ++ ) {

				const c = j * n + i;
				if ( ! this.cellFlags[ c ] ) continue;
				const x0 = t.origin + i * CELL, z0 = t.origin + j * CELL;
				// nearest point of the cell (horizontal, like the shader's LOD distance)
				const dx = Math.max( x0 - cx, 0, cx - x0 - CELL );
				const dz = Math.max( z0 - cz, 0, cz - z0 - CELL );
				const d = Math.hypot( dx, dz );
				if ( d > R_FAR ) continue;
				this._box.min.set( x0, this.cellMinY[ c ] - 0.5, z0 );
				this._box.max.set( x0 + CELL, this.cellMaxY[ c ] + 1.8, z0 + CELL );
				if ( ! this._frustum.intersectsBox( this._box ) ) continue;
				if ( d < R_NEAR && nc < near.max ) {

					near.arr[ nc * 4 ] = x0;
					near.arr[ nc * 4 + 1 ] = z0;
					nc ++;

				} else if ( d < R_MID && mc < mid.max ) {

					mid.arr[ mc * 4 ] = x0;
					mid.arr[ mc * 4 + 1 ] = z0;
					mc ++;

				} else if ( d >= R_MID && fc < far.max ) {

					far.arr[ fc * 4 ] = x0;
					far.arr[ fc * 4 + 1 ] = z0;
					fc ++;

				}

			}

		}

		for ( const [ lvl, count ] of [ [ near, nc ], [ mid, mc ], [ far, fc ] ] ) {

			lvl.count = count;
			lvl.geometry.instanceCount = count;
			lvl.attr.clearUpdateRanges();
			lvl.attr.addUpdateRange( 0, Math.max( 1, count ) * 4 );
			lvl.attr.needsUpdate = true;

		}

		return true;

	}

	get triangles() {

		return this.levels.reduce( ( a, l, k ) => a + l.count * this.patchTris[ k ], 0 );

	}

	dispose() {

		this.heightTex.destroy();
		this.maskTex.destroy();
		this.material.dispose();
		for ( const m of this.meshes ) m.geometry.dispose();

	}

}

// ------------------------------------------------------------------------------------------ WGSL

// sRGB float triple -> linear WGSL vec3 (TerrainShading.srgb)
const _lin = ( c ) => ( c < 0.04045 ? c * 0.0773993808 : Math.pow( c * 0.9478672986 + 0.0521327014, 2.4 ) );
const srgb = ( r, g, b ) => `vec3f( ${ _lin( r ).toFixed( 6 ) }, ${ _lin( g ).toFixed( 6 ) }, ${ _lin( b ).toFixed( 6 ) } )`;

// ---- tropical meadow (tall guinea / elephant grass)
// Local copy of TerrainShading.js's MEADOW / meadowTone (the terrain stream has not ported it yet):
// switch to the terrain module's function once it exists. The tone is shared by the terrain and
// the grass field (blade base colour): both evaluate it from the same inputs, so the geometric
// grass fades into the ground without a visible boundary.
const MEADOW = {
	lush: srgb( 0.13, 0.2, 0.05 ),
	green: srgb( 0.25, 0.32, 0.1 ),
	olive: srgb( 0.36, 0.37, 0.14 ),
	yellow: srgb( 0.5, 0.46, 0.2 ),
	straw: srgb( 0.62, 0.54, 0.33 ),
	soil: srgb( 0.17, 0.13, 0.08 ),
};

// the rotation of an xz vector by a constant angle (matches TerrainShading.rot2)
const rotXZ = ( v, a ) => {

	const c = Math.cos( a ), s = Math.sin( a );
	return `vec2f( ${ v }.x * ${ f( c ) } - ${ v }.y * ${ f( s ) }, ${ v }.x * ${ f( s ) } + ${ v }.y * ${ f( c ) } )`;

};

export const grassModule = new ShaderModule( {
	name: 'vegGrass',
	deps: [ vegModule ],
	code: /* wgsl */`
const VEG_MEADOW_LUSH = ${ MEADOW.lush };
const VEG_MEADOW_GREEN = ${ MEADOW.green };
const VEG_MEADOW_OLIVE = ${ MEADOW.olive };
const VEG_MEADOW_YELLOW = ${ MEADOW.yellow };
const VEG_MEADOW_STRAW = ${ MEADOW.straw };
const VEG_MEADOW_SOIL = ${ MEADOW.soil };

struct VegMeadow { tone: vec3f, dry: f32, lush: f32 };

//   mA, mB: detail fbm channel at the 173 m / 47 m scales (~0.5 +- 0.1): the samples at
//   rot2( xz, 0.7 ) / 173 and rot2( xz, 2.1 ) / 47 that the terrain takes anyway; slope: 1 - N.y;
//   south: N.z (the sun side). Mostly fresh green grass with olive, sun-bleached yellow and a few
// straw-dry patches (more on exposed slopes), darker lush grass in the damp patches.
// (TerrainShading's optional finer 'detail' input is not used by the grass.)
fn vegMeadowTone( mA: f32, mB: f32, slope: f32, south: f32 ) -> VegMeadow {
	let m = mA * 0.55 + mB * 0.45 + slope * 0.25 + south * 0.04;
	let olive = smoothstep( 0.52, 0.6, m );
	let yellow = smoothstep( 0.6, 0.67, m );
	let straw = smoothstep( 0.66, 0.73, m + ( mB - 0.5 ) * 0.2 );
	let lush = smoothstep( 0.46, 0.37, mB * 0.7 + mA * 0.3 + slope * 0.2 );
	var c = mix( VEG_MEADOW_GREEN, VEG_MEADOW_OLIVE, olive );
	c = mix( c, VEG_MEADOW_YELLOW, yellow * 0.8 );
	c = mix( c, VEG_MEADOW_STRAW, straw * 0.55 );
	c = mix( c, VEG_MEADOW_LUSH, lush * 0.75 );
	return VegMeadow( c, olive * 0.4 + yellow * 0.6, lush );
}

// per-tier visibility at camera distance d (1 = full width, 0 = gone); tier 0 thins out per blade
fn vegGrassTierFade( tier: f32, d: f32, cut: f32 ) -> f32 {
	let f2 = 1.0 - smoothstep( ${ f( FADE_T2[ 0 ] ) }, ${ f( FADE_T2[ 1 ] ) }, d );
	let f1 = 1.0 - smoothstep( ${ f( FADE_T1[ 0 ] ) }, ${ f( FADE_T1[ 1 ] ) }, d );
	let f0 = 1.0 - smoothstep( cut - 5.0, cut, d );
	return select( select( f0, f1, tier > 0.5 ), f2, tier > 1.5 );
}
`,
} );

function createGrassMaterial( field ) {

	const t = field.terrain;
	const res = t.res;

	const mat = new Material( {
		name: 'veg-grass',
		side: 'double',
		roughness: 0.8,
		metalness: 0,
		modules: [ vegModule, grassModule ],
		textures: {
			grassHeights: field.heightTex,
			grassMask: field.maskTex,
		},
		attributes: { iCell: 'vec4f', aSlot: 'vec4f', aBlade: 'vec4f', aSide: 'vec4f' },
		varyings: {
			vVegGrass: 'vec4f', // hf, kind, dune fraction, rand
			vVegGrassTone: 'vec4f', // meadow tone (shared with the terrain), dryness
			vVegGrass2: 'vec4f', // density, leaf / flower centre flag, across, dry blade
			vVegGust: 'f32', // current gust bend (wind sheen)
		},
		vertex: /* wgsl */`
	let cell = v.iCell.xy;
	let slot = v.aSlot;
	let blade = v.aBlade;
	let side4 = v.aSide;
	let side = side4.xyz;
	let P = v.position;
	let N = v.normal;

	let xz = cell + slot.xy;
	let hf = blade.x;
	let kind = blade.y;
	let bRnd = blade.z;

	let m = textureSampleLevel( grassMask, smpLinearClamp, ( xz - ${ f( t.origin ) } ) / ${ f( t.size ) }, 0.0 );
	let isGrass = kind < 0.5;
	let isOat = kind > 0.5 && kind < 2.5;
	let lush = m.g;
	let dune = m.r;
	// the backshore grass is dense in its clumps (the mask carries the clumping and the edge)
	let duneF = dune / ( dune + lush + 1e-3 );
	let grassP = mix( lush, min( dune * 1.1, 1.0 ), duneF );
	let density = select( select( m.a, m.b, isOat ), grassP, isGrass );
	let r = vegHash12( xz * 1.37 + 0.51 );
	let r2 = vegHash12( xz * 2.11 + 7.3 );
	let flowerOk = select( 1.0, select( 0.0, 1.0, r2 < 0.35 ), kind > 3.5 );
	let present = select( 0.0, 1.0, r < density ) * flowerOk;

	// meadow tone at the clump: the same function and inputs as the terrain's meadow shading
	let mA = textureSampleLevel( vegDetail, smpLinearRepeat, ${ rotXZ( 'xz', 0.7 ) } / 173.0, 0.0 ).w;
	let mB = textureSampleLevel( vegDetail, smpLinearRepeat, ${ rotXZ( 'xz', 2.1 ) } / 47.0, 0.0 ).w;
	let mt = vegMeadowTone( mA, mB, 0.0, 0.0 );
	// size: tall meadow grass, knee to waist high: swathes of taller grass in the lush patches,
	// lower where it is dry; wiry dune tufts
	let patchN = vegNoise( xz * ${ f( 1 / 6.5 ) } + 17.3 ) * 0.7 + vegNoise( xz * ${ f( 1 / 2.3 ) } ) * 0.3;
	let lushH = mix( 0.7, 1.3, patchN ) * ( mt.lush * 0.25 + 1.0 ) * ( 1.0 - mt.dry * 0.25 );
	// dune tufts vary a lot in size (young shoots to big old clumps)
	let grassH = mix( lushH, 0.62, duneF ) * mix( r2 * 0.35 + 0.83, r2 * r2 * 0.9 + 0.5, duneF ) * ( density * 0.35 + 0.65 );
	let oatH = r2 * 0.55 + 1.0;
	let vineS = r2 * 0.4 + 0.8;
	let hScale = select( select( vineS, oatH, isOat ), grassH, isGrass );
	// meadow clumps fan out wider than the wiry dune tufts
	let spread = select( 1.0, mix( 1.35, 1.3, duneF ), isGrass );

	// distance LOD: tiers fade out (narrow to nothing), the remaining blades widen so the
	// coverage (blade density x width) stays constant; tier 0 thins out per blade near R_FAR
	let dist = length( xz - vegParams.camPos.xz );
	// tier: grass blades and oats carry their own (aBlade.w), otherwise the slot's
	let tier = max( select( 0.0, blade.w, kind < 2.5 ), slot.w );
	let cutK = bRnd * 7.13 + r2;
	let cut = mix( ${ f( FADE_T0[ 0 ] + 5 ) }, ${ f( FADE_T0[ 1 ] ) }, cutK - floor( cutK ) );
	let own = vegGrassTierFade( tier, dist, cut );
	let f2 = 1.0 - smoothstep( ${ f( FADE_T2[ 0 ] ) }, ${ f( FADE_T2[ 1 ] ) }, dist );
	let f1 = 1.0 - smoothstep( ${ f( FADE_T1[ 0 ] ) }, ${ f( FADE_T1[ 1 ] ) }, dist );
	let comp = ${ f( TIER_N[ 0 ] + TIER_N[ 1 ] + TIER_N[ 2 ] ) } / ( f2 * ${ f( TIER_N[ 2 ] ) } + f1 * ${ f( TIER_N[ 1 ] ) } + ${ f( TIER_N[ 0 ] ) } );
	// oats and creeper simply shrink out
	let widthK = select( 1.0, comp * own, isGrass );
	let sizeK = select( own, 1.0, isGrass );
	let scale = hScale * present * sizeK;

	// per-slot random yaw
	let yaw = vegHash12( xz * 0.73 + 3.3 ) * 6.2832;
	let cy = cos( yaw ); let sy = sin( yaw );

	// terrain height (float texels loaded and bilinearly filtered manually)
	let hfp = ( xz - ${ f( t.origin ) } ) / ${ f( t.texel ) } - 0.5;
	let hfi = floor( hfp );
	let hfr = hfp - hfi;
	let ij = vec2i( clamp( hfi, vec2f( 0.0 ), vec2f( ${ f( res - 2 ) } ) ) );
	let ha = textureLoad( grassHeights, ij, 0 ).x;
	let hb = textureLoad( grassHeights, ij + vec2i( 1, 0 ), 0 ).x;
	let hc = textureLoad( grassHeights, ij + vec2i( 0, 1 ), 0 ).x;
	let hd = textureLoad( grassHeights, ij + vec2i( 1, 1 ), 0 ).x;
	let ground = mix( mix( ha, hb, hfr.x ), mix( hc, hd, hfr.x ), hfr.y );
	let base = vec3f( xz.x, ground - 0.03, xz.y );
	let pl = vec3f( P.x * spread, P.y, P.z * spread );
	let o0 = vec3f( pl.x * cy - pl.z * sy, pl.y, pl.x * sy + pl.z * cy ) * scale;

	// wind: travelling gusts bend blades downwind (length preserving), plus flutter
	let w = vegWindStrength();
	let g = vegGustAt( xz );
	let tm = frame.time;
	let ph = r * 6.2832;
	let bendAmt = w * ( g * 0.55 + 0.22 ) + sin( tm * 1.9 + ph + xz.x * 0.2 ) * w * 0.1;
	let flut = sin( tm * 7.3 + ph * 3.0 + bRnd * 20.0 ) * ( w * 0.06 + 0.015 );
	let stiff = select( select( 0.08, 0.8, isOat ), 1.0, isGrass );
	let hf2 = hf * hf;
	let disp = ( vegWindDir3() * ( bendAmt * hf2 * stiff ) + vegWindPerp3() * ( flut * hf2 * stiff ) ) * ( length( o0 ) + 1e-4 );
	let oL = length( o0 );
	let ob = normalize( o0 + disp + vec3f( 0.0, 1e-5, 0.0 ) ) * oL;

	let wScale = select( 1.0, mix( 1.5, 1.55, duneF ), isGrass );
	let wide = wScale * widthK * min( scale * 2.0, max( scale, 0.5 ) );
	let sideR = vec3f( side.x * cy - side.z * sy, side.y, side.x * sy + side.z * cy );
	let pos = base + ob + sideR * wide;

	// lighting normal: blade normal bent towards up (soft, grass-like shading), rounded across
	// the blade (a folded leaf is lit differently on its two halves)
	let across = side4.w;
	let sideDir = normalize( sideR + vec3f( 1e-5, 0.0, 0.0 ) );
	let nR = vec3f( N.x * cy - N.z * sy, N.y, N.x * sy + N.z * cy );

	// a share of the blades is dead / straw coloured (more in the dry patches)
	let dk = bRnd * 13.7 + r * 3.1;
	let dryBlade = select( 0.0, 1.0, dk - floor( dk ) < mt.dry * 0.3 + 0.07 );
	o.vVegGrass = vec4f( hf, kind, duneF, bRnd );
	o.vVegGrassTone = vec4f( mt.tone, mt.dry );
	o.vVegGrass2 = vec4f( density, select( blade.w, 0.0, kind < 2.5 ), across, dryBlade );
	o.vVegGust = sat( g * w * 0.6 ) * stiff;

	v.useWorld = true;
	v.worldPos = pos;
	v.worldNormal = normalize( nR * 0.5 + VEG_UP + sideDir * ( across * 0.35 ) );
`,
		surface: /* wgsl */`
	let hf = in.vs.vVegGrass.x;
	let kind = in.vs.vVegGrass.y;
	let duneF = in.vs.vVegGrass.z;
	let rnd = in.vs.vVegGrass.w;
	let across = in.vs.vVegGrass2.z;
	let dryBlade = in.vs.vVegGrass2.w;
	// self-shadowing of the sward: dark at the base of the clump
	let ao = mix( 0.32, 1.0, smoothstep( 0.0, 0.75, hf ) );
	// dune grass: olive base, straw tips; meadow: the terrain's meadow tone, dark and brownish
	// (dead leaf sheaths) at the base, lighter / sun-bleached towards the tips
	let duneBase = mix( ${ C( 0x5d6232 ) }, ${ C( 0x7f8a40 ) }, rnd );
	let duneTip = mix( ${ C( 0xb8ab6c ) }, ${ C( 0x9aa452 ) }, rnd );
	let tone = in.vs.vVegGrassTone.xyz * ( rnd * 0.34 + 0.83 );
	let lushBase = mix( tone * 0.5, VEG_MEADOW_SOIL, 0.3 );
	let tipDry = in.vs.vVegGrassTone.w * 0.4 + smoothstep( 0.8, 1.0, rnd ) * 0.35;
	let lushTip = mix( tone * vec3f( 1.25, 1.25, 1.05 ), VEG_MEADOW_STRAW, tipDry * smoothstep( 0.55, 1.0, hf ) );
	let gBase = mix( lushBase, duneBase, duneF );
	let gTip = mix( lushTip, duneTip, duneF );
	var grass0 = mix( gBase, gTip, smoothstep( 0.05, 0.95, hf ) );
	// dead blades: straw to brown
	grass0 = mix( grass0, mix( VEG_MEADOW_STRAW, VEG_MEADOW_SOIL * 1.8, rnd * 0.6 ) * ( smoothstep( 0.0, 0.5, hf ) * 0.4 + 0.6 ), dryBlade * ( 1.0 - duneF ) );
	// pale midrib
	grass0 = grass0 * ( pow( 1.0 - abs( across ), 6.0 ) * smoothstep( 0.05, 0.4, hf ) * 0.18 + 1.0 );
	// wind sheen: blades flattened by a gust show their paler undersides, so gusts read
	// as bright waves rolling across the grass
	let grass = mix( grass0, grass0 * vec3f( 1.3, 1.28, 1.1 ) + vec3f( 0.03, 0.03, 0.015 ), in.vs.vVegGust * smoothstep( 0.15, 0.9, hf ) * 0.6 );
	let oatStalk = mix( ${ C( 0x9c9a62 ) }, ${ C( 0xc2b27a ) }, hf );
	let oatHead = mix( ${ C( 0xc9b27a ) }, ${ C( 0xa8905a ) }, rnd );
	let centre = in.vs.vVegGrass2.y; // 1 at leaf / flower centre
	let vine = mix( mix( ${ C( 0x2e5219 ) }, ${ C( 0x4a7328 ) }, rnd ), ${ C( 0x7a8f4a ) }, centre * 0.3 ) * select( vec3f( 1.0 ), vec3f( 1.25, 1.05, 0.8 ), hf < 0.075 );
	let flower = mix( ${ C( 0xb8479c ) }, ${ C( 0xf2e8ee ) }, smoothstep( 0.35, 0.9, centre ) );
	let c = select( select( select( select( flower, vine, kind < 3.5 ), oatHead, kind < 2.5 ), oatStalk, kind < 1.5 ), grass, kind < 0.5 );
	let albedo = c * select( 1.0, ao, kind < 2.5 );
	s.albedo = albedo;
	s.roughness = select( 0.8, 0.45, kind > 2.5 && kind < 3.5 );
	s.metalness = 0.0;
	s.specularIntensity = 0.4;
	s.normal = normalize( normalize( in.vs.normal ) + in.V * 0.4 );
	// back-lit thin blades glow (evaluated in the lighting model with the shadowed light, so
	// grass in shadow does not)
	let back = pow( sat( dot( - in.V, frame.sunDir ) ), 4.0 );
	s.translucency = albedo * vec3f( 1.1, 1.3, 0.6 ) * ( back * 0.3 * smoothstep( 0.2, 1.0, hf ) ) * ( 1.0 - frame.night );
`,
	} );
	return mat;

}
