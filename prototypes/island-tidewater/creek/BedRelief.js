// Museum-authored bed forms. Heights are changed once, before all CPU/GPU maps.
import {Noise2D} from '../vendor/tidewater/src/util/Noise.js';
const noise=new Noise2D(31573);
const smooth=(a,b,x)=>{const t=Math.max(0,Math.min(1,(x-a)/(b-a)));return t*t*(3-2*t);};
export function bedRelief(x,z,h,water,texel=1){
 const depth=water-h;if(depth<.35||depth>28)return h;
 // Keep the original ford and the spring's thin sheets/pool contact unchanged.
 const protect=smooth(20,36,Math.hypot(x+50,z+67))*smooth(12,24,Math.hypot(x+12,z+26));
 const weight=smooth(.35,1.4,depth)*(1-smooth(16,28,depth))*protect;
 const minScale=Math.max(1,texel)*6;
 const warp=noise.noise(x/181,z/213)*9;
 const broad=noise.noise((x+warp)/Math.max(29,minScale),(z-warp)/Math.max(41,minScale));
 const stone=noise.noise((x*.819+z*.574)/Math.max(9,minScale)+13.7,(-x*.574+z*.819)/Math.max(13,minScale));
 const amplitude=water<1?.38:.16;
 return h+weight*(broad*amplitude+stone*amplitude*.23);
}
