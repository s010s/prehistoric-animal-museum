import { DoubleSide, LinearMipmapLinearFilter, MeshStandardMaterial, PlaneGeometry, SRGBColorSpace, TextureLoader, type Mesh, type Texture } from 'three'
import manifest from '../assets/ecology-r5/manifest.json'
import views from '../assets/tree-views/manifest.json'
const urls=import.meta.glob<string>('../assets/tree-views/*.png',{query:'?url',import:'default',eager:true})
export interface ImpostorPart {geometry:PlaneGeometry;material:MeshStandardMaterial}
/** Full camera-facing silhouette selected in source-local azimuth/elevation.
 * Explicit mip images are uploaded unchanged; browser mip generation is disabled. */
export async function loadPropImpostors():Promise<Map<string,ImpostorPart[]>>{
 const textures=new Set<Texture>(),parts=new Map<string,ImpostorPart[]>()
 try{
  for(const entry of views){
   const asset=manifest.assets.find(a=>a.id===entry.id)!,images=await Promise.all(entry.levels.map(async level=>{const t=await new TextureLoader().loadAsync(urls[`../assets/tree-views/${level.file}`]!);textures.add(t);return t}))
   const texture=images[0]!;texture.mipmaps=images.map(t=>t.image) as unknown as Texture['mipmaps'];texture.generateMipmaps=false;texture.minFilter=LinearMipmapLinearFilter;texture.colorSpace=SRGBColorSpace;texture.needsUpdate=true
   for(const t of images.slice(1)){t.dispose();textures.delete(t)}
   const size=Math.max(asset.physicalHeight,asset.footprint.radius*2)*1.15,geometry=new PlaneGeometry(size,size),material=new MeshStandardMaterial({map:texture,alphaTest:.42,side:DoubleSide,roughness:.9,metalness:0})
   material.onBeforeCompile=shader=>{
    shader.vertexShader=shader.vertexShader.replace('#include <common>','#include <common>\nvarying vec2 canopyUV;')
    shader.vertexShader=shader.vertexShader.replace('#include <begin_vertex>',`#include <begin_vertex>
vec3 treeCenter=vec3(0.,${(asset.physicalHeight/2).toFixed(8)},0.);
vec3 eyeWorld=cameraPosition-(modelMatrix*instanceMatrix*vec4(treeCenter,1.)).xyz;
vec3 eyeLocal=normalize(vec3(dot(eyeWorld,normalize(instanceMatrix[0].xyz)),dot(eyeWorld,normalize(instanceMatrix[1].xyz)),dot(eyeWorld,normalize(instanceMatrix[2].xyz))));
vec3 right=normalize(cross(vec3(0.,1.,0.),eyeLocal));vec3 up=normalize(cross(eyeLocal,right));
transformed=treeCenter+right*position.x+up*position.y;
float az=mod(floor(atan(-eyeLocal.z,eyeLocal.x)/.785398163+0.5)+8.,8.);
float elevation=clamp(floor(asin(clamp(eyeLocal.y,-1.,1.))/.785398163+1.5),0.,2.);
canopyUV=(vec2(az,2.-elevation)+clamp(uv,vec2(.002),vec2(.998)))/vec2(8.,3.);`)
    shader.fragmentShader=shader.fragmentShader.replace('#include <common>','#include <common>\nvarying vec2 canopyUV;').replace('#include <map_fragment>','diffuseColor *= texture2D(map,canopyUV);')
   }
   material.customProgramCacheKey=()=>`tree-angle-atlas-${asset.id}-v1`
   parts.set(asset.id,[{geometry,material}])
  }
  return parts
 }catch(error){textures.forEach(t=>t.dispose());for(const list of parts.values())for(const p of list){p.geometry.dispose();p.material.dispose()}throw error}
}
export function disposeMeshResources(meshes: Mesh[]) {
  const textures = new Set<Texture>()
  for (const mesh of meshes) {
    mesh.geometry.dispose()
    for (const material of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
      const map = (material as MeshStandardMaterial).map; if (map) textures.add(map)
      material.dispose()
    }
  }
  textures.forEach(t => t.dispose())
}
