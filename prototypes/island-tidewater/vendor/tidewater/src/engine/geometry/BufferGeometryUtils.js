// Geometry merging / welding (three.js addons BufferGeometryUtils subset).

import { BufferGeometry } from './BufferGeometry.js';
import { BufferAttribute } from './BufferAttribute.js';

// Concatenate attributes of equal itemSize / normalized / array type.
// Handles interleaved inputs by reading element-wise.
export function mergeAttributes( attributes ) {

	const first = attributes[ 0 ];
	const Arr = first.array.constructor, itemSize = first.itemSize, normalized = first.normalized;
	let total = 0;

	for ( const a of attributes ) {

		if ( a.array.constructor !== Arr || a.itemSize !== itemSize || a.normalized !== normalized ) {

			console.error( 'mergeAttributes(): attributes differ in array type, itemSize or normalized.' );
			return null;

		}

		total += a.count * itemSize;

	}

	const out = new Arr( total );
	let off = 0;

	for ( const a of attributes ) {

		if ( a.isInterleavedBufferAttribute ) {

			for ( let i = 0; i < a.count; i ++ ) for ( let c = 0; c < itemSize; c ++ ) out[ off + i * itemSize + c ] = a.array[ a._idx( i, c ) ];

		} else {

			out.set( a.array.subarray( 0, a.count * itemSize ), off );

		}

		off += a.count * itemSize;

	}

	const r = new BufferAttribute( out, itemSize, normalized );
	r.gpuType = first.gpuType !== undefined ? first.gpuType : r.gpuType;
	return r;

}

export function mergeGeometries( geometries, useGroups = false ) {

	const isIndexed = geometries[ 0 ].index !== null;
	const names = new Set( Object.keys( geometries[ 0 ].attributes ) );
	const attrs = {}, merged = new BufferGeometry();
	let offset = 0;

	for ( let i = 0; i < geometries.length; i ++ ) {

		const g = geometries[ i ];
		if ( isIndexed !== ( g.index !== null ) ) {

			console.error( `mergeGeometries(): geometry ${ i } index mismatch; all or none must be indexed.` );
			return null;

		}

		let n = 0;
		for ( const name in g.attributes ) {

			if ( ! names.has( name ) ) {

				console.error( `mergeGeometries(): geometry ${ i } has attribute "${ name }" missing from geometry 0.` );
				return null;

			}

			( attrs[ name ] ||= [] ).push( g.attributes[ name ] );
			n ++;

		}

		if ( n !== names.size ) {

			console.error( `mergeGeometries(): geometry ${ i } is missing attributes.` );
			return null;

		}

		if ( useGroups ) {

			const count = isIndexed ? g.index.count : g.attributes.position.count;
			merged.addGroup( offset, count, i );
			offset += count;

		}

	}

	if ( isIndexed ) {

		let indexOffset = 0;
		const idx = [];
		for ( const g of geometries ) {

			const index = g.index;
			for ( let j = 0; j < index.count; j ++ ) idx.push( index.getX( j ) + indexOffset );
			indexOffset += g.attributes.position.count;

		}

		merged.setIndex( idx );

	}

	for ( const name in attrs ) {

		const a = mergeAttributes( attrs[ name ] );
		if ( ! a ) {

			console.error( `mergeGeometries(): failed merging attribute "${ name }".` );
			return null;

		}

		merged.setAttribute( name, a );

	}

	const ud = geometries.map( ( g ) => g.userData ).filter( ( u ) => u && Object.keys( u ).length );
	if ( ud.length ) merged.userData.mergedUserData = ud;
	return merged;

}

// Weld vertices whose every attribute matches within `tolerance`; returns an
// indexed geometry.
export function mergeVertices( geometry, tolerance = 1e-4 ) {

	tolerance = Math.max( tolerance, Number.EPSILON );
	const decimalShift = Math.log10( 1 / tolerance ), shift = Math.pow( 10, decimalShift );
	const hashOffset = 0.5 / shift;
	const index = geometry.getIndex(), pos = geometry.getAttribute( 'position' );
	const count = index ? index.count : pos.count;
	const names = Object.keys( geometry.attributes );
	const src = names.map( ( n ) => geometry.attributes[ n ] );
	const tmp = src.map( ( a ) => new a.array.constructor( a.count * a.itemSize ) );
	const map = new Map(), newIndex = [];
	let next = 0;

	for ( let i = 0; i < count; i ++ ) {

		const vi = index ? index.getX( i ) : i;
		let hash = '';
		for ( const a of src ) for ( let c = 0; c < a.itemSize; c ++ ) hash += ~ ~ ( ( a.getComponent( vi, c ) + hashOffset ) * shift ) + ',';

		const hit = map.get( hash );
		if ( hit !== undefined ) { newIndex.push( hit ); continue; }

		for ( let k = 0; k < src.length; k ++ ) {

			const a = src[ k ];
			for ( let c = 0; c < a.itemSize; c ++ ) tmp[ k ][ next * a.itemSize + c ] = a.array[ a._idx( vi, c ) ];

		}

		map.set( hash, next );
		newIndex.push( next );
		next ++;

	}

	const out = geometry.clone();
	for ( let k = 0; k < names.length; k ++ ) {

		const a = src[ k ];
		out.setAttribute( names[ k ], new BufferAttribute( tmp[ k ].slice( 0, next * a.itemSize ), a.itemSize, a.normalized ) );

	}

	out.morphAttributes = {};
	out.setIndex( newIndex );
	return out;

}

export const BufferGeometryUtils = { mergeAttributes, mergeGeometries, mergeVertices };
