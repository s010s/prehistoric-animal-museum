import {islandGroundAt} from './IslandEcologyPlan.js';

const smooth = (a, b, x) => {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

// Acoustic treatments follow the existing terrain and water facies. These
// levels mix modern recordings of wind, small waves and insects.
const PROFILES = {
  'mixed-forest': [2.4, .9, 1],
  'ridge-woodland': [6.2, .19, .48],
  'giant-forest': [1.75, .7, 1],
  lake: [3.4, .62, .85],
  grassland: [5.8, .52, .25],
  'east-alluvial': [3.8, .71, .55],
  wetland: [2.15, 1, .82],
  highland: [8.0, .07, .16],
  'highland-lake': [6.7, .07, .17],
  'dry-upland': [5.9, .29, .19],
  'west-coast': [5.7, .2, .48],
  'east-bay': [4.4, .17, .46],
  estuary: [3.9, .72, .56],
};
const SHORE_SCENES = {
  lake: {range: 63, gain: .41, cutoff: 1380, rate: .94},
  'highland-lake': {range: 44, gain: .24, cutoff: 1220, rate: 1.04},
  wetland: {range: 57, gain: .24, cutoff: 745, rate: .83},
  'east-alluvial': {range: 62, gain: .47, cutoff: 1880, rate: 1.14},
  'east-source': {range: 34, gain: .29, cutoff: 1650, rate: 1.24},
  'north-source': {range: 33, gain: .30, cutoff: 1730, rate: 1.18},
};

export function prepareIslandAmbience(data, areas) {
  const profiles = Object.entries(PROFILES).flatMap(([name, values]) =>
    areas[name] ? [{name, area: areas[name], values}] : []);
  const stations = Object.entries(SHORE_SCENES).flatMap(([id, spec]) => {
    const area = areas[id];
    if (!area) return [];
    const [ox, oz] = area.origin, [dx, dz] = area.direction;
    const x = ox + dx * 15, z = oz + dz * 15;
    let best = null;
    for (let j = -76; j <= 76; j += 2) for (let i = -76; i <= 76; i += 2) {
      const g = islandGroundAt(data, x + i, z + j);
      if (!g.fresh || g.edge > .05 || g.height > -.06 || g.height < -.44) continue;
      const score = Math.hypot(i, j) + Math.abs(g.height + .18) * 12;
      if (!best || score < best.score) best = {g, score};
    }
    return best ? [{id, ...spec, x: best.g.x, y: best.g.level + .04, z: best.g.z}] : [];
  });
  const marine = data.cove.continuous;
  return {data, profiles, stations, marine, coastline: marine.segments};
}

export function regionalSoundAt(plan, p, surface, seaLevel, distanceToMarine = Infinity) {
  const base = {region: 'connected island', wind: 3.2, insects: .27, chorus: .55, ocean: false, surfGain: 0, sample: false};
  if (!plan) return base;
  const route = plan.data.field.continuousSample;
  const core = Math.max(Math.abs(p.x), Math.abs(p.z)) < 515;
  const marine = plan.marine.marineAt(p.x, p.z);
  const water = plan.data.field.sample(p.x, p.z);
  const inland = water[0] > seaLevel + .55 && water[1] < .05;
  base.ocean = marine > .60 && !inland && surface >= seaLevel - .6 && surface < seaLevel + .55;
  base.surfGain = 1 - smooth(360, 1000, distanceToMarine);
  const inSample = p.x > -1536 && p.x < -512 && p.z > -672 && p.z < 352;
  if (core || (inSample && (route?.sample(p.x, p.z)?.[1] ?? 100) < 75)) return {...base, sample: true, surfGain: 1};
  let strongest = 0, total = 1;
  for (const {name, area, values} of plan.profiles) {
    const d = Math.hypot(p.x - area.origin[0], p.z - area.origin[1]);
    const influence = 3.1 * (1 - smooth(area.reach * .42, area.reach * 2.4, d));
    if (influence <= 0) continue;
    base.wind += influence * values[0];
    base.insects += influence * values[1];
    base.chorus += influence * values[2];
    total += influence;
    if (influence > strongest) {
      strongest = influence;
      base.region = name;
    }
  }
  base.wind /= total;
  base.insects /= total;
  base.chorus /= total;
  return base;
}

export class IslandFreshwaterSound {
  constructor(plan, seaLevel) {
    this.plan = plan;
    this.seaLevel = seaLevel;
    this.sources = new Map();
  }

  update(p, ctx, above, load, underwater) {
    for (const site of this.plan.stations) {
      const distance = Math.hypot(site.x - p.x, site.y - p.y, site.z - p.z);
      const envelope = (1 - smooth(site.range * .62, site.range, distance)) * (1 - underwater * .68);
      let layer = this.sources.get(site.id);
      if (!layer && envelope > .004) {
        const buffer = load();
        if (!buffer) continue;
        const source = ctx.createBufferSource(), gain = ctx.createGain();
        const lowpass = ctx.createBiquadFilter(), panner = ctx.createPanner();
        source.buffer = buffer;
        source.loop = true;
        source.playbackRate.value = site.rate;
        gain.gain.value = 0;
        lowpass.type = 'lowpass';
        lowpass.frequency.value = site.cutoff;
        panner.panningModel = 'HRTF';
        panner.distanceModel = 'inverse';
        panner.refDistance = 4;
        panner.maxDistance = site.range;
        panner.rolloffFactor = 1;
        panner.positionX.value = site.x;
        panner.positionY.value = site.y - this.seaLevel;
        panner.positionZ.value = site.z;
        source.connect(gain).connect(lowpass).connect(panner).connect(above);
        source.start();
        layer = {source, gain, lowpass, panner, distance, envelope: -1};
        this.sources.set(site.id, layer);
      }
      if (!layer) continue;
      layer.distance = distance;
      if (distance > site.range + 34) {
        this.release(site.id, layer);
      } else if (Math.abs(layer.envelope - envelope) > .002) {
        layer.gain.gain.setTargetAtTime(site.gain * envelope, ctx.currentTime, .14);
        layer.envelope = envelope;
      }
    }
  }

  release(id, layer) {
    layer.source.stop();
    layer.source.disconnect();
    layer.gain.disconnect();
    layer.lowpass.disconnect();
    layer.panner.disconnect();
    this.sources.delete(id);
  }

  dispose() {
    for (const [id, layer] of this.sources) this.release(id, layer);
  }

  stats() {
    return this.plan.stations.map(site => ({id: site.id, point: [site.x, site.y, site.z],
      active: this.sources.has(site.id), envelope: Math.max(0, this.sources.get(site.id)?.envelope ?? 0)}));
  }
}
