import {riverX,smooth} from './field.js';
import {regionPathWeight,regionPathGLSL} from './sample-region.js';
export const trailX=z=>riverX(z)+65+Math.sin((z+500)/77)*9+Math.sin((z+500)/29)*2.5;
export function trailWeight(x,z){return Math.max(regionPathWeight(x,z),(1-smooth(1.15,2.7,Math.abs(x-trailX(z))))*smooth(-1600,-1420,z)*(1-smooth(200,360,z)));}
export const habitatGLSL=`
${regionPathGLSL}
float trailMask(vec2 p){float x=-1830.+190.*sin(p.y/640.)+72.*sin(p.y/230.)-smoothstep(2400.,4000.,p.y)*1550.+65.+sin((p.y+500.)/77.)*9.+sin((p.y+500.)/29.)*2.5;
 return max(regionTrail(p),(1.-smoothstep(1.15,2.7,abs(p.x-x)))*smoothstep(-1600.,-1420.,p.y)*(1.-smoothstep(200.,360.,p.y)));}
`;
