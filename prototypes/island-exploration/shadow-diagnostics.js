import * as T from 'three';
// Bounded observation of native comparison depth, with no sampler-state mutation.
// Bisection at actual source texel centres recovers 16 bits of normalized depth.
export function makeShadowDiagnostics(renderer){
 const uniforms={shadowDepth:{value:null},sourceSize:{value:new T.Vector2()}};
 const material=new T.ShaderMaterial({uniforms,glslVersion:T.GLSL3,depthTest:false,depthWrite:false,toneMapped:false,
 vertexShader:'out vec2 coord;void main(){coord=uv;gl_Position=vec4(position.xy,0.,1.);}',
 fragmentShader:`precision highp sampler2DShadow;uniform sampler2DShadow shadowDepth;uniform vec2 sourceSize;in vec2 coord;out vec4 color;
 void main(){vec2 uv=(floor(coord*sourceSize)+.5)/sourceSize;float lo=0.,hi=1.;for(int i=0;i<16;i++){float mid=(lo+hi)*.5;if(texture(shadowDepth,vec3(uv,mid))>.5)lo=mid;else hi=mid;}float code=floor((lo+hi)*.5*65535.+.5);color=vec4(floor(code/256.)/255.,mod(code,256.)/255.,clamp(((lo+hi)*.5-.35)*3.,0.,1.),1.);}`});
 const geometry=new T.PlaneGeometry(2,2),scene=new T.Scene(),camera=new T.OrthographicCamera(-1,1,1,-1,0,1);scene.add(new T.Mesh(geometry,material));
 const target=new T.WebGLRenderTarget(512,512,{depthBuffer:false});
 return {capture(light){if(!light.shadow.map?.depthTexture)throw Error('Shadow map unavailable');const before=renderer.getRenderTarget(),auto=renderer.autoClear;uniforms.shadowDepth.value=light.shadow.map.depthTexture;uniforms.sourceSize.value.copy(light.shadow.mapSize);
  try{renderer.setRenderTarget(target);renderer.autoClear=true;renderer.render(scene,camera);const pixels=new Uint8Array(512*512*4);renderer.readRenderTargetPixels(target,0,0,512,512,pixels);return{width:512,height:512,pixels,sourceSize:light.shadow.mapSize.toArray(),matrix:light.shadow.matrix.toArray(),encoding:'R high and G low bytes of 16-bit normalized depth; B visualization; sampled source texel centres, bounded 512² observation'};}finally{renderer.setRenderTarget(before);renderer.autoClear=auto;}},dispose(){target.dispose();material.dispose();geometry.dispose();}};
}
