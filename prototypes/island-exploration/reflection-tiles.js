// Index-only spatial ownership. Bounds use referenced vertices, not nominal
// cell rectangles. Main/collision buffers are never modified or duplicated.
export function buildReflectionTiles(indices,positions,size=512) {
  if(!ArrayBuffer.isView(indices)||!ArrayBuffer.isView(positions)||indices.length%3||positions.length%3||!Number.isFinite(size)||size<=0||indices.length>12000000)return null;
  if(!indices.length)return [];
  const vertices=positions.length/3,cells=new Map();
  for(const p of positions)if(!Number.isFinite(p))return null;
  for(const k of indices)if(!Number.isInteger(k)||k<0||k>=vertices)return null;
  const keyAt=i=>{const a=indices[i]*3,b=indices[i+1]*3,c=indices[i+2]*3,x=Math.floor((positions[a]+positions[b]+positions[c])/(3*size)),z=Math.floor((positions[a+2]+positions[b+2]+positions[c+2])/(3*size));return x>=-32768&&x<32768&&z>=-32768&&z<32768?(x+32768)*65536+z+32768:null;};
  const heightAt=i=>Math.ceil(Math.max(positions[indices[i]*3+1],positions[indices[i+1]*3+1],positions[indices[i+2]*3+1]));
  for(let i=0;i<indices.length;i+=3){
    const key=keyAt(i),h=heightAt(i);if(key===null||h< -2147483648||h>2147483647)return null;
    let cell=cells.get(key);if(!cell){if(cells.size>=4096)return null;cell={key,count:0,minHeight:h,maxHeight:h,bounds:new Float64Array([Infinity,Infinity,Infinity,-Infinity,-Infinity,-Infinity])};cells.set(key,cell);}
    cell.count++;cell.minHeight=Math.min(cell.minHeight,h);cell.maxHeight=Math.max(cell.maxHeight,h);
    for(let j=0;j<3;j++){const k=indices[i+j]*3;for(let a=0;a<3;a++){cell.bounds[a]=Math.min(cell.bounds[a],positions[k+a]);cell.bounds[a+3]=Math.max(cell.bounds[a+3],positions[k+a]);}}
  }
  for(const cell of cells.values()){
    const bins=cell.maxHeight-cell.minHeight+1;if(bins>65536)return null;
    cell.histogram=new Uint32Array(bins);cell.indices=new indices.constructor(cell.count*3);
  }
  for(let i=0;i<indices.length;i+=3){const cell=cells.get(keyAt(i));cell.histogram[heightAt(i)-cell.minHeight]++;}
  for(const cell of cells.values()){
    const heights=[],starts=[],cursor=new Uint32Array(cell.histogram.length);let offset=0;
    for(let h=0;h<cell.histogram.length;h++){cursor[h]=offset;if(cell.histogram[h]){heights.push(h+cell.minHeight);starts.push(offset);}offset+=cell.histogram[h]*3;}starts.push(offset);cell.cursor=cursor;
    const b=cell.bounds;cell.range={indices:cell.indices,heights:new Int32Array(heights),starts:new Uint32Array(starts),minX:b[0],maxX:b[3],minZ:b[2],maxZ:b[5]};
  }
  for(let i=0;i<indices.length;i+=3){const cell=cells.get(keyAt(i)),h=heightAt(i)-cell.minHeight,o=cell.cursor[h];cell.indices[o]=indices[i];cell.indices[o+1]=indices[i+1];cell.indices[o+2]=indices[i+2];cell.cursor[h]+=3;}
  return [...cells.values()].sort((a,b)=>a.key-b.key).map(({indices,bounds,range})=>({indices,bounds,range}));
}
