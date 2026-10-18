import { Mesh, Vector2, Vector3 } from '../engine/index.js';
import { ShaderModule } from '../engine/gpu/Shader.js';
import { CDLOD } from '../core/CDLOD.js';
import { standard } from '../materials/Materials.js';
import { G } from '../engine/render/Frame.js';
import { WORLD } from './WorldLayout.js';
import { srgb, rot2, terrainShadingModule } from './terrain/TerrainShading.js';

// = GrassField FADE_T0 (vegetation/GrassField.js): tier 0 blades drop out at random distances in
// this range. Kept as a literal so the terrain doesn't pull in the grass field's shaders.
const GRASS_FADE = [ 62, 87 ];

// The former TerrainLightingModel (multiplies the key directional light by the soft heightfield
// sun shadow: long hill shadows beyond the shadow map range and from terrain outside the view) is
// `terrainGPU.sunModulationModule` + the define MATERIAL_SUN_MODULATION (see TerrainGPU.js); the
// terrain's own version below also darkens the tall-grass meadow at low sun.

// Island terrain: CDLOD mesh displaced by the heightmap, with a procedural material that blends
// coral sand (dry / damp / wet, wind ripples, shell grit, wrack line, swash marks), the seabed
// (sand with ripple fields, seagrass meadows, rubble heads), tropical lawn, jungle floor and canopy,
// landslide scars, worn dirt paths and weathered volcanic rock (triplanar, faceted blocks, bedding,
// lichen, moss, splash-zone zonation, rain streaks). Detail comes from one small tileable height
// texture sampled at several scales / rotations; normals use surface-gradient bump mapping; the
// baked horizon AO feeds the surface ao. Rock is only evaluated where it can appear. The key light
// is multiplied by the baked heightfield sun shadow (long, soft hill shadows at low sun).
export class Terrain {

	// gridSize 40 / rangeFactor 2.0: 0.2 m vertices at the camera, ~80 quads per LOD range
	// (~9-25 % finer than 32 / 2.3 at every distance) for 0.1-0.2 M triangles.
	// sunShadow: apply the heightfield sun shadow here (pass false if it is applied to every scene
	// material through SceneLighting.directModulation). renderer: optional (unused: the sun shadow
	// map is baked from update() into the frame encoder).
	constructor( { scene, terrainData, terrainGPU, gridSize = 40, rangeFactor = 2.0, sunShadow = true, renderer = null } ) {

		this.data = terrainData;
		this.gpu = terrainGPU;
		const half = terrainData.size / 2;

		this.lod = new CDLOD( {
			gridSize, leafSize: 8, levels: 9,
			heightBounds: ( x0, z0, x1, z1 ) => terrainData.boundsFor( x0, z0, x1, z1 ),
			center: { x: - half, z: - half, size: terrainData.size },
			rangeFactor,
			prefix: 'terrainLod',
		} );

		// optional wetness from the shore system: { modules: [ ... ], code: WGSL defining
		// fn terrainWetness( xz: vec2f, h: f32 ) -> vec2f (x = wetness, y = foam residue) }
		this.wetness = null;
		this.sunShadow = sunShadow;
		this.renderer = renderer;

		// Morph toward the view camera in every pass: the shadow passes render the same surface
		// (with the pass camera they would morph toward the light camera instead).
		this.uViewPos = { value: new Vector3() };
		// travelling gust field offset (the same integration as Vegetation's vegGustOffset)
		this.gustOffset = new Vector2();

		const mat = this.material = standard( {
			name: 'Terrain',
			roughness: 0.9, metalness: 0,
			uniforms: {
				viewPos: [ 'vec3f', this.uViewPos.value ],
				wetDarken: [ 'f32', 0.58 ],
				gustOffset: [ 'vec2f', this.gustOffset ],
			},
			attributes: { nodeData: 'vec4f' },
		} );
		this.params = { wetDarken: mat.uniforms.wetDarken };
		this.uViewPos = mat.uniforms.viewPos;

		mat.vertex = /* wgsl */`
	// CDLOD vertex (same lattice snapping and geomorph as the CDLOD module) morphing toward viewPos
	let snapped = terrainLodSnapped( v.nodeData, v.position.xz );
	let y0 = terrainHeightAt( snapped );
	let cv = terrainLodMorph( v.nodeData, v.position.xz, mat.viewPos, y0 );
	v.useWorld = true;
	v.worldPos = vec3f( cv.worldXZ.x, terrainHeightAt( cv.worldXZ ), cv.worldXZ.y );
	v.worldNormal = vec3f( 0.0, 1.0, 0.0 );
`;

		this.finalizeMaterial();

		this.mesh = new Mesh( this.lod.geometry, mat );
		this.mesh.frustumCulled = false;
		this.mesh.receiveShadow = true;
		this.mesh.castShadow = true;
		this.mesh.staticVelocity = true;
		this.mesh.name = 'Terrain';
		scene.add( this.mesh );

	}

	// (Re)build the fragment code. Called again once the shore system provides wetness.
	finalizeMaterial() {

		const mat = this.material;
		const modules = [ this.gpu.module, terrainShadingModule(), this.lod.module ];
		if ( this.wetness ) {

			modules.push( ...( this.wetness.modules || [] ) );
			modules.push( new ShaderModule( { name: 'terrainWetness', deps: [ this.gpu.module, ...( this.wetness.modules || [] ) ], code: this.wetness.code } ) );

		}

		modules.push( new ShaderModule( { name: 'terrainMaterial', deps: [ this.gpu.module, terrainShadingModule() ], code: TERRAIN_MATERIAL_WGSL } ) );
		mat.modules = modules;
		mat.defines.HAS_WETNESS = this.wetness ? 1 : 0;
		mat.defines.MATERIAL_SUN_MODULATION = this.sunShadow ? 1 : 0;
		mat.surface = TERRAIN_SURFACE;
		mat.needsUpdate = true;

	}

	update( camera ) {

		camera.getWorldPosition( this.uViewPos.value );
		this.lod.update( camera );
		// travelling gust field offset (integrated so speed/direction changes never jump)
		const wd = G.windDir.value;
		const speed = 0.7 * G.windSpeed.value + 1.5;
		const dt = G.dt.value;
		this.gustOffset.x += wd.x * speed * dt;
		this.gustOffset.y += wd.y * speed * dt;
		this.gpu.updateSunShadow( this.renderer );

	}

}

const S = srgb;

// module part: meadow weight shared between the surface and the key-light modulation, the gust
// field and the wetness fallback
const TERRAIN_MATERIAL_WGSL = /* wgsl */`
// meadow weight of the current fragment (written by the surface, read by the sun modulation)
var<private> terMeadowW: f32 = 0.0;

// tall grass shades itself when the sun is low (the meadow darkens and gains contrast)
fn materialSunModulation( P: vec3f, N: vec3f ) -> vec3f {
	let grass = mix( 1.0, smoothstep( -0.05, 0.45, frame.sunDir.y ) * 0.35 + 0.62, terMeadowW );
	return vec3f( terrainSunShadowAt( P ) * grass );
}

// Travelling gust field in [0, 1] (VegNodes gustAt): noise of (worldXZ - windDir * t * speed),
// where the time-integrated offset comes from mat.gustOffset. Two fetches of the detail texture's
// fbm channel (~35 m and ~15 m gust cells).
fn terGustAt( xz: vec2f, offset: vec2f ) -> f32 {
	let p = xz - offset;
	let n = textureSampleLevel( terrainDetailTex, smpLinearRepeat, p / 140.0, 0.0 ).w * 0.62
		+ textureSampleLevel( terrainDetailTex, smpLinearRepeat, p / 61.0 + 0.37, 0.0 ).w * 0.38;
	return smoothstep( 0.46, 0.6, n );
}

// ---- wetness (swash zone) from the shore system, else a static damp band
fn terWetFoam( xz: vec2f, h: f32 ) -> vec2f {
#if HAS_WETNESS
	return terrainWetness( xz, h );
#else
	return vec2f( smoothstep( 0.5, 0.0, h ), 0.0 );
#endif
}

fn terDetail( uv: vec2f ) -> vec4f {
	return textureSample( terrainDetailTex, smpAniso4Repeat, uv );
}
`;

const TERRAIN_SURFACE = /* wgsl */`
	let p = in.P;
	let xz = p.xz;
	let h = p.y;
	var outRough = 0.9;
	var outN = vec3f( 0.0, 1.0, 0.0 );
	var outAO = 1.0;
	var albedoOut = vec3f( 0.0 );

	// ---- data maps
	let nr = terrainNormalRock( xz );
	let N0 = normalize( vec3f( nr.x, sqrt( max( 1.0 - nr.x * nr.x - nr.y * nr.y, 0.0025 ) ), nr.y ) );
	let sp = terrainSplat( xz );
	let slope = 1.0 - N0.y;
	let camDist = length( frame.cameraPos - p );
	let dpx = dpdx( p ); let dpy = dpdy( p );
	let fwY = fwidth( h );

	// ---- deep seabed (seen through the water: no rock, land cover, swash or wind ripples),
	// the same colour / relief / AO as the full path below, from 6 detail samples instead of ~17
	// detail samples shared by both paths (sampled in uniform control flow: no derivative seams
	// where the paths meet)
	let macroA = terDetail( ${ rot2( 'xz', 0.7 ) } / 173.0 ).w;
	let macroB = terDetail( ${ rot2( 'xz', 2.1 ) } / 47.0 ).w;
	let mcr = macroA * 0.6 + macroB * 0.4;
	let dN = terDetail( xz / 1.9 );
	let dM = terDetail( ${ rot2( 'xz', 1.3 ) } / 6.7 + 0.21 );
	let dF = terDetail( ${ rot2( 'xz', 2.4 ) } / 0.63 + 0.53 );
	let grain = min( dN.z, 0.62 );
	let grainF = min( dF.z, 0.62 );
#if REFRACTION_CLIP
	// the refraction source (half resolution, seen blurred through the water): every non-rock
	// fragment under the water takes the cheap seabed path
	let seabedPath = h < 0.4 && nr.z < 0.05;
#else
	let seabedPath = h < -0.8 && nr.z < 0.05 && slope < 0.18;
#endif
	let sw = vec2f( ${ WORLD.swellDir.x }, ${ WORLD.swellDir.y } );
	let swDir = sw;
	let rc = vec2f( ${ WORLD.reef.center.x.toFixed( 3 ) }, ${ WORLD.reef.center.z.toFixed( 3 ) } );
	// ripple phases of both paths (identical there), differentiated in uniform control flow
	let ph2 = dot( xz, swDir ) * ( 6.2832 / 0.75 ) + dM.w * 16.0 + macroB * 24.0;
	let fade2 = 1.0 - smoothstep( 0.5, 2.0, fwidth( ph2 ) );
	let rip2 = pow( sin( ph2 ) * 0.5 + 0.5, 1.4 );
	let ph3 = dot( xz, swDir ) * ( 6.2832 / 0.16 ) + dM.w * 26.0 + dN.w * 5.0;
	let fade3 = 1.0 - smoothstep( 0.6, 2.2, fwidth( ph3 ) );
	let rip3 = pow( sin( ph3 ) * 0.5 + 0.5, 1.5 );
	// bump height of either path: the surface-gradient bump runs after the branch (its screen-space
	// derivatives would be undefined in quads that straddle the two paths)
	var hdOut = 0.0;
	if ( seabedPath ) {

		let underW = 1.0;
		let sandW = smoothstep( 0.3, 0.72, sp.x + ( dM.z - 0.5 ) * 0.5 + ( mcr - 0.5 ) * 0.35 );
		// ---- seabed: sand with ripple fields, seagrass meadows, rubble heads
		let depth = -h;
		let reefD = length( xz - rc );
		let reefW = 1.0 - smoothstep( ${ WORLD.reef.radius * 0.5 }, ${ WORLD.reef.radius * 1.15 }, reefD + ( mcr - 0.5 ) * 30.0 );
		var under = mix( ${ S( 0.84, 0.78, 0.64 ) }, ${ S( 0.72, 0.7, 0.58 ) }, smoothstep( 1.0, 9.0, depth ) );
		under = under * ( ( dM.w - 0.5 ) * 0.14 + 1.0 ) * ( ( grain - 0.45 ) * 0.25 + 1.0 );
		// megaripple fields (~0.75 m) across the swell, troughs collect darker shell hash; not in
		// the swash zone or the first metre of depth
		let fieldW = smoothstep( 0.42, 0.62, macroB + ( dM.w - 0.5 ) * 0.35 ) * smoothstep( 0.9, 2.0, depth ) * ( 1.0 - reefW );
		under = under * ( ( rip2 - 0.55 ) * 0.22 * fieldW * fade2 + 1.0 );
		// small wave ripples (~0.16 m) everywhere below the swash
		// seagrass meadows: ragged edges, blade streaks leaning with the wave surge, epiphyte tips
		// (the fringe breaks up into clumps: noise at three scales thresholds the soft splat edge)
		let clumps = ( dM.w - 0.5 ) * 0.5 + ( dN.y - 0.45 ) * 0.4 + ( macroB - 0.5 ) * 0.3;
		let seagrassW = smoothstep( 0.3, 0.55, sp.z + clumps ) * underW * smoothstep( 0.3, 0.9, depth );
		let swPerp = vec2f( -swDir.y, swDir.x );
		let blades = terDetail( vec2f( dot( xz, swDir ) / 2.6, dot( xz, swPerp ) / 0.35 ) ).y;
		var meadow = mix( ${ S( 0.12, 0.16, 0.07 ) }, ${ S( 0.27, 0.29, 0.15 ) }, smoothstep( 0.35, 0.75, blades ) );
		meadow = mix( meadow, ${ S( 0.24, 0.2, 0.11 ) }, smoothstep( 0.55, 0.8, dM.y + ( macroB - 0.5 ) * 0.4 ) * 0.5 );
		// sparse at the fringe: sand shows between the blades; thinner, paler patches inside
		meadow = mix( under, meadow, smoothstep( 0.3, 0.85, sp.z + clumps * 0.5 ) * 0.35 + 0.65 );
		meadow = mix( meadow, mix( meadow, under, 0.45 ), smoothstep( 0.58, 0.8, macroB + ( dM.w - 0.5 ) * 0.4 ) );
		under = mix( under, meadow, seagrassW );
		// rubble heads: coral rubble and rock turfed with algae, pink coralline crusts
		let rubbleW = smoothstep( 0.3, 0.6, sp.w + ( dN.x - 0.5 ) * 0.4 + ( dM.w - 0.5 ) * 0.3 ) * underW;
		var rubble = mix( ${ S( 0.2, 0.19, 0.15 ) }, ${ S( 0.36, 0.33, 0.26 ) }, smoothstep( 0.3, 0.7, dN.x ) );
		rubble = mix( rubble, ${ S( 0.2, 0.24, 0.1 ) }, smoothstep( 0.5, 0.7, dF.y ) * 0.6 );
		rubble = mix( rubble, ${ S( 0.58, 0.38, 0.44 ) }, smoothstep( 0.62, 0.74, dM.x ) * 0.6 );
		under = mix( under, rubble, rubbleW );
		// reef flat: coral rubble and pink crusts toward the reef
		under = mix( under, mix( ${ S( 0.56, 0.50, 0.44 ) }, ${ S( 0.60, 0.43, 0.46 ) }, smoothstep( 0.45, 0.7, dM.x ) ), reefW * 0.7 * smoothstep( 0.4, 0.6, dN.x ) );

		// damp sand below the berm (wet = 0 under water)
		let dampMottle = smoothstep( 0.3, 0.7, dM.w + ( dN.y - 0.45 ) * 0.6 + ( macroB - 0.5 ) * 0.4 );
		let wetK = smoothstep( 1.7, 0.5, h + dM.w * 0.3 ) * sandW * mix( 0.22, 0.5, dampMottle );
		let wetAlbedo = terrainSaturation( under * mat.wetDarken, 1.15 ) * vec3f( 0.97, 0.98, 1.0 );
		albedoOut = mix( under, wetAlbedo, wetK );
		outRough = 0.75;
		let waveR = rip3 * 0.012 * fade3 * smoothstep( -0.3, -0.9, h ) * ( 1.0 - seagrassW );
		let megaR = rip2 * 0.035 * fade2 * fieldW * ( 1.0 - seagrassW );
		let sandH = grain * 0.004 + grainF * 0.003 + waveR + megaR;
		let seabedH = seagrassW * ( blades * 0.05 + 0.08 ) + rubbleW * ( dN.x * 0.07 + dF.x * 0.015 );
		hdOut = sandH + seabedH;
		outAO = nr.w * ( 1.0 - seagrassW * 0.3 ) * ( 1.0 - rubbleW * smoothstep( 0.55, 0.2, dN.x ) * 0.35 );
		terMeadowW = 0.0;

	} else {

		// ---- detail samples (tileable heights: x rock, y soil, z sand, w fbm)
		// sand grain without the pebble peaks (pebbles are drawn separately where they belong)

		// ---- downslope streaks (rock flutes, hanging vegetation, landslide scars): the detail
		// texture stretched vertically on the two vertical projection planes
		let sw4 = pow( abs( N0.xz ), vec2f( 4.0 ) );
		let swN = sw4 / ( sw4.x + sw4.y + 1e-5 );
		// (everything they shape is weighted by the slope and vanishes at 0.28 or less: explicit
		// gradients in the branch, the same as the implicit ones of the full-screen quad)
		var streak = 0.5; var scar = 0.5;
		if ( slope > 0.28 ) {
			let stA = textureSampleGrad( terrainDetailTex, smpAniso4Repeat, vec2f( p.z / 9.3, h / 37.0 ), vec2f( dpx.z / 9.3, dpx.y / 37.0 ), vec2f( dpy.z / 9.3, dpy.y / 37.0 ) );
			let stB = textureSampleGrad( terrainDetailTex, smpAniso4Repeat, vec2f( p.x / 9.3 + 0.5, h / 37.0 + 0.3 ), vec2f( dpx.x / 9.3, dpx.y / 37.0 ), vec2f( dpy.x / 9.3, dpy.y / 37.0 ) );
			streak = stA.w * swN.x + stB.w * swN.y;
			scar = stA.y * swN.x + stB.y * swN.y;
		}

		// ---- rock: only evaluated where the rock mask or the slope allow it. Exposure follows the
		// form: steep faces, convex spurs and ridges (high AO) go bare, gully floors (low AO,
		// drainage lines) keep soil and plants; noise and fall-line streaks break the outline up.
		// Around the bare rock a band of scree / dark soil and moss; plants creep over it.
		let gully = sp.z * smoothstep( -0.5, 0.5, h );
		var rockAlbedo = vec3f( 0.2 ); var rockRough = 0.8; var rockHd = 0.0;
		var rockW = 0.0; var screeW = 0.0;
		let cliffK = smoothstep( 0.28, 0.55, slope );
		let convex = smoothstep( 0.5, 0.85, nr.w );
		// rv below, without the rock's own relief term, which adds at most 0.1925 (R.height <= 1): where
		// even that can't reach the scree band (0.28), rock and scree weigh 0 and the rock isn't shaded
		let rvBound = nr.z * 0.7 + smoothstep( 0.3, 0.62, slope ) * 0.5 + convex * 0.14 - gully * 0.4
			+ ( dM.w - 0.5 ) * 0.34 + ( dN.w - 0.5 ) * 0.22 + ( streak - 0.5 ) * 1.0 * cliffK + 0.2;
		if ( ( nr.z > 0.06 || slope > 0.3 ) && rvBound > 0.28 ) {

			var g: RockGrad;
			g.dpdx = dpx; g.dpdy = dpy; g.fwY = fwY; g.useGrad = true;
			let R = terrainRockSurface( p, N0, h, mcr, 0.5, 1.0, g );
			let rv = nr.z * 0.7 + smoothstep( 0.3, 0.62, slope ) * 0.5 + convex * 0.14 - gully * 0.4
				+ ( R.height - 0.45 ) * 0.35 + ( dM.w - 0.5 ) * 0.34 + ( dN.w - 0.5 ) * 0.22
				+ ( streak - 0.5 ) * 1.0 * cliffK;
			// fades to 0 at the branch boundary: no step along the slope / mask iso-lines
			let branchK = max( smoothstep( 0.06, 0.18, nr.z ), smoothstep( 0.3, 0.42, slope ) );
			rockW = smoothstep( 0.5, 0.68, rv ) * branchK;
			screeW = smoothstep( 0.28, 0.52, rv ) * branchK * ( 1.0 - rockW );
			// weathered basalt: darker and browner than the sea-cliff palette, streaked; moss and
			// ferns on the ledges and on the less steep parts of the faces
			// dark wet stains down the fall line, paler dry ribs between them
			let stain = smoothstep( 0.5, 0.7, streak ) * cliffK;
			// dark, weathered basalt (the island's inland rock is darker and browner than the pale
			// sea-cliff palette), stained down the fall line
			var basalt = R.albedo * vec3f( 0.36, 0.34, 0.31 ) * ( 1.0 - stain * 0.45 ) * ( smoothstep( 0.42, 0.25, streak ) * cliffK * 0.15 + 1.0 );
			// soil and humus caught in the joints and hollows of the rock (low relief), so the face
			// reads as fractured stone instead of a smooth plate
			let joints = smoothstep( 0.42, 0.22, R.height + ( dN.w - 0.5 ) * 0.25 );
			basalt = mix( basalt, mix( ${ S( 0.13, 0.1, 0.07 ) }, ${ S( 0.2, 0.2, 0.1 ) }, dF.y ), joints * 0.7 );
			// moss / small plants on every ledge and on the less steep parts, more near the edges
			let ledgeMoss = smoothstep( 0.4, 0.75, N0.y + ( dN.y - 0.45 ) * 0.6 ) * smoothstep( 0.25, 0.55, macroB + dM.y * 0.4 );
			let fringe = smoothstep( 0.5, 0.58, rv ) * smoothstep( 0.8, 0.6, rv ) * smoothstep( 0.3, 0.6, dM.w + dN.y * 0.4 );
			let mossK = sat( max( ledgeMoss * 0.75, fringe * 0.8 ) + R.moss * 0.3 + joints * 0.25 );
			rockAlbedo = mix( basalt, mix( ${ S( 0.12, 0.17, 0.05 ) }, ${ S( 0.22, 0.26, 0.09 ) }, dF.y ), mossK );
			rockRough = R.rough;
			// craggier than the boulders: the big blocks and plates stand out from afar
			rockHd = R.hd * 2.2 + R.height * 0.6;

		}

		// ---- weights
		let notRock = 1.0 - rockW;
		let underW = smoothstep( 0.12, -0.6, h );
		let landW = 1.0 - underW;
		let sandW = smoothstep( 0.3, 0.72, sp.x + ( dM.z - 0.5 ) * 0.5 + ( mcr - 0.5 ) * 0.35 ) * notRock;
		let pathW = smoothstep( 0.28, 0.62, sp.y + ( dN.y - 0.45 ) * 0.4 + ( dM.w - 0.5 ) * 0.25 ) * notRock * landW
			* ( 1.0 - smoothstep( 50.0, 220.0, camDist ) * 0.85 );
		// forest on the higher / steeper ground and in the gullies, tall-grass meadow on the valley
		// floor and around the village (same classification as the vegetation's land cover)
		let jungleW = sat( smoothstep( 9.0, 24.0, h + ( mcr - 0.5 ) * 18.0 ) + smoothstep( 0.18, 0.36, slope ) + gully * 0.6 );
		// landslide scars: raw red-brown laterite in streaks down steep slopes, rare
		let lateriteW = smoothstep( 0.62, 0.74, scar + ( macroB - 0.5 ) * 0.3 ) * smoothstep( 0.3, 0.42, slope )
			* smoothstep( 0.52, 0.66, mcr ) * notRock * 0.85;

		// ---- beach sand: pale coral sand, drifts of warmer / coarser sand, grain
		let dryK = smoothstep( 0.8, 3.0, h );
		var sand = mix( ${ S( 0.83, 0.75, 0.6 ) }, ${ S( 0.9, 0.84, 0.72 ) }, smoothstep( 0.3, 0.72, mcr + dryK * 0.2 ) );
		sand = mix( sand, ${ S( 0.84, 0.72, 0.55 ) }, smoothstep( 0.55, 0.8, dM.w + ( macroB - 0.5 ) * 0.6 ) * 0.45 );
		sand = sand * ( ( dM.w - 0.5 ) * 0.16 + 1.0 ) * ( ( dN.w - 0.5 ) * 0.1 + 1.0 );
		sand = sand * ( ( grain - 0.45 ) * 0.3 + 0.97 ) * ( ( grainF - 0.45 ) * 0.2 + 1.0 );
		// disturbed / trodden patches: slightly darker, coarser sand (footfall, crabs, wind scour)
		let trod = smoothstep( 0.52, 0.7, dN.y + ( dM.y - 0.5 ) * 0.6 ) * dryK;
		sand = sand * ( 1.0 - trod * 0.07 );
		// the high-water band collects shell grit, coral bits and dried seaweed
		let hw = h + ( dM.w - 0.5 ) * 0.5;
		let wrackBand = smoothstep( 1.15, 1.4, hw ) * smoothstep( 2.1, 1.7, hw );
		let pebDensity = smoothstep( 0.62, 0.85, macroB + dM.w * 0.3 ) * 0.2 + wrackBand * smoothstep( 0.3, 0.6, dM.y );
		let pebW = smoothstep( 0.66, 0.8, dN.z ) * sat( pebDensity ) * smoothstep( 0.6, 0.9, sp.x ) * landW
			* ( 1.0 - smoothstep( 12.0, 35.0, camDist ) );
		let pebCol = mix( mix( ${ S( 0.86, 0.82, 0.74 ) }, ${ S( 0.78, 0.64, 0.6 ) }, smoothstep( 0.45, 0.75, dM.x ) ), ${ S( 0.36, 0.33, 0.3 ) }, smoothstep( 0.74, 0.82, dM.y ) );
		sand = mix( sand, pebCol, pebW * 0.75 );
		let wrack = wrackBand * smoothstep( 0.58, 0.72, dN.y ) * smoothstep( 0.4, 0.6, macroB );
		sand = mix( sand, ${ S( 0.24, 0.18, 0.11 ) }, wrack * 0.8 );
		// trampled sand along the paths
		sand = sand * ( 1.0 - pathW * 0.07 );

		// wind ripples on the dry sand: crests across the wind (bent by the fbm), wavelength
		// ~10.5 cm, fading where trodden; visible in the albedo too (finer sand on the crests).
		// (A wavelength varying in space must not divide the absolute coordinate: the phase then
		// swings by x * dλ / λ², which at 100 m from the origin turned the ripples into patches
		// of random direction and spacing with seams and moiré, and made fwidth switch them off
		// in blotches. The spacing varies through the smooth warp instead.)
		let wd = frame.windDir;
		let ph1 = dot( xz, wd ) * ( 6.2832 / 0.105 ) + dM.w * 24.0 + dN.w * 7.0 + macroB * 30.0;
		let fade1 = 1.0 - smoothstep( 0.6, 2.2, fwidth( ph1 ) );
		let rip1 = pow( sin( ph1 ) * 0.5 + 0.5, 1.6 );
		let windK = fade1 * smoothstep( 1.5, 2.2, h ) * ( 1.0 - pathW ) * ( 1.0 - trod * 0.7 )
			* smoothstep( 0.2, 0.5, macroB + dM.w * 0.3 );
		sand = sand * ( ( rip1 - 0.5 ) * 0.12 * windK + 1.0 );

		// ---- seabed: sand with ripple fields, seagrass meadows, rubble heads (only below the berm:
		// everything here is weighted by underW, 0 on land)
		let depth = -h;
		var fieldW = 0.0; var seagrassW = 0.0; var blades = 0.0; var rubbleW = 0.0;
		var under = sand;
		if ( underW > 0.0 ) {
			let reefD = length( xz - rc );
			let reefW = 1.0 - smoothstep( ${ WORLD.reef.radius * 0.5 }, ${ WORLD.reef.radius * 1.15 }, reefD + ( mcr - 0.5 ) * 30.0 );
			under = mix( ${ S( 0.84, 0.78, 0.64 ) }, ${ S( 0.72, 0.7, 0.58 ) }, smoothstep( 1.0, 9.0, depth ) );
			under = under * ( ( dM.w - 0.5 ) * 0.14 + 1.0 ) * ( ( grain - 0.45 ) * 0.25 + 1.0 );
			// megaripple fields (~0.75 m) across the swell, troughs collect darker shell hash; not in
			// the swash zone or the first metre of depth
			fieldW = smoothstep( 0.42, 0.62, macroB + ( dM.w - 0.5 ) * 0.35 ) * smoothstep( 0.9, 2.0, depth ) * ( 1.0 - reefW );
			under = under * ( ( rip2 - 0.55 ) * 0.22 * fieldW * fade2 + 1.0 );
			// small wave ripples (~0.16 m) everywhere below the swash
			// seagrass meadows: ragged edges, blade streaks leaning with the wave surge, epiphyte tips
			// (the fringe breaks up into clumps: noise at three scales thresholds the soft splat edge)
			let clumps = ( dM.w - 0.5 ) * 0.5 + ( dN.y - 0.45 ) * 0.4 + ( macroB - 0.5 ) * 0.3;
			seagrassW = smoothstep( 0.3, 0.55, sp.z + clumps ) * underW * smoothstep( 0.3, 0.9, depth );
			let swPerp = vec2f( -swDir.y, swDir.x );
			blades = terDetail( vec2f( dot( xz, swDir ) / 2.6, dot( xz, swPerp ) / 0.35 ) ).y;
			var meadow = mix( ${ S( 0.12, 0.16, 0.07 ) }, ${ S( 0.27, 0.29, 0.15 ) }, smoothstep( 0.35, 0.75, blades ) );
			meadow = mix( meadow, ${ S( 0.24, 0.2, 0.11 ) }, smoothstep( 0.55, 0.8, dM.y + ( macroB - 0.5 ) * 0.4 ) * 0.5 );
			// sparse at the fringe: sand shows between the blades; thinner, paler patches inside
			meadow = mix( under, meadow, smoothstep( 0.3, 0.85, sp.z + clumps * 0.5 ) * 0.35 + 0.65 );
			meadow = mix( meadow, mix( meadow, under, 0.45 ), smoothstep( 0.58, 0.8, macroB + ( dM.w - 0.5 ) * 0.4 ) );
			under = mix( under, meadow, seagrassW );
			// rubble heads: coral rubble and rock turfed with algae, pink coralline crusts
			rubbleW = smoothstep( 0.3, 0.6, sp.w + ( dN.x - 0.5 ) * 0.4 + ( dM.w - 0.5 ) * 0.3 ) * underW;
			var rubble = mix( ${ S( 0.2, 0.19, 0.15 ) }, ${ S( 0.36, 0.33, 0.26 ) }, smoothstep( 0.3, 0.7, dN.x ) );
			rubble = mix( rubble, ${ S( 0.2, 0.24, 0.1 ) }, smoothstep( 0.5, 0.7, dF.y ) * 0.6 );
			rubble = mix( rubble, ${ S( 0.58, 0.38, 0.44 ) }, smoothstep( 0.62, 0.74, dM.x ) * 0.6 );
			under = mix( under, rubble, rubbleW );
			// reef flat: coral rubble and pink crusts toward the reef
			under = mix( under, mix( ${ S( 0.56, 0.50, 0.44 ) }, ${ S( 0.60, 0.43, 0.46 ) }, smoothstep( 0.45, 0.7, dM.x ) ), reefW * 0.7 * smoothstep( 0.4, 0.6, dN.x ) );
		}
		sand = mix( sand, under, underW );

		// ---- ground: tall-grass meadow (tone shared with the grass field), forest floor and, from
		// afar, the forest canopy; laterite scars
		let V = normalize( frame.cameraPos - p );
		let NdV = sat( dot( N0, V ) );
		let mt = terrainMeadowTone( macroA, macroB, slope, N0.z, dM.w * 0.65 + dN.w * 0.35, true );
		// clumps (1-3 m) and tussocks, blade-scale grain
		let clump = dM.w * 0.6 + dN.y * 0.4;
		// seen from afar the tussocks and their shadowed gaps are what makes tall grass read as
		// grass (not lawn): the clump contrast grows with distance as the blades fade out
		let clumpK = mix( 0.34, 0.95, smoothstep( 40.0, 140.0, camDist ) );
		var lawn = mt.tone * ( ( clump - 0.5 ) * clumpK + 1.0 ) * ( ( dF.y - 0.4 ) * 0.22 + 1.0 );
		lawn = lawn * mix( 1.0, smoothstep( 0.25, 0.55, dN.y * 0.5 + dM.y * 0.5 ) * 0.35 + 0.72, smoothstep( 50.0, 160.0, camDist ) );
		// grass combed along the wind: long streaks (anisotropic sample of the fbm channel)
		// (comb and gust only where the lawn shows: not under full forest, sand or water)
		let lawnShows = jungleW < 1.0 && landW > 0.0 && sandW < 1.0;
		var comb = 0.5;
		if ( lawnShows ) {
			let combUV = vec2f( dot( xz, frame.windDir ) / 7.5, dot( xz, vec2f( -frame.windDir.y, frame.windDir.x ) ) / 0.9 );
			comb = terDetail( combUV + vec2f( 0.31, 0.77 ) ).w;
			lawn = lawn * ( ( comb - 0.5 ) * 0.3 + 1.0 );
		}
		// seen from above the dark soil shows between the clumps; at grazing angles blade sides
		// cover everything (lighter, more saturated)
		let gapK = smoothstep( 0.3, 0.95, NdV ) * smoothstep( 0.62, 0.3, clump );
		lawn = mix( lawn, MEADOW_soil, gapK * 0.45 );
		lawn = mix( lawn, terrainSaturation( lawn * 1.12, 1.15 ), smoothstep( 0.45, 0.1, NdV ) * 0.6 );
		// travelling gusts flatten the grass: the paler blade backs show as waves (same gust
		// field as the grass blades)
		let windStrength = max( frame.windSpeed * 0.1, 0.03 );
		if ( lawnShows ) {
			let gust = terGustAt( xz, mat.gustOffset ) * sat( windStrength * 0.5 );
			lawn = mix( lawn, lawn * vec3f( 1.25, 1.22, 1.06 ) + 0.01, gust * 0.6 );
		}
		// bare trodden soil in places, sandy soil toward the beach
		lawn = mix( lawn, ${ S( 0.4, 0.33, 0.23 ) }, smoothstep( 0.72, 0.84, dN.y + ( dM.y - 0.5 ) * 0.5 ) * 0.25 );
		lawn = mix( lawn, ${ S( 0.60, 0.52, 0.38 ) }, sat( sp.x * 1.6 ) * smoothstep( 0.45, 0.62, dN.z + dM.y * 0.3 ) * 0.7 );
		// inside the geometric grass field (GrassField) the ground is only seen between the blades:
		// the shaded base of the sward, dark and brownish with dead leaves; it hands over to the
		// sward's own look (above) where the blades thin out
		let grassHere = smoothstep( 2.5, 4.5, h ) * ( 1.0 - smoothstep( 0.45, 0.85, jungleW ) ) * ( 1.0 - sat( sp.x * 1.6 ) );
		let fieldK = ( 1.0 - smoothstep( ${ GRASS_FADE[ 0 ].toFixed( 1 ) }, ${ GRASS_FADE[ 1 ].toFixed( 1 ) }, length( p.xz - frame.cameraPos.xz ) ) ) * grassHere;
		let swardBase = mix( mt.tone * 0.4, MEADOW_soil, 0.4 ) * ( ( dN.y - 0.45 ) * 0.6 + 1.0 ) * ( ( dF.y - 0.4 ) * 0.3 + 1.0 );
		lawn = mix( lawn, swardBase, fieldK * 0.85 );
		let litter = mix( ${ S( 0.2, 0.15, 0.09 ) }, ${ S( 0.34, 0.25, 0.13 ) }, dF.y );
		var jungle = mix( ${ S( 0.1, 0.16, 0.05 ) }, litter, smoothstep( 0.52, 0.7, dN.y ) );
		jungle = mix( jungle, ${ S( 0.12, 0.1, 0.06 ) }, gully * 0.3 );
		let far = smoothstep( 40.0, 160.0, camDist );
		var cover = mix( ${ S( 0.08, 0.13, 0.04 ) }, ${ S( 0.17, 0.24, 0.07 ) }, smoothstep( 0.3, 0.7, mcr ) );
		cover = mix( cover, ${ S( 0.27, 0.29, 0.12 ) }, smoothstep( 0.66, 0.84, macroB + dM.w * 0.2 ) * 0.45 );
		jungle = mix( jungle, cover, far * 0.8 );
		jungle = jungle * ( ( mcr - 0.5 ) * 0.3 + 1.0 );
		// canopy: seen from a distance (or on slopes too steep for the trees) the forest reads as
		// a carpet of lumpy crowns with dark gaps
		let canopyW = jungleW * max( smoothstep( 0.2, 0.4, slope ), smoothstep( 90.0, 260.0, camDist ) ) * smoothstep( 25.0, 70.0, camDist ) * notRock * ( 1.0 - screeW * 0.7 );
		var canopyH = 0.0;
		if ( canopyW > 0.0 ) {
			let crowns = terDetail( ${ rot2( 'xz', 0.9 ) } / 61.0 ).w;
			let crownsB = terDetail( ${ rot2( 'xz', 2.3 ) } / 13.0 + 0.37 ).w;
			canopyH = smoothstep( 0.32, 0.7, crowns * 0.45 + crownsB * 0.4 + dM.w * 0.15 );
			var canopy = mix( ${ S( 0.05, 0.08, 0.025 ) }, mix( ${ S( 0.14, 0.21, 0.06 ) }, ${ S( 0.22, 0.27, 0.09 ) }, macroB ), canopyH );
			// steep faces: the canopy hangs in streaks down the fall line
			canopy = canopy * ( ( streak - 0.5 ) * 0.5 * smoothstep( 0.3, 0.5, slope ) + 1.0 );
			jungle = mix( jungle, canopy, canopyW );
		}
		var ground = mix( lawn, jungle, jungleW );
		// around the bare rock: dark humus, stones and moss, with the surrounding plants creeping
		// in (a soft, noisy band; no speckle)
		let creepIn = smoothstep( 0.4, 0.75, dM.w + ( dN.y - 0.45 ) * 0.5 + ( macroB - 0.5 ) * 0.3 );
		var scree = mix( ${ S( 0.16, 0.13, 0.1 ) }, ${ S( 0.27, 0.24, 0.2 ) }, smoothstep( 0.45, 0.75, dM.x + ( dN.x - 0.5 ) * 0.3 ) );
		scree = mix( scree, mix( ${ S( 0.13, 0.18, 0.06 ) }, ${ S( 0.22, 0.26, 0.09 ) }, dF.y ), smoothstep( 0.45, 0.7, dM.y + ( dN.y - 0.45 ) * 0.5 ) * 0.7 );
		ground = mix( ground, scree, screeW * ( 1.0 - creepIn * 0.7 ) );
		let laterite = mix( ${ S( 0.42, 0.25, 0.16 ) }, ${ S( 0.52, 0.36, 0.24 ) }, dM.w ) * ( ( dN.y - 0.4 ) * 0.3 + 1.0 );
		ground = mix( ground, laterite, lateriteW );

		// ---- worn dirt paths / trampled ground (darker, redder soil in the forest)
		var dirt = mix( ${ S( 0.38, 0.31, 0.23 ) }, ${ S( 0.5, 0.43, 0.32 ) }, dM.w ) * ( ( dN.y - 0.4 ) * 0.35 + 0.95 );
		dirt = mix( dirt, ${ S( 0.3, 0.22, 0.15 ) }, jungleW * 0.7 );
		dirt = mix( dirt, ${ S( 0.56, 0.53, 0.48 ) }, smoothstep( 0.72, 0.82, dN.z ) * 0.5 );
		// grass creeping onto the trail, a grassy strip between the two worn ruts
		let creep = smoothstep( 0.45, 0.7, dN.y + ( dF.y - 0.45 ) * 0.5 ) * smoothstep( 0.9, 0.5, sp.y );
		dirt = mix( dirt, lawn, creep * 0.8 );

		// ---- combine
		let meadowW = ( 1.0 - jungleW ) * ( 1.0 - pathW ) * notRock * ( 1.0 - sandW ) * landW * ( 1.0 - screeW );
		terMeadowW = meadowW;
		var albedo = mix( ground, dirt, pathW );
		albedo = mix( albedo, sand, max( sandW, underW * notRock ) );
		albedo = mix( albedo, rockAlbedo, rockW );

		// ---- eroded beach scarp (splat alpha on land): storm-cut face of the foredune. Layered
		// sandy soil (laminae of paler and darker sand, darker humus-stained patches), live roots
		// and pale dead-root tangles hanging out of the face, damp darker sand at the toe.
		let scarpW = sat( sp.w * 1.6 ) * landW * notRock;
		var scarpH = 0.0;
		if ( scarpW > 0.003 ) {

			// laminae: thin storm layers, warped and wedging out, with a set of cross-beds at a low angle
			let tanF = normalize( vec2f( -N0.z, N0.x ) + vec2f( 1e-4, 0.0 ) );
			let alongF = dot( xz, tanF );
			let hw = h + ( dM.w - 0.5 ) * 0.5 + ( dN.w - 0.5 ) * 0.12 + ( macroB - 0.5 ) * 0.35;
			let lam = sin( hw * ( 6.2832 / 0.11 ) + dN.x * 2.0 ) * 0.5 + 0.5;
			let cross = sin( ( hw + alongF * 0.09 ) * ( 6.2832 / 0.075 ) ) * 0.5 + 0.5;
			let lamB = smoothstep( 0.3, 0.7, sin( ( hw + dM.y * 0.4 ) * ( 6.2832 / 0.43 ) ) * 0.5 + 0.5 );
			let layerMix = mix( lam, cross, smoothstep( 0.4, 0.6, dM.x ) );
			var soil = mix( ${ S( 0.5, 0.42, 0.31 ) }, ${ S( 0.68, 0.6, 0.46 ) }, smoothstep( 0.3, 0.8, layerMix ) * 0.45 + lamB * 0.2 + ( grain - 0.45 ) * 0.5 + ( dM.w - 0.5 ) * 0.3 );
			// humus-stained, rootier soil in patches (the old dune surface caught in the cut)
			soil = mix( soil, ${ S( 0.26, 0.2, 0.14 ) }, smoothstep( 0.55, 0.8, dM.y + ( macroB - 0.5 ) * 0.5 ) * 0.55 );
			// roots: horizontal coordinate along the face, stretched down the fall line
			let ru = terDetail( vec2f( dot( xz, tanF ) / 0.8, h / 0.5 ) + vec2f( 0.37, 0.11 ) );
			let rv = terDetail( vec2f( dot( xz, tanF ) / 1.7 + h * 0.6, h / 0.9 ) + vec2f( 0.71, 0.29 ) );
			let rootLive = smoothstep( 0.035, 0.0, abs( ru.x - 0.5 ) ) * smoothstep( 0.45, 0.62, ru.w );
			let rootDead = smoothstep( 0.03, 0.0, abs( rv.z - 0.52 ) ) * smoothstep( 0.5, 0.66, rv.y );
			soil = mix( soil, ${ S( 0.17, 0.12, 0.08 ) }, rootLive * 0.85 );
			soil = mix( soil, ${ S( 0.8, 0.75, 0.66 ) }, rootDead * 0.75 );
			// damp, darker sand toward the toe and in seepage streaks
			let seep = smoothstep( 0.6, 0.8, terDetail( vec2f( dot( xz, tanF ) / 2.3, h / 6.0 ) ).w ) * 0.35;
			soil = soil * ( 1.0 - seep - smoothstep( 0.5, 1.0, sp.w ) * 0.08 );
			// under the lip: the dark, rooty topsoil the grass grows in, overhanging the cut
			let lip = smoothstep( 0.86, 0.97, sp.w + ( dN.y - 0.45 ) * 0.1 );
			soil = mix( soil, ${ S( 0.2, 0.15, 0.1 ) } * ( dN.x * 0.4 + 0.8 ), lip * 0.85 );
			// foot of the face: undercut by the swash of storm waves, in its own shadow
			soil *= 1.0 - ( 1.0 - smoothstep( 0.6, 0.78, sp.w ) ) * smoothstep( 0.35, 0.55, sp.w ) * 0.25;
			// slumped sand and fallen chunks at the toe: damp beach sand rather than soil
			soil = mix( ${ S( 0.63, 0.56, 0.44 ) } * ( grain * 0.3 + 0.85 ), soil, smoothstep( 0.35, 0.75, sp.w ) );
			albedo = mix( albedo, soil, scarpW );
			scarpH = ( lip * 0.03 + layerMix * 0.012 + lamB * 0.018 + rootLive * 0.012 + rootDead * 0.009 + dN.x * 0.025 );

		}

		// ---- wetness (swash zone) from the shore system, else a static damp band
		let wetFoam = terWetFoam( xz, h );
		let wet = sat( wetFoam.x ) * ( 1.0 - jungleW * 0.8 ) * landW;
		// damp sand below the berm: darker in mottled, drying patches even when the swash has not
		// reached it lately
		let dampMottle = smoothstep( 0.3, 0.7, dM.w + ( dN.y - 0.45 ) * 0.6 + ( macroB - 0.5 ) * 0.4 );
		let damp = smoothstep( 1.7, 0.5, h + dM.w * 0.3 ) * sandW * mix( 0.22, 0.5, dampMottle );
		// sand dries in mottled patches; backwash leaves faint rills down the slope
		let mottle = smoothstep( 0.25, 0.75, dM.w + ( dN.y - 0.45 ) * 0.5 );
		let dryEdge = smoothstep( 0.0, 0.6, wet ) * smoothstep( 1.0, 0.6, wet );
		let wetK = max( wet, damp ) * ( 1.0 - dryEdge * mottle * 0.6 ) * notRock;
		let slopeDir = normalize( N0.xz + vec2f( 1e-4, 0.0 ) );
		let rillK = smoothstep( 0.2, 0.9, wet ) * smoothstep( 0.05, 0.6, h ) * sandW;
		var rill = 0.5;
		if ( rillK > 0.0 ) { rill = terDetail( vec2f( dot( xz, slopeDir ) / 3.2, dot( xz, vec2f( -slopeDir.y, slopeDir.x ) ) / 0.3 ) ).w; }
		let wetAlbedo = terrainSaturation( albedo * mat.wetDarken, 1.15 ) * vec3f( 0.97, 0.98, 1.0 ) * ( ( rill - 0.5 ) * 0.25 * rillK + 1.0 );
		albedo = mix( albedo, wetAlbedo, wetK );
		// swash marks: thin wavy lines of grit left at the limits of earlier uprushes
		let sl = ( h + dM.w * 0.18 + dN.w * 0.05 ) / 0.13;
		let slD = abs( fract( sl ) - 0.5 );
		let slW = fwidth( sl ) + 1e-4;
		let swashLine = smoothstep( slW * 1.5 + 0.04, 0.0, slD ) * smoothstep( 0.2, 0.4, h ) * smoothstep( 1.6, 1.2, h )
			* smoothstep( 0.45, 0.65, dM.y + ( macroB - 0.5 ) * 0.4 ) * sandW * ( 1.0 - smoothstep( 0.8, 2.0, slW * 10.0 ) );
		albedo = mix( albedo * ( 1.0 - swashLine * 0.3 ), ${ S( 0.9, 0.88, 0.84 ) }, swashLine * smoothstep( 0.6, 0.75, dF.z ) * 0.5 );
		// foam residue: lacy patterns stranded on the sand
		var residue = sat( wetFoam.y ) * landW * notRock;
		if ( residue > 0.0 ) { residue *= smoothstep( 0.42, 0.18, terDetail( ${ rot2( 'xz', 0.4 ) } / 0.9 ).x ) * 0.7 + 0.3; }
		albedo = mix( albedo, ${ S( 0.88, 0.9, 0.9 ) }, residue );

		// ---- roughness
		var rough = mix( 0.88, 0.93, sandW );
		rough = mix( rough, 0.9, pathW );
		rough = mix( rough, rockRough, rockW );
		// wet sand has a film of water: glossy while fresh, satin as it drains
		rough = mix( rough, mix( 0.42, 0.16, wet ), wetK );
		rough = mix( rough, 0.7, residue );
		rough = mix( rough, 0.75, underW );
		rough = mix( rough, 0.94, scarpW );
		outRough = rough;

		// ---- micro relief for the normal
		let windR = rip1 * 0.005 * windK;
		let waveR = rip3 * 0.012 * fade3 * smoothstep( -0.3, -0.9, h ) * ( 1.0 - seagrassW );
		let megaR = rip2 * 0.035 * fade2 * fieldW * ( 1.0 - seagrassW );
		let sandH = ( grain * 0.004 + grainF * 0.003 + pebW * 0.004 + windR + waveR + megaR ) * ( 1.0 - wet * 0.6 )
			+ rill * 0.006 * rillK;
		// seagrass canopy stands proud of the sand with a ragged scarp; rubble is knobbly
		let seabedH = seagrassW * ( blades * 0.05 + 0.08 ) + rubbleW * ( dN.x * 0.07 + dF.x * 0.015 );
		let groundH = dN.y * mix( 0.05, 0.035, jungleW ) + dF.y * 0.012 + dM.y * 0.045 + canopyH * canopyW * 2.5
			+ clump * 0.12 * ( 1.0 - jungleW ) + comb * 0.03 * ( 1.0 - jungleW );
		let screeH = dN.z * 0.04 + dM.x * 0.06;
		let dirtH = dN.z * 0.012 + dN.y * 0.01;
		var hd = mix( mix( groundH, screeH, screeW ), dirtH, pathW );
		hd = mix( hd, sandH + seabedH, max( sandW, underW * notRock ) );
		hd = mix( hd, rockHd, rockW );
		hd = mix( hd, scarpH, scarpW );
		hdOut = hd;

		// ---- ambient occlusion: baked horizon + cavity, plus litter / crevices / seagrass canopy
		let aoDetail = mix( 1.0, dN.y * 0.5 + 0.7, jungleW * ( 1.0 - sandW ) * notRock * landW )
			* mix( 1.0, smoothstep( 0.2, 0.7, clump ) * 0.35 + 0.65, meadowW );
		outAO = nr.w * aoDetail * ( 1.0 - seagrassW * 0.3 ) * ( 1.0 - rubbleW * smoothstep( 0.55, 0.2, dN.x ) * 0.35 )
			* mix( 1.0, smoothstep( 0.15, 0.6, canopyH ) * 0.6 + 0.4, canopyW );

		albedoOut = albedo;

	}

	outN = terrainPerturbNormal( p, N0, hdOut, 1.0 );

	s.albedo = albedoOut;
	s.roughness = outRough;
	s.normal = outN;
	s.ao = sat( outAO );
`;
