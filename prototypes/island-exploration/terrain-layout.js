import {SIZE,riverX,halfWidth,tributaryX} from './field.js'
const ROOT=64,DETAIL=8,corridor=new Set(),key=(x,z)=>`${x},${z}`
// Fixed geography, independent of camera/quality. A dry buffer places the 8/64 m
// transition outside the river banks, preserving narrow beds at every distance.
for(const [from,to,center,width]of [[-4000,4320,riverX,halfWidth],[100,5700,tributaryX,()=>18]])for(let z=from;z<=to;z+=8){const x=center(z),pad=width(z)+64;for(let rz=Math.floor((z-64)/64)*64;rz<=z+64;rz+=64)for(let rx=Math.floor((x-pad)/64)*64;rx<=x+pad;rx+=64)corridor.add(key(rx,rz))}
const refined=(x,z)=>corridor.has(key(Math.floor(x/64)*64,Math.floor(z/64)*64))
export function farEdgeStep(x,z){if(x%64===0&&(refined(x-1,z-.01)||refined(x,z-.01)||refined(x-1,z+.01)||refined(x,z+.01)))return DETAIL;if(z%64===0&&(refined(x-.01,z-1)||refined(x-.01,z)||refined(x+.01,z-1)||refined(x+.01,z)))return DETAIL;return ROOT}
const tileCache=new Map()
function tile(x,z){const k=key(x,z);if(tileCache.has(k))return tileCache.get(k);const fine=refined(x,z),points=[],indices=[];let polygon=null
 if(fine){for(let iz=0;iz<=8;iz++)for(let ix=0;ix<=8;ix++)points.push([x+ix*8,z+iz*8]);for(let iz=0;iz<8;iz++)for(let ix=0;ix<8;ix++){const a=iz*9+ix,b=a+9;indices.push(a,b,a+1,b,b+1,a+1)}}
 else{polygon=[];const edges=[[x,z,0,64,refined(x-1,z)],[x,z+64,64,0,refined(x,z+64)],[x+64,z+64,0,-64,refined(x+64,z)],[x+64,z,-64,0,refined(x,z-1)]];for(const[ax,az,dx,dz,detail]of edges){const count=detail?8:1;for(let i=0;i<count;i++)polygon.push([ax+dx*i/count,az+dz*i/count])}
  points.push(...polygon);if(polygon.length===4)indices.push(0,1,3,1,2,3);else{const c=points.length;points.push([x+32,z+32]);for(let i=0;i<c;i++)indices.push(c,i,(i+1)%c)}
 }
 const result={x,z,fine,points,indices};if(fine||points.length>4)tileCache.set(k,result);return result
}
function triangleWeights(x,z,a,b,c){const den=(b[1]-c[1])*(a[0]-c[0])+(c[0]-b[0])*(a[1]-c[1]),u=((b[1]-c[1])*(x-c[0])+(c[0]-b[0])*(z-c[1]))/den,v=((c[1]-a[1])*(x-c[0])+(a[0]-c[0])*(z-c[1]))/den;return [u,v,1-u-v]}
export function farTriangle(x,z){const gx=Math.floor(x/64)*64,gz=Math.floor(z/64)*64,t=tile(gx,gz);if(t.fine||t.points.length===4){const s=t.fine?8:64,ax=Math.floor(x/s)*s,az=Math.floor(z/s)*s,u=(x-ax)/s,v=(z-az)/s;return u+v<=1?{points:[[ax,az],[ax+s,az],[ax,az+s]],weights:[1-u-v,u,v]}:{points:[[ax+s,az+s],[ax,az+s],[ax+s,az]],weights:[u+v-1,1-u,1-v]}}
 for(let i=0;i<t.indices.length;i+=3){const points=t.indices.slice(i,i+3).map(j=>t.points[j]),weights=triangleWeights(x,z,...points);if(Math.min(...weights)>=-1e-8)return {points,weights}}
 throw Error('No terrain triangle at '+key(x,z))
}
let cachedLayout
export function farLayout(){if(cachedLayout)return cachedLayout;const positions=[],indices=[],ranges=[],vertexMap=new Map();const vertex=p=>{const k=key(...p);if(!vertexMap.has(k)){vertexMap.set(k,positions.length);positions.push(p)}return vertexMap.get(k)}
 for(let z=-SIZE/2;z<SIZE/2;z+=64)for(let x=-SIZE/2;x<SIZE/2;x+=64){const t=tile(x,z),ids=t.points.map(vertex),start=indices.length;for(const i of t.indices)indices.push(ids[i]);ranges.push({x,z,start,count:indices.length-start})}
 return cachedLayout={positions,indices:new Uint32Array(indices),ranges,refinedTiles:corridor.size}
}
export function farIndicesForHole(x,z,size){const layout=farLayout(),out=new Uint32Array(layout.indices.length);let used=0;for(const r of layout.ranges){if(Math.abs(r.x+32-x)<size/2&&Math.abs(r.z+32-z)<size/2)continue;out.set(layout.indices.subarray(r.start,r.start+r.count),used);used+=r.count}return out.subarray(0,used)}
