// Small shore-parallel hard grounds with exposed sand between them. Positions
// come from the settled dive/animal visits, including the actual visitor gaze.
import {Group, Mesh} from '../vendor/tidewater/src/engine/index.js';
import {Material} from '../vendor/tidewater/src/engine/render/Material.js';
import {srgb, terrainShadingModule} from '../vendor/tidewater/src/world/terrain/TerrainShading.js';
import {attachMarineRockProfiles,placeMarineRock,updateMarineRockProfiles} from './MarineRockProfiles.js';
import {Builder} from '../vendor/tidewater/src/world/village/GeoBuilder.js';
import {stone} from '../vendor/tidewater/src/world/debris/DebrisShapes.js';
import {mulberry32} from '../vendor/tidewater/src/util/Noise.js';

const TAU = 2 * Math.PI;
const coastForms = {
  sheltered: ['favosites', 'thecosmilia', 'halysites'],
  exposed: ['halysites', 'flabellum', 'thecosmilia'],
  jurassic: ['thecosmilia'],
  cretaceous: ['micrabacia', 'flabellum'],
  cambrian: ['pirania'],
  carboniferous: ['acrocyathus'],
  neogene: ['flabellum'],
};
// Intersect the visible triangles of the host, so an encrusting colony
// shares its angled contact plane even when its rock is partly embedded.
function rockSurface(batch, x, z) {
  const {pos, idx} = batch;
  let highest = null;
  for (let i = 0; i < idx.length; i += 3) {
    const a = idx[i] * 3, b = idx[i+1] * 3, c = idx[i+2] * 3;
    const bx = pos[b]-pos[a], bz = pos[b+2]-pos[a+2], cx = pos[c]-pos[a], cz = pos[c+2]-pos[a+2];
    const det = bx*cz-bz*cx;
    if (Math.abs(det) < 1e-9) continue;
    const dx = x-pos[a], dz = z-pos[a+2], u = (dx*cz-dz*cx)/det, v = (bx*dz-bz*dx)/det;
    if (u < 0 || v < 0 || u+v > 1) continue;
    const by = pos[b+1]-pos[a+1], cy = pos[c+1]-pos[a+1], y = pos[a+1]+u*by+v*cy;
    if (!highest || y > highest.y) highest = {y, slopeX:(by*cz-cy*bz)/det, slopeZ:(bx*cy-cx*by)/det};
  }
  return highest;
}

function stations(app, data) {
  const out = [];
  for (const [i,site] of data.cove.continuous.divingSites.entries()) {
    out.push({id:site.id, p:site.point, gaze:site.gaze, community:[0,1,2,7].includes(i)?'sheltered':'exposed'});
  }
  const point = data.cove.shelves[1].at(0,175);
  out.push({id:'east-bay-shoal',p:point,gaze:[point[0]-.60, -2.8, point[1]-.80],community:'sheltered'});
  for (const visit of Object.values(app.islandFaunaHabitats.visits)) {
    if (!['marine','benthic'].includes(visit.medium)) continue;
    const bed = data.terrain.heightAt(visit.gaze[0],visit.gaze[2]);
    if (visit.gaze[1]-bed > 11 || -.7-bed > 18) continue;
    const community = ({'cambrian-shelf':'cambrian','coal-age-banks':'carboniferous',
      'jurassic-lagoon':'jurassic','cretaceous-coast':'cretaceous','neogene-sea':'neogene'})[visit.regionId] ?? 'cretaceous';
    out.push({id:visit.id,p:visit.p,gaze:visit.gaze,community,specimen:visit.animalId});
  }
  return out;
}

export class MarineBenthicDetails {
  constructor(app, data, ecology, profiles) {
    const ground = (x,z)=>data.terrain.heightAt(x,z);
    // The strand shader darkens and polishes air-exposed wet stone. For a
    // submerged slab the refracting water surface is already rendered separately.
    this.profiles=profiles;this.lastEye={x:Infinity,y:Infinity,z:Infinity};
    this.material = new Material({name:'Submerged sedimentary ledges',roughness:.91,metalness:0,
      modules:[terrainShadingModule(),app.terrainGPU.module],
      attributes:{tint:'vec3f'},varyings:{vMineral:'vec3f'},vertex:'o.vMineral=v.tint;',
      surface:`
       let p=in.P;
       let rockGrad=terrainImplicitGrad(p);
       let uv=p.xz/vec2f(19.7,16.2);
       let rockTone=textureSample(terrainDetailTex,smpAniso4Repeat,uv).w;
       let rock=terrainRockSurface(p,in.N,p.y,rockTone,.37,0.0,rockGrad);
       let fine=textureSample(terrainDetailTex,smpAniso4Repeat,(p.xz+p.y*.53)/.82).z;
       let silt=(1.0-smoothstep(.008,.13,p.y-terrainHeightAt(p.xz)))*smoothstep(.40,.67,fine+rockTone*.16);
       let scanned=in.vs.vMineral;
       let medium=mix(scanned,rock.albedo,.22)*(.72+.52*fine);
       s.albedo=mix(medium,${srgb(.53,.52,.44)},silt*.41);
       s.normal=terrainPerturbNormal(p,in.N,rock.hd*.56+fine*.0016,1.0);
       s.roughness=.91;s.specularIntensity=.14;s.ao=mix(.72,1.0,rock.height);
      `});
    this.group = new Group();
    this.group.name = 'Marine hard grounds and shell deposits';
    this.patches = [];
    this.coralSites = []; this.shellSites = []; this.spongeSites = [];
    const obstacles = [...app.shelfReef.obstacles,...app.coveRocks.instances].map(p=>({x:p.x,z:p.z,r:p.footRadius??p.radius}));
    for (const p of ecology.sites) if (p.mode===3) obstacles.push({x:p.x,z:p.z,r:p.scale*.45});
    for (const station of stations(app,data)) {
      const {id, p, gaze, community, specimen} = station;
      let seed = 27091;
      for (const c of id) seed = Math.imul(seed,31)+c.charCodeAt(0);
      const random = mulberry32(seed>>>0);
      const heading = Math.atan2(gaze[2]-p[1],gaze[0]-p[0]), dx = Math.cos(heading), dz = Math.sin(heading);
      const existing = obstacles.filter(o=>Math.hypot(o.x-p[0],o.z-p[1]) < 75+o.r);
      const clear = (x,z,r)=>existing.every(o=>(x-o.x)**2+(z-o.z)**2>(o.r+r)**2);
      const territory = (x,z,r)=>{const o={x,z,r};existing.push(o);obstacles.push(o);};
      const wet = (x,z) => {
        const floor = ground(x,z), depth = -.7-floor;
        if (depth < 1.1 || depth > 18 || data.cove.continuous.marineAt(x,z) < .55) return null;
        const [level,edge] = data.field.sample(x,z);
        if (edge<=.05 && level>-.55) return null;
        const gx = ground(x+.5,z)-ground(x-.5,z), gz = ground(x,z+.5)-ground(x,z-.5);
        return Math.hypot(gx,gz) < .32 ? {floor,depth} : null;
      };
      const B = new Builder(), forms = coastForms[community], kinds = new Set();
      const counts = {stones:0,colonies:0,shells:0,seagrass:0};
      const faunaDistance = Math.hypot(gaze[0]-p[0],gaze[2]-p[1]);
      if (specimen) territory(gaze[0],gaze[2],Math.max(.45,Math.min(4,faunaDistance*.32)));
      const inner = specimen ? Math.max(1.8,Math.min(10,faunaDistance*.64)) : 4.7;
      const lush = community==='sheltered' || community==='cretaceous';
      for (let pocket=0; pocket<5; pocket++) {
        const distance = [inner,inner+4,inner+9,inner+17,inner+26][pocket];
        const side = (pocket===0 ? 1 : random()<.55 ? -1 : 1)*(pocket<2?1.0+random()*2.1:1.6+random()*5.2);
        const cx = p[0]+dx*distance-dz*side, cz = p[1]+dz*distance+dx*side;
        const heads = pocket===0 ? 1 : 1+Math.floor(random()*3);
        for (let j=0;j<heads;j++) {
          for (let attempt=0;attempt<12;attempt++) {
            const angle=random()*TAU, r=Math.sqrt(random())*(pocket===0?1.8:3.9);
            const x=cx+Math.cos(angle)*r,z=cz+Math.sin(angle)*r, bed=wet(x,z);
            const scale=.46+random()**1.4*(specimen ? .56 : 1.12);
            if (!bed || !clear(x,z,scale*1.32) || Math.hypot(x-p[0],z-p[1])<1.28+scale) continue;
            // Several overlapping, fractured pieces make one outcrop. They
            // share a bedding direction, with sand covering their lower flanks.
            const host={pos:[],idx:[]},seams=[];
            const trend=heading+(random()-.5)*1.7, pieces=3+Math.floor(random()*3);
            for(let layer=0;layer<pieces;layer++){
              const offset=(layer/(pieces-1)-.5)*1.64*scale, cross=(random()-.5)*.42*scale;
              const rx=x+Math.cos(trend)*offset-Math.sin(trend)*cross,rz=z+Math.sin(trend)*offset+Math.cos(trend)*cross;
              const length=scale*(.56+random()*.49);
              const profile=profiles[(pocket+j+(layer===0?1:0))%profiles.length];
              const tall=length*(.57+random()*.22), lift=ground(rx,rz)-tall*(.21+random()*.10);
              placeMarineRock(profile,host,rx,lift,rz,length*(1.54+random()*.21),tall,length*(.83+random()*.33),
                trend+(random()-.5)*.83,(random()-.5)*.19,(random()-.5)*.23);
              counts.stones++;seams.push({x:rx,z:rz,length});
            }
            territory(x,z,scale*1.46);
            // An irregular ribbon of settlers grows along the ledge. Bare,
            // sediment-covered outcrops interleave with mixed-age clusters.
            const colonies=random()<.27?0:2+Math.floor(random()*4), settled=[];
            for(let member=0;member<colonies;member++){
              const seam=seams[(member+1)%pieces],angle=random()*TAU;
              const radial=seam.length*(.12+random()*.47);
              const sx=seam.x+Math.cos(angle)*radial,sz=seam.z+Math.sin(angle)*radial;
              const top=rockSurface(host,sx,sz);
              if (!top || top.y<ground(sx,sz)+.018 || Math.hypot(top.slopeX,top.slopeZ)>.85) continue;
              const kind=forms[(pocket+member+j)%forms.length], small=['pirania','flabellum','micrabacia'].includes(kind);
              const span=Math.min(scale*.66,small ? .08+random()*.14 : .19+random()*.39);
              if(settled.some(other=>Math.hypot(other.x-sx,other.z-sz)<(span+other.span)*.45))continue;
              const site={x:sx,z:sz,floor:top.y,depth:-.7-top.y,span,yaw:random()*TAU,kind,region:id,
                slopeX:top.slopeX,slopeZ:top.slopeZ,embed:.009+span*.058,range:Math.min(23,5+span*24)};
              (kind==='pirania'?this.spongeSites:this.coralSites).push(site);
              counts.colonies++; kinds.add(kind);settled.push(site);
            }
            break;
          }
        }
        for (let j=0;j<17;j++) {
          const u=(random()-.5)*5, v=(random()-.5)*2.6;
          const x=cx+dx*u-dz*(side*.44+v),z=cz+dz*u+dx*(side*.44+v), bed=wet(x,z);
          if (!bed || !clear(x,z,.12)) continue;
          if (j%3===0) {
            const size=.055+random()**2*.17;
            stone(B,ground,x,z,size,size*(.35+random()*.34),size*(.59+random()*.38),random,
              {detail:0,tint:[.21,.18,.135],palette:.42+random()*.32,sink:.43,angular:.32});
            territory(x,z,size);counts.stones++;
          } else if (j%3===1 && community!=='cambrian' && community!=='carboniferous') {
            const kind=community==='neogene'?'naticarius':community==='jurassic'||community==='cretaceous'||j%2?'trigonia':'naticarius';
            const span=.075+random()*.085;
            this.shellSites.push({x,z,...bed,span,yaw:random()*TAU,lean:random()*.18,embedFraction:.20+random()*.13,kind,region:id,range:3.8+span*22});
            territory(x,z,span*.62);counts.shells++;kinds.add(kind);
          }
        }
        if (!['cambrian','carboniferous','jurassic'].includes(community) && (pocket===1||pocket===2||pocket===4)) {
          // Broken pockets of rhizomes: crowded central shoots, short young
          // leaves at the margin, then several metres of open sand.
          for (let clump=0;clump<(lush?4:2);clump++) {
            const a=random()*TAU,radius=1.3+random()*2.8;
            const ax=cx+Math.cos(a)*radius,az=cz+Math.sin(a)*radius;
            const width=.38+random()*.84,mature=.62+random()*.62,richness=7+Math.floor(random()*12);
            for(let j=0;j<richness;j++){
              const phase=random()*TAU,r=Math.sqrt(random()),u=Math.cos(phase)*r*width*1.45,v=Math.sin(phase)*r*width;
              const x=ax+dx*u-dz*v,z=az+dz*u+dx*v,bed=wet(x,z);
              if(!bed||bed.depth>8||!clear(x,z,.08))continue;
              const scale=mature*(.36+.76*(1-r))*(.80+random()*.49);
              ecology.sites.push({region:id,form:'seagrass',x,y:bed.floor-.018,z,scale,depth:bed.depth,
                mode:3,yaw:random()*TAU,seed:random(),flow:[.085,.032]});
              territory(x,z,.076*scale);counts.seagrass++;
            }
          }
        }
      }
      if (!counts.stones) continue;
      const mesh = new Mesh(B.batch('nature').build(),this.material);
      mesh.name = 'Subtidal outcrops '+id;
      mesh.castShadow=false;mesh.receiveShadow=true;mesh.staticVelocity=true;mesh.visible=false;
      this.group.add(mesh);
      this.patches.push({id,x:p[0],z:p[1],floor:ground(...p),kinds:[...kinds],counts,mesh});
      const regional = ecology.counts[id]??={};
      regional.seagrass=(regional.seagrass??0)+counts.seagrass;
    }
    attachMarineRockProfiles(profiles,this.material,this.group);
    app.scene.add(this.group);
  }
  update(position) {
    const last=this.lastEye;
    if((position.x-last.x)**2+(position.y-last.y)**2+(position.z-last.z)**2<.36)return;
    Object.assign(last,{x:position.x,y:position.y,z:position.z});
    updateMarineRockProfiles(this.profiles,position);
    for (const p of this.patches) p.mesh.visible=Math.hypot(position.x-p.x,position.z-p.z)<74 && Math.abs(position.y-p.floor)<30;
  }
  stats() {return this.patches.map(({id,x,z,floor,kinds,counts,mesh})=>({id,x,z,depth:-.7-floor,kinds,...counts,visible:mesh.visible}));}
  dispose() {
    this.group.removeFromParent();
    for(const p of this.profiles){p.mesh.dispose();p.geometry.dispose();}
    for(const p of this.patches)p.mesh.geometry.dispose();
    this.material.uniformBlock.buffer?.destroy();
    this.material.dispose();
  }
}
