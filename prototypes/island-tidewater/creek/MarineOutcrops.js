import {BufferAttribute, Matrix4, Quaternion, Vector3} from '../vendor/tidewater/src/engine/index.js';
import {createConch, createFingers, createHalimeda, createMound, createTubes, createPlates, createRubble, createSargassum, createSeaRod} from '../vendor/tidewater/src/world/reef/ReefGeometry.js';
import {mulberry32} from '../vendor/tidewater/src/util/Noise.js';
import {indexRockSurface, rockSurface} from './MarineRockProfiles.js';

const up = new Vector3(0, 1, 0);
const linear = value => value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4;
const channel = v => Math.round(Math.min(1, Math.max(0, v))*255);
const rgb = (r, g, b) => (channel(r) << 16) | (channel(g) << 8) | channel(b);
const rockSilhouettes = {
  crest: [.98,.77,.78,-.063],
  ledge: [1.00,.55,.72,-.057],
  bench: [1.13,.37,.78,-.030],
};
const settlers = {
  holdfast: {size:[.66,1.55], height:.26, spread:.14},
  wrack: {size:[.72,1.63], height:.48, spread:.16},
  'reef-rod': {size:[.72,1.07], height:.73, spread:.19},
  colony: {size:[.92,1.64], height:.29, spread:.25},
  fingers: {size:[1.14,2.15], height:.21, spread:.17},
  'low-colony': {size:[.98,1.65], height:.38, spread:.36},
  'tube-sponge': {size:[1.10,1.95], height:.36, spread:.18},
  shell: {size:[.64,1.20], height:.09, spread:.10},
};

export function marineOutcropKinds(profiles) {
  const kinds = new Map();
  for (const [index, profile] of profiles.entries()) {
    const lithology = index===0 ? 'sandstone' : 'conglomerate';
    for (const [role,[sx,sy,sz,y]] of Object.entries(rockSilhouettes)) {
      const pair = [profile.geometry.index.array, profile.coarseIndices].map(indices => {
        const geometry = profile.geometry.clone().setIndex(new BufferAttribute(indices, 1));
        geometry.scale(sx, sy, sz).translate(0, y, 0);
        const position = geometry.attributes.position, tint = geometry.attributes.tint;
        const packed = new Float32Array(position.count * 4);
        const tone = index === 0 ? [.48,.40,.28] : [.42,.40,.32];
        for (let i = 0; i < position.count; i++) {
          // Keep the photographed variation. A pale mineral film and lower
          // silt line give the shallow rock an appropriate submerged value.
          const lift = Math.min(1, Math.max(0, (position.getY(i)+.14)*4.1));
          const shade = .84 + .16*lift;
          packed.set([0, rgb((tint.getX(i)*.58+tone[0]*.50)*shade,
            (tint.getY(i)*.58+tone[1]*.50)*shade, (tint.getZ(i)*.58+tone[2]*.50)*shade), .77+.23*lift, 0], i*4);
        }
        geometry.setAttribute('aData', new BufferAttribute(packed, 4));
        return {geometry};
      });
      kinds.set(`${lithology}-${role}`, pair);
    }
  }
  if (kinds.size === 0) return kinds;
  // Eroded knobs and the flatter scanned beds have different silhouettes.
  // Use the same fitted geometry for their contacts, colliders and fish.
  const knobs=[1,2].map(lod=>{
    const geometry=createMound(mulberry32(19675),lod,'rock');
    geometry.scale(1.12,.84,.95).translate(0,-.075,0);
    const data=geometry.attributes.aData;
    for(let i=0;i<data.count;i++){
      const lift=data.getX(i),ao=data.getY(i),grain=Math.sin(data.getW(i)*8.2);
      const c=.19+.11*lift+.025*grain;
      data.setXYZW(i,0,rgb(c*1.05,c*.94,c*.78),.68+.32*ao,0);
    }
    return {geometry};
  });
  kinds.set('weathered-knobs',knobs);
  // These share the existing native reef vertex layout and need no textures.
  for (const [kind, generator, colors] of [
    ['holdfast', createHalimeda, [[.26,.43,.19],[.55,.66,.31]]],
    ['wrack', createSargassum, [[.31,.38,.17],[.61,.62,.31]]],
    ['low-colony', (rng,lod)=>createMound(rng,lod,'knobby'), [[.48,.38,.21],[.76,.67,.40]]],
    ['tube-sponge', createTubes, [[.54,.27,.16],[.81,.54,.32]]],
    ['reef-rod', createSeaRod, [[.45,.39,.27],[.72,.59,.42]]],
    ['shell', createConch, [[.51,.39,.27],[.82,.74,.56]]],
    ['colony', createPlates, [[.47,.33,.20],[.76,.60,.36]]],
    ['fingers', createFingers, [[.40,.33,.35],[.65,.58,.53]]],
    ['reef-rubble', createRubble, [[.49,.46,.35],[.69,.64,.49]]],
  ]) {
    const palette = colors.map(color => rgb(...color.map(linear)));
    const pair = [1, 2].map(lod => {
      const geometry = generator(mulberry32(92371), lod), packed = geometry.attributes.aData;
      const flexible = kind === 'holdfast' || kind === 'wrack' || kind === 'reef-rod';
      if (kind === 'low-colony') geometry.scale(1,.82,1).translate(0,-.045,0);
      if (kind === 'shell') geometry.scale(1, .76, 1);
      if (kind === 'reef-rubble') geometry.scale(1, 1.22, .87);
      for (let i = 0; i < packed.count; i++) {
        const t = packed.getX(i), ao = packed.getY(i), part = packed.getW(i);
        const light = kind === 'shell' ? geometry.attributes.position.getX(i) > -.02 : t > .55 || part > .63;
        packed.setXYZW(i, flexible ? t : 0, palette[Number(light)], .76 + .24 * ao, part);
      }
      return {geometry};
    });
    kinds.set(kind, pair);
  }
  return kinds;
}

// Align bedding to the physical slope. Lower the specimen if the ground
// drops below its footprint, then measure its actual exposed silhouette.
export function fitMarineOutcrop(terrain, level, rock, geometry) {
  const {x, z, floor, gx, gz, yaw, scale} = rock;
  const normal = new Vector3(-gx, 1, -gz).normalize();
  const q = new Quaternion().setFromUnitVectors(up, normal).multiply(new Quaternion().setFromAxisAngle(up, yaw));
  const m = new Matrix4().compose(new Vector3(), q, new Vector3(scale,scale,scale)).elements;
  let y = floor;
  for (let i=0;i<8;i++) {
    const angle = i*Math.PI/4, lx = Math.cos(angle)*.45, lz = Math.sin(angle)*.35;
    const rx = m[0]*lx+m[8]*lz, rz = m[2]*lx+m[10]*lz;
    y = Math.min(y, terrain.heightAt(x+rx,z+rz)-m[1]*lx-m[9]*lz);
  }
  const position = geometry.attributes.position.array, pos = new Float64Array(position.length);
  let top = -Infinity, bottom = Infinity, radiusSq = 0, peakX=x, peakZ=z;
  for (let i=0;i<position.length;i+=3) {
    const lx=position[i], ly=position[i+1], lz=position[i+2];
    const rx=m[0]*lx+m[4]*ly+m[8]*lz, ry=m[1]*lx+m[5]*ly+m[9]*lz, rz=m[2]*lx+m[6]*ly+m[10]*lz;
    if (y+ry>top) { top=y+ry; peakX=x+rx; peakZ=z+rz; }
    bottom = Math.min(bottom, y+ry);
    radiusSq = Math.max(radiusSq, rx*rx+rz*rz);
    pos[i]=x+rx; pos[i+1]=y+ry; pos[i+2]=z+rz;
  }
  if (top>level-.95 || top-floor<.12) return null;
  const radius = Math.sqrt(radiusSq), host = {pos, idx:geometry.index.array, peakX, peakZ};
  if (scale>1.05) indexRockSurface(host,x,z,radius);
  return {...rock, y, top, bottom, q, radius, footRadius:radius, host};
}

// The proxy roof is below the visible rock at its centre, corners and edge
// midpoints. Keep the outer shallows and gaps on either side open to a swimmer.
export function outcropCollision(rock, terrain) {
  const {x,z,yaw,floor,top,scale,host} = rock;
  if (top-floor<.34) return null;
  const c=Math.cos(yaw), s=Math.sin(yaw);
  for (const [inward,shrink] of [[0,1],[0,.7],[.45,.7],[0,.46],[.64,.46]]) {
    const cx=x+(host.peakX-x)*inward, cz=z+(host.peakZ-z)*inward;
    const halfX=scale*.18*shrink, halfZ=scale*.12*shrink;
    let roof=top, ground=floor;
    for (let u=-1;u<=1;u++) for (let v=-1;v<=1;v++) {
      const wx=cx+u*halfX*c+v*halfZ*s, wz=cz-u*halfX*s+v*halfZ*c;
      roof=Math.min(roof,rockSurface(host,wx,wz)?.y??-Infinity);
      ground=Math.min(ground,terrain.heightAt(wx,wz));
    }
    if (roof>ground+.23) return {x:cx,z:cz,yMin:ground-.10,yMax:roof-.055,halfX,halfZ,yaw};
  }
  return null;
}

export function settleMarineOutcrop(rock, terrain, level, random, nearbyRocks, occupied, colonyKind, protectedFootprint) {
  const {host, scale} = rock;
  const sites = [];
  if (scale < 1.05) return sites;
  const large = scale > 2.15;
  const forms = large ? ['wrack', 'holdfast', colonyKind ?? 'holdfast', 'shell', 'holdfast']
    : ['holdfast', colonyKind ?? (rock.seed>.56 ? 'wrack' : 'shell')];
  if (large && rock.seed>.40) forms.push(rock.reefRole==='crest' && rock.depth>3.1 && rock.seed>.57 ? 'reef-rod' : 'wrack');
  // An established clear-water ledge can carry a second generation of
  // settlers. Bulbous colonies need a broad stable seat; the tube cluster
  // fits a narrower patch beside them. Leave the sand-scoured benches open.
  if (rock.reefRole==='crest' && rock.depth>2.65 && rock.seed>.17) {
    forms.splice(1,0,'low-colony');
    forms.push('tube-sponge', colonyKind??'wrack');
  } else if (rock.reefRole==='ledge' && scale>1.25 && rock.depth>2.5 && rock.seed>.55) {
    forms.unshift(rock.seed>.78 ? 'tube-sponge' : 'low-colony');
  }
  const phase = random()*Math.PI*2;
  for (const [i, kind] of forms.entries()) {
    const {size, height, spread} = settlers[kind], width = size[0]+random()**1.6*(size[1]-size[0]);
    const coverRadius = Math.max(spread,height)*width+.12;
    for (let attempt=0;attempt<6;attempt++) {
      // Work outward from the crown, trying different aspects around the
      // same rock so a visitor can find attached life from either side.
      const a = phase+i*2.39996+attempt*1.07, r = scale*(.06+(i%4)*.08+attempt*.023);
      const x = rock.x+Math.cos(a)*r, z = rock.z+Math.sin(a)*r;
      if (protectedFootprint(x,z,coverRadius) || occupied.some(s => (s.x-x)**2+(s.z-z)**2 < (s.spread+width*spread+.03)**2)) continue;
      const contact = rockSurface(host,x,z);
      if (!contact || contact.y < terrain.heightAt(x,z)+.055 || Math.hypot(contact.slopeX,contact.slopeZ)>.88 ||
          contact.y+width*height > level-.63) continue;
      if (nearbyRocks.some(other => other !== rock && (x-other.x)**2+(z-other.z)**2<other.radius**2 &&
          (rockSurface(other.host,x,z)?.y ?? -Infinity)>contact.y+.028)) continue;
      if (kind==='low-colony') {
        // The patch grows over the rock. Check its base on the actual
        // triangles so a wide colony cannot hang off a ledge at one end.
        let seated=true;
        for (const [u,v] of [[.19,0],[-.19,0],[0,.19],[0,-.19]]) {
          const h=rockSurface(host,x+u*width,z+v*width);
          const plane=contact.y+(contact.slopeX*u+contact.slopeZ*v)*width;
          if (!h || h.y<plane-.10*width) {seated=false;break;}
        }
        if(!seated) continue;
      }
      const y = contact.y-(kind==='shell' ? width*.025 : .018);
      const site = {kind, x, y, z, scale:width, yaw:random()*Math.PI*2,
        seed:random(), gx:contact.slopeX, gz:contact.slopeZ, flowX:.08, flowZ:.025,
        depth:level-contact.y, mode:3, fixed:true, reach:Math.max(7, Math.max(13, scale*3.6)-r-1), radius:coverRadius, reefId:rock.reefId,
        hostX:rock.x, hostZ:rock.z, hostRockId:rock.rockId, spread:width*spread};
      sites.push(site);
      occupied.push(site);
      break;
    }
  }
  return sites;
}
