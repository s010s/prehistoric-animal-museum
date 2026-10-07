// Explicit review-only GPU readbacks. Never runs as part of a timing sample.
import * as T from 'three'
const levels=[.02,.18,1,4]
const textureInfo=tx=>tx?({uuid:tx.uuid,width:tx.image?.width??null,height:tx.image?.height??null,depth:tx.image?.depth??null,type:tx.type,format:tx.format,colorSpace:tx.colorSpace,minFilter:tx.minFilter,magFilter:tx.magFilter,generateMipmaps:tx.generateMipmaps,premultiplyAlpha:tx.premultiplyAlpha,isRenderTargetTexture:tx.isRenderTargetTexture??false}):null
const materialInfo=m=>m?({type:m.type,toneMapped:m.toneMapped,transparent:m.transparent,blending:m.blending,premultipliedAlpha:m.premultipliedAlpha,depthTest:m.depthTest,depthWrite:m.depthWrite,alphaToCoverage:m.alphaToCoverage,outputChunks:m.fragmentShader?.match(/#include <(?:tonemapping|colorspace)_fragment>/g)??[]}):null
const stateOf=r=>({target:r.getRenderTarget()?.uuid??null,viewport:r.getViewport(new T.Vector4()).toArray(),scissor:r.getScissor(new T.Vector4()).toArray(),scissorTest:r.getScissorTest(),autoClear:r.autoClear,clear:r.getClearColor(new T.Color()).toArray(),clearAlpha:r.getClearAlpha(),toneMapping:r.toneMapping,exposure:r.toneMappingExposure,outputColorSpace:r.outputColorSpace,pixelRatio:r.getPixelRatio(),drawSize:r.getDrawingBufferSize(new T.Vector2()).toArray(),shadowAutoUpdate:r.shadowMap.autoUpdate})
export function auditComposition(renderer,{resources,materials,scene}) {
  const gl=renderer.getContext(),before=stateOf(renderer),oldTarget=renderer.getRenderTarget(),oldFace=renderer.getActiveCubeFace(),oldMip=renderer.getActiveMipmapLevel()
  const oldInfo={geometries:renderer.info.memory.geometries,textures:renderer.info.memory.textures,programs:renderer.info.programs.length}
  const report={schema:'island-composition-contract-v2',createdAt:new Date().toISOString(),before,resourceCountsBefore:oldInfo,context:gl.getContextAttributes(),drawingBufferColorSpace:gl.drawingBufferColorSpace,threeRevision:T.REVISION,gpuPassMs:null,scope:'synchronous neutral GPU readback; not a performance sample',checks:{},probes:{}}
  const targets=resources();report.targets=targets.map(([name,rt])=>({name,uuid:rt.uuid,width:rt.width,height:rt.height,samplesRequested:rt.samples,samplesCap:renderer.capabilities.maxSamples,depthBuffer:rt.depthBuffer,stencilBuffer:rt.stencilBuffer,texture:textureInfo(rt.texture),depthTexture:textureInfo(rt.depthTexture)}))
  const textures=new Map();const take=(tx,owner)=>{if(tx?.isTexture){const row=textures.get(tx.uuid)??{...textureInfo(tx),owners:[]};if(!row.owners.includes(owner))row.owners.push(owner);textures.set(tx.uuid,row)}}
  take(scene.environment,'scene.environment');take(scene.background,'scene.background')
  scene.traverse(o=>{for(const m of [o.material].flat().filter(Boolean)){for(const [key,value] of Object.entries(m))take(value,`${m.type}.${key}`);for(const [key,u]of Object.entries(m.uniforms??{}))take(u.value,`${m.type}.uniform.${key}`)}})
  for(const [name,m]of Object.entries(materials)){for(const [key,u]of Object.entries(m?.uniforms??{}))take(u.value,name+'.uniform.'+key)}
  for(const [name,rt]of targets){take(rt.texture,name);take(rt.depthTexture,name+'.depth')}
  report.textures=[...textures.values()];report.materials=Object.fromEntries(Object.entries(materials).map(([name,m])=>[name,materialInfo(m)]))
  const errors=()=>{const found=[];for(let i=0;i<16;i++){const e=gl.getError();if(e===gl.NO_ERROR)break;found.push(e)}return found}
  report.preexistingGlErrors=errors();report.probeGlErrors={}
  const checkpoint=name=>report.probeGlErrors[name]=errors()
  const allocated=[],dispose=o=>(allocated.push(o),o),start=performance.now()
  try {
    if(gl.isContextLost())throw Error('WebGL context lost')
    const camera=new T.OrthographicCamera(-1,1,1,-1,0,1),neutral=new T.Scene(),geometry=dispose(new T.PlaneGeometry(.5,2))
    for(let i=0;i<levels.length;i++){const m=dispose(new T.MeshBasicMaterial({color:new T.Color().setRGB(levels[i],levels[i],levels[i]),depthTest:false,depthWrite:false})),mesh=new T.Mesh(geometry,m);mesh.position.x=-.75+i*.5;neutral.add(mesh)}
    const linear=dispose(new T.WebGLRenderTarget(32,8,{type:T.HalfFloatType,depthBuffer:false,minFilter:T.NearestFilter,magFilter:T.NearestFilter})),half=new Uint16Array(32*8*4)
    renderer.autoClear=true;renderer.setScissorTest(false);renderer.setClearColor(0,1);renderer.shadowMap.autoUpdate=false
    renderer.setRenderTarget(linear);renderer.render(neutral,camera);renderer.readRenderTargetPixels(linear,0,0,32,8,half)
    const readHalf=levels.map((_,i)=>Array.from(half.slice((4*32+i*8+4)*4,(4*32+i*8+4)*4+4),T.DataUtils.fromHalfFloat))
    checkpoint('linear');report.probes.linear={input:levels,rgba:readHalf};report.checks.linearPreserved=readHalf.every((p,i)=>p.every(Number.isFinite)&&Math.abs(p[0]-levels[i])<.004&&Math.abs(p[1]-levels[i])<.004&&Math.abs(p[2]-levels[i])<.004&&p[3]===1)
    const display=()=>{const size=renderer.getDrawingBufferSize(new T.Vector2());return levels.map((_,i)=>{const p=new Uint8Array(4);gl.readPixels(Math.floor((i+.5)*size.x/4),Math.floor(size.y/2),1,1,gl.RGBA,gl.UNSIGNED_BYTE,p);return Array.from(p)})}
    const screen=()=>{renderer.setRenderTarget(null);renderer.setViewport(0,0,before.drawSize[0]/before.pixelRatio,before.drawSize[1]/before.pixelRatio);renderer.setScissorTest(false)}
    screen();renderer.render(neutral,camera);const reference=display();checkpoint('reference')
    // Use the real copy shader and uniforms. AO is excluded to isolate the output boundary.
    const composite=dispose(new T.WebGLRenderTarget(32,8,{type:T.HalfFloatType,depthBuffer:false,minFilter:T.NearestFilter,magFilter:T.NearestFilter}));
    const copy=dispose(new T.ShaderMaterial({vertexShader:materials.copy.vertexShader,fragmentShader:materials.copy.fragmentShader,uniforms:{...materials.copy.uniforms,map:{value:linear.texture},aoEnabled:{value:0}},depthTest:materials.copy.depthTest,depthWrite:materials.copy.depthWrite,toneMapped:materials.copy.toneMapped})),quadGeometry=dispose(new T.PlaneGeometry(2,2)),copyScene=new T.Scene();copyScene.add(new T.Mesh(quadGeometry,copy));
    const output=dispose(new T.ShaderMaterial({vertexShader:materials.output.vertexShader,fragmentShader:materials.output.fragmentShader,uniforms:{map:{value:composite.texture}},depthTest:false,depthWrite:false,toneMapped:materials.output.toneMapped})),outputScene=new T.Scene();outputScene.add(new T.Mesh(quadGeometry,output));
    renderer.setRenderTarget(composite);renderer.render(copyScene,camera);screen();renderer.render(outputScene,camera);const actual=display();checkpoint('copy-and-output')
    report.probes.output={referenceNeutralMesh:reference,actualCopyAndOutput:actual,linearInput:levels,exposure:before.exposure,aoEnabled:0}
    report.checks.copyMatchesNeutral=actual.every((p,i)=>p.slice(0,3).every((v,c)=>Math.abs(v-reference[i][c])<=1))
    const source=materials.water.fragmentShader,tailStart=source.indexOf('#include <tonemapping_fragment>'),tail=source.slice(tailStart)
    if(tailStart<0||!tail.includes('#include <colorspace_fragment>'))throw Error('Water output boundary unavailable')
    // This isolates the actual water output tail and blend flags, not its full physical shader.
    const waterBoundary=dispose(new T.ShaderMaterial({vertexShader:'void main(){gl_Position=vec4(position.xy,0.,1.);}',fragmentShader:'uniform vec4 neutralColor;void main(){gl_FragColor=neutralColor;\n'+tail,uniforms:{neutralColor:{value:new T.Vector4(4,4,4,.5)}},transparent:materials.water.transparent,blending:materials.water.blending,premultipliedAlpha:materials.water.premultipliedAlpha,toneMapped:materials.water.toneMapped,depthTest:false,depthWrite:false})),blendScene=new T.Scene();blendScene.add(new T.Mesh(quadGeometry,waterBoundary))
    renderer.setRenderTarget(composite);renderer.render(copyScene,camera);renderer.autoClear=false;renderer.render(blendScene,camera);renderer.readRenderTargetPixels(composite,0,0,32,8,half);
    const mixedLinear=levels.map((_,i)=>Array.from(half.slice((4*32+i*8+4)*4,(4*32+i*8+4)*4+4),T.DataUtils.fromHalfFloat));
    report.checks.linearAlphaBlend=mixedLinear.every((p,i)=>p.slice(0,3).every(v=>Math.abs(v-(2+levels[i]*.5))<.005));
    screen();renderer.autoClear=true;renderer.render(outputScene,camera);const blended=display();
    const expectedScene=new T.Scene();for(let i=0;i<levels.length;i++){const m=dispose(new T.MeshBasicMaterial({color:new T.Color().setRGB(2+levels[i]*.5,2+levels[i]*.5,2+levels[i]*.5),depthTest:false,depthWrite:false})),mesh=new T.Mesh(geometry,m);mesh.position.x=-.75+i*.5;expectedScene.add(mesh);}renderer.render(expectedScene,camera);const expected=display();
    report.probes.waterBoundaryProxy={foregroundLinear:[4,4,4],alpha:.5,backgroundLinear:levels,mixedLinear,rgba:blended,expectedAfterOneOutput:expected,scope:'actual water output tail, blend flags and final output; excludes physical water/occlusion/spray'}
    report.checks.blendThenOneOutput=blended.every((p,i)=>p.slice(0,3).every((v,c)=>Math.abs(v-expected[i][c])<=1))
    report.checks.noShaderErrors=(renderer.info.programs?.filter(p=>p.diagnostics?.runnable===false).length??0)===0
    checkpoint('blend');report.checks.readbackNoGlError=Object.values(report.probeGlErrors).every(es=>es.length===0)
  } catch(error) {report.error=String(error);report.checks.probeSucceeded=false}
  finally {
    renderer.setRenderTarget(oldTarget,oldFace,oldMip);renderer.setViewport(...before.viewport);renderer.setScissor(...before.scissor);renderer.setScissorTest(before.scissorTest);renderer.autoClear=before.autoClear;renderer.setClearColor(new T.Color().fromArray(before.clear),before.clearAlpha);renderer.toneMapping=before.toneMapping;renderer.toneMappingExposure=before.exposure;renderer.outputColorSpace=before.outputColorSpace;renderer.shadowMap.autoUpdate=before.shadowAutoUpdate
    for(const o of allocated.reverse())o.dispose()
    report.after=stateOf(renderer);report.checks.rendererStateRestored=JSON.stringify(before)===JSON.stringify(report.after)
    report.resourceCountsAfter={geometries:renderer.info.memory.geometries,textures:renderer.info.memory.textures,programs:renderer.info.programs.length}
    report.checks.temporaryResourcesDisposed=JSON.stringify(oldInfo)===JSON.stringify(report.resourceCountsAfter)
    report.auditCpuInclusiveMs=performance.now()-start;report.passed=Object.values(report.checks).every(Boolean)
  }
  return report
}
