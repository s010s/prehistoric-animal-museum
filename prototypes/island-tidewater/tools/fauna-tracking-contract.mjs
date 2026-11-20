import assert from 'node:assert/strict';
import { FaunaTracking, describeFaunaTarget } from '../creek/FaunaTracking.js';

const point = (x, y, z = 0) => ({ x, y, z });
const camera = { position: point(0, 1.62) };
const actor = (id, speciesId, x, { population = false, live = false } = {}) => ({
  id, ...point(x, 2.3), active: live, model: live ? { group: { visible: true } } : null,
  body: { half: [.4, .5, .8], floor: -.5 }, route: { origin: [x, 2.3, 0], yaw: 0, length: 0 },
  site: { id: speciesId, title: speciesId, length: 2, medium: 'air', population, visitId: 'fauna-' + speciesId,
    regionId: 'cretaceous-coast', districtId: 'west-coast' },
});
const colony = actor('pteranodon', 'pteranodon', 700);
const roaming = actor('population-pteranodon-1', 'pteranodon', 23, { population: true, live: true });
const other = actor('archaeopteryx', 'archaeopteryx', 45, { live: true });
const status = new Map();
const sample = {
  definition: { habitat: 'air', title: '无齿翼龙', data: { id: 'pteranodon', scale: 3, dimensions: [3, 1, .5], metres: 7 } },
  active: true, model: { group: { visible: true } },
};
const bird = { id: 'near-bird', species: 'ichthyornis', position: point(2, 1.62), trackingSpan: .8, trackingVisible: true };
let sampleCenter = [12, 3.1, 0];
const app = {
  camera,
  terrainData: { size: 6000, heightAt: x => x < 0 ? -10 : 0 },
  creekData: { field: { sample: x => x < -15 ? [4, -3] : [-.7, 20] } },
  islandVisits: {
    'fauna-pteranodon': { id: 'fauna-pteranodon', p: [710, 0], eye: [710, 1.62, 0] },
    'sample-pteranodon': { id: 'sample-pteranodon', p: [6, 0], footing: { ground: 0 } },
    'west-shelf': { title: '西岸浅湾' },
  },
  islandFauna: {
    individuals: new Map([colony, roaming, other].map(entry => [entry.id, entry])),
    residents: new Set([roaming, other]),
    residency: { state: id => ({ status: status.get(id) ?? 'outside' }) },
  },
  sampleMuseumLife: {
    group: { visible: true }, actors: [sample],
    centerOf: () => sampleCenter,
    reviewAnchors: { pteranodon: { initialCenter: [16, 3, 0] } },
  },
  life: {
    enabled: true, group: { visible: true }, trackingSwimmers: [],
    environment: { trackingFliers: [bird], types: new Map([[bird.species, { batch: {} }]]) },
  },
};
const tracking = new FaunaTracking(app);

assert.equal(tracking.scan().target.id, 'sample:pteranodon');
assert.equal(tracking.scan(camera.position, 'all').target.id, 'environment:flight:near-bird');
assert(tracking.scan().near.some(entry => entry.id === 'environment:flight:near-bird'));
const directory = tracking.directory();
assert.equal(directory.filter(entry => entry.speciesId === 'pteranodon').length, 1);
assert.equal(directory[0].id, 'sample:pteranodon');
assert.equal(directory[0].visitId, 'sample-pteranodon');
assert.equal(directory[0].englishName, 'Pteranodon');
assert.equal(directory[0].observation.medium, 'ground');

assert.equal(tracking.lockSpecies('pteranodon').id, 'sample:pteranodon');
sampleCenter = [80, 7, 0];
assert.equal(tracking.scan().target.x, 80);
assert.equal(tracking.scan(point(24, 2)).target.id, 'sample:pteranodon');
sample.active = false;
sample.model.group.visible = false;
assert.equal(tracking.scan().target.x, 16);
assert.equal(tracking.scan().lock.state, 'habitat');
assert.equal(tracking.lockSpecies('pteranodon').id, roaming.id);
roaming.x = 1600;
assert.equal(tracking.directory()[0].id, 'sample:pteranodon');
assert.equal(tracking.lockSpecies('pteranodon').id, 'sample:pteranodon');
roaming.x = 23;
sample.model = null;
status.set('sample:pteranodon', 'loading');
assert.equal(tracking.scan(point(650, 2)).lock.state, 'loading');
status.set('sample:pteranodon', 'failed');
assert.equal(tracking.scan().lock.state, 'unavailable');
assert.equal(tracking.scan(camera.position, 'off').lock.id, 'sample:pteranodon');
assert.equal(tracking.scan(camera.position, 'off').target, null);

assert.equal(tracking.lockSpecies('pteranodon').id, roaming.id);
const roamingTarget = tracking.scan().target;
assert.equal(roamingTarget.observation, null);
assert.equal(roamingTarget.fallbackVisitId, 'fauna-pteranodon');
assert.equal(roamingTarget.habitat, '西岸浅湾');
assert.equal(tracking.lockIndividual('pteranodon').visitId, 'fauna-pteranodon');
assert.equal(tracking.scan().target.id, 'pteranodon');
assert.equal(tracking.lockIndividual('not-found'), null);
assert.equal(tracking.scan().target.id, 'pteranodon');
tracking.clearLock();
assert.equal(tracking.scan().target.id, roaming.id);

assert.equal(tracking.lockIndividual('environment:flight:near-bird').id, 'environment:flight:near-bird');
app.life.enabled = false;
assert.equal(tracking.scan().target, null);
assert.equal(tracking.scan().lock.state, 'unavailable');
tracking.clearLock();
assert.equal(tracking.scan(point(720, 120)).target.id, 'pteranodon');
assert.equal(tracking.scan(point(720, 120)).target.id, 'pteranodon');

const fish = { ...point(-20, 1, 4), medium: 'freshwater',
  observation: { ...point(-20, 3, 4), medium: 'water', waterLevel: 4 } };
const aboveWater = describeFaunaTarget(app, point(-20, 4.1, 4), fish);
assert.equal(aboveWater.horizontalDistance, 0);
assert(Math.abs(aboveWater.slantDistance - 3.1) < .0001);
assert(aboveWater.relativeHeight < 0);
assert.equal(aboveWater.terrainClearance, 11);
assert.deepEqual(aboveWater.height, { type: 'depth', metres: 3, reference: 'water' });
assert.equal(aboveWater.atObservation, false);
assert.equal(describeFaunaTarget(app, point(-20, 3, 4), fish).atObservation, true);
assert.equal(describeFaunaTarget(app, point(-20, 40, 4), fish).atObservation, false);
assert.deepEqual(describeFaunaTarget(app, camera.position, { ...fish, medium: 'air', y: 9 }).height,
  { type: 'altitude', metres: 5, reference: 'water' });
assert.deepEqual(describeFaunaTarget(app, camera.position, { ...colony, medium: 'air', y: 9 }).height,
  { type: 'altitude', metres: 9, reference: 'ground' });
console.log('Fauna tracking: nearest catalogue individual, streaming locks, arrival medium and distances passed.');
