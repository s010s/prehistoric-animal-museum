// Linear RGB absorption and scattering per metre. The ocean is calibrated between the
// clear open-water reference and the island’s sediment-bearing shelf; the river keeps the museum creek medium.
// Near the tidal reach both faces, the receiver and the swimmer's eye follow
// the same continuous inland water field.
import { ShaderModule } from '../vendor/tidewater/src/engine/gpu/Shader.js';

export const coastalWaterOptics = new ShaderModule({ name: 'museumCoastalWaterOptics', code: `
fn museumAbsorption(fresh:f32)->vec3f{return mix(vec3f(.29,.078,.046),frame.waterAbsorption,fresh);}
fn museumScattering(fresh:f32)->vec3f{return mix(vec3f(.011,.016,.020),frame.waterScattering,fresh);}
` });
