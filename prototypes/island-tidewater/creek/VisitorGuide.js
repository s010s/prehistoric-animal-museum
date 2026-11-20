import {ISLAND_FAUNA_PLAN, ISLAND_FAUNA_REGIONS} from './IslandFaunaPlan.js';
import {NearbyFaunaGuide} from './NearbyFaunaGuide.js';
import {WildlifeDirectory} from './WildlifeDirectory.js';

export class VisitorGuide {
  constructor(app, travel, lookAt) {
    this.app = app;
    this.nearby = new NearbyFaunaGuide(app);
    this.select = document.querySelector('#fauna-place');
    this.details = document.querySelector('#field-guide');
    this.destination = document.querySelector('#guide-destination');
    this.status = document.querySelector('#fauna-status');
    this.face = document.querySelector('#face-animal');
    this.credit = document.querySelector('#model-credit');
    this.face.onclick = () => {
      const visit = app.islandVisits[app.currentLandmark];
      const point = visit?.animalId && app.islandFauna.state(visit.animalId)?.position;
      if (point) lookAt(point);
    };
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
        this.cancelTracking();
        this.details.open = false;
        this.update();
      }
    };
    this.pinButton.onclick = () => {
      const visit = app.islandVisits[this.select.value];
      if (visit?.animalId) this.startTracking(visit.animalId);
      this.details.open = false;
    };
    this.directory = new WildlifeDirectory({
      getEntries: () => this.nearby.tracking.directory(app.camera.position),
      track: speciesId => this.startTracking(speciesId),
      travel: entry => {
        const id = entry.visitId ?? entry.fallbackVisitId;
        if (!id || !travel(id)) return false;
        const visit = app.islandVisits[id];
        if (visit?.focusAnimal) this.trackIndividual(visit.focusAnimal);
        else if (id === entry.visitId) this.trackIndividual(entry.id);
        else if (visit?.animalId) this.trackIndividual(visit.animalId);
        return true;
      },
    });
    document.querySelector('#wildlife-cancel').onclick = () => {
      this.cancelTracking();
      this.directory.opener.focus({preventScroll:true});
    };
    this.choose(app.islandVisits[app.currentLandmark]?.animalId ? app.currentLandmark : '');
  }

  choose(id) {
    this.select.value = id;
    const visit = this.app.islandVisits[id];
    this.destination.textContent = visit ? visit.era + ' · ' + visit.note : '';
    this.pinButton.disabled = this.travelButton.disabled = !visit;
  }

  get trackId() {
    return this.nearby.snapshot?.lock?.id ?? null;
  }

  startTracking(speciesId) {
    this.nearby.tracking.lockSpecies(speciesId, this.app.camera.position);
    this.nearby.refresh();
    return this.nearby.snapshot.lock?.speciesId === speciesId;
  }

  trackIndividual(id) {
    this.nearby.tracking.lockIndividual(id);
    this.nearby.refresh();
    return this.trackId === id;
  }

  cancelTracking() {
    this.nearby.tracking.clearLock();
    this.nearby.refresh();
  }

  update() {
    const {app} = this;
    const visit = app.islandVisits[app.currentLandmark];
    if (this.arrivalId !== app.currentLandmark) {
      this.arrivalId = app.currentLandmark;
      if (visit?.focusAnimal) this.trackIndividual(visit.focusAnimal);
    }
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
  }
}
