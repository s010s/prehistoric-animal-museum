import * as T from 'three';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {MeshoptDecoder} from 'three/addons/libs/meshopt_decoder.module.js';
import {ANIMAL_ASSETS} from './animal-assets.js';

export async function makeEncounter(scene,apply,stop,groundHeight){
  const loader=new GLTFLoader().setMeshoptDecoder(MeshoptDecoder),instances=[];
  const group=new T.Group();group.name='representative-animals';scene.add(group);
  for(const config of ANIMAL_ASSETS){
    const gltf=await loader.loadAsync('./assets/'+config.url),root=gltf.scene;
    root.updateMatrixWorld(true);
    const sourceBox=new T.Box3().setFromObject(root,true),size=sourceBox.getSize(new T.Vector3());
    const sourceLength=Math.max(size.x,size.z),scale=config.lengthMetres/sourceLength;
    if(!Number.isFinite(scale)||scale<=0)throw Error('Invalid animal dimensions: '+config.id);
    root.name=config.name;root.scale.setScalar(scale);root.rotation.y=config.yaw;
    const ground=groundHeight(config.site.x,config.site.z);
    root.position.set(config.site.x,ground-sourceBox.min.y*scale,config.site.z);
    const contacts=[];let triangles=0,geometryBytes=0;const materials=new Set();
    root.traverse(o=>{if(!o.isMesh)return;o.castShadow=o.receiveShadow=true;o.frustumCulled=true;
      triangles+=(o.geometry.index?.count??o.geometry.attributes.position.count)/3;
      geometryBytes+=Object.values(o.geometry.attributes).reduce((sum,a)=>sum+a.array.byteLength,0)+(o.geometry.index?.array.byteLength??0);
      for(const m of [o.material].flat()){materials.add(m);m.envMapIntensity=.55;m.metalness=0;if(m.aoMap)m.aoMapIntensity=.6;}
    });
    group.add(root);apply(root);root.updateMatrixWorld(true);
    const mixer=new T.AnimationMixer(root),idle=gltf.animations.find(c=>/idle/i.test(c.name));
    if(idle)mixer.clipAction(idle).play();
    // Actual low mesh vertices are contact probes through the idle. The root
    // remains fixed; no whole-body translation pretends to be locomotion.
    const bounds=new T.Box3().setFromObject(root,true),bottom=bounds.min.y,point=new T.Vector3();
    root.traverse(mesh=>{if(!mesh.isMesh)return;const candidates=[];
      for(let i=0;i<mesh.geometry.attributes.position.count;i++){mesh.getVertexPosition(i,point);point.applyMatrix4(mesh.matrixWorld);if(point.y<bottom+.055)candidates.push(i);}
      for(let i=0;i<candidates.length;i+=Math.max(1,Math.floor(candidates.length/24)))contacts.push({mesh,index:candidates[i]});
    });
    instances.push({config,root,mixer,idle,sourceBox,scale,triangles,geometryBytes,materials:materials.size,contacts,contact:null});
  }
  const ray=new T.Raycaster(),delta=new T.Vector3(),point=new T.Vector3();
  const button=document.querySelector('#observe'),dialog=document.querySelector('#animal-dialog');let discovered=false;
  button.onclick=()=>{stop();dialog.showModal();discovered=true;button.textContent='再次观察 · 迷惑龙';document.querySelector('#discovery').textContent='已发现 · 溪畔的巨影'};
  document.querySelector('#animal-dialog .close').onclick=()=>dialog.close();
  return {
    group,
    constrain(position,previous){
      delta.subVectors(position,previous);const travel=delta.length();if(travel<.0001)return false;
      ray.set(previous,delta.divideScalar(travel));ray.far=travel+.85;
      for(const {root,config}of instances){if(Math.hypot(position.x-config.site.x,position.z-config.site.z)>config.lengthMetres||position.y>root.position.y+12)continue;
        const hit=ray.intersectObject(root,true)[0];if(hit){position.copy(previous).addScaledVector(delta,Math.max(0,hit.distance-.85));return true;}}
      return false;
    },
    update(time,camera){
      for(const item of instances){item.mixer.setTime(time*item.config.animationSpeed);item.root.updateMatrixWorld(true);
        let min=Infinity,max=-Infinity;
        for(const {mesh,index}of item.contacts){mesh.getVertexPosition(index,point);point.applyMatrix4(mesh.matrixWorld);const gap=point.y-groundHeight(point.x,point.z);min=Math.min(min,gap);max=Math.max(max,gap);}
        item.contact={probes:item.contacts.length,minGapMetres:min,maxGapMetres:max};
      }
      const site=instances[0].config.site,distance=Math.hypot(camera.position.x-site.x,camera.position.z-site.z);button.hidden=distance>120;button.dataset.distance=distance.toFixed(1);
    },
    status:()=>({loaded:true,discovered,instances:instances.map(i=>({id:i.config.id,clip:i.idle?.name??null,animationSpeed:i.config.animationSpeed,position:i.root.position.toArray(),yaw:i.config.yaw,sourceBounds:{min:i.sourceBox.min.toArray(),max:i.sourceBox.max.toArray()},scale:i.scale,lengthMetres:i.config.lengthMetres,measuredLengthMetres:Math.max(i.sourceBox.max.x-i.sourceBox.min.x,i.sourceBox.max.z-i.sourceBox.min.z)*i.scale,triangles:i.triangles,geometryBytes:i.geometryBytes,materials:i.materials,contact:i.contact}))}),
  };
}
