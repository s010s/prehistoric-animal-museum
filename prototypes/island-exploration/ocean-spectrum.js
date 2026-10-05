import * as T from 'three';
// Bounded spectral wave quadrature for WebGL2. Dispersion and JONSWAP envelope
// follow Tidewater OceanFFT.js (MIT, DRG Software Solutions LLC). This is a
// 64-mode approximation, not its FFT solver. World-space phases never reset.
const hash=n=>{const a=Math.sin(n*127.13+91.7)*43758.5453;return a-Math.floor(a);};
function band(span,minK,maxK,rms,seed){
 const modes=[];let energy=0;
 for(let i=0;i<32;i++){
  const k=minK*(maxK/minK)**((i+hash(i+seed))/32),angle=-.44+(hash(i+seed+47)-.5)*2.8;
  const x=Math.round(Math.cos(angle)*k*span/(Math.PI*2))*Math.PI*2/span,z=Math.round(Math.sin(angle)*k*span/(Math.PI*2))*Math.PI*2/span;
  const K=Math.hypot(x,z),omega=Math.sqrt(9.81*K*Math.tanh(K*40)),peak=1.05,sigma=omega<=peak?.07:.09;
  const peakBoost=Math.exp(-.5*((omega-peak)/(sigma*peak))**2);
  const spectrum=.0081*9.81**2/omega**5*Math.exp(-1.25*(peak/omega)**4)*3.3**peakBoost;
  // Logarithmic quadrature: dOmega is proportional to omega in each band.
  const amplitude=Math.sqrt(Math.max(1e-12,spectrum*omega));energy+=amplitude*amplitude*K*K*.5;
  modes.push(new T.Vector4(x,z,amplitude,omega));
 }
 const scale=rms/Math.sqrt(energy);for(const m of modes)m.z*=scale;
 return {span,modes,phases:modes.map((_,i)=>hash(i+seed+123)*Math.PI*2)};
}
export function makeOceanSpectrum(){
 const bands=[band(256,.075,.8,.13,13),band(32,.8,8,.095,107)];
 const targets=bands.map(()=>new T.WebGLRenderTarget(128,128,{type:T.HalfFloatType,depthBuffer:false,minFilter:T.LinearMipmapLinearFilter,magFilter:T.LinearFilter,generateMipmaps:true,wrapS:T.RepeatWrapping,wrapT:T.RepeatWrapping}));
 const uniforms={waveTime:{value:0},waveSpan:{value:256},modes:{value:bands[0].modes},phases:{value:bands[0].phases}};
 const material=new T.ShaderMaterial({uniforms,depthTest:false,depthWrite:false,vertexShader:'varying vec2 waveUV;void main(){waveUV=uv;gl_Position=vec4(position.xy,0.,1.);}',fragmentShader:`varying vec2 waveUV;uniform float waveTime,waveSpan,phases[32];uniform vec4 modes[32];void main(){vec2 p=waveUV*waveSpan,slope=vec2(0.);float height=0.;for(int i=0;i<32;i++){vec4 m=modes[i];float phase=dot(p,m.xy)-waveTime*m.w+phases[i];slope+=m.xy*m.z*cos(phase);height+=m.z*sin(phase);}gl_FragColor=vec4(slope,height,1.);}`});
 const scene=new T.Scene(),camera=new T.OrthographicCamera(-1,1,1,-1,0,1);scene.add(new T.Mesh(new T.PlaneGeometry(2,2),material));let lastTime=NaN,updates=0;
 return {status:()=>({updates,lastTime:Number.isFinite(lastTime)?lastTime:null}),dispose(){targets.forEach(t=>t.dispose());scene.children[0].geometry.dispose();material.dispose();},uniforms:{oceanBand0:{value:targets[0].texture},oceanBand1:{value:targets[1].texture}},resources:()=>targets.map((t,i)=>['oceanSpectrum'+i,t]),update(renderer,time,diagnostics){
  if(time===lastTime)return;lastTime=time;const target=renderer.getRenderTarget(),auto=renderer.autoClear;renderer.autoClear=true;uniforms.waveTime.value=time;
  for(let i=0;i<2;i++){uniforms.waveSpan.value=bands[i].span;uniforms.modes.value=bands[i].modes;uniforms.phases.value=bands[i].phases;renderer.setRenderTarget(targets[i]);if(diagnostics)diagnostics.pass('oceanSpectrum'+i,()=>renderer.render(scene,camera));else renderer.render(scene,camera);}
  renderer.setRenderTarget(target);renderer.autoClear=auto;updates++;
 }};
}
export const oceanSpectrumGLSL=`uniform sampler2D oceanBand0,oceanBand1;
vec2 spectrumSlope(vec2 p,float footprint){return texture2D(oceanBand0,p/256.).rg+texture2D(oceanBand1,p/32.).rg*(1.-smoothstep(.35,1.8,footprint));}`;
