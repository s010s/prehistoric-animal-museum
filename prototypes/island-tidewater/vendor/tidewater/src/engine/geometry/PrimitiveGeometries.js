// Parametric primitives with three.js-identical vertex order, UV conventions,
// index winding and material groups.

import { BufferGeometry } from './BufferGeometry.js';
import { Float32BufferAttribute } from './BufferAttribute.js';
import { Vector3 } from '../math/Vector3.js';
import { Vector2 } from '../math/Vector2.js';

function finish( g, indices, vertices, normals, uvs ) {

	if ( indices ) g.setIndex( indices );
	g.setAttribute( 'position', new Float32BufferAttribute( vertices, 3 ) );
	g.setAttribute( 'normal', new Float32BufferAttribute( normals, 3 ) );
	g.setAttribute( 'uv', new Float32BufferAttribute( uvs, 2 ) );

}

export class PlaneGeometry extends BufferGeometry {

	constructor( width = 1, height = 1, widthSegments = 1, heightSegments = 1 ) {

		super();
		this.type = 'PlaneGeometry';
		this.parameters = { width, height, widthSegments, heightSegments };

		const hw = width / 2, hh = height / 2;
		const gx = Math.floor( widthSegments ), gy = Math.floor( heightSegments );
		const gx1 = gx + 1, gy1 = gy + 1;
		const sw = width / gx, sh = height / gy;
		const indices = [], vertices = [], normals = [], uvs = [];

		for ( let iy = 0; iy < gy1; iy ++ ) {

			const y = iy * sh - hh;
			for ( let ix = 0; ix < gx1; ix ++ ) {

				vertices.push( ix * sw - hw, - y, 0 );
				normals.push( 0, 0, 1 );
				uvs.push( ix / gx, 1 - ( iy / gy ) );

			}

		}

		for ( let iy = 0; iy < gy; iy ++ ) {

			for ( let ix = 0; ix < gx; ix ++ ) {

				const a = ix + gx1 * iy, b = ix + gx1 * ( iy + 1 ), c = ( ix + 1 ) + gx1 * ( iy + 1 ), d = ( ix + 1 ) + gx1 * iy;
				indices.push( a, b, d, b, c, d );

			}

		}

		finish( this, indices, vertices, normals, uvs );

	}

}

export class BoxGeometry extends BufferGeometry {

	constructor( width = 1, height = 1, depth = 1, widthSegments = 1, heightSegments = 1, depthSegments = 1 ) {

		super();
		this.type = 'BoxGeometry';
		this.parameters = { width, height, depth, widthSegments, heightSegments, depthSegments };

		widthSegments = Math.floor( widthSegments );
		heightSegments = Math.floor( heightSegments );
		depthSegments = Math.floor( depthSegments );

		const indices = [], vertices = [], normals = [], uvs = [];
		let numberOfVertices = 0, groupStart = 0;
		const vec = new Vector3();

		const plane = ( u, v, w, udir, vdir, pw, ph, pd, gx, gy, materialIndex ) => {

			const sw = pw / gx, sh = ph / gy, hw = pw / 2, hh = ph / 2, hd = pd / 2;
			const gx1 = gx + 1, gy1 = gy + 1;
			let count = 0, groupCount = 0;

			for ( let iy = 0; iy < gy1; iy ++ ) {

				const y = iy * sh - hh;
				for ( let ix = 0; ix < gx1; ix ++ ) {

					const x = ix * sw - hw;
					vec[ u ] = x * udir; vec[ v ] = y * vdir; vec[ w ] = hd;
					vertices.push( vec.x, vec.y, vec.z );
					vec[ u ] = 0; vec[ v ] = 0; vec[ w ] = pd > 0 ? 1 : - 1;
					normals.push( vec.x, vec.y, vec.z );
					uvs.push( ix / gx, 1 - ( iy / gy ) );
					count ++;

				}

			}

			for ( let iy = 0; iy < gy; iy ++ ) {

				for ( let ix = 0; ix < gx; ix ++ ) {

					const n = numberOfVertices;
					const a = n + ix + gx1 * iy, b = n + ix + gx1 * ( iy + 1 ), c = n + ( ix + 1 ) + gx1 * ( iy + 1 ), d = n + ( ix + 1 ) + gx1 * iy;
					indices.push( a, b, d, b, c, d );
					groupCount += 6;

				}

			}

			this.addGroup( groupStart, groupCount, materialIndex );
			groupStart += groupCount;
			numberOfVertices += count;

		};

		plane( 'z', 'y', 'x', - 1, - 1, depth, height, width, depthSegments, heightSegments, 0 ); // px
		plane( 'z', 'y', 'x', 1, - 1, depth, height, - width, depthSegments, heightSegments, 1 ); // nx
		plane( 'x', 'z', 'y', 1, 1, width, depth, height, widthSegments, depthSegments, 2 ); // py
		plane( 'x', 'z', 'y', 1, - 1, width, depth, - height, widthSegments, depthSegments, 3 ); // ny
		plane( 'x', 'y', 'z', 1, - 1, width, height, depth, widthSegments, heightSegments, 4 ); // pz
		plane( 'x', 'y', 'z', - 1, - 1, width, height, - depth, widthSegments, heightSegments, 5 ); // nz

		finish( this, indices, vertices, normals, uvs );

	}

}

export class SphereGeometry extends BufferGeometry {

	constructor( radius = 1, widthSegments = 32, heightSegments = 16, phiStart = 0, phiLength = Math.PI * 2, thetaStart = 0, thetaLength = Math.PI ) {

		super();
		this.type = 'SphereGeometry';
		this.parameters = { radius, widthSegments, heightSegments, phiStart, phiLength, thetaStart, thetaLength };

		widthSegments = Math.max( 3, Math.floor( widthSegments ) );
		heightSegments = Math.max( 2, Math.floor( heightSegments ) );
		const thetaEnd = Math.min( thetaStart + thetaLength, Math.PI );
		let index = 0;
		const grid = [], indices = [], vertices = [], normals = [], uvs = [];
		const v3 = new Vector3();

		for ( let iy = 0; iy <= heightSegments; iy ++ ) {

			const row = [], v = iy / heightSegments;
			let uOffset = 0;
			if ( iy === 0 && thetaStart === 0 ) uOffset = 0.5 / widthSegments;
			else if ( iy === heightSegments && thetaEnd === Math.PI ) uOffset = - 0.5 / widthSegments;

			for ( let ix = 0; ix <= widthSegments; ix ++ ) {

				const u = ix / widthSegments;
				const st = Math.sin( thetaStart + v * thetaLength );
				v3.set(
					- radius * Math.cos( phiStart + u * phiLength ) * st,
					radius * Math.cos( thetaStart + v * thetaLength ),
					radius * Math.sin( phiStart + u * phiLength ) * st
				);
				vertices.push( v3.x, v3.y, v3.z );
				v3.normalize();
				normals.push( v3.x, v3.y, v3.z );
				uvs.push( u + uOffset, 1 - v );
				row.push( index ++ );

			}

			grid.push( row );

		}

		for ( let iy = 0; iy < heightSegments; iy ++ ) {

			for ( let ix = 0; ix < widthSegments; ix ++ ) {

				const a = grid[ iy ][ ix + 1 ], b = grid[ iy ][ ix ], c = grid[ iy + 1 ][ ix ], d = grid[ iy + 1 ][ ix + 1 ];
				if ( iy !== 0 || thetaStart > 0 ) indices.push( a, b, d );
				if ( iy !== heightSegments - 1 || thetaEnd < Math.PI ) indices.push( b, c, d );

			}

		}

		finish( this, indices, vertices, normals, uvs );

	}

}

export class CylinderGeometry extends BufferGeometry {

	constructor( radiusTop = 1, radiusBottom = 1, height = 1, radialSegments = 32, heightSegments = 1, openEnded = false, thetaStart = 0, thetaLength = Math.PI * 2 ) {

		super();
		this.type = 'CylinderGeometry';
		this.parameters = { radiusTop, radiusBottom, height, radialSegments, heightSegments, openEnded, thetaStart, thetaLength };

		radialSegments = Math.floor( radialSegments );
		heightSegments = Math.floor( heightSegments );
		const indices = [], vertices = [], normals = [], uvs = [];
		const indexArray = [], halfHeight = height / 2;
		let index = 0, groupStart = 0;
		const n = new Vector3();

		// torso
		{

			let groupCount = 0;
			const slope = ( radiusBottom - radiusTop ) / height;

			for ( let y = 0; y <= heightSegments; y ++ ) {

				const row = [], v = y / heightSegments;
				const radius = v * ( radiusBottom - radiusTop ) + radiusTop;

				for ( let x = 0; x <= radialSegments; x ++ ) {

					const u = x / radialSegments, theta = u * thetaLength + thetaStart;
					const s = Math.sin( theta ), c = Math.cos( theta );
					vertices.push( radius * s, - v * height + halfHeight, radius * c );
					n.set( s, slope, c ).normalize();
					normals.push( n.x, n.y, n.z );
					uvs.push( u, 1 - v );
					row.push( index ++ );

				}

				indexArray.push( row );

			}

			for ( let x = 0; x < radialSegments; x ++ ) {

				for ( let y = 0; y < heightSegments; y ++ ) {

					const a = indexArray[ y ][ x ], b = indexArray[ y + 1 ][ x ], c = indexArray[ y + 1 ][ x + 1 ], d = indexArray[ y ][ x + 1 ];
					if ( radiusTop > 0 || y !== 0 ) { indices.push( a, b, d ); groupCount += 3; }
					if ( radiusBottom > 0 || y !== heightSegments - 1 ) { indices.push( b, c, d ); groupCount += 3; }

				}

			}

			this.addGroup( groupStart, groupCount, 0 );
			groupStart += groupCount;

		}

		const cap = ( top ) => {

			const centerStart = index;
			const radius = top === true ? radiusTop : radiusBottom, sign = top === true ? 1 : - 1;
			let groupCount = 0;

			for ( let x = 1; x <= radialSegments; x ++ ) {

				vertices.push( 0, halfHeight * sign, 0 );
				normals.push( 0, sign, 0 );
				uvs.push( 0.5, 0.5 );
				index ++;

			}

			const centerEnd = index;

			for ( let x = 0; x <= radialSegments; x ++ ) {

				const u = x / radialSegments, theta = u * thetaLength + thetaStart;
				const c = Math.cos( theta ), s = Math.sin( theta );
				vertices.push( radius * s, halfHeight * sign, radius * c );
				normals.push( 0, sign, 0 );
				uvs.push( ( c * 0.5 ) + 0.5, ( s * 0.5 * sign ) + 0.5 );
				index ++;

			}

			for ( let x = 0; x < radialSegments; x ++ ) {

				const c = centerStart + x, i = centerEnd + x;
				if ( top === true ) indices.push( i, i + 1, c ); else indices.push( i + 1, i, c );
				groupCount += 3;

			}

			this.addGroup( groupStart, groupCount, top === true ? 1 : 2 );
			groupStart += groupCount;

		};

		if ( openEnded === false ) {

			if ( radiusTop > 0 ) cap( true );
			if ( radiusBottom > 0 ) cap( false );

		}

		finish( this, indices, vertices, normals, uvs );

	}

}

export class ConeGeometry extends CylinderGeometry {

	constructor( radius = 1, height = 1, radialSegments = 32, heightSegments = 1, openEnded = false, thetaStart = 0, thetaLength = Math.PI * 2 ) {

		super( 0, radius, height, radialSegments, heightSegments, openEnded, thetaStart, thetaLength );
		this.type = 'ConeGeometry';
		this.parameters = { radius, height, radialSegments, heightSegments, openEnded, thetaStart, thetaLength };

	}

}

export class CircleGeometry extends BufferGeometry {

	constructor( radius = 1, segments = 32, thetaStart = 0, thetaLength = Math.PI * 2 ) {

		super();
		this.type = 'CircleGeometry';
		this.parameters = { radius, segments, thetaStart, thetaLength };

		segments = Math.max( 3, segments );
		const indices = [], vertices = [ 0, 0, 0 ], normals = [ 0, 0, 1 ], uvs = [ 0.5, 0.5 ];

		for ( let s = 0; s <= segments; s ++ ) {

			const a = thetaStart + s / segments * thetaLength;
			const x = radius * Math.cos( a ), y = radius * Math.sin( a );
			vertices.push( x, y, 0 );
			normals.push( 0, 0, 1 );
			uvs.push( ( x / radius + 1 ) / 2, ( y / radius + 1 ) / 2 );

		}

		for ( let i = 1; i <= segments; i ++ ) indices.push( i, i + 1, 0 );

		finish( this, indices, vertices, normals, uvs );

	}

}

export class TorusGeometry extends BufferGeometry {

	constructor( radius = 1, tube = 0.4, radialSegments = 12, tubularSegments = 48, arc = Math.PI * 2, thetaStart = 0, thetaLength = Math.PI * 2 ) {

		super();
		this.type = 'TorusGeometry';
		this.parameters = { radius, tube, radialSegments, tubularSegments, arc, thetaStart, thetaLength };

		radialSegments = Math.floor( radialSegments );
		tubularSegments = Math.floor( tubularSegments );
		const indices = [], vertices = [], normals = [], uvs = [];
		const p = new Vector3(), c = new Vector3();

		for ( let j = 0; j <= radialSegments; j ++ ) {

			const v = thetaStart + ( j / radialSegments ) * thetaLength;

			for ( let i = 0; i <= tubularSegments; i ++ ) {

				const u = i / tubularSegments * arc;
				p.set( ( radius + tube * Math.cos( v ) ) * Math.cos( u ), ( radius + tube * Math.cos( v ) ) * Math.sin( u ), tube * Math.sin( v ) );
				vertices.push( p.x, p.y, p.z );
				c.set( radius * Math.cos( u ), radius * Math.sin( u ), 0 );
				p.sub( c ).normalize();
				normals.push( p.x, p.y, p.z );
				uvs.push( i / tubularSegments, j / radialSegments );

			}

		}

		for ( let j = 1; j <= radialSegments; j ++ ) {

			for ( let i = 1; i <= tubularSegments; i ++ ) {

				const t1 = tubularSegments + 1;
				const a = t1 * j + i - 1, b = t1 * ( j - 1 ) + i - 1, cc = t1 * ( j - 1 ) + i, d = t1 * j + i;
				indices.push( a, b, d, b, cc, d );

			}

		}

		finish( this, indices, vertices, normals, uvs );

	}

}

export class LatheGeometry extends BufferGeometry {

	constructor( points = [ new Vector2( 0, - 0.5 ), new Vector2( 0.5, 0 ), new Vector2( 0, 0.5 ) ], segments = 12, phiStart = 0, phiLength = Math.PI * 2 ) {

		super();
		this.type = 'LatheGeometry';
		this.parameters = { points, segments, phiStart, phiLength };

		segments = Math.floor( segments );
		phiLength = Math.max( 0, Math.min( Math.PI * 2, phiLength ) );
		const indices = [], vertices = [], uvs = [], initNormals = [], normals = [];
		const inv = 1.0 / segments;
		const normal = new Vector3(), cur = new Vector3(), prev = new Vector3();
		const n = points.length;

		// profile normals: perpendicular of each edge, averaged at interior points
		for ( let j = 0; j <= n - 1; j ++ ) {

			if ( j === 0 ) {

				const dx = points[ 1 ].x - points[ 0 ].x, dy = points[ 1 ].y - points[ 0 ].y;
				normal.set( dy, - dx, 0 );
				prev.copy( normal );
				normal.normalize();
				initNormals.push( normal.x, normal.y, normal.z );

			} else if ( j === n - 1 ) {

				initNormals.push( prev.x, prev.y, prev.z );

			} else {

				const dx = points[ j + 1 ].x - points[ j ].x, dy = points[ j + 1 ].y - points[ j ].y;
				normal.set( dy, - dx, 0 );
				cur.copy( normal );
				normal.add( prev ).normalize();
				initNormals.push( normal.x, normal.y, normal.z );
				prev.copy( cur );

			}

		}

		for ( let i = 0; i <= segments; i ++ ) {

			const phi = phiStart + i * inv * phiLength;
			const s = Math.sin( phi ), c = Math.cos( phi );

			for ( let j = 0; j <= n - 1; j ++ ) {

				vertices.push( points[ j ].x * s, points[ j ].y, points[ j ].x * c );
				uvs.push( i / segments, j / ( n - 1 ) );
				normals.push( initNormals[ 3 * j ] * s, initNormals[ 3 * j + 1 ], initNormals[ 3 * j ] * c );

			}

		}

		for ( let i = 0; i < segments; i ++ ) {

			for ( let j = 0; j < n - 1; j ++ ) {

				const base = j + i * n;
				const a = base, b = base + n, c = base + n + 1, d = base + 1;
				indices.push( a, b, d, c, d, b );

			}

		}

		// three.js order for lathes: position, uv, normal
		this.setIndex( indices );
		this.setAttribute( 'position', new Float32BufferAttribute( vertices, 3 ) );
		this.setAttribute( 'uv', new Float32BufferAttribute( uvs, 2 ) );
		this.setAttribute( 'normal', new Float32BufferAttribute( normals, 3 ) );

	}

}
