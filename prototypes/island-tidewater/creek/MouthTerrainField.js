import grid from './assets/mouth-bed-v2.json';
import {smooth} from './ContinuousSample.js';

// An editable, world-fixed coastal field. It is baked into the existing
// physical arrays, never sampled per-frame or selected by a nearest river.
const [x0,z0]=grid.origin,x1=x0+(grid.width-1)*grid.step,z1=z0+(grid.height-1)*grid.step;
const [ix0,iz0,ix1,iz1]=grid.inner;
if(grid.schema!=='museum-authored-mouth-grid-v1'||grid.heights.length!==grid.width*grid.height)throw Error('Invalid authored mouth grid');
export const mouthFieldInfo={id:'mouth-bed-v2',outer:[x0,z0,x1,z1],inner:grid.inner,editingStepMetres:grid.step,runtimeStepMetres:1,method:'fixed editable bed; C1 support feather; original catchment outside; shared physical arrays'};
export function mouthFieldWeight(x,z){
 if(x<=x0||x>=x1||z<=z0||z>=z1)return 0;
 return smooth(x0,ix0,x)*(1-smooth(ix1,x1,x))*smooth(z0,iz0,z)*(1-smooth(iz1,z1,z));
}
export function mouthFieldAt(x,z,original){
 const w=mouthFieldWeight(x,z);if(w===0)return original;
 const fx=(x-x0)/grid.step,fz=(z-z0)/grid.step,i=Math.min(grid.width-2,Math.floor(fx)),j=Math.min(grid.height-2,Math.floor(fz)),u=fx-i,v=fz-j,k=j*grid.width+i;
 const a=grid.heights[k]*(1-u)+grid.heights[k+1]*u,b=grid.heights[k+grid.width]*(1-u)+grid.heights[k+grid.width+1]*u;
 return original*(1-w)+(a*(1-v)+b*v)*w;
}
