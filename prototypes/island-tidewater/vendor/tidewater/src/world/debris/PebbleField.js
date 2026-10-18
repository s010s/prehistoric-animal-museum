import { BufferGeometry, Float32BufferAttribute, Uint16BufferAttribute, InstancedBufferAttribute, Mesh, Frustum, Matrix4, Box3, DynamicDrawUsage } from '../../engine/index.js';
import { Texture } from '../../engine/gpu/Texture.js';
import { ShaderModule } from '../../engine/gpu/Shader.js';
import { commonModule } from '../../engine/render/wgsl/common.js';
import { standard } from '../../materials/Materials.js';
import { srgb, terrainShadingModule } from '../terrain/TerrainShading.js';
import { stoneSurfaceModule } from './NatureMaterial.js';
import { stonePart } from './DebrisShapes.js';

// Camera-following ground clutter: pebbles, cobbles and shell / coral grit on the beaches,
// rocky shores and paths (one draw call, no shadow casting).
//
// The ground is divided into PCELL x PCELL cells; every visible cell near the camera draws one
// instance of a patch of blue-noise slots (small pebbles, cobbles, flat shell / coral chips).
// In the vertex shader each slot looks up its density in the debris mask (DebrisPlacement: R
// pebbles, G cobbles, B grit, A stone palette), picks its size, shape, yaw from hashes of its
// world position (stable while the camera moves), sits on the terrain (TerrainGPU.heightAt) and
// shrinks to nothing with distance (small grit before cobbles): no popping. Empty cells are
// skipped on the CPU and cells are frustum culled when the camera moves.

export const PCELL = 4;
export const R_FAR = 25;
const FADE_SMALL = [ 8, 15 ];
const FADE_COBBLE = [ 15, 24 ];
const MAX_CELLS = 240;
const N_COBBLE = 18, N_CHIP = 44, N_SMALL = 150;

function blueNoise( rand, n, size, k = 12 ) {

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

// flat, slightly domed fragment with a ragged outline (shell / coral grit), unit radius
function chipPart( v ) {

	const p = [ 0, 0.3, 0 ], idx = [];
	const m = 6;
	for ( let k = 0; k < m; k ++ ) {

		const a = ( k + ( ( v * 7 + k * 3 ) % 5 ) * 0.12 ) / m * Math.PI * 2;
		const r = 0.65 + ( ( v * 13 + k * 7 ) % 9 ) / 9 * 0.45;
		p.push( Math.cos( a ) * r, 0, Math.sin( a ) * r );

	}

	for ( let k = 0; k < m; k ++ ) idx.push( 0, 1 + ( k + 1 ) % m, 1 + k );
	const n = new Array( p.length ).fill( 0 );
	for ( let t = 0; t < idx.length; t += 3 ) {

		const a = idx[ t ] * 3, b = idx[ t + 1 ] * 3, c = idx[ t + 2 ] * 3;
		const ux = p[ b ] - p[ a ], uy = p[ b + 1 ] - p[ a + 1 ], uz = p[ b + 2 ] - p[ a + 2 ];
		const vx = p[ c ] - p[ a ], vy = p[ c + 1 ] - p[ a + 1 ], vz = p[ c + 2 ] - p[ a + 2 ];
		const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
		for ( const o of [ a, b, c ] ) {

			n[ o ] += nx; n[ o + 1 ] += ny; n[ o + 2 ] += nz;

		}

	}

	for ( let i = 0; i < n.length; i += 3 ) {

		if ( n[ i + 1 ] < 0 ) {

			n[ i ] = - n[ i ]; n[ i + 1 ] = - n[ i + 1 ]; n[ i + 2 ] = - n[ i + 2 ];

		}

		n[ i + 1 ] += 0.6; // rounded edges read softer
		const l = Math.hypot( n[ i ], n[ i + 1 ], n[ i + 2 ] );
		n[ i ] /= l; n[ i + 1 ] /= l; n[ i + 2 ] /= l;

	}

	// faces up
	for ( let t = 0; t < idx.length; t += 3 ) {

		const a = idx[ t ] * 3, b = idx[ t + 1 ] * 3, c = idx[ t + 2 ] * 3;
		const ux = p[ b ] - p[ a ], uz = p[ b + 2 ] - p[ a + 2 ], vx = p[ c ] - p[ a ], vz = p[ c + 2 ] - p[ a + 2 ];
		if ( uz * vx - ux * vz < 0 ) {

			const s = idx[ t + 1 ];
			idx[ t + 1 ] = idx[ t + 2 ];
			idx[ t + 2 ] = s;

		}

	}

	return { p, n, idx };

}

function buildPatch() {

	let s = 1234567;
	const rand = () => {

		s = ( s * 16807 ) % 2147483647;
		return ( s - 1 ) / 2147483646;

	};

	const pts = blueNoise( rand, N_COBBLE + N_CHIP + N_SMALL, PCELL );
	const pos = [], nor = [], slot = [], idx = [];
	for ( let k = 0; k < pts.length; k ++ ) {

		const type = k < N_COBBLE ? 1 : k < N_COBBLE + N_CHIP ? 2 : 0;
		const part = type === 2 ? chipPart( k % 7 ) : type === 1 ? stonePart( 30 + ( k % 6 ), 1, k % 2 ? 0.5 : 0.05 ) : stonePart( 20 + ( k % 7 ), 0, k % 3 === 0 ? 0.8 : 0.1 );
		const base = pos.length / 3;
		for ( let i = 0; i < part.p.length; i ++ ) pos.push( part.p[ i ] );
		for ( let i = 0; i < part.n.length; i ++ ) nor.push( part.n[ i ] );
		for ( let i = 0; i < part.p.length / 3; i ++ ) slot.push( pts[ k ][ 0 ], pts[ k ][ 1 ], rand(), type );
		for ( let i = 0; i < part.idx.length; i ++ ) idx.push( base + part.idx[ i ] );

	}

	const g = new BufferGeometry();
	g.setAttribute( 'position', new Float32BufferAttribute( pos, 3 ) );
	g.setAttribute( 'normal', new Float32BufferAttribute( nor, 3 ) );
	g.setAttribute( 'aSlot', new Float32BufferAttribute( slot, 4 ) );
	g.setIndex( new Uint16BufferAttribute( idx, 1 ) );
	return g;

}

const pebbleModule = new ShaderModule( {
	name: 'debrisPebble',
	code: 'fn pebHash12( p: vec2f ) -> f32 { return fract( sin( dot( p, vec2f( 127.1, 311.7 ) ) ) * 43758.5453 ); }',
} );

export class PebbleField {

	// terrain: TerrainData, gpu: TerrainGPU, mask: { data (RGBA8), res, texel } over the terrain domain
	constructor( { terrain, gpu, mask } ) {

		this.terrain = terrain;
		this.gpu = gpu;
		const T = terrain;
		// RGBA8, bilinear, clamp to edge (smpLinearClamp), linear data, no mips
		this.maskTex = new Texture( { label: 'debrisPebbleMask', width: mask.res, height: mask.res, format: 'rgba8unorm', usage: [ 'sample', 'copyDst' ], data: mask.data } );

		// occupied cells + height range
		const n = Math.ceil( T.size / PCELL );
		this.cellsPerSide = n;
		this.cellFlags = new Uint8Array( n * n );
		this.cellMinY = new Float32Array( n * n );
		this.cellMaxY = new Float32Array( n * n );
		const mpc = PCELL / mask.texel;
		const hpc = PCELL / T.texel;
		let occupied = 0;
		for ( let cj = 0; cj < n; cj ++ ) for ( let ci = 0; ci < n; ci ++ ) {

			let any = 0;
			const i0 = Math.max( 0, Math.floor( ci * mpc ) - 1 ), i1 = Math.min( mask.res - 1, Math.ceil( ( ci + 1 ) * mpc ) );
			const j0 = Math.max( 0, Math.floor( cj * mpc ) - 1 ), j1 = Math.min( mask.res - 1, Math.ceil( ( cj + 1 ) * mpc ) );
			for ( let j = j0; j <= j1 && ! any; j ++ ) for ( let i = i0; i <= i1; i ++ ) {

				const o = ( j * mask.res + i ) * 4;
				if ( mask.data[ o ] > 6 || mask.data[ o + 1 ] > 6 || mask.data[ o + 2 ] > 6 ) {

					any = 1;
					break;

				}

			}

			const c = cj * n + ci;
			this.cellFlags[ c ] = any;
			if ( ! any ) continue;
			occupied ++;
			let mn = Infinity, mx = - Infinity;
			const hi0 = Math.max( 0, Math.floor( ci * hpc ) - 1 ), hi1 = Math.min( T.res - 1, Math.ceil( ( ci + 1 ) * hpc ) );
			const hj0 = Math.max( 0, Math.floor( cj * hpc ) - 1 ), hj1 = Math.min( T.res - 1, Math.ceil( ( cj + 1 ) * hpc ) );
			for ( let j = hj0; j <= hj1; j ++ ) for ( let i = hi0; i <= hi1; i ++ ) {

				const h = T.heights[ j * T.res + i ];
				if ( h < mn ) mn = h;
				if ( h > mx ) mx = h;

			}

			this.cellMinY[ c ] = mn;
			this.cellMaxY[ c ] = mx;

		}

		this.occupiedCells = occupied;
		const geometry = buildPatch();
		this.patchTris = geometry.index.count / 3;
		this.arr = new Float32Array( MAX_CELLS * 4 );
		this.attr = new InstancedBufferAttribute( this.arr, 4 );
		this.attr.setUsage( DynamicDrawUsage );
		geometry.setAttribute( 'iCell', this.attr );
		geometry.instanceCount = 0;
		this.geometry = geometry;
		this.material = this._createMaterial();
		this.mesh = new Mesh( geometry, this.material );
		this.mesh.name = 'debris-pebbles';
		this.mesh.frustumCulled = false;
		this.mesh.castShadow = false;
		this.mesh.receiveShadow = true;
		this.mesh.matrixAutoUpdate = false;
		this.mesh.staticVelocity = true;
		this.count = 0;

		this._frustum = new Frustum();
		this._mat = new Matrix4();
		this._box = new Box3();
		this._last = new Float64Array( 8 ).fill( NaN );

	}

	_createMaterial() {

		const gpu = this.gpu;
		const f = ( x ) => Number( x ).toFixed( 1 );
		// (the mask covers the terrain domain: terrainUvOf)

		const mat = standard( {
			name: 'DebrisPebbles',
			roughness: 0.8, metalness: 0,
			underwaterLighting: 'lite',
			// the former TerrainLightingModel (heightfield sun shadow on the key light)
			modules: [ commonModule, terrainShadingModule(), gpu.module, gpu.sunModulationModule, stoneSurfaceModule, pebbleModule ],
			defines: { MATERIAL_SUN_MODULATION: 1 },
			appliesHillShadow: true, // (applied above: the lighting hook must not apply it again)
			textures: { debrisPebbleMask: this.maskTex },
			attributes: { iCell: 'vec4f', aSlot: 'vec4f' },
			varyings: { vPebble: 'vec4f' }, // type, palette, seed, radius
			vertex: /* wgsl */`
	let cell = v.iCell.xy;
	let slot = v.aSlot;
	let P = v.position;
	let N = v.normal;
	let xz = cell + slot.xy;
	let m = textureSampleLevel( debrisPebbleMask, smpLinearClamp, terrainUvOf( xz ), 0.0 );
	let ptype = slot.w;
	let isSmall = ptype < 0.5;
	let isCob = ptype > 0.5 && ptype < 1.5;
	let isChip = ptype > 1.5;
	let dens = select( select( m.z, m.y, isCob ), m.x, isSmall );
	let h1 = pebHash12( xz * 1.37 + 0.51 );
	let h2 = pebHash12( xz * 2.11 + 7.3 );
	let h3 = pebHash12( xz * 3.7 + 1.1 );
	let h4 = pebHash12( xz * 5.3 + 2.9 );
	let h5 = pebHash12( xz * 8.9 + 4.7 );
	let present = step( h1, dens );
	let d = length( xz - frame.cameraPos.xz );
	let fade = 1.0 - smoothstep( select( ${ f( FADE_SMALL[ 0 ] ) }, ${ f( FADE_COBBLE[ 0 ] ) }, isCob ), select( ${ f( FADE_SMALL[ 1 ] ) }, ${ f( FADE_COBBLE[ 1 ] ) }, isCob ), d + h4 * 2.5 );
	// size: denser patches have more but slightly smaller stones
	let r = select( select( mix( 0.008, 0.022, h2 ), mix( 0.03, 0.09, h2 * h2 ), isCob ), mix( 0.007, 0.024, h2 * h2 ), isSmall ) * ( 1.15 - dens * 0.3 );
	let sc = vec3f( r * mix( 1.0, 1.55, h3 ), r * select( mix( 0.42, 0.8, h4 ), 0.28, isChip ), r );
	let k = present * fade;
	// tilt about the local x axis (the stones don't all lie flat), then yaw
	let tilt = ( h5 - 0.5 ) * select( 0.9, 0.5, isChip );
	let ct = cos( tilt ); let st = sin( tilt );
	let q0 = P * sc * k;
	let q = vec3f( q0.x, q0.y * ct - q0.z * st, q0.y * st + q0.z * ct );
	let yaw = h3 * 6.2832;
	let c = cos( yaw ); let s = sin( yaw );
	let gy = terrainHeightAt( xz );
	let lift = sc.y * select( 0.15, 0.35, isChip ) * k;
	let n0 = N / sc;
	let nl = vec3f( n0.x, n0.y * ct - n0.z * st, n0.y * st + n0.z * ct );
	v.normal = normalize( vec3f( nl.x * c + nl.z * s, nl.y, nl.z * c - nl.x * s ) );
	// palette: dark basalt / grey / pale coral limestone in proportions set by the region
	// (mask alpha: 0 rocky shore .. 1 white coral beach)
	let dark = mix( 0.72, 0.24, m.w ); let grey = mix( 0.26, 0.3, m.w );
	let pal = select( select( mix( 0.6, 0.97, h2 ), mix( 0.32, 0.56, h2 ), h4 < dark + grey ), mix( 0.02, 0.3, h2 ), h4 < dark );
	o.vPebble = vec4f( ptype, pal, h2 + h3, r );
	v.position = vec3f( xz.x + q.x * c + q.z * s, gy + lift + q.y, xz.y + q.z * c - q.x * s );
`,
			surface: /* wgsl */`
	let p = in.P;
	let N = in.N;
	let ptype = in.vs.vPebble.x; let pal = in.vs.vPebble.y; let seed = in.vs.vPebble.z; let r = in.vs.vPebble.w;
	let isChip = step( 1.5, ptype );
	let tile = clamp( r * 4.0, 0.03, 0.3 );
	let w = terrainTriWeights( N );
	let A = textureSample( terrainDetailTex, smpAniso4Repeat, p.zy / tile );
	let B = textureSample( terrainDetailTex, smpAniso4Repeat, p.xz / tile + 0.37 );
	let Cc = textureSample( terrainDetailTex, smpAniso4Repeat, p.xy / tile + 0.71 );
	let T3 = A * w.x + B * w.y + Cc * w.z;
	let S = debrisStoneSurface( T3, N, pal, 0.0, seed, tile );
	// shell and coral grit: white / cream / pink chips with growth bands
	let hue = fract( seed * 7.13 );
	var chip = mix( ${ srgb( 0.94, 0.92, 0.88 ) }, ${ srgb( 0.86, 0.74, 0.56 ) }, smoothstep( 0.3, 0.45, hue ) );
	chip = mix( chip, ${ srgb( 0.9, 0.6, 0.56 ) }, smoothstep( 0.58, 0.66, hue ) );
	chip = mix( chip, ${ srgb( 0.58, 0.4, 0.28 ) }, smoothstep( 0.76, 0.82, hue ) );
	chip = mix( chip, ${ srgb( 0.36, 0.33, 0.4 ) }, smoothstep( 0.9, 0.95, hue ) );
	chip = chip * ( ( T3.a - 0.5 ) * 0.5 + 1.0 ) * ( sin( ( p.x + p.z ) * 900.0 ) * 0.06 + 0.97 );
	// sea glass among the grit (frosted green / brown / white, glinting) and pumice among the
	// pebbles (pale, porous)
	let glass = step( 0.955, fract( seed * 3.71 ) ) * isChip;
	let gh = fract( seed * 13.3 );
	let glassC = select( select( ${ srgb( 0.8, 0.84, 0.82 ) }, ${ srgb( 0.52, 0.34, 0.18 ) }, gh < 0.75 ), ${ srgb( 0.42, 0.62, 0.45 ) }, gh < 0.45 );
	chip = mix( chip, glassC, glass );
	let pumice = step( 0.93, fract( seed * 5.17 ) ) * ( 1.0 - isChip );
	let pumiceC = ${ srgb( 0.66, 0.64, 0.6 ) } * ( 1.0 - smoothstep( 0.55, 0.8, T3.b ) * 0.45 );
	var col = mix( mix( S.albedo, pumiceC, pumice ), chip, isChip );
	var rough = mix( mix( S.rough, 0.95, pumice ), mix( 0.5, 0.12, glass ), isChip );
	// wet near the sea, dusted with sand where they touch the ground
	let ground = terrainHeightAt( p.xz );
	let contact = 1.0 - smoothstep( 0.0, max( r * 0.7, 0.006 ), p.y - ground );
	let wet = 1.0 - smoothstep( 0.4, 1.0, p.y );
	col = mix( col, ${ srgb( 0.78, 0.7, 0.56 ) }, contact * smoothstep( 0.8, 1.6, ground ) * 0.35 );
	col = col * ( 1.0 - wet * 0.45 );
	rough = mix( rough, 0.22, wet * 0.85 );
	s.albedo = col;
	s.roughness = clamp( rough, 0.05, 1.0 );
	s.ao = sat( 1.0 - contact * 0.5 );
	s.normal = terrainPerturbNormal( p, N, S.hd * ( 1.0 - isChip ), 1.0 );
`,
		} );
		// (the TSL version set mat.mrtNode = staticVelocityMRT: the mesh sets `staticVelocity = true`)
		return mat;

	}

	// Recompute the visible cells (skipped when the camera did not move / turn).
	update( camera ) {

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
		const T = this.terrain;
		const n = this.cellsPerSide;
		let count = 0;
		// nothing to see from high above
		const hCam = cy - T.heightAt( cx, cz );
		if ( hCam < R_FAR ) {

			const i0 = Math.max( 0, Math.floor( ( cx - R_FAR - T.origin ) / PCELL ) ), i1 = Math.min( n - 1, Math.floor( ( cx + R_FAR - T.origin ) / PCELL ) );
			const j0 = Math.max( 0, Math.floor( ( cz - R_FAR - T.origin ) / PCELL ) ), j1 = Math.min( n - 1, Math.floor( ( cz + R_FAR - T.origin ) / PCELL ) );
			for ( let j = j0; j <= j1; j ++ ) for ( let i = i0; i <= i1; i ++ ) {

				const c = j * n + i;
				if ( ! this.cellFlags[ c ] ) continue;
				const x0 = T.origin + i * PCELL, z0 = T.origin + j * PCELL;
				const dx = Math.max( x0 - cx, 0, cx - x0 - PCELL ), dz = Math.max( z0 - cz, 0, cz - z0 - PCELL );
				if ( Math.hypot( dx, dz ) > R_FAR ) continue;
				this._box.min.set( x0, this.cellMinY[ c ] - 0.2, z0 );
				this._box.max.set( x0 + PCELL, this.cellMaxY[ c ] + 0.3, z0 + PCELL );
				if ( ! this._frustum.intersectsBox( this._box ) ) continue;
				if ( count >= MAX_CELLS ) break;
				this.arr[ count * 4 ] = x0;
				this.arr[ count * 4 + 1 ] = z0;
				count ++;

			}

		}

		this.count = count;
		this.geometry.instanceCount = count;
		this.attr.clearUpdateRanges();
		this.attr.addUpdateRange( 0, Math.max( 1, count ) * 4 );
		this.attr.needsUpdate = true;
		return true;

	}

	get triangles() {

		return this.count * this.patchTris;

	}

	dispose() {

		this.maskTex.destroy();
		this.material.dispose();
		this.geometry.dispose();

	}

}
