import { freshwaterBedStops } from '../creek/FreshwaterBedVisits.js';
import { ISLAND_PLAN as plan } from './plan.js';
import { ISLAND_FAUNA_PLAN, ISLAND_FAUNA_REGIONS } from '../creek/IslandFaunaPlan.js';
import { mouthStops, rivers } from './assets/map.json';

const find = selector => document.querySelector(selector);
const terrainImage = find('#terrain');
const habitatImage = find('#habitat');
const habitatLegend = find('.map-habitat-key');
const mapStatus = find('#map-status');
const habitatURL = new URL('./assets/habitat.webp', import.meta.url);
const regionList = find('#region-list');
const regionDetail = find('#region-detail');
const regionName = find('#region-name');
const faunaList = find('#region-fauna');
const markers = find('#markers');
const overlay = find('#map-overlay');
const layerButtons = document.querySelectorAll('[data-layer]');
const mapSize = 512;
const [west, north, east, south] = plan.bounds;
const mapX = x => (x - west) / (east - west) * mapSize;
const mapY = z => (z - north) / (south - north) * mapSize;
const project = ([x, z]) => [mapX(x), mapY(z)];
const projectFauna = ({ preferred: [x, z] }) => project([x + plan.sourceOrigin[0], z + plan.sourceOrigin[1]]);
const riverLines = rivers.map(run => {
  const points = run.map(project).map(point => point.join(',')).join(' ');
  return `<polyline class="map-river" points="${points}"/>`;
}).join('');

// The pins fan out where neighbouring districts would otherwise cover each
// other at phone widths. Leader lines keep the district centres readable.
const pinOffsets = {
  creek: [18, 22],
  'west-coast': [-25, 6],
  'giant-forest': [-14, -12],
  lake: [12, -8],
  'east-bay': [-32, 0],
};
const tourAdditions = {
  creek: [
    { name: '岩隙里的细泉', place: 'sample-source' },
    { name: '溪谷巨木与幼树', place: 'sample-forest' },
  ],
  'west-coast': [
    { name: '西岸样板河口', place: 'sample-mouth' },
    { name: '在浅湾岸边看无齿翼龙', place: 'sample-pteranodon' },
  ],
  lake: [{ name: '山间长湖砾岸', place: 'lake-shingle' }],
  grassland: [{ name: '东部支流曲流滩', place: 'alluvial-bend' }],
  wetland: [{ name: '南部湿地汊道', place: 'wetland-runnels' }],
  highland: [{ name: '高地冰碛脊', place: 'tarn-moraine' }],
  'dry-upland': [{ name: '背风谷岩阶', place: 'dry-escarpment' }],
};
for (const stop of freshwaterBedStops) tourAdditions[stop.region].push({name:stop.title, place:stop.id});
const submergedSites = new Set(['shore-life', ...freshwaterBedStops.map(stop => stop.id)]);
const aerialSites = new Set(['cove-close', 'giant-canopy', 'giant-extent']);
const mediaLabels = { ground: '陆地', air: '空中', freshwater: '淡水', marine: '海水', benthic: '海底' };
const options = [];
let layer = 'terrain';
let activeRegion;
let focusedFauna;
let focusedMouth;

function route(params) {
  return '../creek/?' + new URLSearchParams(params);
}

function createRegionButton(region, index, onMap) {
  const button = document.createElement('button');
  button.type = 'button';
  button.setAttribute('aria-controls', 'region-detail');
  button.setAttribute('aria-pressed', 'false');

  if (onMap) {
    const [x, z] = project(region.point);
    const [dx, dz] = pinOffsets[region.id] ?? [0, 0];
    button.className = 'marker';
    button.textContent = index + 1;
    button.title = region.name;
    button.setAttribute('aria-label', region.name);
    button.style.left = `${(x + dx) / mapSize * 100}%`;
    button.style.top = `${(z + dz) / mapSize * 100}%`;
  } else {
    const badge = document.createElement('span');
    badge.className = 'region-index';
    badge.setAttribute('aria-hidden', 'true');
    badge.textContent = index + 1;
    button.append(badge, document.createTextNode(region.name));
  }

  button.addEventListener('click', event => {
    if (activeRegion?.id !== region.id) {
      history.pushState(null, '', '#' + region.id);
      selectRegion(region.id);
    }
    if (event.detail > 0 && matchMedia('(max-width: 760px)').matches) {
      regionName.focus({ preventScroll: true });
      regionName.scrollIntoView({ block: 'start' });
    }
  });
  options.push({ button, region });
  return button;
}

function faunaRow(animal) {
  const row = document.createElement('li');
  const link = document.createElement('a');
  link.href = route({ place: animal.visitId });
  link.className = 'fauna-link';
  const name = document.createElement('strong');
  name.textContent = animal.title;
  const era = document.createElement('span');
  era.className = 'fauna-meta';
  era.textContent = [animal.era, mediaLabels[animal.medium] ?? animal.medium].filter(Boolean).join(' · ');
  const arrow = document.createElement('span');
  arrow.className = 'fauna-arrow';
  arrow.setAttribute('aria-hidden', 'true');
  arrow.textContent = '↗';
  link.append(name, era, arrow);
  const englishName = document.createElement('span');
  englishName.className = 'fauna-name-alt';
  englishName.lang = 'en';
  englishName.textContent = animal.englishName;
  name.after(englishName);

  const highlight = id => {
    focusedFauna = id;
    drawOverlay();
  };
  link.addEventListener('focus', () => highlight(animal.id));
  link.addEventListener('blur', () => highlight(undefined));
  link.addEventListener('pointerenter', () => highlight(animal.id));
  link.addEventListener('pointerleave', () => highlight(document.activeElement === link ? animal.id : undefined));

  row.append(link);
  return row;
}

function scenicRow(site) {
  const row = document.createElement('li');
  const link = document.createElement('a');
  link.href = route(site.water ? { water: site.water } : { place: site.place });
  link.textContent = site.name;
  const mode = site.water || submergedSites.has(site.place) ? '水下' : aerialSites.has(site.place) ? '空中' : '步行';
  const meta = document.createElement('span');
  meta.textContent = `${mode} ↗`;
  link.append(meta);
  row.append(link);
  return row;
}

function habitatsForRegion() {
  return ISLAND_FAUNA_REGIONS.filter(habitat => habitat.districtId === activeRegion.id);
}

function faunaForHabitat(habitat) {
  return ISLAND_FAUNA_PLAN.filter(animal => animal.regionId === habitat.id);
}

function habitatBlock(habitat) {
  const block = document.createElement('div');
  const heading = document.createElement('h4');
  heading.className = 'fauna-habitat';
  heading.textContent = habitat.title;
  const list = document.createElement('ul');
  list.className = 'fauna-list';
  list.append(...faunaForHabitat(habitat).map(faunaRow));
  block.append(heading, list);
  return block;
}

function selectRegion(id) {
  activeRegion = plan.regions.find(region => region.id === id) ?? plan.regions[0];
  focusedFauna = undefined;

  for (const { button, region } of options) {
    button.setAttribute('aria-pressed', String(region === activeRegion));
  }
  regionName.textContent = activeRegion.name;
  find('#region-landform').textContent = activeRegion.landform;
  const note = find('#region-note');
  note.hidden = activeRegion.id !== 'giant-forest';
  note.textContent = note.hidden ? '' : '这片林地的树高和林下层次参考现存老龄林。';

  const habitats = habitatsForRegion();
  faunaList.replaceChildren(...habitats.map(habitatBlock));
  find('#no-fauna').hidden = habitats.length > 0;

  const stops = [...tourAdditions[activeRegion.id] ?? [], ...activeRegion.sites];
  find('#region-visits').replaceChildren(...stops.map(scenicRow));
  regionDetail.hidden = false;
  drawOverlay();
}

function drawOverlay() {
  const [x, z] = project(activeRegion.point);
  const [extentX, extentZ] = activeRegion.extent;
  const radiusX = extentX / (east - west) * mapSize;
  const radiusZ = extentZ / (south - north) * mapSize;
  const footprint = `<ellipse class="map-footprint" cx="${x}" cy="${z}" rx="${radiusX}" ry="${radiusZ}"/>`;
  const leaders = plan.regions.map(region => {
    const [px, pz] = project(region.point);
    const [dx, dz] = pinOffsets[region.id] ?? [0, 0];
    return `<path class="map-leader" d="M${px} ${pz}l${dx} ${dz}"/>`;
  });
  const visitAnimals = habitatsForRegion().flatMap(faunaForHabitat);
  const animals = visitAnimals.map(animal => {
    const [px, pz] = projectFauna(animal);
    const radius = focusedFauna === animal.id ? 5 : 3;
    return `<rect class="map-fauna ${focusedFauna === animal.id ? 'map-fauna-focus' : ''}" x="${px - radius}" y="${pz - radius}" width="${2 * radius}" height="${2 * radius}" transform="rotate(45 ${px} ${pz})"/>`;
  });
  const mouths = Object.entries(mouthStops).map(([id, point]) => {
    const [px, pz] = project(point);
    const radius = focusedMouth === id ? 6 : 4;
    return `<circle class="map-mouth" data-mouth="${id}" cx="${px}" cy="${pz}" r="${radius}"/>`;
  });
  overlay.innerHTML = [footprint, riverLines, ...leaders, ...animals, ...mouths].join('');
}

function selectFragment() {
  selectRegion(location.hash.slice(1));
}

plan.regions.forEach((region, index) => {
  regionList.append(createRegionButton(region, index, false));
  markers.append(createRegionButton(region, index, true));
});
window.addEventListener('hashchange', selectFragment);
selectFragment();

for (const link of document.querySelectorAll('.mouth-visits a')) {
  const highlight = id => {
    focusedMouth = id;
    drawOverlay();
  };
  link.addEventListener('focus', () => highlight(link.dataset.mouth));
  link.addEventListener('blur', () => highlight(undefined));
  link.addEventListener('pointerenter', () => highlight(link.dataset.mouth));
  link.addEventListener('pointerleave', () => highlight(document.activeElement === link ? link.dataset.mouth : undefined));
}

function displayLayer(nextLayer) {
  const showHabitat = nextLayer === 'habitat';
  for (const option of layerButtons) option.setAttribute('aria-pressed', String(option.dataset.layer === nextLayer));
  habitatImage.hidden = habitatLegend.hidden = !showHabitat;
  terrainImage.hidden = showHabitat;
}

const terrainUnavailable = '地形暂时无法显示。仍可从展区列表进入观察点。';
const displayTerrainError = () => {
  if (!terrainImage.hidden) mapStatus.textContent = terrainUnavailable;
};
terrainImage.addEventListener('error', displayTerrainError);
if (terrainImage.complete && !terrainImage.naturalWidth) displayTerrainError();

for (const button of layerButtons) {
  button.addEventListener('click', async () => {
    const requested = layer = button.dataset.layer;
    if (requested === 'terrain') {
      displayLayer(requested);
      mapStatus.textContent = terrainImage.complete && !terrainImage.naturalWidth ? terrainUnavailable : '';
      return;
    }
    try {
      if (!habitatImage.hasAttribute('src')) habitatImage.src = habitatURL.href;
      mapStatus.textContent = habitatImage.complete ? '' : '正在加载生态图…';
      await habitatImage.decode();
      if (layer !== requested) return;
      displayLayer(requested);
      mapStatus.textContent = '';
    } catch {
      if (layer !== requested) return;
      habitatImage.removeAttribute('src');
      displayLayer('terrain');
      mapStatus.textContent = '生态图暂时无法显示。可继续使用地形图。';
    }
  });
}
