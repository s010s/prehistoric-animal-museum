import * as T from 'three'
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js'
import {MeshoptDecoder} from 'three/addons/libs/meshopt_decoder.module.js'
import {encounter} from './field.js'

export async function makeEncounter(scene,apply,stop){
 const gltf=await new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).loadAsync('./assets/apatosaurus.glb');
 const root=gltf.scene;root.name='溪畔迷惑龙';root.scale.setScalar(22/3.2);root.rotation.y=-.45;root.position.set(encounter.x,encounter.y,encounter.z);
 root.traverse(o=>{if(o.isMesh){o.castShadow=o.receiveShadow=true;o.frustumCulled=true}});scene.add(root);apply(root);
 const mixer=new T.AnimationMixer(root);const idle=gltf.animations.find(c=>c.name.toLowerCase().includes('idle'))??gltf.animations[0];if(idle)mixer.clipAction(idle).play();
 const ray=new T.Raycaster(),delta=new T.Vector3();
 const button=document.querySelector('#observe'),dialog=document.querySelector('#animal-dialog');let discovered=false;
 button.onclick=()=>{stop();dialog.showModal();discovered=true;button.textContent='再次观察 · 迷惑龙';document.querySelector('#discovery').textContent='已发现 · 溪畔的巨影'};
 document.querySelector('#animal-dialog .close').onclick=()=>dialog.close();
 return {constrain(position,previous){if(Math.hypot(position.x-encounter.x,position.z-encounter.z)>18||position.y>encounter.y+11)return false;delta.subVectors(position,previous);const travel=delta.length();if(travel<.0001)return false;ray.set(previous,delta.divideScalar(travel));ray.far=travel+.85;const hit=ray.intersectObject(root,true)[0];if(!hit)return false;position.copy(previous).addScaledVector(delta,Math.max(0,hit.distance-.85));return true;},update(time,camera){mixer.setTime(time);const distance=Math.hypot(camera.position.x-encounter.x,camera.position.z-encounter.z);button.hidden=distance>120;button.dataset.distance=distance.toFixed(1);},status:()=>({loaded:true,clip:idle?.name,position:root.position.toArray(),lengthMetres:22,discovered})};
}
