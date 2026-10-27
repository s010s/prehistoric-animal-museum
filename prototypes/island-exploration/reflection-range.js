// Opaque, static reflection indices only. The main/collision indices are inputs,
// never mutated. Height buckets allow a conservative O(log buckets) draw range.
export function buildReflectionRange(indices,positions) {
  if(!ArrayBuffer.isView(indices)||!ArrayBuffer.isView(positions)||indices.length%3||positions.length%3)return null;
  if(!indices.length)return {indices:indices.slice(),heights:new Int32Array(),starts:new Uint32Array([0]),minX:0,maxX:0,minZ:0,maxZ:0};
  let minY=Infinity,maxY=-Infinity,minX=Infinity,maxX=-Infinity,minZ=Infinity,maxZ=-Infinity;
  for(let i=0;i<positions.length;i+=3){
    const x=positions[i],y=positions[i+1],z=positions[i+2];
    if(!Number.isFinite(x)||!Number.isFinite(y)||!Number.isFinite(z))return null;
    minX=Math.min(minX,x);maxX=Math.max(maxX,x);minY=Math.min(minY,y);maxY=Math.max(maxY,y);minZ=Math.min(minZ,z);maxZ=Math.max(maxZ,z);
  }
  const base=Math.ceil(minY),bins=Math.ceil(maxY)-base+1;
  if(!Number.isSafeInteger(base)||base< -2147483648||Math.ceil(maxY)>2147483647||bins<=0||bins>65536)return null;
  const counts=new Uint32Array(bins),maxIndex=positions.length/3;
  const bucket=i=>Math.ceil(Math.max(positions[indices[i]*3+1],positions[indices[i+1]*3+1],positions[indices[i+2]*3+1]))-base;
  for(let i=0;i<indices.length;i+=3){
    for(let j=0;j<3;j++)if(!Number.isInteger(indices[i+j])||indices[i+j]<0||indices[i+j]>=maxIndex)return null;
    counts[bucket(i)]++;
  }
  const offsets=new Uint32Array(bins),heights=[],starts=[];let offset=0;
  for(let b=0;b<bins;b++){offsets[b]=offset;if(counts[b]){heights.push(base+b);starts.push(offset);}offset+=counts[b]*3;}
  starts.push(indices.length);
  const cursors=offsets.slice(),ordered=new indices.constructor(indices.length);
  for(let i=0;i<indices.length;i+=3){const b=bucket(i),o=cursors[b];ordered[o]=indices[i];ordered[o+1]=indices[i+1];ordered[o+2]=indices[i+2];cursors[b]+=3;}
  return {indices:ordered,heights:new Int32Array(heights),starts:new Uint32Array(starts),minX,maxX,minZ,maxZ};
}
export function reflectionDrawStart(range,plane) {
  if(!range||!plane||![plane.x,plane.y,plane.z,plane.w].every(Number.isFinite)||plane.y<=1e-6)return 0;
  // The actual world/geometry near plane includes the reflector's oblique bias.
  // Max XZ contribution over every vertex bound makes this conservative even
  // for tilted planes. Bucket upper height and a 5 cm pad retain contacts.
  const maxXZ=Math.max(plane.x*range.minX,plane.x*range.maxX)+Math.max(plane.z*range.minZ,plane.z*range.maxZ);
  const threshold=(-plane.w-maxXZ-.05)/plane.y;
  let lo=0,hi=range.heights.length;
  while(lo<hi){const mid=(lo+hi)>>>1;if(range.heights[mid]<threshold)lo=mid+1;else hi=mid;}
  return range.starts[lo]??0;
}
