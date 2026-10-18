// Shared setup for the sky stream tests (headless): atmosphere + sky (+ clouds) rendered as the
// scene background into a SceneRenderer, tonemapped (ACES + exposure) into an rgba8 target.
import { writePNG } from './headless.mjs';
import { GPU } from '../src/engine/gpu/GPU.js';
import { RenderTarget } from '../src/engine/gpu/Texture.js';
import { readTexture } from '../src/engine/gpu/Readback.js';
import { FrameUniforms, G, setFrameCamera } from '../src/engine/render/Frame.js';
import { FullscreenPass } from '../src/engine/render/FullscreenPass.js';
import * as E from '../src/engine/index.js';

export { GPU, G, E, FrameUniforms, setFrameCamera, writePNG, readTexture, RenderTarget };

// same key light logic as App.updateSun / applyAtmosphereReadback
export function setTimeOfDay( app, hours, sunDirectionFromTime, SUN_ILLUMINANCE ) {

	const dir = sunDirectionFromTime( hours );
	app.atmosphere.sunDir.value.copy( dir );
	const night = E.MathUtils.smoothstep( - dir.y, 0.02, 0.18 );
	G.night.value = night;
	app.sky.starIntensity.value = night;
	const moon = new E.Vector3( - dir.x, Math.abs( dir.y ) * 0.8 + 0.25, - dir.z ).normalize();
	app.sky.moonDir.value.copy( moon );
	G.sunDir.value.copy( dir.y > - 0.07 ? dir : moon );
	app._sunUp = dir.y > - 0.07;
	app._SUN_E = SUN_ILLUMINANCE;

}

export function applyReadback( app ) {

	const a = app.atmosphere;
	if ( ! a.sunTransmittance ) return false;
	const sunTrue = a.sunDir.value;
	const T = a.sunTransmittance;
	const horizonFade = E.MathUtils.smoothstep( sunTrue.y, - 0.03, 0.02 );
	if ( app._sunUp ) G.sunColor.value.setRGB( T[ 0 ], T[ 1 ], T[ 2 ] ).multiplyScalar( app._SUN_E * horizonFade );
	else G.sunColor.value.setRGB( 0.6, 0.7, 1.0 ).multiplyScalar( 0.12 * G.night.value );
	const irr = a.skyIrradiance;
	const nightAmb = 0.012 * G.night.value;
	G.skyIrradiance.value.setRGB( irr[ 0 ] + nightAmb * 0.6, irr[ 1 ] + nightAmb * 0.7, irr[ 2 ] + nightAmb );
	G.horizonColor.value.setRGB( a.horizon[ 0 ], a.horizon[ 1 ], a.horizon[ 2 ] );
	return true;

}

let _tonemap = null;
let _src = null;
export function tonemapPass( srcTex ) {

	_src = srcTex;
	if ( ! _tonemap ) _tonemap = new FullscreenPass( { label: 'test tonemap', colorFormats: [ 'rgba8unorm' ], bindings: { hdr: { texture: () => _src } },
		code: /* wgsl */`
fn RRTAndODTFit( v: vec3f ) -> vec3f {
	let a = v * ( v + 0.0245786 ) - 0.000090537;
	let b = v * ( 0.983729 * v + 0.4329510 ) + 0.238081;
	return a / b;
}
fn aces( c: vec3f ) -> vec3f {
	let ACESInputMat = mat3x3f( vec3f( 0.59719, 0.07600, 0.02840 ), vec3f( 0.35458, 0.90834, 0.13383 ), vec3f( 0.04823, 0.01566, 0.83777 ) );
	let ACESOutputMat = mat3x3f( vec3f( 1.60475, -0.10208, -0.00327 ), vec3f( -0.53108, 1.10813, -0.07276 ), vec3f( -0.07367, -0.00605, 1.07602 ) );
	var color = c / 0.6;
	color = ACESInputMat * color;
	color = RRTAndODTFit( color );
	color = ACESOutputMat * color;
	return sat3( color );
}
fn fragment( in: FSIn ) -> vec4f {
	let c = textureLoad( hdr, vec2i( in.pos.xy ), 0 ).rgb * frame.exposure;
	return vec4f( linearToSrgb( aces( c ) ), 1.0 );
}` } );
	return _tonemap;

}

export async function savePNG( tex, path, crops = [] ) {

	const img = await readTexture( tex );
	const w = tex.width, h = tex.height;
	const rgba = new Uint8Array( img.data );
	writePNG( path, w, h, rgba );
	// crops: [ { x, y, w, h, name } ] saved next to it (zoomed inspection)
	for ( const c of crops ) {

		const out = new Uint8Array( c.w * c.h * 4 );
		for ( let y = 0; y < c.h; y ++ ) out.set( rgba.subarray( ( ( c.y + y ) * w + c.x ) * 4, ( ( c.y + y ) * w + c.x + c.w ) * 4 ), y * c.w * 4 );
		writePNG( path.replace( '.png', `-${ c.name || 'crop' }.png` ), c.w, c.h, out );

	}

	console.log( 'wrote', path );

}

export function wait( ms ) {

	return new Promise( ( r ) => setTimeout( r, ms ) );

}
