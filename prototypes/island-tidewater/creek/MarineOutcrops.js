import {BufferAttribute, Quaternion, Vector3} from '../vendor/tidewater/src/engine/index.js';
import {createConch, createFingers, createHalimeda, createPlates, createRubble, createSargassum} from '../vendor/tidewater/src/world/reef/ReefGeometry.js';
import {mulberry32} from '../vendor/tidewater/src/util/Noise.js';
import {rockSurface} from './MarineRockProfiles.js';

const up = new Vector3(0, 1, 0);
const linear = value => value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4;
const channel = v => Math.round(Math.min(1, Math.max(0, v))*255);
const rgb = (r, g, b) => (channel(r) << 16) | (channel(g) << 8) | channel(b);
const settlers = {
  holdfast: {size:[.66,1.55], height:.26, spread:.14},
  wrack: {size:[.72,1.63], height:.48, spread:.16},
  colony: {size:[.92,1.64], height:.29, spread:.25},
  fingers: {size:[1.14,2.15], height:.21, spread:.17},
  shell: {size:[.64,1.20], height:.09, spread:.10},
};

export function marineOutcropKinds(profiles) {
  const kinds = new Map();
  for (const [index, profile] of profiles.entries()) {
    const pair = [profile.geometry.index.array, profile.coarseIndices].map(indices => {
      const geometry = profile.geometry.clone().setIndex(new BufferAttribute(indices, 1));
      geometry.scale(1, .55, .72).translate(0, -.057, 0);
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
    kinds.set(index === 0 ? 'sandstone' : 'conglomerate', pair);
  }
  if (kinds.size === 0) return kinds;
  // These share the existing native reef vertex layout and need no textures.
  for (const [kind, generator, colors] of [
    ['holdfast', createHalimeda, [[.26,.43,.19],[.55,.66,.31]]],
    ['wrack', createSargassum, [[.31,.38,.17],[.61,.62,.31]]],
    ['shell', createConch, [[.51,.39,.27],[.82,.74,.56]]],
    ['colony', createPlates, [[.47,.33,.20],[.76,.60,.36]]],
    ['fingers', createFingers, [[.40,.33,.35],[.65,.58,.53]]],
    ['reef-rubble', createRubble, [[.49,.46,.35],[.69,.64,.49]]],
  ]) {
    const palette = colors.map(color => rgb(...color.map(linear)));
    const pair = [1, 2].map(lod => {
      const geometry = generator(mulberry32(92371), lod), packed = geometry.attributes.aData;
      const flexible = kind === 'holdfast' || kind === 'wrack';
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
  const p = new Vector3();
  let y = floor;
  for (let i = 0; i < 8; i++) {
    const angle = i * Math.PI / 4;
    p.set(Math.cos(angle) * scale * .44, 0, Math.sin(angle) * scale * .34).applyQuaternion(q);
    y = Math.min(y, terrain.heightAt(x + p.x, z + p.z) - p.y);
  }
  const position = geometry.attributes.position, pos = [];
  let top = -Infinity, bottom = Infinity, radius = 0;
  for (let i = 0; i < position.count; i++) {
    p.set(position.getX(i), position.getY(i), position.getZ(i)).multiplyScalar(scale).applyQuaternion(q);
    top = Math.max(top, y + p.y);
    bottom = Math.min(bottom, y + p.y);
    radius = Math.max(radius, Math.hypot(p.x, p.z));
    pos.push(x + p.x, y + p.y, z + p.z);
  }
  if (top > level - .95 || top - floor < .12) return null;
  return {...rock, y, top, bottom, q, radius, host: {pos, idx: geometry.index.array}};
}

export function settleMarineOutcrop(rock, terrain, level, random, nearbyRocks, occupied, colonyKind) {
  const {host, scale} = rock;
  const sites = [];
  if (scale < 1.05) return sites;
  const large = scale > 2.15;
  const forms = large ? ['wrack', 'holdfast', colonyKind ?? 'holdfast', 'shell', 'holdfast']
    : ['holdfast', colonyKind ?? (rock.seed>.56 ? 'wrack' : 'shell')];
  if (large && rock.seed>.40) forms.push('wrack');
  const phase = random()*Math.PI*2;
  for (const [i, kind] of forms.entries()) {
    const {size, height, spread} = settlers[kind], width = size[0]+random()**1.6*(size[1]-size[0]);
    for (let attempt=0;attempt<6;attempt++) {
      // Work outward from the crown, trying different aspects around the
      // same rock so a visitor can find attached life from either side.
      const a = phase+i*2.39996+attempt*1.07, r = scale*(.06+(i%4)*.08+attempt*.023);
      const x = rock.x+Math.cos(a)*r, z = rock.z+Math.sin(a)*r;
      if (occupied.some(s => (s.x-x)**2+(s.z-z)**2 < (s.spread+width*spread+.03)**2)) continue;
      const contact = rockSurface(host,x,z);
      if (!contact || contact.y < terrain.heightAt(x,z)+.055 || Math.hypot(contact.slopeX,contact.slopeZ)>.88 ||
          contact.y+width*height > level-.63) continue;
      if (nearbyRocks.some(other => other !== rock && (x-other.x)**2+(z-other.z)**2<other.radius**2 &&
          (rockSurface(other.host,x,z)?.y ?? -Infinity)>contact.y+.028)) continue;
      const y = contact.y-(kind==='shell' ? width*.025 : .018);
      const site = {kind, x, y, z, scale:width, yaw:random()*Math.PI*2,
        seed:random(), gx:contact.slopeX, gz:contact.slopeZ, flowX:.08, flowZ:.025,
        depth:level-contact.y, mode:3, fixed:true, reach:Math.max(7, Math.max(13, scale*3.6)-r-1), radius:Math.max(spread,height)*width+.12,
        hostX:rock.x, hostZ:rock.z, spread:width*spread};
      sites.push(site);
      occupied.push(site);
      break;
    }
  }
  return sites;
}
