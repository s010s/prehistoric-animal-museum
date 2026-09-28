import * as T from 'three'
// Colour and template-space normal are baked separately from the very same
// branch geometry used nearby. Neither channel contains a baked sun or sky.
export function bakeTreeAtlas(renderer,templates){
 const cell=256,cols=8,rows=templates.length*3,targets=[0,1].map(()=>new T.WebGLRenderTarget(cols*cell,rows*cell,{generateMipmaps:true,minFilter:T.LinearMipmapLinearFilter,magFilter:T.LinearFilter,depthBuffer:true}));
 const old={target:renderer.getRenderTarget(),tone:renderer.toneMapping,clear:renderer.getClearColor(new T.Color()),alpha:renderer.getClearAlpha(),viewport:renderer.getViewport(new T.Vector4()),scissor:renderer.getScissor(new T.Vector4()),test:renderer.getScissorTest(),auto:renderer.autoClear};
 const scene=new T.Scene(),camera=new T.OrthographicCamera(-.7,.7,.7,-.7,.01,100),center=new T.Vector3(0,.5,0);
 renderer.toneMapping=T.NoToneMapping;renderer.autoClear=false;renderer.setClearColor(0,0);renderer.setScissorTest(false);
 for(let pass=0;pass<2;pass++){
  renderer.setRenderTarget(targets[pass]);renderer.clear();
  for(let species=0;species<templates.length;species++){
   const tree=templates[species],meshes=tree.parts.map(part=>{
    const m=new T.MeshBasicMaterial({map:part.material.map,color:part.material.color,vertexColors:part.material.vertexColors,alphaTest:part.material.alphaTest,side:T.DoubleSide,toneMapped:false});
    if(pass){m.onBeforeCompile=s=>{s.vertexShader=s.vertexShader.replace('#include <common>','#include <common>\nvarying vec3 atlasN;').replace('#include <begin_vertex>','#include <begin_vertex>\natlasN=normal;');s.fragmentShader=s.fragmentShader.replace('#include <common>','#include <common>\nvarying vec3 atlasN;').replace('#include <opaque_fragment>','outgoingLight=normalize(atlasN)*.5+.5;\n#include <opaque_fragment>');};m.customProgramCacheKey=()=> 'template-normal-atlas';}
    const compile=m.onBeforeCompile;m.onBeforeCompile=s=>{compile(s);s.fragmentShader=s.fragmentShader.replace('#include <opaque_fragment>','diffuseColor.a=1.;\n#include <opaque_fragment>');};m.customProgramCacheKey=()=>`opaque-cutout-atlas-${pass}`;
    const mesh=new T.Mesh(part.geometry,m);mesh.scale.setScalar(1/tree.height);scene.add(mesh);return mesh;
   });
   for(let row=0;row<3;row++)for(let col=0;col<cols;col++){
    const elevation=row*.55,az=col*Math.PI/4;camera.position.set(Math.sin(az)*Math.cos(elevation)*20,.5+Math.sin(elevation)*20,Math.cos(az)*Math.cos(elevation)*20);camera.lookAt(center);camera.updateMatrixWorld();
    renderer.setViewport(col*cell,(species*3+row)*cell,cell,cell);renderer.render(scene,camera);
   }
   meshes.forEach(m=>{scene.remove(m);m.material.dispose()});
  }
 }
 renderer.setRenderTarget(old.target);renderer.setViewport(old.viewport);renderer.setScissor(old.scissor);renderer.setScissorTest(old.test);renderer.toneMapping=old.tone;renderer.setClearColor(old.clear,old.alpha);renderer.autoClear=old.auto;
 const geometry=new T.PlaneGeometry(1.4,1.4);geometry.translate(0,.5,0);
 return{geometry,material:new T.MeshStandardMaterial({map:targets[0].texture,alphaTest:.44,side:T.DoubleSide,roughness:1}),normalMap:targets[1].texture,targets,cell,rows};
}
