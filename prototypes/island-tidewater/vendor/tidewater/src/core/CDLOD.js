import { Vector2, Vector4, Box3, Frustum, Matrix4, Vector3, Sphere } from '../engine/index.js';
import { InstancedBufferGeometry, BufferAttribute, InstancedBufferAttribute } from '../engine/geometry/index.js';
import { UniformBlock, ShaderModule } from '../engine/webgpu.js';

// Continuous distance-dependent LOD (Strugar 2010) quadtree grid.
// A single G x G grid mesh is instanced for every selected node. Vertices near the
// outer edge of each LOD range geomorph toward the next coarser grid so there are
// never cracks or pops between levels.
//
// WGSL module (`cdlod.module`, prefix `cdlod`, or the `prefix` option): the material declares the
// instanced attribute `nodeData: vec4f` (origin xz, size, lod) and calls
//   fn cdlodSnapped( node: vec4f, grid: vec2f ) -> vec2f             the vertex on its LOD's lattice
//   fn cdlodMorph( node: vec4f, grid: vec2f, viewPos: vec3f, y0: f32 ) -> CdlodVertex
//        (y0 = height at cdlodSnapped(), for the morph distance; 0 for the sea)
//   struct CdlodVertex { worldXZ: vec2f, spacing: f32, morphK: f32, lod: f32, size: f32 }
// Uniforms: <prefix>.morph[ lod ] = ( morph start, 1 / morph range, grid spacing, 0 ).
export class CDLOD {

	constructor( {
		gridSize = 64, // quads per node side (even)
		leafSize = 8, // node size at LOD 0 (m)
		levels = 12,
		rangeFactor = 2.5, // LOD range = leafSize * 2^lod * rangeFactor
		morphStartRatio = 0.66,
		maxInstances = 1500,
		minY = - 20,
		maxY = 20,
		heightBounds = null, // optional (x0,z0,x1,z1) => [minY,maxY]
		center = null, // optional fixed world bounds for root grid { x, z, size }
		prefix = 'cdlod', // WGSL name prefix of this instance's module
	} = {} ) {

		this.G = gridSize;
		this.leafSize = leafSize;
		this.levels = levels;
		this.minY = minY;
		this.maxY = maxY;
		this.heightBounds = heightBounds;
		this.fixedRoot = center;

		this.ranges = [];
		const morph = [];
		let prev = 0;
		for ( let l = 0; l < levels; l ++ ) {

			const r = leafSize * Math.pow( 2, l ) * rangeFactor;
			this.ranges.push( r );
			const start = prev + ( r - prev ) * morphStartRatio;
			morph.push( new Vector2( start, 1 / Math.max( 1e-3, r - start ) ) );
			prev = r;

		}

		const spacings = [];
		for ( let l = 0; l < levels; l ++ ) spacings.push( leafSize * Math.pow( 2, l ) / gridSize );
		// (three version: uniformArray( morph ) / uniformArray( spacings ); `.array` kept for callers)
		this.uMorph = { array: morph };
		this.uSpacing = { array: spacings };
		const P = prefix;
		const Cap = P[ 0 ].toUpperCase() + P.slice( 1 );
		this.params = new UniformBlock( Cap + 'Params', {
			morph: [ `vec4f[${ levels }]`, morph.map( ( m, l ) => new Vector4( m.x, m.y, spacings[ l ], 0 ) ) ],
		}, { label: P } );
		this.module = new ShaderModule( {
			name: P,
			uniforms: this.params,
			uniformName: P,
			code: /* wgsl */`
struct ${ Cap }Vertex { worldXZ: vec2f, spacing: f32, morphK: f32, lod: f32, size: f32 };

// Morph in world space on the LOD's own vertex lattice (spacing h). Quarter nodes of a
// partially subdivided parent carry the parent's LOD, so their extra vertices first snap
// onto that lattice; every node covering a point then computes the same position.
fn ${ P }Snapped( node: vec4f, grid: vec2f ) -> vec2f {
	let h = ${ P }.morph[ i32( node.w ) ].z;
	let p = node.xy + grid * node.z;
	return floor( p / h + 1e-3 ) * h;
}

fn ${ P }Morph( node: vec4f, grid: vec2f, viewPos: vec3f, y0: f32 ) -> ${ Cap }Vertex {
	let lod = i32( node.w );
	let m = ${ P }.morph[ lod ];
	let h = m.z;
	let p = node.xy + grid * node.z;
	let idx = floor( p / h + 1e-3 );
	let snapped = idx * h;
	let dist = length( viewPos - vec3f( snapped.x, y0, snapped.y ) );
	let morphK = clamp( ( dist - m.x ) * m.y, 0.0, 1.0 );
	let odd = fract( idx * 0.5 ) * 2.0;
	var o: ${ Cap }Vertex;
	o.worldXZ = snapped - odd * h * morphK;
	o.spacing = h * ( morphK + 1.0 );
	o.morphK = morphK;
	o.lod = node.w;
	o.size = node.z;
	return o;
}
`,
		} );

		// grid geometry in [0,1]^2 on XZ
		const G = gridSize;
		const verts = new Float32Array( ( G + 1 ) * ( G + 1 ) * 3 );
		let p = 0;
		for ( let j = 0; j <= G; j ++ ) {

			for ( let i = 0; i <= G; i ++ ) {

				verts[ p ++ ] = i / G;
				verts[ p ++ ] = 0;
				verts[ p ++ ] = j / G;

			}

		}

		// quads in column strips of STRIP: the next row of a strip reuses vertices the GPU shaded a
		// moment ago (a full grid row is longer than its post-transform reuse window)
		const STRIP = 8;
		const idx = new Uint32Array( G * G * 6 );
		p = 0;
		for ( let i0 = 0; i0 < G; i0 += STRIP ) for ( let j = 0; j < G; j ++ ) {

			for ( let i = i0; i < Math.min( i0 + STRIP, G ); i ++ ) {

				const a = j * ( G + 1 ) + i;
				const b = a + 1;
				const c = a + ( G + 1 );
				const d = c + 1;
				// alternate diagonal for better symmetry
				if ( ( i + j ) % 2 === 0 ) {

					idx[ p ++ ] = a; idx[ p ++ ] = c; idx[ p ++ ] = b;
					idx[ p ++ ] = b; idx[ p ++ ] = c; idx[ p ++ ] = d;

				} else {

					idx[ p ++ ] = a; idx[ p ++ ] = c; idx[ p ++ ] = d;
					idx[ p ++ ] = a; idx[ p ++ ] = d; idx[ p ++ ] = b;

				}

			}

		}

		const geo = new InstancedBufferGeometry();
		geo.setAttribute( 'position', new BufferAttribute( verts, 3 ) );
		geo.setIndex( new BufferAttribute( idx, 1 ) );
		this.nodeArray = new Float32Array( maxInstances * 4 );
		this.nodeAttr = new InstancedBufferAttribute( this.nodeArray, 4 );
		geo.setAttribute( 'nodeData', this.nodeAttr );
		geo.instanceCount = 0;
		geo.boundingSphere = new Sphere( new Vector3(), 1e7 );
		geo.boundingBox = new Box3( new Vector3( - 1e7, - 1e7, - 1e7 ), new Vector3( 1e7, 1e7, 1e7 ) );
		this.geometry = geo;
		this.maxInstances = maxInstances;
		this.count = 0;

		this._box = new Box3();
		this._frustum = new Frustum();
		this._mat = new Matrix4();
		this._cam = new Vector3();
		this.lodCounts = new Array( levels ).fill( 0 );

	}

	// WGSL snippet (vertex hook) computing `let <out> = cdlodMorph( ... )` for the current vertex: the
	// material declares `attributes: { nodeData: 'vec4f' }`. `heightFn` optional WGSL function name
	// ( xz: vec2f ) -> f32 used for the morph distance (defaults to seaLevel 0); `viewPos` WGSL vec3f
	// (defaults to the camera; the terrain passes its view position so shadow passes morph alike).
	vertexNodes( heightFn = null, { out = 'lod', viewPos = 'frame.cameraPos' } = {} ) {

		const P = this.module.name;
		const y0 = heightFn ? `${ heightFn }( ${ P }Snapped( v.nodeData, v.position.xz ) )` : '0.0';
		return `let ${ out } = ${ P }Morph( v.nodeData, v.position.xz, ${ viewPos }, ${ y0 } );`;

	}

	update( camera ) {

		camera.updateMatrixWorld();
		this._mat.multiplyMatrices( camera.projectionMatrix, camera.matrixWorldInverse );
		this._frustum.setFromProjectionMatrix( this._mat, camera.coordinateSystem, camera.reversedDepth );
		camera.getWorldPosition( this._cam );

		this.count = 0;
		this.lodCounts.fill( 0 );

		const top = this.levels - 1;
		const rootSize = this.leafSize * Math.pow( 2, top );

		if ( this.fixedRoot ) {

			const { x, z, size } = this.fixedRoot;
			const n = Math.ceil( size / rootSize );
			for ( let j = 0; j < n; j ++ ) for ( let i = 0; i < n; i ++ ) {

				this._select( x + i * rootSize, z + j * rootSize, rootSize, top );

			}

		} else {

			const cx = Math.floor( this._cam.x / rootSize );
			const cz = Math.floor( this._cam.z / rootSize );
			for ( let j = - 1; j <= 1; j ++ ) for ( let i = - 1; i <= 1; i ++ ) {

				this._select( ( cx + i ) * rootSize, ( cz + j ) * rootSize, rootSize, top );

			}

		}

		// front-to-back order so early depth testing rejects hidden wave faces
		const n = this.count;
		const order = this._order || ( this._order = [] );
		order.length = n;
		const arr = this.nodeArray;
		const c = this._cam;
		for ( let i = 0; i < n; i ++ ) {

			const s = arr[ i * 4 + 2 ];
			const dx = Math.max( arr[ i * 4 ] - c.x, 0, c.x - arr[ i * 4 ] - s );
			const dz = Math.max( arr[ i * 4 + 1 ] - c.z, 0, c.z - arr[ i * 4 + 1 ] - s );
			order[ i ] = { d: dx * dx + dz * dz, x: arr[ i * 4 ], z: arr[ i * 4 + 1 ], s, l: arr[ i * 4 + 3 ] };

		}

		order.sort( ( a, b ) => a.d - b.d );
		for ( let i = 0; i < n; i ++ ) {

			const o = order[ i ];
			arr[ i * 4 ] = o.x; arr[ i * 4 + 1 ] = o.z; arr[ i * 4 + 2 ] = o.s; arr[ i * 4 + 3 ] = o.l;

		}

		this.geometry.instanceCount = this.count;
		this.nodeAttr.clearUpdateRanges();
		this.nodeAttr.addUpdateRange( 0, this.count * 4 );
		this.nodeAttr.needsUpdate = true;

	}

	_bounds( x, z, size ) {

		if ( this.heightBounds ) {

			const [ a, b ] = this.heightBounds( x, z, x + size, z + size );
			this._box.min.set( x, a, z );
			this._box.max.set( x + size, b, z + size );

		} else {

			this._box.min.set( x, this.minY, z );
			this._box.max.set( x + size, this.maxY, z + size );

		}

		return this._box;

	}

	_intersectsSphere( box, r ) {

		const c = this._cam;
		const dx = Math.max( box.min.x - c.x, 0, c.x - box.max.x );
		const dy = Math.max( box.min.y - c.y, 0, c.y - box.max.y );
		const dz = Math.max( box.min.z - c.z, 0, c.z - box.max.z );
		return dx * dx + dy * dy + dz * dz <= r * r;

	}

	_add( x, z, size, lod ) {

		if ( this.count >= this.maxInstances ) return;
		const o = this.count * 4;
		this.nodeArray[ o ] = x;
		this.nodeArray[ o + 1 ] = z;
		this.nodeArray[ o + 2 ] = size;
		this.nodeArray[ o + 3 ] = lod;
		this.count ++;
		this.lodCounts[ lod ] ++;

	}

	_select( x, z, size, lod ) {

		const box = this._bounds( x, z, size );
		if ( ! this._intersectsSphere( box, this.ranges[ lod ] ) ) return false;
		if ( ! this._frustum.intersectsBox( box ) ) return true;

		if ( lod === 0 || ! this._intersectsSphere( box, this.ranges[ lod - 1 ] ) ) {

			this._add( x, z, size, lod );
			return true;

		}

		const h = size * 0.5;
		const children = [ [ x, z ], [ x + h, z ], [ x, z + h ], [ x + h, z + h ] ];
		for ( const [ cx, cz ] of children ) {

			if ( ! this._select( cx, cz, h, lod - 1 ) ) {

				// quadrant outside the finer range: draw it at this node's LOD
				const b = this._bounds( cx, cz, h );
				if ( this._frustum.intersectsBox( b ) ) this._add( cx, cz, h, lod );

			}

		}

		return true;

	}

}
