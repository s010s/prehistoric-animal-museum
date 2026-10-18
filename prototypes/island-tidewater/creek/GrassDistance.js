// One distance contract for CPU cells, native blade cut and ground handover.
import {ShaderModule,UniformBlock} from '../vendor/tidewater/src/engine/gpu/Shader.js';
import {Vector2} from '../vendor/tidewater/src/engine/index.js';
export function createGrassDistance(){
 const presets={88:[62,87],144:[108,143]};
 const uniforms=new UniformBlock('MuseumGrassDistance',{fade:['vec2f',new Vector2(108,143)],radius:['f32',144]});
 const module=new ShaderModule({name:'museumGrassDistance',uniforms,uniformName:'museumGrassDistance'});
 return {module,uniforms,radius:144,set(radius){radius=Number(radius);if(!presets[radius])throw Error('Unknown grass distance');this.radius=radius;uniforms.fields.fade.value.set(...presets[radius]);uniforms.fields.radius.value=radius;},stats(){return {near:18,mid:46,far:this.radius,fade:uniforms.fields.fade.value.toArray(),distance:'3D root to camera; conservative cell volume on CPU'};}};
}
