// End-to-end headless test of the boat's water effects: the real hull lines (HullLines) driving
// BoatSpray -> Spray (CPU requests, hull collisions) and WakeSim, the boat running at speed through a
// head swell. Writes a side view of the bow spray and a top-down view of the wake.
// usage: node test/ocean-spray-boat.mjs [out-prefix]
import { writePNG } from './headless.mjs';
import { GPU } from '../src/engine/gpu/GPU.js';
import { RenderTarget } from '../src/engine/gpu/Texture.js';
import { ShaderModule } from '../src/engine/gpu/Shader.js';
import { readTexture } from '../src/engine/gpu/Readback.js';
import { G, setFrameCamera } from '../src/engine/render/Frame.js';
import { Material } from '../src/engine/render/Material.js';
import { MeshRenderer } from '../src/engine/render/MeshRenderer.js';
import { SceneRenderer } from '../src/engine/render/SceneRenderer.js';
import { FullscreenPass } from '../src/engine/render/FullscreenPass.js';
import { SunShadows } from '../src/engine/render/Shadows.js';
import * as E from '../src/engine/index.js';
import { HullLines } from '../src/world/boat/HullLines.js';
import { Spray } from '../src/fx/Spray.js';
import { BoatSpray } from '../src/player/BoatSpray.js';
import { WakeSim } from '../src/ocean/WakeSim.js';

await GPU.init( { headless: true } );
const W = Number( process.env.W || 1280 ), H = Number( process.env.H || 720 );
const out = process.argv[ 2 ] || '/tmp/ocean-boat';

// head swell (also the stub water query)
const A = 0.45, K = 2 * Math.PI / 22, OM = Math.sqrt( 9.81 * K );
const swell = ( x, z, t ) => A * Math.sin( K * z + OM * t );
const query = { module: new ShaderModule( { name: 'queryStub', code: /* wgsl */`
fn waterQueryHeightAtXZ( xz: vec2f ) -> f32 { return ${ A } * sin( ${ K } * xz.y + ${ OM } * frame.time ); }
` } ) };
const terrain = { module: new ShaderModule( { name: 'terrainStub', code: 'fn terrainHeightAt( xz: vec2f ) -> f32 { return -40.0; }' } ) };

const lines = new HullLines();
const boat = {
	model: { lines, propeller: new E.Vector3( 0, - 0.6, lines.zAft + 0.6 ), colliders: [ { tag: 'houseWall', center: new E.Vector3( 0, 1.3, 0.55 ), half: new E.Vector3( 0.9, 0.9, 0.9 ) } ] },
	position: new E.Vector3( 0, 0, 0 ), quaternion: new E.Quaternion(), velocity: new E.Vector3(), angular: new E.Vector3(),
	driven: true, throttle: 0.9, thrust: 6000, rpm: 1, hasWater: true, t: 0,
	forward( v ) { return v.set( 0, 0, 1 ).applyQuaternion( this.quaternion ); },
	toWorld( p, target ) { return target.copy( p ).applyQuaternion( this.quaternion ).add( this.position ); },
	sampleWaterAt( p ) { return swell( p.x, p.z, this.t ); },
};

const scene = new E.Scene();
const floor = new E.Mesh( new E.PlaneGeometry( 400, 400 ).rotateX( - Math.PI / 2 ), new Material( { name: 'sea', color: 0x0b2c3c, roughness: 0.25 } ) );
floor.position.y = - 0.05;
// the hull as a box, for scale
const hull = new E.Mesh( new E.BoxGeometry( 2.2, 1.4, lines.zBow - lines.zAft ), new Material( { name: 'hull', color: 0xd8d4c8, roughness: 0.5 } ) );
scene.add( floor, hull );
hull.visible = ! process.env.NOHULL;

const camera = new E.PerspectiveCamera( 45, W / H, 0.1, 2000 );
G.sunDir.value.set( - 0.4, 0.35, 0.6 ).normalize();
G.sunColor.value.setRGB( 6, 5.6, 5 );
G.skyIrradiance.value.setRGB( 0.35, 0.45, 0.6 );
G.windSpeed.value = 8;

const mr = new MeshRenderer();
const shadows = new SunShadows();
const sr = new SceneRenderer( mr, scene, camera );
sr.setSize( W, H );
sr.clearColor = [ 0.5, 0.62, 0.8, 1 ];
const spray = new Spray( null, { query, terrain, sceneCopy: sr.opaqueCopy } );
scene.add( spray.mesh );
const boatSpray = new BoatSpray( { boat, spray } );
const wake = new WakeSim( null, { terrainGPU: terrain, boat } );

const tonemap = new FullscreenPass( { label: 'tonemap', colorFormats: [ 'rgba8unorm' ], bindings: { hdr: { texture: () => sr.sceneRT.texture } },
	code: `fn fragment( in: FSIn ) -> vec4f {
		let c = textureLoad( hdr, vec2i( in.pos.xy ), 0 ).rgb;
		let a = c * 0.6; let t = ( a * ( 2.51 * a + 0.03 ) ) / ( a * ( 2.43 * a + 0.59 ) + 0.14 );
		return vec4f( linearToSrgb( sat3( t ) ), 1.0 ); }` } );
const ldr = new RenderTarget( W, H, { colors: [ 'rgba8unorm' ], label: 'ldr' } );

const dt = 1 / 60, speed = Number( process.env.SPEED || 9 );
const frames = Number( process.env.FRAMES || 360 );
let particles = 0, maxP = 0, tWake = 0, tSpray = 0;
const e = new E.Euler();
for ( let f = 0; f < frames; f ++ ) {

	G.time.value += dt; G.dt.value = dt;
	boat.t = G.time.value;
	// heave and pitch with the swell
	const z = boat.position.z + speed * dt;
	const hB = swell( 0, z + 3, boat.t ), hS = swell( 0, z - 3, boat.t );
	const pitch = - Math.atan2( hB - hS, 6 ) * 0.8;
	const prevY = boat.position.y;
	boat.position.set( 0, ( hB + hS ) * 0.5 * 0.8, z );
	boat.quaternion.setFromEuler( e.set( pitch, 0, 0 ) );
	boat.velocity.set( 0, ( boat.position.y - prevY ) / dt, speed );
	hull.position.copy( boat.position ).add( new E.Vector3( 0, 0.4, 0 ) );
	hull.quaternion.copy( boat.quaternion );

	camera.position.set( boat.position.x - 5, 1.4, boat.position.z + 10 );
	camera.lookAt( boat.position.x, 0.5, boat.position.z + 3 );

	GPU.beginFrame();
	setFrameCamera( camera, W, H );
	boatSpray.update( dt );
	particles += boatSpray.stats.particles; maxP = Math.max( maxP, boatSpray.stats.particles );
	await GPU.queue.onSubmittedWorkDone();
	let a = performance.now();
	wake.update( dt );
	GPU.submit(); await GPU.queue.onSubmittedWorkDone();
	tWake += performance.now() - a;
	a = performance.now();
	spray.update();
	GPU.submit(); await GPU.queue.onSubmittedWorkDone();
	tSpray += performance.now() - a;
	shadows.render( scene, mr, shadows.update( camera, G.sunDir.value ) );
	sr.render();
	tonemap.render( { colorViews: [ ldr.texture ] } );
	GPU.submit();

}

await GPU.queue.onSubmittedWorkDone();
console.log( `BoatSpray: ${ particles } particles over ${ frames } frames (max ${ maxP } / frame); wake ${ ( tWake / frames ).toFixed( 3 ) } ms, spray update ${ ( tSpray / frames ).toFixed( 3 ) } ms (wall clock incl. submit)` );
let img = await readTexture( ldr.texture );
writePNG( `${ out }-spray.png`, W, H, new Uint8Array( img.data ) );

// wake, top-down 80 m around the boat
const WT = 768;
const rt = new RenderTarget( WT, WT, { colors: [ 'rgba8unorm' ], label: 'wakeView' } );
const view = new FullscreenPass( { label: 'wake view', modules: [ wake.module ], colorFormats: [ 'rgba8unorm' ], code: /* wgsl */`fn fragment( in: FSIn ) -> vec4f {
	let xz = vec2f( ${ boat.position.x.toFixed( 2 ) }, ${ boat.position.z.toFixed( 2 ) } - 25.0 ) + ( vec2f( in.uv.x, 1.0 - in.uv.y ) - 0.5 ) * 80.0;
	let h = wakeDisplacement( xz ).y;
	let fr = wakeFragment( xz );
	let n = normalize( vec3f( - fr.slopes.x, 1.0, - fr.slopes.y ) );
	let shade = sat( dot( n, normalize( vec3f( 0.5, 0.8, 0.3 ) ) ) );
	let col = mix( vec3f( 0.45 + h, 0.5 + h, 0.55 + h ) * ( 0.4 + 0.6 * shade ), vec3f( 1.0 ), sat( fr.foam ) );
	return vec4f( mix( col, vec3f( 0.2, 0.9, 0.8 ), fr.aeration ), 1.0 );
}` } );
GPU.beginFrame();
view.render( { colorViews: [ rt.texture ], clear: [ 0, 0, 0, 1 ] } );
GPU.submit();
img = await readTexture( rt.texture );
writePNG( `${ out }-wake.png`, WT, WT, new Uint8Array( img.data ) );
console.log( 'wrote', `${ out }-spray.png`, `${ out }-wake.png` );
await new Promise( ( r ) => setTimeout( r, 300 ) );
process.exit( 0 );
