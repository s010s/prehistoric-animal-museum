// SPDX-License-Identifier: AGPL-3.0-only
// Explicit art-directed, world-anchored cloud-shadow boundary, not underwater lamps.
export const CLOUD_BANK = { edgeZ: -13, halfTransitionMetres: 6, shadowSolarTransmission: .10, shadowSkyRadiance: .60, shadowReflectedWater: .90, clearReflectedWater: 1.83 };
const smooth = t => { t = Math.max(0, Math.min(1, t)); return t * t * (3 - 2 * t); };
export function cloudClearFraction(x, z) { const edge = CLOUD_BANK.edgeZ + 2.4 * Math.sin(x * .055) + 1.2 * Math.sin(x * .13 + .7); return smooth((edge - z + CLOUD_BANK.halfTransitionMetres) / (2 * CLOUD_BANK.halfTransitionMetres)); }
export function cloudSolarTransmission(x, z) { return CLOUD_BANK.shadowSolarTransmission + (1 - CLOUD_BANK.shadowSolarTransmission) * cloudClearFraction(x, z); }
export const CLOUD_BANK_GLSL = `
uniform float uCloudBankEnabled;
uniform vec2 uCloudOrigin;
float cloudClearFraction(vec2 xz){
 xz-=uCloudOrigin;
 float edge=-13.0+2.4*sin(xz.x*.055)+1.2*sin(xz.x*.13+.7);
 return smoothstep(-6.0,6.0,edge-xz.y);
}
float cloudSolarTransmission(vec2 xz){return mix(1.0,mix(.10,1.0,cloudClearFraction(xz)),uCloudBankEnabled);}
float cloudSkyRadianceScale(vec2 xz){return mix(1.0,mix(.60,1.0,cloudClearFraction(xz)),uCloudBankEnabled);}
// Cloud cover suppresses the narrow direct sun much more than the broad sky.
// The real-time camera spans upward angles absent from the fixed film shot.
// Approximation: local downwelling water radiance responds to the same broad
// clear/shadow regions. This is not a traced reflected path or cloud simulation.
float cloudWaterRadianceScale(vec2 xz){return mix(1.0,mix(.90,1.83,cloudClearFraction(xz)),uCloudBankEnabled);}
`;
