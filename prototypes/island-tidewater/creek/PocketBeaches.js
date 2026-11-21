// Two secondary coasts expose different cross sections of the island. Compose
// the headlands, beach face and shoreface in the physical height grids before
// the connected-water chart, the wave travel field and the colliders are built.
export const pocketBeachSites = {
  'east-pocket-beach': {x:10386, z:160, nx:1, nz:-.105, reach:1, relief:1, dip:.19, bluff:true},
  'north-pocket-beach': {x:5224, z:-7336, nx:.68, nz:-.733, reach:.76, relief:.72, dip:-.14, bluff:false},
};
const beaches = Object.values(pocketBeachSites);
const sea = -.7;
const smooth = (a,b,x) => {
  const t = Math.max(0,Math.min(1,(x-a)/(b-a)));
  return t*t*(3-2*t);
};
const bell = x => Math.exp(-x*x);
const halfLength = 416;
const step = 8;

function coastSection(site,along,heightAt) {
  const length=Math.hypot(site.nx,site.nz),nx=site.nx/length,nz=site.nz/length;
  const x=site.x-nz*along,z=site.z+nx*along;
  let lo=-320,hi=320;
  if(heightAt(x+nx*lo,z+nz*lo)<=sea || heightAt(x+nx*hi,z+nz*hi)>sea)
    throw Error('Pocket beach no longer meets the open sea');
  for(let i=0;i<14;i++){
    const mid=(lo+hi)*.5;
    if(heightAt(x+nx*mid,z+nz*mid)>sea) lo=mid;
    else hi=mid;
  }
  return (lo+hi)*.5;
}

// Slabs break off the two resistant noses. Trace the finished intertidal
// contour so the blocks below a ledge toe through the actual water surface.
export function placePocketRocks(terrain, add) {
  const heightAt=(x,z)=>terrain.heightAt(x,z);
  for(const site of beaches){
    const length=Math.hypot(site.nx,site.nz),nx=site.nx/length,nz=site.nz/length;
    const position=(a,d)=>{
      const across=coastSection(site,a,heightAt)+d;
      return [site.x-nz*a+nx*across,site.z+nx*a+nz*across];
    };
    const strike=Math.atan2(-nz,nx)+site.dip;
    for(const [center,strength] of [[126,1],[-187,.64]]){
      for(const [offset,offshore,size,style,flat] of [
        [-26,-9,10,1,.93],[-18,-5,10.5,2,.83],[-8,-14,16,1,1],
        [6,-11,13.2,1,.97],[17,-5,12,2,.85],[29,-11,7,0,.9],
        [-7,4,9.8,2,.73],[3,10,7.8,2,.65],[13,14,4.3,1,.95],
        [20,24,3.2,2,.74],[27,33,7.2,1,1.02],[31,37,3.6,2,.78],[-31,3,4.9,2,.64],
      ]){
        const a=center+offset*strength*site.reach;
        add(...position(a,offshore*site.reach),size*strength*site.relief,style,flat,strike);
      }
    }
    // A detached pavement on one shoulder comes to the surface below the
    // curl of the bay. The sand in the middle stays open to walkers/swimmers.
    for(const [a,d,size] of [[-12,3,2.1],[-8,5,1.8],[-5,5.6,1.3],[1,8,.73],[6,9.4,.51]]){
      add(...position(a*site.reach,d),size*site.relief,2,.66,strike);
    }
    // Different faults meet the strand in the two bays. The east bank
    // exposes a tilted bluff with fall blocks at its foot. The north bank
    // has a low tidal pavement interrupted by water-filled joints.
    const exposures=site.bluff?[
      [41,-6,4.5,2,.67],[50,-11,8.6,1,.90],[58,-15,12.4,1,.96],
      [69,-14,10.2,2,1.08],[79,-22,13.5,1,.89],[91,-22,10.1,2,.91],
      [59,-.8,4.2,1,.75],[52,3.5,3.7,2,.57],[42,8,2.3,2,.58],
      [33,5.5,.88,0,.76],[67,16,3.8,1,.88],
    ]:[
      [-104,3.5,2.9,2,.52],[-109,5.0,3.6,2,.54],[-114,8,2.4,2,.56],
      [-120,11,3.2,2,.68],[-126,13,3.4,1,.63],[-136,11,4.8,2,.69],
      [-140,19,2.7,1,.84],[-146,23,1.8,2,.73],[-154,22,3.8,0,.95],
    ];
    for(const [a,d,size,style,flat] of exposures) add(...position(a,d),size,style,flat,strike);
  }
}

export function sculptPocketBeaches(grids, heightAt) {
  // Trace each original strand before mutating any resolution. Alongshore
  // curvature and the join to the existing coastal hills survive the edit.
  const pockets = beaches.map(site => {
    const length = Math.hypot(site.nx,site.nz), nx = site.nx/length, nz = site.nz/length;
    const edges = [];
    for(let a=-halfLength;a<=halfLength;a+=step){
      edges.push(coastSection(site,a,heightAt));
    }
    return {...site,nx,nz,edges};
  });
  function section(p,x,z) {
    const dx=x-p.x,dz=z-p.z, a=-dx*p.nz+dz*p.nx;
    if(Math.abs(a)>=halfLength) return null;
    const u=(a+halfLength)/step,i=Math.floor(u);
    const dist=dx*p.nx+dz*p.nz-(p.edges[i]+(p.edges[i+1]-p.edges[i])*(u-i));
    if(dist<=-160||dist>=200) return null;
    const weight=(1-smooth(325,halfLength,Math.abs(a)))*smooth(-160,-88,dist)*(1-smooth(112,200,dist));
    const head=bell((a-126)/55),spur=bell((a+187)/77);
    const pocket=bell((a+42)/94);
    const offset=(72*head+44*spur-22*pocket)*p.reach;
    return {a,d:dist-offset,head,spur,weight};
  }
  for(const g of grids){
    const [cx,cz]=g.center??[0,0],ox=cx-g.size/2,oz=cz-g.size/2;
    for(const p of pockets){
      const minX=Math.max(0,Math.floor((p.x-620-ox)/g.texel)),maxX=Math.min(g.res-1,Math.ceil((p.x+620-ox)/g.texel));
      const minZ=Math.max(0,Math.floor((p.z-620-oz)/g.texel)),maxZ=Math.min(g.res-1,Math.ceil((p.z+620-oz)/g.texel));
      for(let j=minZ;j<=maxZ;j++)for(let i=minX;i<=maxX;i++){
        const x=ox+(i+.5)*g.texel,z=oz+(j+.5)*g.texel,s=section(p,x,z);
        if(!s) continue;
        const {a,d,head,spur,weight}=s,k=j*g.res+i;
        // A rounded beach berm gives way below water to a trough and low
        // offshore bar. Both fade out around the more resistant rock points.
        const rock=Math.max(head,spur*.86),inland=Math.max(0,-d),off=Math.max(0,d);
        const face=sea+inland*.067+1.15*bell((inland-27)/13)*smooth(0,14,inland)
          -off*.051+.72*bell((off-80-Math.sin(a*.017)*10)/17)*smooth(18,45,off);
        const strike=a+p.dip*d;
        const ridge=10+8*bell((strike-116)/43)+3.7*Math.sin(strike*.058)+2.3*Math.sin(strike*.112+.8);
        const crest=1-Math.exp(-inland/24);
        const ledge=2.3*smooth(5,12,inland)-1.6*smooth(18,29,inland)+
          2.2*bell((inland-32-7*Math.sin(strike*.046))/10);
        const crags=(11.5*bell((strike-123)/19)+5.2*bell((strike-162)/16)+
          7.3*bell((strike+172)/24))*bell((inland-42)/27)*smooth(1,18,inland);
        const shoulder=sea+(ridge*crest+ledge+crags)*p.relief-
          Math.min(off*.12,7.5)+1.05*bell((off-11)/7)*smooth(0,8,off);
        const scar=p.bluff?bell((a-68)/30):0;
        const cutBank=scar*smooth(1,13,inland)*(1-smooth(26,48,inland));
        const h=face+(shoulder-face)*rock+6.8*cutBank;
        g.heights[k]+=(h-g.heights[k])*weight;
        // Fractured faces remain exposed. Stable shoulders behind their brow
        // trap soil in hollows and can support wind-pruned stands.
        const soilPocket=smooth(40,84,inland)*(1-smooth(1,5,crags));
        const exposed=Math.max(.07+rock*(.87-.55*soilPocket),.91*cutBank);
        g.rock[k]+=(exposed-g.rock[k])*weight;
      }
    }
  }
  return (x,z)=>{
    for(const p of pockets){
      if(Math.abs(x-p.x)>620||Math.abs(z-p.z)>620) continue;
      const s=section(p,x,z);
      if(s) return s.weight;
    }
    return 0;
  };
}
