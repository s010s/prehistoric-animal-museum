// Everything of the ocean stream together on the shore stubs' analytic beach (land at z < 0):
// FFT, CDLOD surface, shore waves + swash, ShoreSim foam, SurfFoam, SeaDetail, caustics, underwater
// lighting, Breakers lips, Spray, WaterQuery. Views from the beach, over the surf, and below.
// node test/ocean-full.mjs [outDir]
import { makeOceanScene } from './ocean-scene.mjs';
import { makeTerrain, makeSky, makeClouds, heightAt } from './ocean-shore-stubs.mjs';
import { ShaderModule } from '../src/engine/gpu/Shader.js';
import { Vector2 } from '../src/engine/index.js';
import { LAYERS } from '../src/engine/render/SceneRenderer.js';
import { ShoreWaves } from '../src/ocean/ShoreWaves.js';
import { ShoreSim } from '../src/ocean/ShoreSim.js';
import { SurfFoam } from '../src/ocean/SurfFoam.js';
import { SeaDetail } from '../src/ocean/SeaDetail.js';
import { Breakers } from '../src/ocean/Breakers.js';
import { Spray } from '../src/fx/Spray.js';
import { WaterQuery } from '../src/ocean/WaterQuery.js';

const out = process.argv[ 2 ] || '/tmp';
let errors = 0;
const origErr = console.error;
console.error = ( ...a ) => { errors ++; origErr( ...a ); };

const base = makeTerrain();
const terrain = Object.assign( Object.create( Object.getPrototypeOf( base ) ), base );
terrain.module = new ShaderModule( { name: 'terrainStubFull', deps: [ base.module ], code: 'fn terrainSunShadowAt( P: vec3f ) -> f32 { return 1.0; }\nfn terrainNormalRockLevel( xz: vec2f, level: f32 ) -> vec4f { return vec4f( 0.0, 1.0, 0.0, 0.0 ); }' } );
const sky = makeSky();
const clouds = makeClouds();

let sys;
// UNIFORM_BUDGET=n: pretend the adapter has n uniform buffers per stage (exercises the storage demotion)
if ( process.env.UNIFORM_BUDGET ) {

	const { GPU } = await import( '../src/engine/gpu/GPU.js' );
	const init = GPU.init.bind( GPU );
	GPU.init = async ( o ) => { await init( o ); const L = GPU.limits; GPU.limits = new Proxy( L, { get: ( t, k ) => k === 'maxUniformBuffersPerShaderStage' ? Number( process.env.UNIFORM_BUDGET ) : t[ k ] } ); return GPU; };

}
const s = await makeOceanScene( { terrain, sky, clouds, extra: ( ctx ) => {

	const { surface } = ctx;
	const shore = new ShoreWaves( terrain );
	const detail = new SeaDetail();
	const shoreSim = new ShoreSim( null, { terrainGPU: terrain, shore, center: new Vector2( 0, 20 ), size: 160, res: 768 } );
	const surfFoam = new SurfFoam( { shoreSim } );
	surface.shore = shore;
	surface.detail = detail;
	surface.shoreSim = shoreSim;
	surface.foamShading = surfFoam;
	const query = new WaterQuery( null, surface );
	sys = { shore, detail, shoreSim, surfFoam, query };
	ctx.onMaterial = ( mat, sr ) => {

		const spray = sys.spray = new Spray( null, { query, terrain, sceneCopy: sr.opaqueCopy, clouds } );
		const breakers = new Breakers( null, { surface, shore, terrainData: { heightAt }, sky, spray, clouds } );
		sys.breakers = breakers;
		ctx.scene.add( breakers.mesh );
		ctx.scene.add( spray.mesh );

	};

} } );
const { shore, detail, shoreSim, query, spray } = sys;
s.before.push( ( dt ) => {

	if ( shore.update ) shore.update( dt );
	detail.update( dt );
	shoreSim.update();
	query.setCamera( s.camera.position.x, s.camera.position.z );
	query.update();
	sys.breakers.update( s.camera );
	spray.update();

} );

const shots = [
	[ 'beach', [ - 6, 2.2, - 12 ], [ 10, 0, 40 ] ],
	[ 'surf', [ 10, 6, 45 ], [ 0, 0, 0 ] ],
	[ 'aerial', [ - 30, 40, 70 ], [ 0, 0, 10 ] ],
	[ 'under', [ 0, - 2.0, 90 ], [ 0, - 0.8, 40 ] ],
];
for ( let i = 0; i < 240; i ++ ) { s.camera.position.set( ...shots[ 0 ][ 1 ] ); s.camera.lookAt( ...shots[ 0 ][ 2 ] ); s.frame(); }
for ( const [ name, p, t ] of shots ) {

	s.camera.position.set( ...p ); s.camera.lookAt( ...t );
	for ( let i = 0; i < 4; i ++ ) s.frame();
	await s.save( `${ out }/ocean-full-${ name }.png` );

}

s.camera.position.set( ...shots[ 0 ][ 1 ] ); s.camera.lookAt( ...shots[ 0 ][ 2 ] );
console.log( 'frame ms (all ocean systems @ 2560x1267):', ( await s.time( 30 ) ).toFixed( 2 ), 'pipelines', s.mr.stats.pipelines, 'errors', errors );
// binding budget of the water pipeline (12 uniform buffers per stage on Apple / Chrome)
{

	const { buildMeshShader } = await import( '../src/engine/render/MeshShader.js' );
	const { composeShader } = await import( '../src/engine/gpu/Shader.js' );
	const wm = s.waterMaterial;
	const layout = [ { name: 'position', wgsl: 'vec3f', location: 0 }, { name: 'nodeData', wgsl: 'vec4f', location: 1, instanced: true } ];
	const src = buildMeshShader( wm, layout, { kind: 'main', late: true } );
	const c = composeShader( { modules: src.modules, bindings: src.bindings, code: src.code, defines: src.defines, stage: 'render', label: 'count' } );
	const count = ( vis ) => { const r = { uniform: 1, texture: 0, storage: 0 }; for ( const d of [ ...c.group0.described, ...c.bindings.described ] ) if ( d.layout.visibility & vis ) { if ( d.layout.buffer?.type === 'uniform' ) r.uniform ++; else if ( d.layout.texture ) r.texture ++; else if ( d.layout.buffer ) r.storage ++; } return r; };
	if ( process.env.DUMP_WGSL ) ( await import( 'node:fs' ) ).writeFileSync( process.env.DUMP_WGSL, c.code );
	const names = ( vis ) => c.bindings.names.filter( ( n, i ) => c.bindings.described[ i ].layout.buffer?.type === 'uniform' && ( c.bindings.described[ i ].layout.visibility & vis ) );
	console.log( 'vertex uniforms', names( GPUShaderStage.VERTEX ).join( ' ' ), '| fragment', names( GPUShaderStage.FRAGMENT ).join( ' ' ) );
	console.log( 'water bindings (incl. per-draw block) vertex', JSON.stringify( count( GPUShaderStage.VERTEX ) ), 'fragment', JSON.stringify( count( GPUShaderStage.FRAGMENT ) ), 'WGSL bytes', c.code.length );

}

process.exit( 0 );
