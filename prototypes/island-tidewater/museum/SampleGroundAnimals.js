import { museumGroundSupport, museumTrunkClear, museumXZ, seatMuseumModel } from './MuseumGrounding.js';
import { faunaTorso, placeFaunaTorso } from '../creek/FaunaLandInteraction.js';
import { Vector3 } from '../vendor/tidewater/src/engine/index.js';
import { groundLookAngle, groundVisitorAttention } from './GroundVisitorAttention.js';

const routines = {
  apatosaurus: { behavior: 'browse', speed: .62, distance: 5.6, observe: 42, alert: 8 },
  triceratops: { behavior: 'graze', speed: .65, distance: 4.2, observe: 25, alert: 5.4 },
};

export function sampleAnimalTrail(app, metadata, site) {
  const routine = routines[metadata.id];
  const heading = Math.atan2(metadata.forward[0], metadata.forward[1]) + site.yaw;
  const [dx, dz] = museumXZ(...metadata.forward, site.yaw);
  const supportAt = distance => museumGroundSupport(app.terrainData, app.creekData.field,
    site.x + dx * distance, site.z + dz * distance, site.yaw, site.supportHalf);
  let length = 0;
  for (let distance = .35; distance <= routine.distance + 1e-6; distance += .35) {
    const section = supportAt(distance);
    // The support plane carries the torso. Each toe fits the actual terrain.
    if (section.clear < .22 || section.edge < .3 || section.slope > .24 || section.residual > .09
        || !museumTrunkClear(app, section, metadata, site.contactCenter)) break;
    length = distance;
  }
  return { ...routine, heading, length: length >= 1.05 - 1e-6 ? length : 0, supportAt };
}

export function resetSampleGroundAnimal(actor, metadata) {
  const routine = actor.trail;
  actor.groundState = { distance: 0, nearTime: 0, attention: 0, headYaw: 0, disposition: routine.behavior };
  actor.torso = faunaTorso(metadata.id, metadata);
  actor.torsoCenter = new Vector3();
  actor.model.groundMotion?.reset();
  actor.model.setHeadYaw(0);
}

export function updateSampleGroundAnimal(app, actor, dt) {
  const { model, trail, groundState: state, site } = actor;
  const data = actor.definition.data;
  const visitor = app.freeCam ? app.camera.position : app.player?.position ?? app.camera.position;
  const dx = visitor.x - actor.center.x, dz = visitor.z - actor.center.z;
  const distance = Math.hypot(dx, dz, visitor.y - actor.ground);
  const nearby = distance < trail.observe;
  state.nearTime = nearby ? state.nearTime + dt : 0;
  state.attention = groundVisitorAttention(state, dt, distance, trail.alert, 1.8);
  const alert = state.attention > 0;
  const remaining = Math.max(0, trail.length - state.distance);
  const walking = state.nearTime > 2.4 && remaining > .008 && !alert;
  const desiredSpeed = Math.min(trail.speed, Math.sqrt(1.05 * remaining));
  const speed = model.groundMotion?.advance(dt, walking, desiredSpeed) ?? 0;
  const travelled = Math.min(remaining, speed * dt);
  const before = state.distance;
  const proposed = before + travelled;
  if (travelled || dt === 0) {
    const support = proposed ? trail.supportAt(proposed) : site;
    seatMuseumModel(actor.mount, data, support, site.contactCenter);
    const { x, y, z } = actor.mount.group.position;
    if (!app.colliders || placeFaunaTorso(app, actor, x, y, z, trail.heading, travelled > 0)) {
      model.group.position.copy(actor.mount.group.position);
      model.group.quaternion.copy(actor.mount.group.quaternion);
      actor.ground = support.y;
      state.distance = proposed;
      actor.center.copy(actor.localCenter).applyQuaternion(model.group.quaternion).add(model.group.position);
    } else {
      actor.mount.group.position.copy(model.group.position);
      actor.mount.group.quaternion.copy(model.group.quaternion);
    }
  } else if (actor.collider) actor.collider.solid = true;
  const target = alert ? groundLookAngle(Math.atan2(dx, dz), trail.heading, model.headYawLimit) : 0;
  state.headYaw += (target - state.headYaw) * -Math.expm1(-dt * 3.8);
  model.setHeadYaw(state.headYaw);
  const waiting = model.headYawLimit ? 'watching-visitor' : 'holding-footing';
  state.disposition = alert ? waiting : state.distance > before ? 'walking' : trail.behavior;
  model.play(walking ? 'StrideBase' : 'Idle', { fade: .35 });
  model.update(dt, { terrain: app.terrainData, behavior: trail.behavior, alert, travelled: state.distance - before });
}
