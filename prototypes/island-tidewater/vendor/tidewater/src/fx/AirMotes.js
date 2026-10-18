import { Material } from '../engine/render/Material.js';
import { Mesh } from '../engine/scene/Mesh.js';
import { PlaneGeometry } from '../engine/geometry/index.js';
import { ShaderModule, UniformBlock } from '../engine/gpu/Shader.js';
import { LAYERS } from '../engine/render/SceneRenderer.js';
import { G } from '../engine/render/Frame.js';
import { Vector2, Vector3 } from '../engine/math/index.js';

const GNAT_SWARMS = 4, GNATS_PER_SWARM = 12, SEEDS = 48;
const VISIBILITY = 8;

const f = ( x ) => {

	const s = String( x );
	return s.includes( '.' ) || s.includes( 'e' ) ? s : s + '.0';

};

// Life in the air around the camera: dust and pollen motes, fine salt aerosol near the surf, a few
// drifting seed tufts and, rarely, a loose swarm of gnats hovering over the vegetation. Like
// MarineSnow the positions are procedural (hash of the instance) in a box that wraps around the
// camera: no simulation, no CPU work beyond a few uniforms. Everything drifts with the wind plus a
// slow per-particle swirl; the gnats hold station in small swarms and dart around in loops.
// The specks are far smaller than a pixel: each is drawn at least ~1.2 px wide with its opacity
// scaled by the coverage of the real particle, so it neither flickers under the TAA jitter nor turns
// into a blob. They are lit per particle (vertex stage) by the sun through a forward-scattering
// phase function and the sun's visibility at the particle (cloud shadow, hill shadow and the near
// shadow cascade, so motes in a palm's shade stay dark): nearly invisible most of the time, they
// light up when backlit in the sun against a dark background. Drawn premultiplied in the late pass;
// the core of each speck writes depth and its own motion vector (wind + swirl), so the temporal
// resolve follows it instead of clipping it away. Cost: one instanced draw, ~0.02 ms.
//
// Port notes: the motion vector comes from the mesh template (world position now and a frame ago:
// camera + own motion; VELOCITY_OPAQUE so the speck owns it instead of blending it, as three's
// NoBlending velocity target did); the near cascade lookup is the engine's sunShadowCascadeHard( P, 0 ).
// Consumes terrain.module (terrainHeightAt, terrainSunShadowAt) and clouds.module (cloudsShadow).
export class AirMotes {

	constructor( { terrain, clouds = null, csm = null, reversedDepth = true, count = 3000, box = 12 } ) {

		this.terrain = terrain;
		this.csm = csm;
		this.box = box;
		this.reversedDepth = reversedDepth;
		this.uniforms = new UniformBlock( 'AirMotesParams', {
			camPos: [ 'vec3f', new Vector3() ],
			intensity: [ 'f32', 1 ],
			drift: [ 'vec2f', new Vector2() ], // wind drift, wrapped to the box (m)
		}, { label: 'airMotes' } );
		this.camPos = this.uniforms.fields.camPos;
		this.drift = this.uniforms.fields.drift;
		this.intensity = this.uniforms.fields.intensity;
		this.windScale = 0.25; // near the ground, among the plants: a fraction of the 10 m wind

		const hasTerrain = !! ( terrain && terrain.module );
		const hasClouds = !! ( clouds && clouds.module );
		const params = new ShaderModule( { name: 'airMotesParams', uniforms: this.uniforms, uniformName: 'air', code: /* wgsl */`
fn airHash3( n: f32 ) -> vec3f { return fract( sin( vec3f( n, n + 17.13, n + 43.71 ) ) * vec3f( 43758.5453, 22578.1459, 19642.3490 ) ); }
// Henyey-Greenstein phase (1/sr)
fn airPhaseHG( cosT: f32, g: f32 ) -> f32 { return ( ( 1.0 - g * g ) / ( 4.0 * PI ) ) / pow( max( 1.0 + g * g - cosT * 2.0 * g, 1e-4 ), 1.5 ); }
` } );

		const B = f( box );
		const NG = GNAT_SWARMS * GNATS_PER_SWARM;

		const mat = new Material( {
			name: 'AirMotes',
			modules: [ params, hasTerrain && terrain.module, hasClouds && ( clouds.shadowModule || clouds.module ) ].filter( Boolean ),
			lit: false,
			transparent: true,
			// the core of each speck writes depth: the temporal resolve dilates its motion vectors by depth,
			// so the speck's own motion is used around it and its history follows it (instead of being
			// clipped away as it moves over a background with other motion)
			depthWrite: true,
			depthTest: true,
			side: 'double',
			blending: 'premultiplied',
			defines: { VELOCITY_OPAQUE: 1 },
			varyings: { vAirCol: 'vec4f', vAirUV: 'vec2f' }, // radiance, opacity; quad corner
			vertex: /* wgsl */`
	let id = f32( v.instance );
	let h = airHash3( id * 0.7131 + 0.37 );
	let h2 = airHash3( id * 1.3917 + 5.1 );
	let h3 = airHash3( id * 2.1733 + 11.7 );
	let isGnat = id < ${ f( NG ) };
	let isSeed = id >= ${ f( NG ) } && id < ${ f( NG + SEEDS ) };
	let t = frame.time;
	let L = frame.sunDir;
	let Bx = ${ B };

	// ---- where: wrapped around the camera. Gnats: a swarm home fixed in the world (no drift)
	let sid = floor( id / ${ f( GNATS_PER_SWARM ) } );
	let hs = airHash3( sid * 3.917 + 1.3 );
	let home = select( h.xz, hs.xz, isGnat );
	let drift = select( air.drift, vec2f( 0.0 ), isGnat );
	let local = ( fract( home + ( drift - air.camPos.xz ) / Bx ) - 0.5 ) * Bx;
	let xz0 = air.camPos.xz + local;
	let ht = ${ hasTerrain ? 'terrainHeightAt( xz0 )' : '-90.0' };
	let hA = ht - frame.seaLevel;

	// ---- motion: slow swirl (two octaves, random phases) + wind; gnats dart in loops
	let ph = h3 * 6.2832;
	let w1 = h2 * 0.5 + 0.35; // rad/s
	let w2 = h2.zxy * 1.4 + 1.5;
	let A1 = vec3f( 0.45, 0.22, 0.45 ) * select( 1.0, 1.6, isSeed );
	let A2 = vec3f( 0.07, 0.05, 0.07 );
	let a1 = w1 * t + ph; let a2 = w2 * t + ph.zxy;
	let swirl = sin( a1 ) * A1 + sin( a2 ) * A2;
	let swirlV = cos( a1 ) * ( A1 * w1 ) + cos( a2 ) * ( A2 * w2 );
	let gw = h2 * 2.2 + 1.8;
	let gA = vec3f( 0.3, 0.2, 0.3 ) * ( h3.x * 0.6 + 0.6 );
	let g1 = gw * t + ph; let g2 = gw.zxy * ( t * 1.7 ) + ph.yzx;
	let gnatOff = ( h - 0.5 ) * vec3f( 0.9, 0.6, 0.9 ) + sin( g1 ) * gA + sin( g2 ) * ( gA * 0.45 );
	let gnatV = cos( g1 ) * ( gA * gw ) + cos( g2 ) * ( gA * 0.45 * gw.zxy * 1.7 );
	let off = select( swirl, gnatOff, isGnat );
	let windV = vec3f( frame.windDir.x, 0.0, frame.windDir.y ) * ( frame.windSpeed * ${ f( this.windScale ) } );
	let vel = select( swirlV + windV, gnatV, isGnat );

	// height above the ground (or the sea): mostly low down, seeds and gnats in the first metres
	let ground = max( ht, frame.seaLevel + 0.25 );
	let yMote = pow( h.y, 1.8 ) * 6.5 + 0.2;
	let ySeed = h.y * 2.5 + 0.3;
	let yGnat = hs.y * 1.4 + 0.8;
	let y = ground + select( select( yMote, ySeed, isSeed ), yGnat, isGnat );
	let p = vec3f( xz0.x, y, xz0.y ) + off;

	// ---- how many live here: most over the beach and the plants, very few far out over the sea,
	// fewer at night; gnats only inland over the vegetation, in a few places (per world tile)
	let land = smoothstep( 0.3, 1.5, hA );
	let shore = smoothstep( -7.0, -2.0, hA );
	let day = 1.0 - frame.night * 0.75;
	let tile = floor( xz0 / Bx );
	let tileHash = fract( sin( dot( tile, vec2f( 12.9898, 78.233 ) ) + sid * 7.31 ) * 43758.5453 );
	let dMote = max( max( land * 0.85, shore ), 0.06 ) * day;
	let dSeed = land * day;
	let dGnat = smoothstep( 1.5, 4.0, hA ) * select( 0.0, 1.0, tileHash < 0.3 ) * ( 1.0 - frame.night );
	let density = select( select( dMote, dSeed, isSeed ), dGnat, isGnat );
	let keep = sat( ( density - select( h3.y, 0.5, isGnat ) ) * 8.0 );

	// ---- what: salt aerosol near the surf / over the sea, dust and pollen over the land
	let salt = smoothstep( 0.8, -0.5, hA );
	// (the size of what catches the eye in film: lint, pollen clumps, bits of plant, sea salt crystals)
	let rMote = mix( 0.00015, 0.0005, h2.x * h2.x ) * mix( 1.0, 0.6, salt ) * select( 1.0, 2.2, h2.y > 0.96 );
	let r = select( select( rMote, mix( 0.0025, 0.0045, h2.x ), isSeed ), mix( 0.0008, 0.0011, h2.x ), isGnat );

	// ---- lighting (per particle): forward-scattering phase, sun visibility at the particle
	let toCam = frame.cameraPos - p;
	let dist = max( length( toCam ), 0.05 );
	let Vd = toCam / dist;
	let cosT = - dot( Vd, L ); // 1 = looking toward the sun through the particle
	var vis = select( 1.0, sunShadowCascadeHard( p, 0 ), shadowParams.enabled > 0.5 );
${ hasClouds ? '\tvis *= cloudsShadow( p.xz );' : '' }
${ hasTerrain ? '\tvis *= terrainSunShadowAt( p );' : '' }
	let sun = frame.sunColor * vis;
	// diffraction + refraction: a strong forward lobe with a narrow glint core, a weak broad part
	// (the broad part keeps sunlit motes faintly visible from the side against shade)
	let phDust = airPhaseHG( cosT, 0.93 ) * 0.22 + airPhaseHG( cosT, 0.7 ) * 0.43 + airPhaseHG( cosT, 0.15 ) * 0.35;
	let phSalt = airPhaseHG( cosT, 0.93 ) * 0.35 + airPhaseHG( cosT, 0.75 ) * 0.5 + airPhaseHG( cosT, 0.2 ) * 0.15;
	let phMote = mix( phDust, phSalt, salt );
	let albMote = mix( vec3f( 0.95, 0.85, 0.66 ), vec3f( 1.0 ), salt );
	let cMote = albMote * ( sun * phMote + frame.skyIrradiance * 0.2 );
	// seed tufts: white fluff, diffuse from any side plus a forward glow
	let cSeed = sun * ( airPhaseHG( cosT, 0.55 ) * 0.8 + 0.05 ) + frame.skyIrradiance * 0.35;
	// gnats: dark bodies (specks against the sky), wings that catch the light when backlit
	let cGnat = sun * ( airPhaseHG( cosT, 0.9 ) * 0.12 ) + frame.skyIrradiance * 0.02;
	let col = select( select( cMote, cSeed, isSeed ), cGnat, isGnat );

	// ---- footprint: at least ~1.2 px wide, opacity = the real particle's coverage of it
	let p11 = frame.proj[ 1 ][ 1 ];
	let pixel = dist * 2.0 / ( p11 * frame.resolution.y );
	let size = max( r, pixel * 1.2 );
	// (x VISIBILITY: in film these read larger than they are, defocused and bloomed)
	let rs = r / size;
	let cover = min( rs * rs * ${ f( 3.5 * VISIBILITY ) }, 1.0 );
	// fades: box edges (before the wrap), right in front of the lens, near the water surface
	let edge = smoothstep( Bx * 0.5, Bx * 0.36, max( abs( p.x - air.camPos.x ), abs( p.z - air.camPos.z ) ) );
	let fade = edge * smoothstep( Bx * 0.5, Bx * 0.3, dist ) * smoothstep( 0.12, 0.5, dist ) * smoothstep( 0.25, 0.9, p.y - frame.seaLevel );
	let a = cover * fade * keep * air.intensity;

	// camera-facing quad
	let right = normalize( cross( vec3f( 0.0, 1.0, 0.0 ), Vd ) + vec3f( 1e-5, 0.0, 0.0 ) );
	let up = cross( Vd, right );
	let corner = v.position.xy; // plane is 2 x 2: half-width = size
	let world = p + right * ( corner.x * size ) + up * ( corner.y * size );

	o.vAirCol = vec4f( col, a );
	o.vAirUV = corner;
	// nothing to draw: collapse the quad off-screen
	v.useWorld = true;
	v.worldPos = select( vec3f( 0.0, -1e5, 0.0 ), world, a > 2e-4 );
	v.worldNormal = Vd;
	// own motion over the last frame (the template adds the camera's)
	v.prevWorldPos = v.worldPos - vel * frame.dt;
`,
			// gaussian speck cut at its core (the cut tails' energy is folded into the core: 1 / 0.65)
			surface: /* wgsl */`
	let uvq = in.vs.vAirUV;
	let g = exp( dot( uvq, uvq ) * -3.5 );
	let a = min( in.vs.vAirCol.w * g / 0.65, 1.0 );
	if ( g < 0.35 || a < 0.003 ) { discard; }
	s.albedo = in.vs.vAirCol.rgb * a;
	s.emissive = vec3f( 0.0 );
	s.alpha = a;
`,
			output: 'r.color = vec4f( s.albedo, s.alpha );',
		} );

		const geo = new PlaneGeometry( 2, 2 );
		geo.instanceCount = count;
		this.material = mat;
		this.mesh = new Mesh( geo, mat );
		this.mesh.name = 'AirMotes';
		this.mesh.frustumCulled = false;
		this.mesh.castShadow = false;
		this.mesh.receiveShadow = false;
		this.mesh.renderOrder = 21;
		this.mesh.layers.set( LAYERS.TRANSPARENT );

	}

	// cameraWaterHeight: water level at the camera (none drawn with the camera under water)
	update( dt, camera, cameraWaterHeight = 0 ) {

		const visible = this.intensity.value > 0 && camera.position.y > cameraWaterHeight;
		this.mesh.visible = visible;
		if ( ! visible ) return;
		this.camPos.value.copy( camera.position );
		const s = G.windSpeed.value * this.windScale * dt;
		const d = this.drift.value;
		d.x = ( d.x + G.windDir.value.x * s ) % this.box;
		d.y = ( d.y + G.windDir.value.y * s ) % this.box;

	}

}
