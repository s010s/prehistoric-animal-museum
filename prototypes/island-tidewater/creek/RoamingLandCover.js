// Deterministic colonies are addressed by their parent cell, even when roots
// cross its border. Eviction discards the records; returning recreates them.
import {woodlandFloorPockets} from './WoodlandFloorPlan.js';
import {mulberry32} from '../vendor/tidewater/src/util/Noise.js';
import {landContextAt, protectedSampleLand} from './LandHabitatField.js';

export const LAND_CELL = 48;
const RADIUS = 2;
const GROUPS = 7, MEMBERS = 7;
const PER_CELL = GROUPS * MEMBERS;
const CELLS = (2*RADIUS + 1)**2;
export const LAND_CAPACITY = CELLS * PER_CELL;

// The first form builds a colony's silhouette. Smaller companions occupy
// its margins. Gravel can share a bank with rushes, but does not grow in rows.
const recipes = {
  meadow: [['tussock','heath','tussock'], ['heath','tussock','cobble']],
  woodland: [['fern','duff','fern'], ['duff','fern','cobble']],
  'wet-bank': [['rush','duff','rush'], ['fern','rush','duff']],
  'dry-slope': [['heath','scree','tussock'], ['scree','heath','cobble']],
  upland: [['scree','talus','heath'], ['heath','tussock','scree']],
  shore: [['cobble','scree','cobble'], ['scree','cobble','heath']],
};

export function* landCellColonies(data, ix, iz) {
  const rng = mulberry32(Math.imul(ix, 246709) ^ Math.imul(iz, 19349663) ^ 501813);
  const existing = [];
  for (let n = 0; n < GROUPS; n++) {
    const x = (ix + rng()) * LAND_CELL, z = (iz + rng()) * LAND_CELL;
    const home = landContextAt(data,x,z);
    const sites = [];
    if (home && rng() < .36 + home.patchStrength*.72) {
      const rocky = home.rock > .52 || home.slope > .39;
      const recipe = recipes[home.biome][Number(rng() < (rocky ? .78 : .32))];
      const amount = Math.min(MEMBERS, 2 + Math.floor(home.patchStrength*3 + rng()*3));
      // Align slope deposits roughly along contour, disturb the alignment on flats.
      const angle = home.slope > .13 ? Math.atan2(home.gx, -home.gz) + (rng()-.5)*.9 : rng()*Math.PI*2;
      const ca = Math.cos(angle), sa = Math.sin(angle);
      const size = .65 + rng()*.9 + home.patchStrength*.36;
      const spread = (2.3 + rng()*4.8) *
        (home.biome === 'meadow' ? 1.37 : home.biome === 'wet-bank' ? .74 : home.biome === 'shore' ? .63 : 1);
      for (let m = 0; m < amount; m++) {
        const theta = rng()*Math.PI*2, radius = m ? spread*Math.sqrt(rng()) : 0;
        const u = Math.cos(theta)*radius, v = Math.sin(theta)*radius*.56;
        const px = x + ca*u - sa*v, pz = z + sa*u + ca*v;
        const g = m ? landContextAt(data,px,pz) : home;
        if (!g || g.biome !== home.biome) continue;
        let form = m ? recipe[Math.floor(rng()*recipe.length)] : recipe[0];
        if (g.biome === 'wet-bank' && g.slope < .2 && g.height < .9 && g.rock < .35) {
          form = m && m%4 === 0 ? 'duff' : 'rush';
        }
        if (g.slope > .58 && g.biome === 'woodland' && g.rock < .5) form = 'duff';
        else if ((g.slope > .58 || g.rock > .81) && form !== 'talus') form = 'scree';
        if (form === 'rush' && (g.slope > .35 || g.rock > .58)) form = 'cobble';
        if (form === 'heath' && g.biome === 'shore' && g.height < 1.4) form = 'cobble';
        const stature = form === 'rush' ? (g.height < .18 ? .72 : 1.35)
          : form === 'heath' && g.biome === 'meadow' ? 1.48 : form === 'fern' ? 1.22 : 1;
        const scale = stature * size * (m === 0 ? .95 + rng()*.28 : .40 + rng()*.6)
          * (form === 'tussock' ? .88 : form === 'cobble' ? .72 : 1);
        if (sites.some(s => (s.x-px)**2 + (s.z-pz)**2 < ((scale+s.scale)*(['scree','cobble','talus'].includes(form) ? .85 : .33))**2)) continue;
        sites.push({x:px, y:g.y-.018, z:pz, gx:g.gx, gz:g.gz, scale, form, region:'roaming-'+g.biome,
          yaw:rng()*Math.PI*2, seed:rng(), mode:0, flow:[0,0]});
      }
    }
    for (const site of sites) {
      if (site.region === 'roaming-woodland' && site.form === 'duff' && site.seed < .79) {
        site.form = 'needle-litter'; site.mode = -1;
        site.scale = Math.max(.94,site.scale);
      }
    }
    existing.push(...sites);
    yield sites;
  }
  yield* woodlandFloorPockets(data,ix,iz,LAND_CELL,PER_CELL-existing.length,existing);
}

export class RoamingLandCover {
  constructor(data, onReady) {
    this.data = data;
    this.onReady = onReady;
    this.tiles = new Map();
    this.free = Array.from({length:CELLS}, (_, i) => i);
    this.pending = [];
    this.completed = 0;
  }

  clear() {
    for (const t of this.tiles.values()) this.free.push(t.slot);
    this.tiles.clear();
    this.pending.length = 0;
    this.ix = this.iz = undefined;
  }

  update(p) {
    const ix = Math.floor(p.x/LAND_CELL), iz = Math.floor(p.z/LAND_CELL);
    // A cell-centre height cannot reject a steep slope the visitor is standing
    // on. Use the actual camera footprint; nearby shore cover stays visible.
    if (p.y > this.data.terrain.heightAt(p.x,p.z) + 110 || p.y < this.data.island.seaLevel-75
        || (protectedSampleLand(p.x,p.z) && [1,-1].every(d =>
          protectedSampleLand(p.x+110*d,p.z+110) && protectedSampleLand(p.x+110*d,p.z-110)))) {
      if (this.tiles.size) this.clear();
      return;
    }
    if (ix !== this.ix || iz !== this.iz) {
      this.ix = ix; this.iz = iz;
      for (const [id,tile] of this.tiles) {
        if (Math.abs(tile.x-ix) <= RADIUS && Math.abs(tile.z-iz) <= RADIUS) continue;
        this.tiles.delete(id);
        this.free.push(tile.slot);
      }
      for (let j = iz-RADIUS; j <= iz+RADIUS; j++) for (let i = ix-RADIUS; i <= ix+RADIUS; i++) {
        const id = i+','+j;
        if (!this.tiles.has(id)) this.tiles.set(id,{x:i, z:j, slot:this.free.pop(), sites:[],
          source:landCellColonies(this.data,i,j)});
      }
      this.pending = [...this.tiles.values()].filter(t => t.source).sort((a,b) =>
        Math.hypot(a.x+.5-p.x/LAND_CELL,a.z+.5-p.z/LAND_CELL) - Math.hypot(b.x+.5-p.x/LAND_CELL,b.z+.5-p.z/LAND_CELL));
    }
    if (!this.pending.length) return;
    const deadline = performance.now()+.8;
    // Yield between colonies on slower CPUs. Walking usually needs only
    // the new outside row, while a map jump fills the nearest cells first.
    for (let work=0; this.pending.length && work<24; work++) {
      const t = this.pending[0], next = t.source.next();
      if (next.done) {
        this.pending.shift(); t.source = null;
        this.onReady(t.slot*PER_CELL,t.sites);
        this.completed++;
      } else t.sites.push(...next.value);
      if (performance.now() >= deadline) break;
    }
  }

  visit(fn) {
    for (const t of this.tiles.values()) {
      if (t.source) continue;
      let index = t.slot*PER_CELL;
      for (const site of t.sites) fn(site,index++);
    }
  }

  stats() {
    let sites = 0;
    for (const tile of this.tiles.values()) sites += tile.sites.length;
    return {residentCells:this.tiles.size, pendingCells:this.pending.length, sites, capacity:LAND_CAPACITY, completedCells:this.completed};
  }
}
