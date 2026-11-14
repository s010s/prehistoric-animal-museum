// Folded, opaque leaf ribbons. Each pocket has a more upright centre and a
// broken skirt of weathered leaves. All leaves of a shore share one draw.
import {BufferGeometry, Float32BufferAttribute} from '../vendor/tidewater/src/engine/index.js';
import {Material} from '../vendor/tidewater/src/engine/render/Material.js';
import {mulberry32} from '../vendor/tidewater/src/util/Noise.js';

const ROWS = [0, .29, .58, .83];
const COAST_GREEN = [.108, .195, .106], COAST_STRAW = [.48, .352, .172];
const LAKE_GREEN = [.065, .149, .074], LAKE_STRAW = [.305, .259, .128];

export function createShorePlantMaterial() {
  return new Material({
    name: 'Museum strand and lake foliage', vertexColors: true, side: 'double',
    underwaterLighting: 'lite', localLightsCheap: true,
    attributes: {aShoreFlex: 'vec2f'},
    vertex: `
      let phase=v.aShoreFlex.y;
      let now=frame.time*1.45;
      let prev=(frame.time-frame.dt)*1.45;
      let motion=vec3f(frame.windDir.x,0.0,frame.windDir.y)*min(frame.windSpeed*.13,1.5)*v.aShoreFlex.x;
      v.worldOffset=motion*(sin(now+phase)*.68+sin(now*.54+phase*.42)*.32);
      v.prevWorldOffset=motion*(sin(prev+phase)*.68+sin(prev*.54+phase*.42)*.32);`,
    surface: `
      s.albedo=in.color.rgb;
      s.normal=normalize(in.N+vec3f(0.0,.36,0.0));
      s.translucency=s.albedo*.17;
      s.roughness=.83;s.specularIntensity=.14;`,
  });
}

export function buildShorePlants(plan, ground) {
  const positions=[], colors=[], flex=[], indices=[];
  const {freshwater}=plan.profile;
  const green=freshwater?LAKE_GREEN:COAST_GREEN, straw=freshwater?LAKE_STRAW:COAST_STRAW;
  for (const pocket of plan.plants) for (const clump of pocket.members) {
    const rand=mulberry32(clump.seed),height=clump.size;
    const stature=height/plan.profile.detail.plantHeight[1];
    const blades=Math.floor(6+stature*7+rand()*3),phase=clump.x*.43+clump.z*.36;
    // Neighbouring crowns share a prevailing lay. Individual outer blades
    // arch away from the fan, while a few inner spears carry its high point.
    const fan=Math.atan2(-plan.normal[1],-plan.normal[0])+Math.sin(pocket.x*.047+pocket.z*.021)*.64+(rand()-.5)*.54;
    const leeX=Math.cos(fan),leeZ=Math.sin(fan);
    for (let blade=0;blade<blades;blade++) {
      const skirt=Math.min(1,(blade+rand()*.6)/(blades-1));
      const sideSign=blade%2?1:-1;
      const azimuth=fan+sideSign*(.23+1.63*skirt+rand()*.47);
      const dx=Math.cos(azimuth),dz=Math.sin(azimuth);
      const spread=(.02+skirt*.085)*height;
      const x=clump.x+dx*spread,z=clump.z+dz*spread,y=ground(x,z)-.034;
      const h=height*(.83+rand()*.17)*(1-skirt*.16);
      const arch=(freshwater?.10:.14)+(freshwater?.65:.76)*skirt*skirt;
      const reach=h*(.11+skirt*(freshwater?.59:.89)+rand()*.14);
      const sweep=h*(.09+skirt*(freshwater?.17:.37));
      const width=h*((freshwater?.034:.032)+rand()*(freshwater?.043:.05));
      const curl=sideSign*(.25+.9*skirt)*(rand()*.64+.36);
      const age=rand()*.17+skirt**2*(freshwater?.57:.73);
      const base=positions.length/3;
      const vertex=(t,side,w)=>{
        const bend=t*t,twist=azimuth+curl*bend,ax=Math.cos(twist),az=Math.sin(twist);
        const midrib=(1-Math.abs(side))*w*.46,spread=reach*(t*.19+bend*.81);
        positions.push(x+dx*spread+leeX*sweep*bend-az*w*side+ax*midrib,
          y+h*(1.10*t+arch*(1.8*t-2.65*bend)),
          z+dz*spread+leeZ*sweep*bend+ax*w*side+az*midrib);
        const dry=Math.min(.97,age+t*t*(freshwater?.18:.32));
        const shade=(.52+.51*Math.sqrt(t))*(side===0?1.05:side<0?.89:.98);
        for (let c=0;c<3;c++) colors.push((green[c]*(1-dry)+straw[c]*dry)*shade);
        flex.push(t*t*h*.13,phase+azimuth*.35);
      };
      for (const t of ROWS) {
        const w=width*(1-t*.65)*(.45+.83*Math.sin(Math.PI*t));
        for (const side of [-1,0,1]) vertex(t,side,w);
      }
      vertex(1,0,0);
      for (let row=0;row<ROWS.length-1;row++) for (let face=0;face<2;face++) {
        const a=base+3*row+face;
        indices.push(a,a+3,a+1, a+1,a+3,a+4);
      }
      const end=base+3*(ROWS.length-1), tip=end+3;
      indices.push(end,tip,end+1, end+1,tip,end+2);
    }
  }
  if (!indices.length) return null;
  const g=new BufferGeometry();
  g.setAttribute('position',new Float32BufferAttribute(positions,3));
  g.setAttribute('color',new Float32BufferAttribute(colors,3));
  g.setAttribute('aShoreFlex',new Float32BufferAttribute(flex,2));
  g.setIndex(indices);g.computeVertexNormals();g.computeBoundingSphere();
  // Worst-case tip travel at wind cap, with headroom for the tallest lake leaf.
  g.boundingSphere.radius+=.6;
  return g;
}
