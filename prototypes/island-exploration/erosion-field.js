// Deterministic hydraulic erosion, baked from authored island; half-metre deltas.
const N=769,step=16,data=(await import('./erosion-data.js')).data;
export function erosionDelta(x,z){const gx=x/step+(N-1)/2,gz=z/step+(N-1)/2;if(gx<0||gz<0||gx>=N-1||gz>=N-1)return 0;const ix=Math.floor(gx),iz=Math.floor(gz),u=gx-ix,v=gz-iz,i=iz*N+ix;return (data[i]*(1-u)*(1-v)+data[i+1]*u*(1-v)+data[i+N]*(1-u)*v+data[i+N+1]*u*v)*.5}
