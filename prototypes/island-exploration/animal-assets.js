import {encounter,companion} from './field.js';
// Existing museum assets. Length is calibrated from the loaded geometry.
export const ANIMAL_ASSETS = [
  {id:'apatosaurus',name:'迷惑龙',url:'apatosaurus.glb',source:'src/content/animals/apatosaurus/model/model.glb',lengthMetres:22,yaw:-.45,site:encounter,animationSpeed:.9},
  {id:'triceratops',name:'三角龙',url:'triceratops.glb',source:'src/content/animals/triceratops/model/model.glb',lengthMetres:8.5,yaw:.6,site:companion,animationSpeed:.9},
];
