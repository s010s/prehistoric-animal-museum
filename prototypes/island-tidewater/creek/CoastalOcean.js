// Application composition of Tidewater 4811ba48 (MIT, DRG Software Solutions).
// Ocean simulation/materials stay native; geography and inland volume are ours.
import {Mesh,Vector2} from '../vendor/tidewater/src/engine/index.js';
import {UniformBlock} from '../vendor/tidewater/src/engine/webgpu.js';
import {ShaderModule} from '../vendor/tidewater/src/engine/gpu/Shader.js';
import {CDLOD} from '../vendor/tidewater/src/core/CDLOD.js';
import {G} from '../vendor/tidewater/src/core/Globals.js';
import {LAYERS} from '../vendor/tidewater/src/core/SceneRenderer.js';
import {OceanFFT} from '../vendor/tidewater/src/ocean/OceanFFT.js';
import {WaterSurface} from '../vendor/tidewater/src/ocean/WaterSurface.js';
import {MuseumWaterMaterial} from './MuseumWaterMaterial.js';
import {useHybridShoreDirection} from './CoveShoreField.js';
import {WaterQuery} from '../vendor/tidewater/src/ocean/WaterQuery.js';
import {createFoamTexture} from '../vendor/tidewater/src/ocean/FoamTexture.js';
import {SeaDetail} from '../vendor/tidewater/src/ocean/SeaDetail.js';
import {ShoreWaves} from '../vendor/tidewater/src/ocean/ShoreWaves.js';
import {TravellingShoreSim,TravellingBreakers} from './TravellingSurf.js';
import {SurfFoam} from '../vendor/tidewater/src/ocean/SurfFoam.js';
import {Caustics} from '../vendor/tidewater/src/ocean/Caustics.js';
import {installUnderwaterLighting} from '../vendor/tidewater/src/ocean/UnderwaterLighting.js';
import {Spray} from '../vendor/tidewater/src/fx/Spray.js';

const names=['waterQueryDispAt','waterQueryHeightAtXZ','waterQueryResult','waterQueryHeightAt','waterQueryCameraState'];
function renderCopy(module){
 let code=module.code;
 for(const name of names)code=code.replaceAll(new RegExp('\\b'+name+'\\b','g'),name.replace('waterQuery','oceanQuery'));
 return new ShaderModule({name:'museum-'+module.name,deps:module.deps,bindings:module.bindings,code});
}

export class CreekSeaQuery {
 constructor(renderer,surface,field,terrain){
  this.ocean=new WaterQuery(renderer,surface);this.field=field;this.terrain=terrain;
  this.cpu=new Float32Array(256);this.cpuValid=true;this.points=new Map([[0,[0,0]]]);
  const results=renderCopy(this.ocean.resultsModule),height=renderCopy(this.ocean.heightModule);
  // Preserve native query dispatch, normal solve, slot layout and async readback.
  // Feed it the inland mean as well: slot 0 is now the same-frame hybrid camera
  // result, calculated once rather than re-evaluated by every post pixel.
  this.ocean._heightModule=new ShaderModule({name:'museum-query-input',deps:[height,field.module],code:`
fn waterQueryHeightAtXZ(p:vec2f)->f32{
 if(museumEstuaryOwns(p)){return creekMeanAt(p);}
 return mix(oceanQueryHeightAtXZ(p),creekMeanAt(p),museumEstuaryBlend(p));
}
`});
  this.resultsModule=new ShaderModule({name:'museum-water-camera',deps:[results],code:`
fn waterQueryCameraState()->vec4f{return oceanQueryCameraState();}
`});
  const domain=new ShaderModule({name:'museum-water-domain',deps:[field.module,surface.terrain.module],code:`
fn museumHasCreek(p:vec2f)->bool{return creekContains(p)&&creekMeanAt(p)>terrainHeightAt(p)-0.01;}
`});
  // The post medium only probes the lens (~0.1m from the camera). Use the
  // same-frame native height/normal there; full FFT Eulerian queries remain in
  // simulation and spray. This keeps the beauty pass within 32 texture bindings.
  this.mediumModule=new ShaderModule({name:'museum-lens-water',deps:[this.resultsModule,domain],code:`
fn waterQueryHeightAtXZ(p:vec2f)->f32{
 if(museumHasCreek(p)){return creekMeanAt(p);}
 if(terrainHeightAt(p)>=frame.seaLevel+0.6){return -90.0;}
 let s=oceanQueryCameraState();let ny=sqrt(max(1.0-dot(s.yz,s.yz),0.01));
 let delta=p-frame.cameraPos.xz;if(length(delta)>2.0){return frame.seaLevel;}
 return s.x-dot(delta,s.yz)/ny;
}
`});
  this.module=new ShaderModule({name:'museum-water-volumes',deps:[this.resultsModule,domain,height],code:`
fn waterQueryHeightAtXZ(p:vec2f)->f32{
 if(museumHasCreek(p)){return creekMeanAt(p);}
 if(terrainHeightAt(p)<frame.seaLevel+0.6){return oceanQueryHeightAtXZ(p);}
 return -90.0;
}
fn waterQueryHeightAt(slot:u32)->f32{return oceanQueryHeightAt(slot);}
fn waterQueryResult(slot:u32)->vec4f{return oceanQueryResult(slot);}
`});
 }
 allocate(name,n=1){return this.ocean.allocate(name,n);}
 sample(x,z){
  const f=this.field.sample(x,z),ground=this.terrain.heightAt(x,z);
  if(f[1]<.05&&f[0]>G.seaLevel.value+.5&&f[0]>ground-.01)return f;
  if(ground<G.seaLevel.value+.6){
   let h=G.seaLevel.value;const weight=f[1]<-1?Math.max(0,Math.min(1,(f[0]-G.seaLevel.value)/.2)):0;h=h*(1-weight)+f[0]*weight;
   if(this.ocean.cpuValid)for(const [i]of this.points){const k=i*4,q=this.ocean.resultInputs;if(Math.hypot(q[k]-x,q[k+1]-z)<2){h=this.ocean.cpu[k];break;}}
   return [h,ground-h,0,0];
  }
  return [ground-.2,10000,0,0];
 }
 height(x,z){const f=this.sample(x,z);return f[1]<.05?f[0]:-90;}
 setPoint(i,x,z){this.points.set(i,[x,z]);this.ocean.setPoint(i,x,z);this.cpu[i*4]=this.sample(x,z)[0];}
 setCamera(x,z){this.points.set(0,[x,z]);this.ocean.setCamera(x,z);this.cpu[0]=this.height(x,z);}
 update(){this.ocean.update();for(const [i,p]of this.points)this.cpu[i*4]=i===0?this.height(...p):this.sample(...p)[0];}
 cameraState(){const mk=e=>Object.assign(new String(e),{module:this.resultsModule});const r=mk('waterQueryCameraState()');for(const c of 'xyzw')r[c]=mk('waterQueryCameraState().'+c);return r;}
}

export function createCoastalOcean(app,data){
 const {engine,terrainGPU,scene,sky,clouds,sceneRenderer,refraction}=app;
 const fft=new OceanFFT(engine),foamTexture=createFoamTexture(engine);
 // Aerial exploration must not expose a finite ocean edge inside the 60km
 // camera frustum. Outer rings add coarse patches, not extra fine waves.
 const oceanLOD=new CDLOD({gridSize:32,leafSize:8,levels:17,minY:-25,maxY:25});
 const surface=new WaterSurface({fft,cdlod:oceanLOD,foamTexture});surface.terrain=terrainGPU;
 const seaDetail=new SeaDetail();surface.detail=seaDetail;
 const shore=new ShoreWaves(terrainGPU);useHybridShoreDirection(shore,app.shoreField);surface.shore=shore;
 const {x:cx,z:cz}=data.coast.coast;
 const shoreSim=new TravellingShoreSim(engine,{terrainGPU,shore,shelf:data.cove.continuous,center:new Vector2(cx,cz),size:480,res:768});surface.shoreSim=shoreSim;
 const surfFoam=new SurfFoam({shoreSim});surface.foamShading=args=>surfFoam.shading(args);
 const surfSeam='smoothstep( 7.0, 3.0, a.depth ) * shoreSimInside( shoreSimUvOf( xz ) )';
 if(!surfFoam.module.code.includes(surfSeam))throw Error('Native surf appearance seam changed');
 surfFoam.module.code=surfFoam.module.code.replace(surfSeam,surfSeam+' * museumSurfDetailAt(xz)');
 const caustics=new Caustics(engine,fft);caustics.detail=seaDetail;
 const underwaterLighting=installUnderwaterLighting({fft,caustics,clouds,terrain:terrainGPU,shore,surface,shoreSim});
 underwaterLighting.helpers.code=underwaterLighting.helpers.code.replace('shoreSimSample( xz ).x * 0.8','shoreSimSample( xz ).x * museumSurfDetailAt(xz) * 0.8');
 // The installed objects have not been compiled. Give the native functions
 // distinct names, then our hooks can delegate the sea branch without a second
 // copy of their resource graph (module de-duplication uses object identity).
 for(const [mod,name]of [[underwaterLighting.direct,'hookDirectModulation'],[underwaterLighting.ambient,'hookAmbientModulation'],[underwaterLighting.shadowPos,'hookShadowPosition']])mod.code=mod.code.replaceAll(name,'ocean'+name);
 const oceanModule=surface.module; oceanModule.deps.push(data.field.module);
 // A plunging crest is sub-metre geometry. At aerial CDLOD spacings its
 // vertex normals/foam alias into white diamonds. Retain the native close
 // waves; converge their unresolved component continuously to its mean.
 const shoreReview=new UniformBlock('MuseumShoreDetail',{legacy:['f32',0]});
 oceanModule.deps.push(new ShaderModule({name:'museum-shore-detail',uniforms:shoreReview,uniformName:'museumShoreDetail',code:''}));
 const shoreSeam='let sw = shoreEvaluate( worldXZ, depth, ground );';
 if(!oceanModule.code.includes(shoreSeam))throw Error('Native shore detail seam changed');
 oceanModule.code=oceanModule.code.replace(shoreSeam,`${shoreSeam}
  let resolved=mix(1.0-smoothstep(.75,2.75,spacing),1.0,museumShoreDetail.legacy);`)
  .replace('extra += sw.disp;','extra += sw.disp * resolved;')
  .replace('shoreN = clamp( sw.nShore, vec3f( -1.0 ), vec3f( 1.0 ) );','shoreN = normalize(mix(vec3f(0.0,1.0,0.0),clamp(sw.nShore,vec3f(-1.0),vec3f(1.0)),resolved));')
  .replace('shoreFoam = sw.foam;','shoreFoam = mix(.035*sw.env,sw.foam,resolved);')
  .replace('surfMask = vec2f( sw.face, sw.roller );','surfMask = vec2f(sw.face,sw.roller)*resolved;');
 surface.shoreReview=shoreReview;
 const seam='var o: WaterSurfaceVertex;';if(!oceanModule.code.includes(seam))throw Error('Native sea vertex seam changed');
 oceanModule.code=oceanModule.code.replace(seam,`let estuaryK=museumEstuaryBlend(worldXZ);
 y=mix(y,creekMeanAt(worldXZ),estuaryK);total.x*=1.0-estuaryK;total.z*=1.0-estuaryK;total.y=y-frame.seaLevel;
 shoreN=normalize(mix(shoreN,vec3f(0.0,1.0,0.0),estuaryK));
 var o: WaterSurfaceVertex;`);
 oceanModule.code=oceanModule.code.replace('o.normal = normal;',`let estuaryFade=museumEstuaryBlend(lagXZ);let estuaryGrad=creekGradient(lagXZ);
 o.normal=normalize(mix(normal,normalize(vec3f(-estuaryGrad.x,1.0,-estuaryGrad.y)),estuaryFade));`).replace('o.foam = foam;\n\to.coverage', 'o.foam=foam*(1.0-estuaryFade);\n\to.coverage').replace('o.slopes = slopes;', 'o.slopes=mix(slopes,estuaryGrad,estuaryFade);').replace('o.rough = rough;', 'o.rough=mix(rough,.35,estuaryFade);').replace('o.aeration = sat( aeration );','o.aeration=sat(aeration)*(1.0-estuaryFade);');
 const query=new CreekSeaQuery(engine,surface,data.field,data.terrain);
 const material=new MuseumWaterMaterial({surface,sky,sceneCopy:sceneRenderer.opaqueCopy,sceneDepthHalf:sceneRenderer.opaqueDepthHalf.texture,refraction});material.isMuseumOcean=true;material.inlandField=data.field;
 material.clouds=clouds;material.cameraWaterHeightNode=query.cameraState().x;
 const ocean=new Mesh(oceanLOD.geometry,material);ocean.name='Museum western sea · native Tidewater waves';ocean.frustumCulled=false;ocean.receiveShadow=true;ocean.staticVelocity=true;ocean.layers.set(LAYERS.WATER);scene.add(ocean);
 const spray=new Spray(engine,{query,terrain:terrainGPU,sceneCopy:sceneRenderer.opaqueCopy,clouds});scene.add(spray.mesh);
 // Native buildStations scans its original south-facing bay. Rotate/translate
 // that *input coordinate frame* onto our west-facing coast, then return each
 // station and its outward normal to museum coordinates before the first frame.
 // Height scaling only makes the native allocation scan accept the now much
 // flatter western beach; its zero crossing is unchanged. Before dispatch,
 // TravellingBreakers replaces these stations with actual world coast points.
 const localTerrain={heightAt:(x,z)=>(data.terrain.heightAt(cx-z,cz+x)-G.seaLevel.value)*4};
 const breakers=new TravellingBreakers(engine,{surface,shore,terrainData:localTerrain,actualTerrain:data.terrain,shelf:data.cove.continuous,sky,spray,clouds});
 scene.add(breakers.mesh);
 return {fft,foamTexture,oceanLOD,oceanSurface:surface,seaDetail,shore,shoreSim,surfFoam,caustics,underwaterLighting,query,ocean,oceanMaterial:material,spray,breakers};
}
