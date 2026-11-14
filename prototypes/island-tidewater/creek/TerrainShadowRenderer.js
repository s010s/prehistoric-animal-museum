import {GPU} from '../vendor/tidewater/src/engine/gpu/GPU.js';
import {InstancedBufferGeometry, InstancedBufferAttribute} from '../vendor/tidewater/src/engine/geometry/index.js';

// The native CDLOD snap + morph can move a vertex left by one grid spacing.
// Expand by 2 m for rounding and by the coarsest height texel for the bilinear
// taps. boundsFor encloses the contributing regional and fine height layers.
function terrainBox(data, x, z, size, spacing) {
  const x0=x-spacing-2, z0=z-spacing-2, x1=x+size+2, z1=z+size+2;
  const pad=data.texel+2;
  let [y0,y1]=data.boundsFor(x0-pad,z0-pad,x1+pad,z1+pad);
  if(!Number.isFinite(y0)||!Number.isFinite(y1)||y0>y1)return null;
  if(x0< -16370||z0< -16370||x1>16370||z1>16370)y0=Math.min(y0,-90);
  y0-=2;y1+=2;
  return {x:(x0+x1)/2, y:(y0+y1)/2, z:(z0+z1)/2, rx:(x1-x0)/2, ry:(y1-y0)/2, rz:(z1-z0)/2};
}

function outsideMap(box, matrix, margin) {
  // Test the two lateral axes; the depth range and native depth bias play no role.
  for(let i=0;i<2;i++) {
    const ax=matrix[i]*box.x, ay=matrix[i+4]*box.y, az=matrix[i+8]*box.z, t=matrix[i+12];
    const extent=Math.abs(matrix[i])*box.rx+Math.abs(matrix[i+4])*box.ry+Math.abs(matrix[i+8])*box.rz;
    const error=2e-6*(Math.abs(ax)+Math.abs(ay)+Math.abs(az)+Math.abs(t)+extent+1);
    if(Math.abs(ax+ay+az+t)>1+extent+margin+error)return true;
  }
  return false;
}

function makePacket(geometry, capacity, cascade, index) {
  const copy=new InstancedBufferGeometry();
  const nodes=new InstancedBufferAttribute(new Float32Array(capacity*4),4);
  // The source attributes are immutable. The native renderer owns GPU buffers
  // per geometry, so each cascade has its own buffers and disposal event.
  copy.setAttribute('position',geometry.attributes.position);
  copy.setAttribute('nodeData',nodes);copy.setIndex(geometry.index);copy.instanceCount=0;
  return {copy,nodes,cascade,label:'shadow cascade '+index,matrix:new Float32Array(16),frame:-1,version:-1};
}

// Pass this object only to shadows.render(). The normal scene renderer and the
// dynamic shadow cache keep their original targets, schedules and draw methods.
export class TerrainShadowRenderer {
  constructor(terrain,shadows,renderer) {
    this.terrain=terrain;this.shadows=shadows;this.native=renderer;this.packets=[];
    this.boxes=new Map();this.enabled=true;
    const {lod,data,mesh,material}=terrain, geo=lod.geometry, pos=geo.attributes.position, idx=geo.index;
    if(lod.G!==64||lod.leafSize!==8||data.size!==32768||data.texel!==16||!data.boundsFor||
       mesh.geometry!==geo||mesh.material!==material||mesh.isInstancedMesh||mesh.frustumCulled||
       geo.indirect||geo.groups.length||geo.drawRange.start!==0||geo.drawRange.count<idx?.count||
       pos?.count!==4225||idx?.count!==24576||geo.attributes.nodeData!==lod.nodeAttr||
       material.attributes.nodeData!=='vec4f'||shadows.cascades.length!==3)return;
    this.source={geo,material,vertex:material.vertex,pos,idx,posArray:pos.array,idxArray:idx.array,positions:pos.version,indices:idx.version,
      attributes:geo.attributesVersion,nodes:lod.nodeArray,bounds:data.boundsFor};
    this.packets=shadows.cascades.map((cascade,i)=>makePacket(geo,lod.maxInstances,cascade,i));
  }

  // DynamicMuseumShadows uses these native entry points for its unchanged
  // animal draws and scissored restores. Keep `this` bound to the real renderer.
  get precompiling(){return this.native.precompiling;}
  get syncPipelines(){return this.native.syncPipelines;}
  set syncPipelines(value){this.native.syncPipelines=value;}
  get stats(){return this.native.stats;}
  _beginFrame(){return this.native._beginFrame();}
  collect(scene,pass){return this.native.collect(scene,pass);}
  drawItems(renderPass,items,pass){return this.native.drawItems(renderPass,items,pass);}

  prepare(packet,pass) {
    const {lod,data,mesh}=this.terrain, s=this.source, g=s.geo;
    if(mesh.geometry!==g||mesh.material!==s.material||mesh.frustumCulled||s.material.vertex!==s.vertex||
       s.attributes!==g.attributesVersion||g.attributes.position!==s.pos||g.index!==s.idx||
       s.pos.array!==s.posArray||s.idx.array!==s.idxArray||s.pos.version!==s.positions||s.idx.version!==s.indices||
       g.indirect||g.groups.length||g.drawRange.start!==0||g.drawRange.count<g.index.count||
       geoChanged(lod,g,s)||data.boundsFor!==s.bounds)return false;
    const values=pass.frameBlock.fields.viewProj.value.elements, m=packet.matrix;
    if(packet.frame===GPU.frame) {
      if(packet.version!==lod.nodeAttr.version)return false;
      for(let i=0;i<16;i++)if(m[i]!==Math.fround(values[i]))return false;
      return true;
    }
    m.set(values);
    for(let i=0;i<16;i++)if(!Number.isFinite(m[i]))return false;
    if(m[3]!==0||m[7]!==0||m[11]!==0||m[15]!==1)return false;
    // The current field is immutable. Bound the cache even after long travel.
    if(this.boxes.size>8192)this.boxes.clear();
    let kept=0;
    const margin=4/this.shadows.size, src=lod.nodeArray, dst=packet.nodes.array;
    for(let i=0;i<lod.count;i++) {
      const k=i*4,x=src[k],z=src[k+1],size=src[k+2],level=src[k+3];
      const spacing=lod.params.fields.morph.value[level]?.z;
      const full=size===64*spacing;
      if((full||size===32*spacing)&&spacing===2**level/8&&level>=0&&level<=12&&Number.isInteger(level)&&
         Number.isInteger(x/spacing)&&Number.isInteger(z/spacing)&&Number.isInteger(x/4)&&Number.isInteger(z/4)&&x>=-16384&&z>=-16384&&x+size<=16384&&z+size<=16384) {
        // Injective integer packing of two 4 m grid indices, level and node size.
        const key=(((x+16384)/4*8193+(z+16384)/4)*32)+2*level+Number(full);
        let box=this.boxes.get(key);
        if(!box){box=terrainBox(data,x,z,size,spacing);if(box)this.boxes.set(key,box);}
        if(box&&outsideMap(box,m,margin))continue;
      }
      const target=kept++*4;dst[target]=x;dst[target+1]=z;dst[target+2]=size;dst[target+3]=level;
    }
    packet.frame=GPU.frame;packet.version=lod.nodeAttr.version;packet.copy.instanceCount=kept;
    if(kept&&kept<lod.count){packet.nodes.clearUpdateRanges();packet.nodes.addUpdateRange(0,kept*4);packet.nodes.needsUpdate=true;}
    return true;
  }

  render(scene,pass) {
    if(this.enabled&&!this.native.precompiling&&pass.kind==='depth'&&pass.depthFormat==='depth32float'&&
       pass.depthCompare==='less-equal'&&!pass.items&&!pass.scissorRect&&!pass.viewport) {
      for(const packet of this.packets) {
        if(pass.camera!==packet.cascade.camera||pass.frameBlock!==packet.cascade.block||pass.label!==packet.label)continue;
        if(!this.prepare(packet,pass)||packet.copy.instanceCount===this.terrain.lod.count)break;
        const mesh=this.terrain.mesh, original=mesh.geometry;
        mesh.geometry=packet.copy;
        try{return this.native.render(scene,pass);}finally{mesh.geometry=original;}
      }
    }
    return this.native.render(scene,pass);
  }

  dispose() {
    this.enabled=false;this.boxes.clear();const packets=this.packets;this.packets=[];
    const release=()=>{for(const packet of packets)packet.copy.dispose();};
    if(GPU.encoder)GPU.onSubmit(null,release);else release();
  }
}

function geoChanged(lod,geo,source) {
  return lod.geometry!==geo||lod.nodeArray!==source.nodes||geo.attributes.nodeData!==lod.nodeAttr||
    lod.nodeAttr.array!==source.nodes||geo.instanceCount!==lod.count||lod.count>lod.maxInstances;
}
