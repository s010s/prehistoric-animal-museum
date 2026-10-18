import * as THREE from '../../engine/index.js';

// Accumulates vertices with the vegetation attribute layout:
//   position, normal, uv, aVeg (vec4: u, s, flutter, phase), aMat (vec4: part, p1, p2, p3)
//   aLobe (vec4): canopy cards: offset to the leaf-lobe centre, lobe id; other geometry: 0, 0, 0,
//   -1 - kind (kind: plant id inside a merged geometry, see VegNodes.plantDeform)
export class GeoBuilder {

	constructor() {

		this.pos = [];
		this.nor = [];
		this.uv = [];
		this.veg = [];
		this.mat = [];
		this.lobe = [];
		this.kind = 0; // plant id for merged geometries (stored as aLobe.w = -1 - kind)
		this.idx = [];

	}

	get count() {

		return this.pos.length / 3;

	}

	vertex( p, n, u, v, veg, mat, lobe = null ) {

		if ( lobe ) this.lobe.push( lobe[ 0 ], lobe[ 1 ], lobe[ 2 ], lobe[ 3 ] );
		else this.lobe.push( 0, 0, 0, - 1 - this.kind );
		this.pos.push( p.x, p.y, p.z );
		this.nor.push( n.x, n.y, n.z );
		this.uv.push( u, v );
		this.veg.push( veg[ 0 ], veg[ 1 ], veg[ 2 ], veg[ 3 ] );
		this.mat.push( mat[ 0 ], mat[ 1 ], mat[ 2 ], mat[ 3 ] );
		return this.count - 1;

	}

	tri( a, b, c ) {

		this.idx.push( a, b, c );

	}

	quad( a, b, c, d ) {

		// a-b bottom edge, d-c top edge (counter-clockwise when seen from the front)
		this.idx.push( a, b, c, a, c, d );

	}

	// All per-vertex attributes go into one interleaved buffer (one vertex buffer binding: the
	// instanced meshes stay well below WebGPU's limit of 8 vertex buffers).
	build( boundingRadius = 0, boundingCenter = null ) {

		const n = this.count;
		const layout = [ [ 'position', this.pos, 3 ], [ 'normal', this.nor, 3 ], [ 'uv', this.uv, 2 ], [ 'aVeg', this.veg, 4 ], [ 'aMat', this.mat, 4 ], [ 'aLobe', this.lobe, 4 ] ];
		const stride = layout.reduce( ( a, l ) => a + l[ 2 ], 0 );
		const data = new Float32Array( n * stride );
		let off = 0;
		for ( const [ , src, size ] of layout ) {

			for ( let i = 0; i < n; i ++ ) for ( let c = 0; c < size; c ++ ) data[ i * stride + off + c ] = src[ i * size + c ];
			off += size;

		}

		const ib = new THREE.InterleavedBuffer( data, stride );
		const g = new THREE.BufferGeometry();
		off = 0;
		for ( const [ name, , size ] of layout ) {

			g.setAttribute( name, new THREE.InterleavedBufferAttribute( ib, size, off ) );
			off += size;

		}

		g.setIndex( n > 65535 ? new THREE.Uint32BufferAttribute( this.idx, 1 ) : new THREE.Uint16BufferAttribute( this.idx, 1 ) );
		g.computeBoundingBox();
		g.computeBoundingSphere();
		if ( boundingRadius > 0 ) {

			// deformation happens in the vertex shader: give culling a conservative sphere
			g.boundingSphere.radius = Math.max( g.boundingSphere.radius, boundingRadius );
			if ( boundingCenter ) g.boundingSphere.center.copy( boundingCenter );

		}

		return g;

	}

	get triangles() {

		return this.idx.length / 3;

	}

}
