import {Vector3} from '../vendor/tidewater/src/engine/index.js';
import {FaunaTracking, describeFaunaTarget} from './FaunaTracking.js';
import {wildlifeDistance} from './WildlifeDirectory.js';

const compassPoints = ['前方', '右前方', '右侧', '右后方', '身后', '左后方', '左侧', '左前方'];
const lockLabels = {live:'寻踪中', habitat:'寻踪 · 栖地', loading:'寻踪 · 载入中', unavailable:'寻踪 · 暂不可用'};
const TAU = Math.PI * 2;
const view = new Vector3(), ray = new Vector3();
const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));

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
    this.height = document.querySelector('#wildlife-height');
    this.context = document.querySelector('#wildlife-context');
    this.disc = this.arrow.parentElement;
    this.cancel = document.querySelector('#wildlife-cancel');
    this.label = document.querySelector('#wildlife-label');
    this.labelName = this.label.querySelector('span');
    this.mode = document.querySelector('#wildlife-mode');
    this.tracking = new FaunaTracking(app);
    this.snapshot = {target:null, near:[], lock:null};
    this.lastScan = -Infinity;
    this.lastPosition = new Vector3(Infinity, Infinity, Infinity);
    this.mode.onchange = () => this.refresh();
  }

  refresh() {
    const now = performance.now();
    this.update(now, true);
    this.app.regionMap?.update(now, true);
  }

  update(now, refresh = false) {
    const {app} = this, {camera} = app, p = camera.position;
    const mode = this.mode.value;
    if (refresh || (mode !== 'off' || this.snapshot.lock) &&
        (now - this.lastScan >= 125 || this.lastPosition.distanceToSquared(p) > 36)) {
      const scanMode = mode === 'off' && this.tracking.locked ? 'museum' : mode;
      this.snapshot = this.tracking.scan(p, scanMode);
      this.observation = this.snapshot.lock ? describeFaunaTarget(app, p, this.snapshot.target) : null;
      this.sight = new Map();
      this.lastPosition.copy(p);
      this.lastScan = now;
    }
    const {target, lock, near} = this.snapshot;
    if (mode === 'off' && !lock) {
      this.label.hidden = this.panel.hidden = true;
      return;
    }
    this.panel.hidden = !target && !lock;
    this.cancel.hidden = !lock;
    this.disc.hidden = !target;
    this.panel.classList.toggle('is-tracking', !!lock);
    let seen = false;
    if (lock) {
      const nameRange = target && clamp(12 + target.size * 32, 16, 220);
      seen = this.placeLabel(camera, target?.live && target.visible &&
        Math.hypot(target.x-p.x, target.y-p.y, target.z-p.z) < nameRange ? [target] : []);
      if (!seen && target?.medium === 'air') this.placeFlightMarker(camera, target);
    } else {
      this.placeLabel(camera, near);
    }
    if (target || lock) this.renderBearing(camera, target, lock, mode, seen);
  }

  renderBearing(camera, animal, lock, mode, seen) {
    setText(this.name, lock?.name ?? animal.name);
    setText(this.scope, lock ? (seen ? '已进入视野' : lockLabels[lock.state]) : animal.live ?
      (mode === 'museum' ? '附近馆藏' : '附近动物') : '栖地');
    if (!animal) {
      setText(this.range, '暂未取得位置');
      setText(this.height, '');
      setText(this.context, '');
      return;
    }
    const p = camera.position;
    const dx = animal.x-p.x, dy = animal.y-p.y, dz = animal.z-p.z;
    const flat = Math.hypot(dx, dz);
    const axes = camera.matrixWorld.elements;
    const heading = Math.atan2(-axes[8], axes[10]);
    const angle = Math.atan2(dx, -dz) - heading;
    const direction = compassPoints[(Math.round(angle / TAU * 8) % 8 + 8) % 8];
    const vertical = Math.abs(dy) >= (lock ? 1 : Math.max(.8, flat*.36));
    const distance = (animal.live ? '' : '约 ') + wildlifeDistance(flat);
    const height = vertical ? (dy > 0 ? '↑ 上方 ' : '↓ 下方 ') + wildlifeDistance(Math.abs(dy)) : '';
    this.arrow.style.transform = 'rotate(' + angle.toFixed(3) + 'rad)';
    setText(this.range, flat < 1 && vertical ? '' : direction + ' · ' + distance);
    setText(this.height, height);
    const observation = this.observation;
    const elevation = observation?.height;
    let medium = '';
    if (elevation?.type === 'depth') {
      medium = elevation.metres > .15 ? '水下 ' + wildlifeDistance(elevation.metres) : '近水面';
    } else if (elevation?.type === 'altitude') {
      medium = (elevation.reference === 'water' ? '距水面 ' : '离地 ') + wildlifeDistance(elevation.metres);
    }
    setText(this.context, observation?.atObservation ?
      ('已到观察点' + (medium ? ' · ' + medium : '')) : medium);
  }

  placeFlightMarker(camera, animal) {
    view.set(animal.x, animal.y, animal.z).applyMatrix4(camera.matrixWorldInverse);
    if (view.z >= -camera.near) return;
    view.applyMatrix4(camera.projectionMatrix);
    if (Math.abs(view.x) > .91 || Math.abs(view.y) > .91) return;
    this.label.dataset.marker = animal.live ? 'live' : 'habitat';
    this.label.hidden = false;
    const x = (view.x*.5+.5)*innerWidth, y = (.5-view.y*.5)*innerHeight;
    this.label.style.transform = 'translate(' + x.toFixed(1) + 'px,' + y.toFixed(1) + 'px) translate(-50%,-50%)';
  }

  placeLabel(camera, candidates) {
    let best = null, bestScore = Infinity, cx = 0, cy = 0;
    for (const animal of candidates) {
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
    // In the loupe, the specimen is already named in the HUD. Keep the small
    // animal's spines and appendages clear of its screen-space nameplate.
    const identifiedInLoupe = best && camera.zoom > 1 && this.app.loupeActor?.id === best.id;
    this.label.hidden = !best || identifiedInLoupe;
    this.labelId = best?.id;
    if (!best) return false;
    if (identifiedInLoupe) return true;
    delete this.label.dataset.marker;
    view.set(best.x, best.y + best.halfHeight, best.z).project(camera);
    const x = clamp((cx*.5+.5)*innerWidth, 75, innerWidth-75);
    const y = clamp((.5-Math.max(cy, view.y)*.5)*innerHeight-4, 32, innerHeight-25);
    this.label.style.transform = 'translate(' + x.toFixed(1) + 'px,' + y.toFixed(1) + 'px) translate(-50%,-100%)';
    setText(this.labelName, best.name);
    return true;
  }
}
