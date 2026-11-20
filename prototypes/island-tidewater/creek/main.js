import {boot} from '../runtime/boot.js';
import {CreekApp} from './CreekApp.js';
import {ISLAND_FAUNA_PLAN, ISLAND_FAUNA_REGIONS} from './IslandFaunaPlan.js';
import {ISLAND_PLAN} from '../island/plan.js';
import {REGIONAL_LANDFORMS} from './RegionalLandforms.js';

const destination = new URLSearchParams(location.search).get('place');
const exhibit = ISLAND_FAUNA_PLAN.find(entry => entry.visitId === destination);
const landform = REGIONAL_LANDFORMS.find(entry => entry.id === destination);
if (exhibit) {
  document.querySelector('#arrival-title').textContent = exhibit.title;
  document.querySelector('#arrival-era').textContent = exhibit.era;
  document.querySelector('#arrival-region').textContent = ISLAND_FAUNA_REGIONS.find(region => region.id === exhibit.regionId).title;
} else if (destination) {
  const choice = Array.from(document.querySelectorAll('#region-place option, #sample-place option, #coast-place option, [data-place]'))
    .find(node => (node.value || node.dataset.place) === destination);
  if (choice) document.querySelector('#arrival-title').textContent = choice.textContent.trim();
}
const locationXZ = exhibit?.preferred ?? landform?.center;
if (locationXZ) {
  const [x, z] = locationXZ.map((v, i) => v + ISLAND_PLAN.sourceOrigin[i]);
  const [x0, z0, x1, z1] = ISLAND_PLAN.bounds;
  const pin = document.querySelector('#arrival-pin');
  pin.style.left = ((x - x0) / (x1 - x0) * 100) + '%';
  pin.style.top = ((z - z0) / (z1 - z0) * 100) + '%';
  pin.hidden = false;
}
document.querySelector('#arrival-retry').onclick = () => location.reload();
boot(CreekApp, 'museum-creek');
