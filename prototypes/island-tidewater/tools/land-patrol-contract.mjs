import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { loadRuntimeTerrain } from './load-runtime-terrain.mjs';
import { createIslandFaunaHabitats, faunaBodyPlacement, faunaMediumLimits, frameFaunaVisit } from '../creek/IslandFaunaHabitats.js';
import { PerspectiveCamera, Vector3 } from '../vendor/tidewater/src/engine/index.js';
import { landTurnRate, makeRoute, routePoint } from '../creek/IslandFaunaRoute.js';
import { groundLookAngle, groundVisitorAttention } from '../museum/GroundVisitorAttention.js';

// A visitor lingering beside an animal must see it disengage and resume
// ordinary activity, then notice a fresh approach after the visitor leaves.
const encounter = {};
assert(groundVisitorAttention(encounter, 0, 2, 4) > 0);
for (let i = 0; i < 240; i++) groundVisitorAttention(encounter, 1 / 60, 2, 4);
assert.equal(encounter.watchSeconds, 0);
groundVisitorAttention(encounter, .05, 8, 4);
assert(groundVisitorAttention(encounter, .05, 2, 4) > 0);
assert.equal(Math.abs(groundLookAngle(Math.PI, 0, .18)), 0);

const catalog = JSON.parse(readFileSync(new URL('../museum/island-museum-models.lock.json', import.meta.url))).animals;
const data = await loadRuntimeTerrain();
const habitats = createIslandFaunaHabitats(data, catalog);
// The visitor coming from the atlas must see both horns and the tail on a
// portrait display, with their eye on a walkable patch of the same terrain.
const specimen = habitats.sites.carnotaurus;
const visit = habitats.visits[specimen.visitId];
const body = faunaBodyPlacement(catalog.carnotaurus);
const actor = { site: specimen, body, route: makeRoute(specimen, body) };
const camera = new PerspectiveCamera(62, 16/9, .06, 60000);
assert.equal(frameFaunaVisit(data, actor, visit, camera), visit);
for (const aspect of [390 / 844, 543 / 991]) {
  camera.aspect = aspect;
  camera.updateProjectionMatrix();
  const view = frameFaunaVisit(data, actor, visit, camera);
  assert.equal(view.id, visit.id);
  assert(Math.abs(view.eye[1] - data.terrain.heightAt(...view.p) - 1.62) < .02);
  camera.position.fromArray(view.eye);
  camera.lookAt(new Vector3(...view.gaze));
  camera.updateMatrixWorld(true);
  const [cx, , cz, yaw] = routePoint(actor.route, 0);
  const cy = data.terrain.heightAt(cx, cz) - body.floor;
  const [hx, hy, hz] = body.half;
  for (const x of [-hx, hx]) for (const y of [-hy, hy]) for (const z of [-hz, hz]) {
    const point = new Vector3(cx + x*Math.cos(yaw) + z*Math.sin(yaw), cy + y, cz + z*Math.cos(yaw) - x*Math.sin(yaw)).project(camera);
    assert(Math.abs(point.x) < 1 && Math.abs(point.y) < 1, 'Carnotaurus is cropped at the portrait observation point');
  }
}
const land = [...Object.values(habitats.sites), ...habitats.population].filter(site => site.medium === 'ground');
const angle = radians => Math.abs(Math.atan2(Math.sin(radians), Math.cos(radians)));
for (const site of land) {
  const body = faunaBodyPlacement(catalog[site.id]), route = makeRoute(site, body);
  const who = site.actorId ?? site.id;
  for (let s = 0; s < route.length; s += .08) {
    const [x, , z, yaw] = routePoint(route, s);
    const [nextX, , nextZ, nextYaw] = routePoint(route, s + .01);
    assert(faunaMediumLimits(data.terrain, data.field, site, body, x, z, yaw), who + ' leaves its viable ground');
    assert(angle(nextYaw - yaw) * site.speed / .01 <= landTurnRate, who + ' cannot turn fast enough to stay on its path');
    const direction = Math.atan2(nextX - x, nextZ - z);
    assert(angle(direction - yaw - body.forward) < .025, who + ' walks sideways relative to its feet');
  }
}
console.log('Ground visitor response and ' + land.length + ' land encounters passed.');
