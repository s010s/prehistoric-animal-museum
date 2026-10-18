// Stubs of the modules other streams own (terrain, sky, clouds, ocean FFT, spray), for the shore tests.
// Terrain: an analytic sandy beach along x (land at z < 0, sea toward +z, depth 0.04 z), waves
// arriving straight onshore (travel time of shallow-water waves from z = 400 m).
import { ShaderModule, Texture, StorageBuffer, commonModule } from '../src/engine/webgpu.js';

const SLOPE = 0.04;
export const heightAt = ( x, z ) => - SLOPE * z + 0.25 * Math.sin( x * 0.05 ) - ( z < - 3 ? ( z + 3 ) * 0.06 : 0 );
const K = 2 / Math.sqrt( 9.81 * SLOPE );
const Tof = ( z ) => K * ( 20 - Math.sqrt( Math.max( z, 0.25 ) ) );

export function makeTerrain() {

	const origin = - 400, size = 800, res = 256;
	const data = new Float32Array( res * res * 4 );
	for ( let j = 0; j < res; j ++ ) for ( let i = 0; i < res; i ++ ) {

		const z = origin + ( j + 0.5 ) / res * size;
		const k = ( j * res + i ) * 4;
		data[ k ] = Tof( z ); data[ k + 1 ] = 0; data[ k + 2 ] = - 1; data[ k + 3 ] = Tof( 0 );

	}

	const module = new ShaderModule( {
		name: 'terrainStub',
		deps: [ commonModule ],
		code: /* wgsl */`
fn terrainHeightAt( xz: vec2f ) -> f32 {
	return -${ SLOPE } * xz.y + 0.25 * sin( xz.x * 0.05 ) - select( 0.0, ( xz.y + 3.0 ) * 0.06, xz.y < -3.0 );
}
fn terrainShoreSample( xz: vec2f ) -> vec4f {
	let T = ${ K } * ( 20.0 - sqrt( max( xz.y, 0.25 ) ) );
	return vec4f( T, 0.0, -1.0, ${ K } * ( 20.0 - sqrt( 0.25 ) ) );
}
fn terrainNormalRock( xz: vec2f ) -> vec4f { return vec4f( 0.0, ${ SLOPE }, 0.0, 1.0 ); }
fn terrainUvOf( xz: vec2f ) -> vec2f { return ( xz + 400.0 ) / 800.0; }
`,
	} );
	return { module, origin, size, shoreRes: res, shoreField: { data, res }, heightAt: ( xz ) => null, cpu: { heightAt } };

}

export function makeSky() {

	return { module: new ShaderModule( { name: 'skyStub', deps: [ commonModule ], code: /* wgsl */`
fn skyReflectionRadiance( d: vec3f ) -> vec3f { return mix( vec3f( 0.75, 0.82, 0.9 ), vec3f( 0.18, 0.35, 0.75 ), pow( sat( d.y ), 0.5 ) ) * 1.2; }
fn skyRadianceWithClouds( d: vec3f, withSun: bool ) -> vec3f { return skyReflectionRadiance( d ); }
` } ) };

}

export function makeClouds() {

	return { module: new ShaderModule( { name: 'cloudsStub', code: 'fn cloudsShadow( xz: vec2f ) -> f32 { return 1.0; }' } ) };

}

export function makeFFT() {

	const tex = new Texture( { label: 'oceanDisplacementStub', width: 4, height: 4, depth: 4, dimension: '2d-array', format: 'rgba16float', usage: [ 'sample', 'copyDst' ], data: new Uint16Array( 4 * 4 * 4 * 4 ) } );
	return {
		cascades: 4, sizes: [ 733, 157, 33.3, 7.1 ],
		module: new ShaderModule( { name: 'oceanStub', bindings: { oceanDisplacement: { texture: tex } }, code: '' } ),
	};

}

// GPU emit API of Spray (the sibling stream's module): positions only, for counting / drawing
export function makeSpray( N = 32768 ) {

	const pos = new StorageBuffer( { label: 'sprayPosStub', count: N, type: 'vec4f' } );
	const head = new StorageBuffer( { label: 'sprayHeadStub', count: 4, type: 'u32' } );
	return {
		pos, head, N, shoreSim: null, waveShadow: null,
		module: new ShaderModule( {
			name: 'sprayStub', deps: [ commonModule ],
			bindings: { sprayPosS: { storage: pos, access: 'read_write' }, sprayHeadS: { storage: head, access: 'read_write', type: 'atomic<u32>' } },
			code: /* wgsl */`
const SPRAY_DROPLET: f32 = 0.0;
const SPRAY_MIST: f32 = 1.0;
const SPRAY_LIGAMENT: f32 = 2.0;
const SPRAY_SPRAY: f32 = 3.0;
const SPRAY_SHEET: f32 = 4.0;
fn sprayReserve( n: u32 ) -> u32 { return atomicAdd( &sprayHeadS[ 0 ], n ); }
fn spraySlot( base: u32, i: u32 ) -> u32 { return ( base + i ) & ${ N - 1 }u; }
fn sprayWrite( slot: u32, p: vec3f, v: vec3f, size: f32, kind: f32, life: f32, seed: f32 ) { sprayPosS[ slot ] = vec4f( p, kind ); }
fn sprayRand( a: u32, b: u32 ) -> f32 { return hashU( a + b * 1664525u, frame.frameIndex ); }
`,
		} ),
	};

}
