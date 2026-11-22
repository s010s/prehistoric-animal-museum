// Trace only the narrow coastal strip. The 32 m ocean-connectivity chart can
// put its first wet texel tens of metres beyond the physical sea-level line.
const STEP = 8, BIN = 64, REACH = 100;
const key = (x,z) => (x+4096)*8192+z+4096;

export function shorefaceDistance(segments, heightAt, sea) {
  const visited=new Set(), bins=new Map();
  const offsets=[[0,0],[STEP,0],[STEP,STEP],[0,STEP]];
  for (const {point:[cx,cz]} of segments) {
    const bx=Math.floor(cx/STEP), bz=Math.floor(cz/STEP);
    for (let j=bz-6;j<=bz+6;j++) for (let i=bx-6;i<=bx+6;i++) {
      const id=key(i,j);
      if (visited.has(id)) continue;
      visited.add(id);
      const x=i*STEP,z=j*STEP;
      const h=offsets.map(([u,v])=>heightAt(x+u,z+v)-sea);
      if (h.every(y=>y>=0)||h.every(y=>y<0)) continue;
      const edges=[];
      for(let a=0;a<4;a++) {
        const b=(a+1)%4;
        if((h[a]<0)===(h[b]<0)) continue;
        const t=h[a]/(h[a]-h[b]);
        edges.push([x+offsets[a][0]+t*(offsets[b][0]-offsets[a][0]),
          z+offsets[a][1]+t*(offsets[b][1]-offsets[a][1])]);
      }
      if(edges.length===4 && h[0]*h[2]<h[1]*h[3]) edges.push(edges.shift());
      for(let e=0;e+1<edges.length;e+=2){
        const [ax,az]=edges[e], [ex,ez]=edges[e+1], dx=ex-ax,dz=ez-az;
        const line={ax,az,dx,dz,inv:1/Math.max(1e-10,dx*dx+dz*dz)};
        for(let iz=Math.floor((z-REACH)/BIN);iz<=Math.floor((z+STEP+REACH)/BIN);iz++)
          for(let ix=Math.floor((x-REACH)/BIN);ix<=Math.floor((x+STEP+REACH)/BIN);ix++) {
            const bucket=key(ix,iz);
            if(!bins.has(bucket))bins.set(bucket,[]);
            bins.get(bucket).push(line);
          }
      }
    }
  }
  return (x,z)=>{
    const bucket=bins.get(key(Math.floor(x/BIN),Math.floor(z/BIN)));
    if(!bucket)return Infinity;
    let nearest=REACH*REACH;
    for(const {ax,az,dx,dz,inv} of bucket){
      const rx=x-ax,rz=z-az,t=Math.max(0,Math.min(1,(rx*dx+rz*dz)*inv));
      const ex=rx-dx*t,ez=rz-dz*t;
      nearest=Math.min(nearest,ex*ex+ez*ez);
    }
    return nearest<REACH*REACH ? Math.sqrt(nearest) : Infinity;
  };
}
