// Follow material points on the rendered animal. A large distance between
// extrema alone also passes a tail that beats exclusively on one side.
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {gunzipSync} from 'node:zlib';
import {GPU} from '../vendor/tidewater/src/engine/gpu/GPU.js';
import {prepareIslandAquaticMotion} from '../museum/IslandAquaticMotion.js';
import {makeAquaticSteering} from '../museum/IslandMuseumHeadTurn.js';
import {createIslandModelPose, islandModelPieces, parseIslandMuseumModel} from '../museum/IslandMuseumModelData.js';
import {visitAquaticSkin} from './visit-aquatic-skin.mjs';
import lock from '../museum/island-museum-models.lock.json' with {type:'json'};

globalThis.GPUBufferUsage = {STORAGE:1, COPY_DST:2, COPY_SRC:4};
GPU.device = {createBuffer: () => ({destroy(){}})};
GPU.queue = {writeBuffer(){}};
const id = 'dakosaurus';
const bytes = gunzipSync(await readFile(new URL('../museum/assets/island/dakosaurus.glb.gz',import.meta.url)));
const gltf = parseIslandMuseumModel(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset+bytes.byteLength));
await prepareIslandAquaticMotion(gltf,id);
const {pieces,skin} = islandModelPieces(gltf);
const model = createIslandModelPose(gltf,skin);
model.play('Idle',{fade:0});
model.update(0);

// Use the midpoint of the two flanks of each slab. Taking the mean of
// the entire mesh instead gives more weight to the more tessellated side.
const sections = [.75, 0, -.55, -1.06, -1.40];
const slabs = sections.map(() => []);
const fin = [];
for (const [part,piece] of pieces.entries()) {
  const name = gltf.nodes[piece.nodeIndex].name;
  if (!/^base1_(body|tail)/.test(name)) continue;
  visitAquaticSkin(piece,model,([x,y,z],vertex) => {
    const point = {part,vertex,y,z};
    for (const [i,at] of sections.entries()) if (Math.abs(x-at)<.025) slabs[i].push(point);
    if (name.startsWith('base1_tail_back')) fin.push(point);
  });
}
const groups = [];
for (const slab of slabs) {
  slab.sort((a,b) => a.z-b.z);
  const n = Math.floor(slab.length*.13);
  assert(n >= 4,'Missing axial skin cross section');
  groups.push([...slab.slice(0,n),...slab.slice(-n)]);
}
fin.sort((a,b) => a.y-b.y);
const n = Math.floor(fin.length*.05);
assert(n >= 4,'Missing caudal fin skin');
groups.push(fin.slice(0,n), fin.slice(-n));
const members = pieces.map(p => new Uint8Array(p.primitive.attributes.POSITION.count ??
  p.primitive.attributes.POSITION.array.length/3));
for (const [i,points] of groups.entries()) for (const {part,vertex} of points) members[part][vertex] |= 1 << i;

function centers() {
  const c = groups.map(() => [0,0,0]);
  for (const [i,piece] of pieces.entries()) {
    if (!groupsByPiece.has(i)) continue;
    visitAquaticSkin(piece,model,(point,vertex) => {
      const mask = members[i][vertex];
      for (let j=0; mask >> j; j++) {
        if (!(mask & 1 << j)) continue;
        for (let k=0;k<3;k++) c[j][k] += point[k];
      }
    });
  }
  return c.map((p,i) => p.map(v => v/groups[i].length));
}
const groupsByPiece = new Set(groups.flat().map(p => p.part));
const frames = 48;
const metres = lock.animals[id].scale;
const lowerFluke = groups.length-2, upperFluke = groups.length-1;
for (const clip of ['Hover','Swim']) for (const turnRate of [0,-1,1]) {
  model.layers.length = 0;
  const layer = model.play(clip,{fade:0});
  const steer = makeAquaticSteering(id,gltf.nodes,skin);
  steer.follow(turnRate,12);
  const traces = groups.map(() => []);
  for (let i=0;i<frames;i++) {
    layer.time = i/frames*layer.clip.duration;
    model.update(0);
    steer.apply(model);
    const pos = centers(), [chest,hips] = pos;
    const dx = chest[0]-hips[0], dz = chest[2]-hips[2], width = Math.hypot(dx,dz);
    for (const [j,p] of pos.entries()) traces[j].push(metres*((p[2]-hips[2])*dx-(p[0]-hips[0])*dz)/width);
    assert((pos[upperFluke][1]-pos[lowerFluke][1])*metres > .84,'Fluke lost its vertical profile');
  }
  const spans = traces.map(a => [Math.min(...a),Math.max(...a)]);
  const label = clip+' at yaw rate '+turnRate;
  for (const [low,high] of spans.slice(2)) {
    assert(Math.min(-low,high) > (high-low)*.17, label+': caudal skin biased to one side '+low+'..'+high);
  }
  const [root,middle,end] = traces.slice(2,5);
  const peak = wave => wave.indexOf(Math.max(...wave))/frames;
  const delay = (a,b) => (peak(b)-peak(a)+1)%1;
  for (const lag of [delay(root,middle),delay(middle,end)]) {
    assert(lag >= .035 && lag <= .24, label+': lost travelling wave from pelvis to fin');
  }
  for (const lobe of [lowerFluke,upperFluke]) {
    const [low,high] = spans[lobe];
    assert(high-low > 2*(spans[2][1]-spans[2][0]),label+': fluke amplitude did not grow');
  }
  console.log(label, 'lower / upper fluke in metres', spans.slice(lowerFluke).map(pair => pair.map(x=>+x.toFixed(3))));
}
model.dispose();
