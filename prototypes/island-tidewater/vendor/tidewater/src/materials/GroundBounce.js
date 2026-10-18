import { Vector3, Color, SRGBColorSpace } from '../engine/math/index.js';
import { Texture } from '../engine/gpu/Texture.js';
import { ShaderModule, UniformBlock } from '../engine/gpu/Shader.js';
import { ComputeKernel } from '../engine/gpu/Compute.js';
import { commonModule } from '../engine/render/wgsl/common.js';
import { G } from '../engine/render/Frame.js';
import { SceneLighting } from './SceneLighting.js';

// Sunlight bounced off the ground (one diffuse bounce, the dominant indirect light on a sunny beach):
// sunlit coral sand lights the underside of the pier, the eaves, the boat hull, palm trunks and the
// undersides of rocks and fronds.
//
// Bake (compute, only when the key light moves): a 512^2 map over the terrain domain (4 m texels,
// aligned with the terrain sun shadow map) of the light the ground reflects per unit of sun
// irradiance: albedo (sand / grass / forest / rock from the terrain masks, the sea as the seabed seen
// through the water column) x cos(sun, ground normal) x heightfield sun shadow, minus what the
// environment map's own ground (the atmosphere's dark planet surface) already gives, then blurred
// (binomial 5x5, ~4 m). Alpha: height of the bouncing surface (ground or sea level).
//
// Shading: irradiance = sun colour x cloud shadow x map(xz) x lower-hemisphere view factor of the
// normal ((1 - N.y) / 2) x fade with height above the bouncing surface, added to the indirect
// diffuse light (so the diffuse albedo, the material AO and the underwater tint all apply). One
// bilinear lookup via texel loads (no sampler) and only for normals that face down or sideways.
//
// Installed as the `bounce` lighting hook (fn hookBounce( P, N ) -> vec3f, irradiance / PI). Skipped for
// IS_WATER materials and materials with the define NO_GROUND_BOUNCE (the former
// `material.groundBounce = false`: GroundBounce.exclude( material )).
const N = 512;
// objects around the receiver shade part of the ground it sees (their shadows are not in the map)
const SURROUND = 0.6;
// the environment map's lower hemisphere: the atmosphere's planet ground (Atmosphere.groundAlbedo)
const ENV_GROUND = 0.08;

const params = new UniformBlock( 'GroundBounceParams', {
	sun: [ 'vec3f', new Vector3( 0, 1, 0 ) ],
	strength: [ 'f32', 1 ],
	ready: [ 'f32', 0 ],
}, { label: 'groundBounce' } );

export const GroundBounce = {
	strength: params.fields.strength,
	module: null,
	exclude( m ) {

		if ( m && m.setDefine ) m.setDefine( 'NO_GROUND_BOUNCE', 1 );

	},
};

const lin = ( r, g, b ) => {

	const c = new Color().setRGB( r, g, b, SRGBColorSpace );
	return `vec3f( ${ c.r.toFixed( 6 ) }, ${ c.g.toFixed( 6 ) }, ${ c.b.toFixed( 6 ) } )`;

};

// terrain: the TerrainGPU (its module: terrainHeightAt, terrainNormalRockLevel, terrainSplatLevel,
// terrainSunShadowAt); clouds: optional Clouds (its module: cloudsShadow)
export function installGroundBounce( { terrain, clouds = null } ) {

	const make = ( name ) => new Texture( { label: name, width: N, height: N, format: 'rgba16float', usage: [ 'sample', 'storage' ] } );
	const raw = make( 'groundBounceRaw' );
	const map = make( 'groundBounce' );
	const uSun = params.fields.sun;
	const uReady = params.fields.ready;

	const bakeRaw = new ComputeKernel( {
		label: 'Ground Bounce Bake',
		modules: [ commonModule, terrain.module ],
		bindings: { groundBounceParams: { uniform: params }, gbRawOut: { storageTexture: raw, access: 'write' } },
		workgroupSize: [ 8, 8, 1 ],
		code: /* wgsl */`
@compute @workgroup_size( WG_X, WG_Y, WG_Z )
fn main( @builtin( global_invocation_id ) gid: vec3u ) {
	let ij = vec2f( gid.xy );
	let xz = ( ij + 0.5 ) / ${ N }.0 * terrainParams.size + terrainParams.origin;
	let h = terrainHeightAt( xz );
	let nr = terrainNormalRockLevel( xz, 1.0 );
	let n = vec3f( nr.x, sqrt( sat( 1.0 - dot( nr.xy, nr.xy ) ) ), nr.y );
	let slope = 1.0 - n.y;
	let sp = terrainSplatLevel( xz, 1.0 );
	let L = groundBounceParams.sun;
	// land cover (same masks as the terrain material, coarsely)
	let rockW = sat( smoothstep( 0.35, 0.6, nr.z * 0.7 + smoothstep( 0.3, 0.62, slope ) * 0.5 ) );
	let sandW = smoothstep( 0.3, 0.72, sp.x ) * ( 1.0 - rockW );
	let jungleW = sat( smoothstep( 9.0, 24.0, h ) + smoothstep( 0.18, 0.36, slope ) );
	let veg = mix( ${ lin( 0.3, 0.36, 0.16 ) }, ${ lin( 0.12, 0.17, 0.07 ) }, jungleW );
	// dry coral sand, darker where damp near the water line
	let sand = ${ lin( 0.86, 0.79, 0.66 ) } * mix( 0.6, 1.0, smoothstep( 0.2, 1.2, h ) );
	let land = mix( mix( veg, sand, sandW ), vec3f( 0.08, 0.075, 0.065 ), rockW );
	// sea: the seabed (sand in the bay) seen through the water column, down and back up
	let depth = max( frame.seaLevel - h, 0.0 );
	let seabed = mix( ${ lin( 0.62, 0.58, 0.48 ) }, ${ lin( 0.25, 0.3, 0.22 ) }, smoothstep( 0.3, 0.7, sp.y ) );
	let sea = seabed * exp( ( frame.waterAbsorption + frame.waterScattering ) * depth * -2.4 ) * 0.9 + vec3f( 0.01, 0.025, 0.03 );
	let wet = smoothstep( 0.05, -0.1, h - frame.seaLevel );
	let albedo = mix( land, sea, wet );
	let nSurf = mix( n, vec3f( 0.0, 1.0, 0.0 ), wet );
	// heightfield sun shadow at the ground (same filtering as terrainSunShadowAt)
	let top = max( h, frame.seaLevel );
	let vis = terrainSunShadowAt( vec3f( xz.x, top, xz.y ) );
	let E = max( dot( nSurf, L ), 0.0 ) * vis * smoothstep( -0.02, 0.05, L.y );
	let o = max( albedo * E - ${ ENV_GROUND } * max( L.y, 0.0 ), vec3f( 0.0 ) );
	textureStore( gbRawOut, vec2u( gid.xy ), vec4f( o, top ) );
}
`,
	} );

	const w = [ 1, 4, 6, 4, 1 ];
	let taps = '';
	for ( let y = - 2; y <= 2; y ++ ) for ( let x = - 2; x <= 2; x ++ ) taps += `	sum += textureLoad( gbRaw, clamp( c + vec2i( ${ x }, ${ y } ), vec2i( 0 ), vec2i( ${ N - 1 } ) ), 0 ) * ${ ( w[ x + 2 ] * w[ y + 2 ] / 256 ).toFixed( 8 ) };\n`;
	const blur = new ComputeKernel( {
		label: 'Ground Bounce Blur',
		bindings: { gbRaw: { texture: raw, sampleType: 'unfilterable-float' }, gbMapOut: { storageTexture: map, access: 'write' } },
		workgroupSize: [ 8, 8, 1 ],
		code: /* wgsl */`
@compute @workgroup_size( WG_X, WG_Y, WG_Z )
fn main( @builtin( global_invocation_id ) gid: vec3u ) {
	let c = vec2i( gid.xy );
	var sum = vec4f( 0.0 );
${ taps }	textureStore( gbMapOut, vec2u( gid.xy ), sum );
}
`,
	} );

	// re-bake whenever the terrain's sun shadow is re-baked (the key light moved)
	const bake = () => {

		uSun.value.copy( G.sunDir.value );
		bakeRaw.dispatch( [ N / 8, N / 8, 1 ] );
		blur.dispatch( [ N / 8, N / 8, 1 ] );
		uReady.value = 1;

	};

	let done = false;
	const orig = terrain.updateSunShadow.bind( terrain );
	terrain.updateSunShadow = ( renderer, force = false ) => {

		const baked = orig( renderer, force );
		if ( baked || ! done ) bake( renderer );
		done = true;
		return baked;

	};

	const cloudCode = clouds && clouds.module
		// cloud shadow over the surroundings (the clouds module's bilinear shadow map lookup)
		? 'let cloud = cloudsShadow( P.xz );'
		: 'let cloud = 1.0;';

	GroundBounce.module = new ShaderModule( {
		name: 'hook-bounce',
		deps: [ commonModule, terrain.module, ...( clouds && clouds.module ? [ clouds.module ] : [] ) ],
		uniforms: params,
		uniformName: 'groundBounceParams',
		bindings: { groundBounceMap: { texture: map, sampleType: 'unfilterable-float' } },
		code: /* wgsl */`
fn hookBounce( P: vec3f, Nw: vec3f ) -> vec3f {
#if IS_WATER || NO_GROUND_BOUNCE
	return vec3f( 0.0 );
#else
	let view = sat( Nw.y * -0.5 + 0.5 );
	var E = vec3f( 0.0 );
	if ( view > 0.03 && P.y > frame.seaLevel - 0.3 && groundBounceParams.strength > 0.0 && groundBounceParams.ready > 0.0 ) {

		let st = clamp( terrainUvOf( P.xz ) * ${ N }.0 - 0.5, vec2f( 0.0 ), vec2f( ${ N }.0 - 1.001 ) );
		let i = vec2i( floor( st ) );
		let t = fract( st );
		let s = mix(
			mix( textureLoad( groundBounceMap, i, 0 ), textureLoad( groundBounceMap, i + vec2i( 1, 0 ), 0 ), t.x ),
			mix( textureLoad( groundBounceMap, i + vec2i( 0, 1 ), 0 ), textureLoad( groundBounceMap, i + vec2i( 1, 1 ), 0 ), t.x ),
			t.y
		);
		let above = P.y - s.w;
		// nothing from a surface above the receiver (under water: the sea surface is above), a
		// little less high up where more of the view is taken by other objects
		let fade = smoothstep( -0.3, 0.3, above ) * mix( 0.4, 1.0, smoothstep( 30.0, 4.0, above ) );
		${ cloudCode }
		// a face turned away from a low sun looks at the ground its object shades (a long shadow)
		let Lh = frame.sunDir.xz / max( length( frame.sunDir.xz ), 1e-3 );
		let selfShade = 1.0 - sat( -dot( Nw.xz, Lh ) ) * sat( 1.0 - frame.sunDir.y ) * 0.6;
		E = s.xyz * frame.sunColor * cloud * ( view * fade * selfShade * groundBounceParams.strength * ${ SURROUND } );

	}
	// the lighting adds hookBounce * diffuse colour: irradiance / PI (three: E * diffuse / PI)
	return E * INV_PI;
#endif
}
`,
	} );

	SceneLighting.set( 'bounce', GroundBounce.module );
	return { bake, map, raw };

}
