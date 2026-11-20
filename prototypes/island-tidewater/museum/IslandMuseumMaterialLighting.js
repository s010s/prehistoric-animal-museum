import { surfaceModule, lightingModule } from '../vendor/tidewater/src/engine/render/wgsl/lighting.js';
import { localLightsModule } from '../vendor/tidewater/src/materials/LocalLights.js';

// Tidewater keeps one scalar for dielectric reflectance. glTF authors can
// specify a tinted normal-incidence reflectance and a separate Fresnel weight.
const dielectric = 'vec3f( 0.04 ) * s.specularIntensity';
const baseFresnel = 'let specF0 = mix( ' + dielectric + ', s.albedo, s.metalness );';
const museumFresnel = `#if MUSEUM_GLTF_MATERIAL
	let specF0 = mix(min(s.museumDielectricF0, vec3f(1.0)) * s.specularIntensity, s.albedo, s.metalness);
#else
	${baseFresnel}
#endif`;

function insert(source, needle, replacement) {
  if (source.split(needle).length !== 2) throw Error('Pinned fauna lighting contract changed: ' + needle);
  return source.replace(needle, replacement);
}

// The modules are shared by passes. Only shaders compiled with the fauna
// define use these fields or perform the extra lower-hemisphere calculation.
surfaceModule.code = insert(surfaceModule.code, 'struct Surface {', `struct Surface {
#if MUSEUM_GLTF_MATERIAL
	museumDielectricF0: vec3f,
#endif`);
lightingModule.code = insert(lightingModule.code, baseFresnel, museumFresnel);
localLightsModule.code = insert(localLightsModule.code, baseFresnel, museumFresnel);
const bounce = 'acc.indirectDiffuse += diffuseMS * envIrr * INV_PI + hookBounce( P, N ) * diffuseColor;';
lightingModule.code = insert(lightingModule.code, bounce, `#if MUSEUM_LAND_RECEIVER
	// The native beach probe treats all upland as dark jungle. A land animal
	// also sees the surrounding grass, straw and soil. Subtract the sky probe's
	// lower hemisphere so bright beaches retain their existing ground bounce.
	let lowerView = sat(0.5 - 0.5 * N.y);
	let groundDay = frame.skyIrradiance + frame.sunColor * sat(frame.sunDir.y) * hookDirectModulation(P, vec3f(0.0, 1.0, 0.0));
	let earth = groundDay * INV_PI * vec3f(0.20, 0.18, 0.125);
	let openGround = max(earth - hookEnvDiffuse(vec3f(0.0, -1.0, 0.0)), vec3f(0.0)) * lowerView * 0.72;
	acc.indirectDiffuse += diffuseMS * envIrr * INV_PI + max(hookBounce(P, N), openGround) * diffuseColor;
#else
	${bounce}
#endif`);
