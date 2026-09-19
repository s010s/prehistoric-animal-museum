import stochastic from '../assets/lookdev-materials/stochastic.json'
import { DataArrayTexture, LinearFilter, LinearMipmapLinearFilter, MeshStandardMaterial, RepeatWrapping, SRGBColorSpace, TextureLoader, Vector2, Vector4, type Texture } from 'three'
import manifest from '../assets/lookdev-materials/manifest.json'
import inverseUrl from '../assets/lookdev-materials/inverse-all.png?url'
import albedoUrl from '../assets/lookdev-materials/albedo-atlas.webp?url'
import gaussianUrl from '../assets/lookdev-materials/gaussian-atlas.webp?url'
import normalUrl from '../assets/lookdev-materials/normal-atlas.webp?url'
import armUrl from '../assets/lookdev-materials/arm-atlas.webp?url'
import groundcoverGaussianUrl from '../assets/lookdev-materials/leafy_grass-gaussian.webp?url'
import groundcoverNormalUrl from '../assets/lookdev-materials/leafy_grass-normal.webp?url'
import groundcoverArmUrl from '../assets/lookdev-materials/leafy_grass-arm.webp?url'
import {flipRgbaRows,unpackMaterialAtlas} from './material-array'
/** Shared art-trial library. Albedo is sRGB; ARM/OpenGL normals are linear data. */
export async function loadLookdevMaterials(){
 const textures:Texture[]=[],materials:MeshStandardMaterial[]=[]
 try {
  const loader=new TextureLoader(),inverse=await loader.loadAsync(inverseUrl);inverse.generateMipmaps=false;inverse.minFilter=inverse.magFilter=LinearFilter;textures.push(inverse)
  const [albedoImage,gaussianImage,normalImage,armImage]=await Promise.all([loader.loadAsync(albedoUrl),loader.loadAsync(gaussianUrl),loader.loadAsync(normalUrl),loader.loadAsync(armUrl)])
  const cell=544,columns=3,rows=Math.ceil(manifest.entries.length/columns)
  const unpack=(image:Texture)=>{
   const canvas=document.createElement('canvas');canvas.width=columns*cell;canvas.height=rows*cell
   const context=canvas.getContext('2d',{willReadFrequently:true})
   if(!context)throw new Error('2D canvas unavailable for terrain material array')
   context.drawImage(image.image as CanvasImageSource,0,0)
   const data=unpackMaterialAtlas(context.getImageData(0,0,canvas.width,canvas.height).data,canvas.width,canvas.height,manifest.entries.length)
   const array=new DataArrayTexture(data,512,512,manifest.entries.length)
   array.wrapS=array.wrapT=RepeatWrapping;array.magFilter=LinearFilter;array.minFilter=LinearMipmapLinearFilter
   array.generateMipmaps=true;array.anisotropy=4;array.needsUpdate=true;textures.push(array)
   image.dispose()
   return array
  }
  const map=unpack(albedoImage),gaussian=unpack(gaussianImage),normalMap=unpack(normalImage),arm=unpack(armImage)
  map.colorSpace=SRGBColorSpace
  for(const [index,entry] of manifest.entries.entries()){
   const stat=stochastic.find(s=>s.id===entry.id)!
   const col=index%columns,row=Math.floor(index/columns)
   const atlasRect=new Vector4((col*cell+16)/(columns*cell),((rows-row-1)*cell+16)/(rows*cell),512/(columns*cell),512/(rows*cell))
   materials.push(new MeshStandardMaterial({name:entry.role,map,normalMap,normalScale:new Vector2(.65,.65),aoMap:arm,roughnessMap:arm,roughness:entry.role==='wet-sand'?.72:entry.role==='river-mud'?.82:1,metalness:0}))
   materials[materials.length-1]!.userData.stochastic={gaussian,inverse,metresPerRepeat:entry.metresPerRepeat,atlasRect,source:stat.id}
  }
  // A0 review only: compare the same source/LUT and world UVs without the
  // multi-material atlas. Never download these extra textures in the visitor path.
  if(import.meta.env.DEV&&new URLSearchParams(location.search).get('flightA0')==='standalone'){
   const [independentGaussian,independentNormal,independentArm]=await Promise.all([
    loader.loadAsync(groundcoverGaussianUrl),loader.loadAsync(groundcoverNormalUrl),loader.loadAsync(groundcoverArmUrl),
   ])
   const standalone=(texture:Texture)=>{
    const canvas=document.createElement('canvas');canvas.width=canvas.height=512
    const context=canvas.getContext('2d',{willReadFrequently:true});if(!context)throw new Error('2D canvas unavailable for terrain A0')
    context.drawImage(texture.image as CanvasImageSource,0,0)
    const data=flipRgbaRows(context.getImageData(0,0,512,512).data,512,512)
    const array=new DataArrayTexture(data,512,512,1)
    array.wrapS=array.wrapT=RepeatWrapping;array.magFilter=LinearFilter;array.minFilter=LinearMipmapLinearFilter
    array.generateMipmaps=true;array.anisotropy=4;array.needsUpdate=true;textures.push(array);texture.dispose();return array
   }
   const groundcover=materials[5]!.userData.stochastic as {independent?:{gaussian:Texture;normal:Texture;arm:Texture}}
   groundcover.independent={gaussian:standalone(independentGaussian),normal:standalone(independentNormal),arm:standalone(independentArm)}
  }
  return {materials,textures,dispose(){materials.forEach(m=>m.dispose());textures.forEach(t=>t.dispose())}}
 }catch(error){materials.forEach(m=>m.dispose());textures.forEach(t=>t.dispose());throw error}
}
