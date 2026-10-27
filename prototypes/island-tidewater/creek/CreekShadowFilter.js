import {shadowModule} from '../vendor/tidewater/src/engine/render/wgsl/lighting.js';

let installed=false;
export function installCreekShadowFilter(){
 if(installed)return;installed=true;
 const change=(from,to)=>{if(!shadowModule.code.includes(from))throw Error('Pinned creek shadow filter seam changed');shadowModule.code=shadowModule.code.replace(from,to);};
 // The half-resolution refraction source has no temporal resolve of its own.
 // Binary, per-pixel rotated PCSS taps survive as a visible stipple after the
 // water refracts that image. Integrate depth comparisons spatially here;
 // keep the physical blocker-derived penumbra and the original dry-land path.
 change('let phi = noise * TWO_PI;',`let phi = noise * TWO_PI;
#if CREEK_REFRACTION
 let filterPhi=0.731;
#else
 let filterPhi=phi;
#endif`);
 change('vogelDiskSample( i, SHADOW_SEARCH_TAPS, phi ) * searchUV','vogelDiskSample( i, SHADOW_SEARCH_TAPS, filterPhi ) * searchUV');
 change('// 3. PCF over the penumbra',`// 3. PCF over the penumbra
#if CREEK_REFRACTION
 var integrated=0.0;
 for(var j=0;j<32;j++){
  integrated+=_shadowTap(uvz.xy+vogelDiskSample(j,32,filterPhi+1.7)*penumbraUV,c,z);
 }
 return integrated/32.0;
#endif`);
 change('let phiP = pcfNoise * TWO_PI;',`let phiP = pcfNoise * TWO_PI;
#if CREEK_REFRACTION
 var integrated=0.0;
 for(var j=0;j<16;j++){
  integrated+=_shadowTap(uvz.xy+vogelDiskSample(j,16,.731)*texel,c,z);
 }
 return integrated/16.0;
#endif`);
}
