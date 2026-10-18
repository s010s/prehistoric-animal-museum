// Village / pier stream test: builds TerrainData, Colliders and the Village (which builds the pier
// and bakes its texture sets on the first frame), a coarse terrain mesh as ground plus a flat sea
// plane, and renders PNGs at 2560x1267 from several viewpoints.
//   node test/world-village.mjs [outPrefix=/tmp/claude-village-] [only=name,name]
import './headless.mjs';
import { worldHarness, done } from './world-harness.mjs';
import { TerrainData } from '../src/world/TerrainData.js';
import { Colliders } from '../src/world/Colliders.js';
import { Village } from '../src/world/Village.js';
import { Material } from '../src/engine/render/Material.js';

const OUT = process.argv[ 2 ] || '/tmp/claude-village-';
const ONLY = process.argv[ 3 ] ? process.argv[ 3 ].split( ',' ) : null;

const H = await worldHarness( { width: 2560, height: 1267, sun: [ 0.55, 0.5, 0.45 ] } );
const { E, G } = H;

let t0 = performance.now();
const terrain = new TerrainData();
console.log( 'terrain data', ( performance.now() - t0 ).toFixed( 0 ), 'ms' );
const colliders = new Colliders();
t0 = performance.now();
const village = new Village( { scene: H.scene, terrain, colliders } );
console.log( 'village build', ( performance.now() - t0 ).toFixed( 0 ), 'ms', village.getStats() );

// ---- ground: coarse heightfield around the village (after the village flattened its pads)
{

	const x0 = - 30, x1 = 130, z0 = - 190, z1 = 60, step = 0.5;
	const nx = Math.round( ( x1 - x0 ) / step ) + 1, nz = Math.round( ( z1 - z0 ) / step ) + 1;
	const pos = new Float32Array( nx * nz * 3 );
	const nrm = new Float32Array( nx * nz * 3 );
	for ( let j = 0; j < nz; j ++ ) for ( let i = 0; i < nx; i ++ ) {

		const x = x0 + i * step, z = z0 + j * step, k = ( j * nx + i ) * 3;
		pos[ k ] = x; pos[ k + 1 ] = terrain.heightAt( x, z ); pos[ k + 2 ] = z;
		const hx = terrain.heightAt( x + 0.25, z ) - terrain.heightAt( x - 0.25, z );
		const hz = terrain.heightAt( x, z + 0.25 ) - terrain.heightAt( x, z - 0.25 );
		const l = Math.hypot( hx, 0.5, hz );
		nrm[ k ] = - hx / l; nrm[ k + 1 ] = 0.5 / l; nrm[ k + 2 ] = - hz / l;

	}

	const idx = new Uint32Array( ( nx - 1 ) * ( nz - 1 ) * 6 );
	let o = 0;
	for ( let j = 0; j < nz - 1; j ++ ) for ( let i = 0; i < nx - 1; i ++ ) {

		const a = j * nx + i, b = a + 1, c = a + nx, d = c + 1;
		idx[ o ++ ] = a; idx[ o ++ ] = c; idx[ o ++ ] = b; idx[ o ++ ] = b; idx[ o ++ ] = c; idx[ o ++ ] = d;

	}

	const geo = new E.BufferGeometry();
	geo.setAttribute( 'position', new E.BufferAttribute( pos, 3 ) );
	geo.setAttribute( 'normal', new E.BufferAttribute( nrm, 3 ) );
	geo.setIndex( new E.BufferAttribute( idx, 1 ) );
	// plain sand below ~3 m, grass above
	const ground = new E.Mesh( geo, new Material( { name: 'ground', roughness: 0.95,
		surface: `let t = smoothstep( 2.5, 4.5, in.P.y ) * smoothstep( 0.6, 0.85, in.N.y );
	s.albedo = mix( vec3f( 0.62, 0.52, 0.36 ), vec3f( 0.16, 0.22, 0.07 ), t ) * ( 0.9 + 0.1 * sin( in.P.x * 3.1 ) * sin( in.P.z * 2.7 ) );` } ) );
	ground.castShadow = true;
	ground.frustumCulled = false;
	H.scene.add( ground );
	const sea = new E.Mesh( new E.PlaneGeometry( 800, 800 ).rotateX( - Math.PI / 2 ), new Material( { name: 'sea', roughness: 0.08, color: 0x0b3a4a } ) );
	sea.position.set( 50, 0.0, 100 );
	H.scene.add( sea );

}

G.time.value = 3.0;
const views = {
	overview: { pos: [ 40, 70, - 20 ], target: [ 45, 4, - 105 ], fov: 55 },
	street: { pos: [ 30, 6.5, - 100 ], target: [ 22, 5, - 115 ], fov: 55 },
	houses: { pos: [ 50, 9, - 96 ], target: [ 64, 7, - 108 ], fov: 50 },
	boardwalk: { pos: [ 57, 5.5, - 64 ], target: [ 46, 5, - 96 ], fov: 55 },
	pierBeach: { pos: [ 38, 4, - 58 ], target: [ 55, 2, - 30 ], fov: 55 },
	pierHead: { pos: [ 50, 4.6, 26 ], target: [ 56, 2.8, 40 ], fov: 60 },
	closeWall: { pos: [ 14, 4.2, - 99.5 ], target: [ 13.5, 3.5, - 104 ], fov: 45 },
	huts: { pos: [ 60, 4.5, - 55 ], target: [ 72, 4, - 67 ], fov: 55 },
};

for ( const [ name, v ] of Object.entries( views ) ) {

	if ( ONLY && ! ONLY.includes( name ) ) continue;
	await H.shot( OUT + name + '.png', v );

}

console.log( 'bake', village.textures.bakeMs.toFixed( 1 ), 'ms (CPU record)', 'textureMB', ( village.textures.bytes / 1048576 ).toFixed( 1 ) );
H.setView( views.overview );
console.log( 'main pass (overview)', await H.timeMain() );
H.setView( views.street );
console.log( 'main pass (street)', await H.timeMain() );
// night: window glow / lanterns
G.night.value = 1;
G.sunDir.value.set( 0.3, 0.25, 0.2 ).normalize();
G.sunColor.value.setRGB( 0.05, 0.06, 0.1 );
G.skyIrradiance.value.setRGB( 0.01, 0.015, 0.03 );
if ( ! ONLY || ONLY.includes( 'night' ) ) await H.shot( OUT + 'night.png', views.houses );
await done();
