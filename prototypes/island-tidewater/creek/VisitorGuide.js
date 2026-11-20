import {ISLAND_FAUNA_PLAN, ISLAND_FAUNA_REGIONS} from './IslandFaunaPlan.js';
import {NearbyFaunaGuide} from './NearbyFaunaGuide.js';

const directions = ['北', '东北', '东', '东南', '南', '西南', '西', '西北'];

export class VisitorGuide {
  constructor(app, travel, lookAt) {
    this.app = app;
    this.nearby = new NearbyFaunaGuide(app);
    this.select = document.querySelector('#fauna-place');
    this.details = document.querySelector('#field-guide');
    this.destination = document.querySelector('#guide-destination');
    this.status = document.querySelector('#fauna-status');
    this.bearing = document.querySelector('#guide-bearing');
    this.face = document.querySelector('#face-animal');
    this.credit = document.querySelector('#model-credit');
    this.face.onclick = () => {
      const visit = app.islandVisits[app.currentLandmark];
      const point = visit?.animalId && app.islandFauna.state(visit.animalId)?.position;
      if (point) lookAt(point);
    };
    this.cancel = document.querySelector('#guide-cancel');
    this.travelButton = document.querySelector('#fauna-travel');
    this.pinButton = document.querySelector('#fauna-pin');
    for (const region of ISLAND_FAUNA_REGIONS) {
      const group = document.createElement('optgroup');
      group.label = region.title;
      for (const species of ISLAND_FAUNA_PLAN.filter(row => row.regionId === region.id)) {
        if (app.islandVisits[species.visitId]) group.append(new Option(species.title, species.visitId));
      }
      if (group.childElementCount) this.select.append(group);
    }
    this.select.onchange = () => this.choose(this.select.value);
    this.travelButton.onclick = () => {
      const id = this.select.value;
      if (id && travel(id)) {
        this.pin(null);
        this.details.open = false;
        this.update();
      }
    };
    this.pinButton.onclick = () => {
      this.pin(this.select.value);
      this.details.open = false;
    };
    this.cancel.onclick = () => this.pin(null);
    this.choose(app.islandVisits[app.currentLandmark]?.animalId ? app.currentLandmark : '');
  }

  choose(id) {
    this.select.value = id;
    const visit = this.app.islandVisits[id];
    this.destination.textContent = visit ? visit.era + ' · ' + visit.note : '';
    this.pinButton.disabled = this.travelButton.disabled = !visit;
  }

  pin(id) {
    this.target = this.app.islandVisits[id] || null;
    document.querySelector('#guide-waypoint').hidden = !this.target;
    this.update();
  }

  update() {
    const {app, target} = this;
    const visit = app.islandVisits[app.currentLandmark];
    if (this.creditId !== (visit?.animalId ?? null)) {
      this.creditId = visit?.animalId ?? null;
      if (this.creditId) {
        this.choose(visit.id);
        const district = ISLAND_FAUNA_REGIONS.find(item => item.id === visit.regionId)?.districtId;
        const region = document.querySelector('#region-place');
        const regionValue = district === 'creek' ? 'entrance' : district === 'west-coast' ? 'west-shelf' : district;
        if (regionValue && Array.from(region.options).some(o => o.value === regionValue)) region.value = regionValue;
      }
      const info = app.islandFauna?.actors.get(this.creditId)?.metadata.attribution;
      this.credit.hidden = !info;
      this.credit.replaceChildren();
      if (info) {
        const source = document.createElement('a');
        source.href = info.url;
        source.target = '_blank';
        source.rel = 'noopener noreferrer';
        source.textContent = info.title;
        this.credit.append('模型 ', source, ' · ' + info.author + ' · ' + info.license);
      }
    }
    if (visit?.animalId) {
      const state = app.islandFauna?.state(visit.animalId);
      this.face.hidden = !state?.visible;
      const labels = {queued:'等待载入', loading:'正在载入动物', failed:'模型暂时无法载入'};
      const label = labels[state?.status] || '';
      if (this.status.textContent !== label) this.status.textContent = label;
    } else {
      this.face.hidden = true;
      if (this.status.textContent) this.status.textContent = '';
    }
    if (!target) return;
    const p = app.camera.position;
    const dx = target.p[0] - p.x, dz = target.p.at(-1) - p.z;
    const distance = Math.hypot(dx, dz);
    const dir = directions[(Math.round(Math.atan2(dx, -dz) / (Math.PI / 4)) + 8) % 8];
    const metres = distance < 1000 ? Math.round(distance) + ' 米' : (distance / 1000).toFixed(1) + ' 公里';
    const depth = target.diveLevel !== undefined ? ' · 水下' : '';
    const label = distance < 4 ? target.title + ' · 已到观察点附近' + depth : target.title + ' · ' + dir + ' ' + metres + depth;
    if (this.bearing.textContent !== label) this.bearing.textContent = label;
  }
}
