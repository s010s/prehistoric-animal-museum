import assert from 'node:assert/strict';
import {loadRuntimeTerrain} from './load-runtime-terrain.mjs';
import {marineShoreFor} from '../creek/MarineShore.js';
import {coastalRollerRetention, rollerProbePeriods} from '../creek/CoastalWaveClimate.js';

const {terrain, island, cove} = await loadRuntimeTerrain();
const sea = island.seaLevel;
const coast = marineShoreFor(terrain, cove.continuous, sea);
const period = 9;

// The visitor's exposed headland and two lee pockets need fresh whitewater.
// At the headland and long SE shelf a bore can run for most of a period
// before reaching the beach. It must empty its air without another plunge.
const sites = [
  ['west-surf-point', [-787.75, -2464.84], 1, true],
  ['east-pocket-beach', [10385.723, 160.23], .35, false],
  ['north-pocket-beach', [5221.478, -7333.813], .55, false],
  ['southeast-shelf', [10109.25, 5052.32], .35, true],
];

for (const [name, location, exposure, longShelf] of sites) {
  const anchor = coast.nearest(...location);
  assert.ok(anchor, name + ' marine shore');
  let minimumFresh = 1;
  let maximumSpent = 0;
  for (const along of [-40, 0, 40]) {
    const station = coast.at(anchor.path, anchor.along + along);
    assert.ok(station, name + ' shore transect');
    const [x, z] = station.point, [nx, nz] = station.normal;
    const depth = r => sea - terrain.heightAt(x + nx * r, z + nz * r);
    for (const amplitude of [.24, .32, .38]) {
      // Break depth and initial impact match Tidewater's breaking profile.
      const impact = Math.pow(amplitude * Math.sqrt(exposure) * 3.556 / .78, .8) * (1 - .91 * .13);
      const wavelength = period * Math.sqrt(9.81 * impact);
      const [nearOffset, farOffset] = rollerProbePeriods.map(t => t * wavelength);
      const retain = r => coastalRollerRetention(depth(r), depth(r + nearOffset), depth(r + farOffset), impact, period);
      let r = 160;
      while (r > 1 && !(depth(r) < impact && depth(r + .5) >= impact)) r -= .5;
      assert.ok(r > 1, name + ' nearshore plunge');
      minimumFresh = Math.min(minimumFresh, retain(r));
      if (longShelf) {
        const spent = r - .86 * wavelength;
        assert.ok(spent > 0 && depth(spent) > .12, name + ' submerged roller on the inner shelf');
        maximumSpent = Math.max(maximumSpent, retain(spent));
      }
    }
  }
  assert.ok(minimumFresh > .85, name + ' keeps air where the incoming swell first plunges');
  if (longShelf) assert.ok(maximumSpent < .17, name + ' disperses air from an already-broken bore');
  console.log(name, {minimumFresh: +minimumFresh.toFixed(3), maximumSpent: longShelf ? +maximumSpent.toFixed(3) : null});
}
