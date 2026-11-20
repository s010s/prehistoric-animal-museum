import {Vector3} from '../vendor/tidewater/src/engine/index.js';
import {visitNearbyFauna} from './NearbyFaunaSources.js';

const compassPoints = ['前方', '右前方', '右侧', '右后方', '身后', '左后方', '左侧', '左前方'];
const TAU = Math.PI * 2;
const view = new Vector3(), ray = new Vector3();
const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));

function distanceText(m) {
  if (m >= 1000) return (m / 1000).toFixed(1) + ' 公里';
  if (m < 1) return Math.round(m * 100) + ' 厘米';
  return Math.round(m) + ' 米';
}

function setText(el, value) {
  if (el.textContent !== value) el.textContent = value;
}

// Only apply occlusion to the name attached to the body. The direction finder
// still points across a ridge or to a bird that flew behind the visitor.
function bodyInSight(app, p, animal) {
  const eyeY = animal.y + animal.halfHeight * .2;
  ray.set(animal.x - p.x, eyeY - p.y, animal.z - p.z);
  const distance = ray.length();
  if (distance < .03) return true;
  ray.multiplyScalar(1 / distance);
  const end = Math.max(.01, distance - Math.max(.05, Math.min(animal.size * .23, animal.halfHeight)));
  if (app.colliders.sightDistance(p, ray, end, animal.occluder) < end) return false;
  const xStep = ray.x, zStep = ray.z;
  const horizontal = xStep * xStep + zStep * zStep;
  const trunkCells = app.colliders.treeCells;
  if (trunkCells && horizontal > .00001) {
    const ex = p.x + xStep * end, ez = p.z + zStep * end;
    for (let j = Math.floor((Math.min(p.z, ez)-3)/32); j <= Math.floor((Math.max(p.z, ez)+3)/32); j++) {
      for (let i = Math.floor((Math.min(p.x, ex)-3)/32); i <= Math.floor((Math.max(p.x, ex)+3)/32); i++) {
        const trunks = trunkCells.get(i + ',' + j);
        if (!trunks) continue;
        for (const trunk of trunks) {
          if (trunk === animal.occluder) continue;
          const t = clamp(((trunk.x-p.x)*xStep + (trunk.z-p.z)*zStep) / horizontal, 0, end);
          const y = p.y + t * ray.y;
          if (y >= trunk.yMin && y <= trunk.yMax && (p.x+t*xStep-trunk.x)**2 + (p.z+t*zStep-trunk.z)**2 < trunk.radius**2) return false;
        }
      }
    }
  }
  for (let t = Math.min(.5, end/2); t < end; t += 1.2) {
    if (app.terrainData.heightAt(p.x + ray.x*t, p.z + ray.z*t) > p.y + ray.y*t + .025) return false;
  }
  return true;
}

export class NearbyFaunaGuide {
  constructor(app) {
    this.app = app;
    this.panel = document.querySelector('#wildlife-compass');
    this.arrow = document.querySelector('#wildlife-arrow');
    this.scope = document.querySelector('#wildlife-scope');
    this.name = document.querySelector('#wildlife-name');
    this.range = document.querySelector('#wildlife-range');
    this.label = document.querySelector('#wildlife-label');
    this.labelName = this.label.querySelector('span');
    this.mode = document.querySelector('#wildlife-mode');
    this.candidates = [];
    this.near = [];
    this.lastScan = -Infinity;
    this.lastPosition = new Vector3(Infinity, Infinity, Infinity);
    this.lastFarPosition = new Vector3(Infinity, Infinity, Infinity);
    this.mode.onchange = () => {
      this.targetId = null;
      this.farTarget = null;
      this.lastScan = -Infinity;
      this.update(performance.now());
    };
  }

  scan(p) {
    const {app, candidates, near} = this;
    candidates.length = near.length = 0;
    const add = (animal, limit = Infinity) => {
      const distance = Math.hypot(animal.x - p.x, animal.y - p.y, animal.z - p.z);
      if (distance > limit) return;
      if (animal.live && animal.visible && distance < clamp(2.2 + animal.size * 3.5, 2.5, 34)) near.push(animal);
      if (animal.museum || this.mode.value === 'all') candidates.push({animal, distance});
    };
    visitNearbyFauna(app, p, 320, animal => add(animal, 320));
    if (!candidates.length) {
      if (this.lastFarPosition.distanceToSquared(p) > 48**2 || !this.farTarget) {
        visitNearbyFauna(app, p, Infinity, add, {museumOnly:this.mode.value === 'museum'});
        this.lastFarPosition.copy(p);
        this.farTarget = candidates.reduce((a,b) => !a || b.distance < a.distance ? b : a, null)?.animal;
      } else add(this.farTarget);
    }
    let best = null, previous = null;
    for (const item of candidates) {
      if (!best || item.distance < best.distance) best = item;
      if (item.animal.id === this.targetId) previous = item;
    }
    // Individuals in a moving herd cross in distance repeatedly. Retain a
    // marginal tie, but switch promptly to a substantially closer animal.
    if (previous && previous.distance < best.distance + Math.min(1.5, best.distance * .035)) best = previous;
    this.target = best?.animal;
    this.targetId = this.target?.id;
    this.lastPosition.copy(p);
    this.sight = new Map();
  }

  update(now, pinned = false) {
    if (this.mode.value === 'off') {
      this.label.hidden = this.panel.hidden = true;
      return;
    }
    const {app} = this, {camera} = app, p = camera.position;
    if (now - this.lastScan >= 125 || this.lastPosition.distanceToSquared(p) > 36) {
      this.scan(p);
      this.lastScan = now;
    }
    const animal = this.target;
    this.panel.hidden = !animal || pinned;
    if (animal && !pinned) {
      const dx = animal.x-p.x, dy = animal.y-p.y, dz = animal.z-p.z;
      const flat = Math.hypot(dx, dz), metres = Math.hypot(flat, dy);
      const axes = camera.matrixWorld.elements;
      const heading = Math.atan2(-axes[8], axes[10]);
      const angle = Math.atan2(dx, -dz) - heading;
      const direction = compassPoints[(Math.round(angle / TAU * 8) % 8 + 8) % 8];
      const vertical = dy > Math.max(.8,flat*.36) ? '上方' : dy < -Math.max(.8,flat*.36) ? '下方' : '';
      const where = flat < 1 && vertical ? vertical : direction + (vertical ? '偏' + vertical[0] : '');
      this.arrow.style.transform = 'rotate(' + angle.toFixed(3) + 'rad)';
      setText(this.scope, animal.live ? (this.mode.value === 'museum' ? '附近馆藏' : '附近动物') : '栖息地');
      setText(this.name, animal.name);
      setText(this.range, where + ' · ' + (animal.live ? '' : '约 ') + distanceText(metres));
    }
    this.placeLabel(camera);
  }

  placeLabel(camera) {
    let best = null, bestScore = Infinity, cx = 0, cy = 0;
    for (const animal of this.near) {
      view.set(animal.x, animal.y, animal.z).applyMatrix4(camera.matrixWorldInverse);
      if (view.z >= -camera.near) continue;
      const depth = -view.z;
      view.applyMatrix4(camera.projectionMatrix);
      if (Math.abs(view.x) > .89 || Math.abs(view.y) > .89) continue;
      // The animal under the visitor's gaze wins over one at the edge.
      const score = Math.hypot(view.x, view.y) + depth * .005 - (animal.id === this.labelId ? .05 : 0);
      if (score >= bestScore) continue;
      if (!this.sight.has(animal.id)) this.sight.set(animal.id, bodyInSight(this.app, camera.position, animal));
      if (!this.sight.get(animal.id)) continue;
      best = animal; bestScore = score;
      cx = view.x; cy = view.y;
    }
    this.label.hidden = !best;
    this.labelId = best?.id;
    if (!best) return;
    view.set(best.x, best.y + best.halfHeight, best.z).project(camera);
    const x = clamp((cx*.5+.5)*innerWidth, 75, innerWidth-75);
    const y = clamp((.5-Math.max(cy, view.y)*.5)*innerHeight-4, 32, innerHeight-25);
    this.label.style.transform = 'translate(' + x.toFixed(1) + 'px,' + y.toFixed(1) + 'px) translate(-50%,-100%)';
    setText(this.labelName, best.name);
  }
}
