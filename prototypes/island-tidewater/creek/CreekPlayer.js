import { Euler, MathUtils, Vector3 } from '../vendor/tidewater/src/engine/index.js';
import { Player } from '../vendor/tidewater/src/player/Player.js';
import { WALK_CAPSULE } from './MuseumColliders.js';

const EYE = 1.62;
const SWIM_EYE = .162;
const { radius: RADIUS, height: HEIGHT } = WALK_CAPSULE;
const STEP = .32;
const MAX_GRADE = Math.tan(42 * Math.PI / 180);
const EDGE_MARGIN = 24;
const SWIM_DEPTH = 1.35;
const STAND_DEPTH = 1.1;
const BED_CLEARANCE = .25;

export class CreekPlayer extends Player {
  constructor(options) {
    super(options);
    this.seaLevel = options.seaLevel ?? -.7;
    this.wet = false;
    this.wasWet = false;
    this.boundaryHits = 0;
    this.candidate = new Vector3();
    this.wish = new Vector3();
    this.look = new Euler(0, 0, 0, 'YXZ');
    this.waterLevels = {};
  }

  get eyeHeight() {
    return this.mode === 'walk' ? EYE : SWIM_EYE;
  }

  resetPose(mode, x, y, z, grounded = false) {
    this.position.set(x, y, z);
    this.velocity.set(0, 0, 0);
    this.mode = mode;
    this.grounded = grounded;
    this.floating = mode === 'walk';
    this.bob = this.stepDist = this.wade = 0;
    this._camY = null;
    this.refreshWater();
    this.wasWet = this.wet;
    this.wasUnder = mode === 'swim' && y + SWIM_EYE < this.waterH - .05;
  }

  surfaceType(depth) {
    const p = this.position;
    if (depth > .06) return 'water';
    const floor = this.terrain.heightAt(p.x, p.z);
    if (this.colliders.groundHeightAt(p.x, p.z, p.y + .1) > floor + .05) return 'wood';
    const e = .5;
    const gx = this.terrain.heightAt(p.x + e, p.z) - this.terrain.heightAt(p.x - e, p.z);
    const gz = this.terrain.heightAt(p.x, p.z + e) - this.terrain.heightAt(p.x, p.z - e);
    if (Math.hypot(gx, gz) / (2 * e) > .42 || floor > 340) return 'rock';
    const aboveSea = floor - this.seaLevel;
    if (this.wet || (aboveSea < 1.3 && depth > -.25)) return 'wetsand';
    if (aboveSea < 4.0) return 'sand';
    return 'grass';
  }

  placeOnGround(x, z, reach) {
    const terrain = this.terrain.heightAt(x, z);
    const y = this.supportAt(x, z, terrain, reach ?? terrain + STEP);
    const p = this.candidate.set(x, y, z);
    // An arrival may overlap a trunk, exposed root or moving animal.
    this.colliders.resolveCapsule(p, RADIUS, HEIGHT, 1e-4);
    const floor = this.terrain.heightAt(p.x, p.z);
    this.resetPose('walk', p.x, this.supportAt(p.x, p.z, floor, reach ?? floor + STEP), p.z, true);
  }

  placeInWater(x, eyeY, z) {
    const y = eyeY - SWIM_EYE;
    const p = this.candidate.set(x, y - .22, z);
    this.colliders.resolveCapsule(p, RADIUS, .42, 0);
    const terrain = this.terrain.heightAt(p.x, p.z);
    const floor = this.supportAt(p.x, p.z, terrain, y);
    this.resetPose('swim', p.x, Math.max(y, floor + BED_CLEARANCE), p.z);
  }

  alignToCamera() {
    this.look.setFromQuaternion(this.camera.quaternion, 'YXZ');
    this.yaw = this.look.y;
    this.pitch = MathUtils.clamp(this.look.x, -1.5, 1.5);
  }

  dropAtCamera() {
    const camera = this.camera.position;
    const limit = this.terrain.size / 2 - EDGE_MARGIN;
    const x = MathUtils.clamp(camera.x, -limit, limit);
    const z = MathUtils.clamp(camera.z, -limit, limit);
    const terrain = this.terrain.heightAt(x, z);
    const water = this.query.sample(x, z, terrain);
    const ground = this.supportAt(x, z, terrain, camera.y);
    const feet = camera.y - EYE;
    this.alignToCamera();
    if (water[1] < .05 && camera.y < water[0] && ground + BED_CLEARANCE < water[0]) {
      this.placeInWater(x, camera.y, z);
    } else if (feet <= ground) {
      this.placeOnGround(x, z, camera.y);
    } else {
      this.resetPose('walk', x, feet, z);
    }
    this.update(0);
  }

  supportAt(x, z, terrain, reach) {
    return Math.max(terrain, this.colliders.groundHeightAt(x, z, reach + 1e-6));
  }

  refreshWater(terrain = this.terrain.heightAt(this.position.x, this.position.z)) {
    const { x, z } = this.position;
    const f = this.query.sample(x, z, terrain, this.waterLevels);
    this.waterH = f[0];
    this.waterMean = this.waterLevels.mean;
    this.wet = terrain < Math.max(this.waterMean, this.waterH) + .05;
  }

  // The inherited frame update handles mouse look and eases the camera between
  // the standing and swimming eye heights. Both modes use the same substeps.
  updateWalk(dt) { this.advance(dt); }
  updateSwim(dt) { this.advance(dt); }

  advance(dt) {
    this.refreshWater();
    if (dt <= 0) return;
    const input = this.input;
    const forward = Number(input.down('KeyW')) - Number(input.down('KeyS'));
    const strafe = Number(input.down('KeyD')) - Number(input.down('KeyA'));
    const up = input.down('Space');
    const dive = input.down('KeyC') || input.down('ControlLeft');
    const sprint = input.down('ShiftLeft') || input.down('ShiftRight');
    if (this.mode === 'walk' && this.grounded && input.hit('Space') && this.waterMean - this.position.y < .9) {
      this.velocity.y = 4.6;
      this.grounded = false;
    }

    // At a sprint each horizontal probe spans at most 11 cm, even on a slow frame.
    const steps = Math.ceil(dt * 60);
    const step = dt / steps;
    for (let i = 0; i < steps; i++) {
      if (this.mode === 'walk') this.walk(step, forward, strafe, sprint);
      else this.swim(step, forward, strafe, up, dive, sprint);
    }
  }

  horizontalCandidate(x, y, z) {
    const limit = this.terrain.size / 2 - EDGE_MARGIN;
    const nextX = MathUtils.clamp(x, -limit, limit);
    const nextZ = MathUtils.clamp(z, -limit, limit);
    if (nextX !== x || nextZ !== z) this.boundaryHits++;
    return this.candidate.set(nextX, y, nextZ);
  }

  redirectHorizontal(q, moved, dt) {
    const { position: p, velocity: v } = this;
    // A moving collider can displace the body more than its own input step.
    const rate = moved > 0 ? Math.min(1 / dt, Math.hypot(v.x, v.z) / moved) : 0;
    v.x = (q.x - p.x) * rate;
    v.z = (q.z - p.z) * rate;
  }

  walk(dt, forward, strafe, sprint) {
    const { position: p, velocity: v } = this;
    const wish = this.wish.set(strafe, 0, -forward).normalize();
    const sin = Math.sin(this.yaw), cos = Math.cos(this.yaw);
    const depth = this.waterMean - p.y;
    this.wade = MathUtils.clamp(depth / 1.2, 0, 1);
    const speed = (sprint ? 6.2 : 3) * MathUtils.lerp(1, .42, this.wade);
    const acceleration = 1 - Math.exp(-(this.grounded ? 14 : 2.5) * dt);
    v.x += ((wish.x * cos + wish.z * sin) * speed - v.x) * acceleration;
    v.z += ((wish.z * cos - wish.x * sin) * speed - v.z) * acceleration;
    v.multiplyScalar(Math.exp(-dt * Math.max(0, depth) * .8));
    v.y = Math.max(-35, v.y - 9.81 * dt);
    const nextY = p.y + v.y * dt;
    let dx = v.x * dt, dz = v.z * dt;
    const climb = (distance) => this.grounded ? p.y + MAX_GRADE * distance : Math.max(p.y, nextY);
    const terrain = this.terrain;
    const q = this.horizontalCandidate(p.x + dx, p.y, p.z + dz);
    let floor = terrain.heightAt(q.x, q.z);
    if (floor > climb(Math.hypot(q.x - p.x, q.z - p.z)) + 1e-5) {
      // Remove uphill displacement and try the component along the contour.
      const e = .18;
      const gx = terrain.heightAt(q.x + e, q.z) - terrain.heightAt(q.x - e, q.z);
      const gz = terrain.heightAt(q.x, q.z + e) - terrain.heightAt(q.x, q.z - e);
      const uphill = Math.max(0, dx * gx + dz * gz) / Math.max(gx * gx + gz * gz, 1e-8);
      dx -= uphill * gx;
      dz -= uphill * gz;
      this.horizontalCandidate(p.x + dx, p.y, p.z + dz);
      floor = terrain.heightAt(q.x, q.z);
    }

    q.y = this.grounded ? Math.max(p.y, floor) : Math.max(nextY, floor);
    if (this.colliders.resolveCapsule(q, RADIUS, HEIGHT, this.grounded ? STEP : 1e-4)) {
      floor = terrain.heightAt(q.x, q.z);
    }
    let moved = Math.hypot(q.x - p.x, q.z - p.z);
    if (floor > climb(moved) + 1e-5) {
      q.x = p.x;
      q.z = p.z;
      floor = terrain.heightAt(p.x, p.z);
      moved = 0;
    }

    const reach = this.grounded ? Math.max(floor, p.y + STEP) : Math.max(p.y, nextY);
    const ground = this.supportAt(q.x, q.z, floor, reach);
    const follow = this.grounded && p.y - ground <= Math.max(.055, MAX_GRADE * moved);
    this.grounded = follow || nextY <= ground;
    q.y = this.grounded ? ground : nextY;
    if (this.grounded) {
      v.y = 0;
      this.bob += moved * 2.4;
      this.stepDist += moved;
      if (this.stepDist > (sprint ? .9 : .62)) {
        this.stepDist = 0;
        this.surface = this.surfaceType(depth);
        if (this.audio) this.audio.footstep(this.surface);
      }
    }
    this.redirectHorizontal(q, moved, dt);
    p.copy(q);
    const prevWet = this.wasWet;
    this.refreshWater(floor);
    const newDepth = this.waterMean - p.y;
    if (!prevWet && this.wet && newDepth > .14) this.audio?.splash(MathUtils.clamp(.18 + newDepth * .28, .18, .45), p);
    this.wasWet = this.wet && newDepth > .06;

    if (this.wet && newDepth > SWIM_DEPTH) {
      const wadedIn = this.grounded;
      this.mode = 'swim';
      this.grounded = false;
      this.floating = true;
      this.stepDist = 0;
      if (wadedIn) p.y = this.waterH - SWIM_EYE + .1;
      v.y = wadedIn ? 0 : Math.max(v.y * .3, -2.5);
      this.audio?.splash(wadedIn ? .32 : .65, p);
    }
  }

  swim(dt, forward, strafe, up, dive, sprint) {
    const { position: p, velocity: v } = this;
    const sin = Math.sin(this.yaw), cos = Math.cos(this.yaw);
    const f = forward * Math.cos(this.pitch);
    const wish = this.wish.set(strafe * cos - f * sin,
      forward * Math.sin(this.pitch) + Number(up) - Number(dive),
      -strafe * sin - f * cos).normalize();
    const eyeTarget = this.waterH - SWIM_EYE + .1;
    const diving = dive || wish.y < -.25;
    if (diving) this.floating = false;
    else if (p.y > eyeTarget - .15) this.floating = true;
    if (this.floating && !diving) wish.y = Math.max(0, wish.y);
    v.lerp(wish.multiplyScalar(sprint ? 2.5 : 1.5), 1 - Math.exp(-dt * 3));
    const buoyancy = this.floating ? (eyeTarget - p.y) * (1 - Math.exp(-dt * 5)) : 0;
    const nextY = Math.min(p.y + v.y * dt + buoyancy, this.waterH + .05);
    const q = this.horizontalCandidate(p.x + v.x * dt, nextY - .22, p.z + v.z * dt);
    this.colliders.resolveCapsule(q, RADIUS, .42, 0);
    let floor = this.terrain.heightAt(q.x, q.z);
    let ground = this.supportAt(q.x, q.z, floor, Math.max(p.y, nextY) + STEP);
    // A swimmer can follow the rising bed and step out at a low bank.
    // A wall higher than their body requires a different exit.
    if (ground > Math.max(p.y, nextY) + STEP) {
      q.x = p.x;
      q.z = p.z;
      floor = this.terrain.heightAt(p.x, p.z);
      ground = this.supportAt(p.x, p.z, floor, p.y);
    }
    const moved = Math.hypot(q.x - p.x, q.z - p.z);
    this.redirectHorizontal(q, moved, dt);
    p.set(q.x, Math.max(nextY, ground + BED_CLEARANCE), q.z);
    if (p.y > nextY && v.y < 0) v.y = 0;
    this.refreshWater(floor);
    if (moved > 1e-5 && this.waterMean - ground < (diving ? .35 : STAND_DEPTH)) {
      this.mode = 'walk';
      this.grounded = true;
      this.bob = this.stepDist = 0;
      p.y = ground;
      v.y = 0;
      return;
    }
    this.stepDist += moved;
    if (this.stepDist > 1.3) {
      this.stepDist = 0;
      this.audio?.swimStroke();
    }
    const under = p.y + SWIM_EYE < this.waterH - .05;
    if (under !== this.wasUnder && this.audio) {
      if (under) this.audio.submerge();
      else this.audio.emerge();
    }
    this.wasUnder = under;
  }
}
