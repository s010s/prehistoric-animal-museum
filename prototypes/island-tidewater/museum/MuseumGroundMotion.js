import { Matrix4, Quaternion, Vector3 } from '../vendor/tidewater/src/engine/index.js';
import { museumGroundRigs } from './MuseumGroundRigs.js';

const UP = new Vector3(0, 1, 0);
const ONE = new Vector3(1, 1, 1);
const IDENTITY = new Quaternion();
const TAU = Math.PI * 2;
const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));
const fraction = x => x - Math.floor(x);
const smooth = x => x * x * (3 - 2 * x);
const angleDifference = (a, b) => Math.atan2(Math.sin(a - b), Math.cos(a - b));
const positionAt = (rows, i) => new Vector3().fromArray(rows, i * 16 + 12);

function rigidTransform(rotation, from, to = from) {
  const offset = to.clone().sub(from.clone().applyQuaternion(rotation));
  return new Matrix4().compose(offset, rotation, ONE);
}

function warpRows(source, output, rows, { elements: m }) {
  for (const row of rows) for (let col = 0; col < 16; col += 4) {
    const at = row + col;
    const x = source[at], y = source[at + 1], z = source[at + 2], w = source[at + 3];
    output[at] = m[0] * x + m[4] * y + m[8] * z + m[12] * w;
    output[at + 1] = m[1] * x + m[5] * y + m[9] * z + m[13] * w;
    output[at + 2] = m[2] * x + m[6] * y + m[10] * z + m[14] * w;
    output[at + 3] = w;
  }
}

function warp(pose, branch, transform, world = pose.world, palette = pose.jointData) {
  warpRows(world, pose.world, branch.nodes, transform);
  warpRows(palette, pose.jointData, branch.joints, transform);
}

function branchAt(pose, i) {
  if (i == null) return null;
  const descendants = new Set();
  function visit(index) {
    descendants.add(index);
    for (const child of pose.gltf.nodes[index].children) visit(child);
  }
  visit(i);
  return {
    i, nodes: Array.from(descendants, index => index * 16),
    joints: pose.skin.joints.flatMap((index, j) => descendants.has(index) ? [j * 16] : []),
  };
}

function bindPoseRows(pose) {
  const matrices = [], world = new Float32Array(pose.world.length);
  const palette = new Float32Array(pose.joints * 16);
  const t = new Vector3(), r = new Quaternion(), s = new Vector3(), inverseBind = new Matrix4();
  for (const i of pose.order) {
    const { t: p, r: q, s: k } = pose.rest[i];
    const local = new Matrix4().compose(t.fromArray(p), r.fromArray(q), s.fromArray(k));
    const parent = matrices[pose.parent[i]];
    matrices[i] = parent ? parent.clone().multiply(local) : local;
    matrices[i].toArray(world, i * 16);
  }
  for (const [j, i] of pose.skin.joints.entries()) {
    inverseBind.fromArray(pose.skin.inverseBindMatrices, j * 16);
    matrices[i].clone().multiply(inverseBind).toArray(palette, j * 16);
  }
  return { world, palette };
}

function terrainOrientation(terrain, point, heading, radius) {
  const { x, z } = point;
  const dx = terrain.heightAt(x + radius, z) - terrain.heightAt(x - radius, z);
  const dz = terrain.heightAt(x, z + radius) - terrain.heightAt(x, z - radius);
  const normal = new Vector3(-dx, radius * 2, -dz).normalize();
  return new Quaternion().setFromUnitVectors(UP, normal).multiply(heading);
}

function orientBranch(pose, branch, radians, axis) {
  if (!branch || Math.abs(radians) < 1e-5) return;
  const pivot = positionAt(pose.world, branch.i);
  warp(pose, branch, rigidTransform(new Quaternion().setFromAxisAngle(axis, radians), pivot));
}

function moveLeg(pose, limb, frame, target, footRotation) {
  const { upper, lower, foot, pole, soleVector } = limb;
  const hip = positionAt(pose.world, upper.i), knee = positionAt(pose.world, lower.i), ankle = positionAt(pose.world, foot.i);
  const upperVector = knee.clone().sub(hip), lowerVector = ankle.clone().sub(knee);
  const upperLength = upperVector.length(), lowerLength = lowerVector.length();
  const axis = target.clone().sub(hip);
  const distance = clamp(axis.length(), Math.abs(upperLength - lowerLength) + upperLength * .002, (upperLength + lowerLength) * .999);
  axis.normalize();
  const along = (upperLength ** 2 + distance ** 2 - lowerLength ** 2) / (2 * distance);
  const bend = pole.clone().addScaledVector(axis, -pole.dot(axis)).normalize();
  const kneeVector = axis.clone().multiplyScalar(along).addScaledVector(bend, Math.sqrt(Math.max(0, upperLength ** 2 - along ** 2)));
  const turnUpper = new Quaternion().setFromUnitVectors(upperVector.normalize(), kneeVector.clone().normalize());
  warp(pose, upper, rigidTransform(turnUpper, hip));

  const solvedKnee = positionAt(pose.world, lower.i);
  const toFoot = hip.clone().addScaledVector(axis, distance).sub(solvedKnee).normalize();
  const nowToFoot = positionAt(pose.world, foot.i).sub(solvedKnee).normalize();
  const turnLower = new Quaternion().setFromUnitVectors(nowToFoot, toFoot);
  warp(pose, lower, rigidTransform(turnLower, solvedKnee));

  // Restore the reference toe/hoof shape at the new ankle. In particular, a
  // toe curl in a source idle clip must not drag a sole across terrain.
  const solvedAnkle = positionAt(pose.world, foot.i);
  warp(pose, foot, rigidTransform(footRotation, limb.ankle, solvedAnkle), frame.world, frame.palette);
  return soleVector.clone().applyQuaternion(footRotation).add(solvedAnkle);
}

function buildRig(id, pose, derived) {
  const source = museumGroundRigs[id];
  if (!source && !derived) return null;
  const names = new Map(pose.gltf.nodes.map((node, i) => [node.name, i]));
  const resolve = name => {
    if (name == null) return null;
    const i = typeof name === 'number' ? name : names.get(name);
    if (i === undefined || !pose.gltf.nodes[i]) throw Error('Missing museum gait joint ' + id + ' ' + name);
    return i;
  };
  const profile = source ?? {
    root: derived.root, head: derived.head, tail: derived.tail,
    period: derived.chains.length === 2 ? 1.23 : 1.66,
    stride: .8, lift: derived.chains.length === 2 ? .13 : .085,
    duty: derived.chains.length === 2 ? .65 : .77,
  };
  const definitions = source?.legs.map(([upper, lower, foot, contact, pitch]) => ({ upper, lower, foot, contact, pitch })) ?? derived.chains;
  const frame = profile.bindFeet ? bindPoseRows(pose) : {
    world: pose.world.slice(), palette: pose.jointData.slice(0, pose.joints * 16),
  };
  const fore = definitions.length === 4;
  const limbs = definitions.map((definition, i) => {
    const upper = branchAt(pose, resolve(definition.upper));
    const lower = branchAt(pose, resolve(definition.lower));
    const foot = branchAt(pose, resolve(definition.foot));
    const ankle = positionAt(frame.world, foot.i), hip = positionAt(frame.world, upper.i), knee = positionAt(frame.world, lower.i);
    const contact = definition.contact ? new Vector3(...definition.contact)
      : new Vector3(...definition.sole).applyMatrix4(new Matrix4().fromArray(frame.world, foot.i * 16));
    const axis = ankle.clone().sub(hip).normalize();
    const pole = definition.pole ? new Vector3(...definition.pole) : knee.clone().sub(hip).projectOnPlane(axis).normalize();
    if (!pole.lengthSq()) throw Error('Degenerate museum gait pole ' + id + ' ' + definition.lower);
    return {
      upper, lower, foot, ankle, pole, contact, neutral: contact.clone(),
      soleVector: contact.clone().sub(ankle),
      reach: knee.distanceTo(hip) + ankle.distanceTo(knee),
      offset: (fore ? [0, .5, .27, .77] : [0, .5])[i],
      pitch: definition.pitch ?? 0,
      side: definition.side ?? (i % 2 ? 1 : -1),
      anchor: new Vector3(), start: new Vector3(), landing: new Vector3(), sole: new Vector3(), target: new Vector3(),
      stance: true, progress: 0, steps: 0, error: 0, clearance: 0,
      fromHeading: new Quaternion(), toHeading: new Quaternion(),
      orientation: new Quaternion(), ankleTarget: new Vector3(),
    };
  });
  return {
    profile, frame, limbs, fore,
    root: branchAt(pose, resolve(profile.root)),
    head: branchAt(pose, resolve(profile.head)),
    tail: branchAt(pose, resolve(profile.tail)),
  };
}

export function createMuseumGroundMotion(id, metadata, pose, derived = null) {
  const rig = buildRig(id, pose, derived);
  if (!rig) return null;
  const { profile, frame, limbs, fore, root, head, tail } = rig;
  const forward = new Vector3(metadata.forward[0], 0, metadata.forward[1]).normalize();
  const right = new Vector3().crossVectors(UP, forward);
  const poseScale = metadata.scale;
  // Some source reference poses have one leg mid-step. Keep their authored
  // distal bind geometry and center the two touchdown lanes independently.
  for (let i = 0; i < limbs.length; i += 2) {
    const a = limbs[i], b = limbs[i + 1];
    const forePosition = (a.contact.dot(forward) + b.contact.dot(forward)) * .5;
    for (const foot of [a, b]) foot.neutral.addScaledVector(forward, forePosition - foot.contact.dot(forward));
  }
  const center = limbs.reduce((v, limb) => v.add(limb.neutral), new Vector3()).divideScalar(limbs.length);
  const shortestLeg = Math.min(...limbs.map(leg => leg.reach));
  const height = shortestLeg * poseScale;
  const maximumStride = height * profile.stride;
  const footSampleRadius = clamp(height * .075, .018, .28);
  const supportSampleRadius = Math.max(footSampleRadius * 2, Math.max(...limbs.map(leg =>
    Math.hypot(leg.neutral.x - center.x, leg.neutral.z - center.z))) * poseScale * .82);
  const swingFraction = 1 - profile.duty;
  const correction = new Quaternion();

  let seeded = false, desired = false, speed = 0, cadenceDistance = maximumStride;
  let phase = 0, gaitWeight = 0, time = 0, started = false, previousYaw = 0, curvature = 0, stalled = 0;
  let supportOffset = null, balance = 0;
  let terrain = null;
  const previousOrigin = new Vector3();
  const origin = new Vector3(), heading = new Quaternion(), inverse = new Quaternion(), rootMatrix = new Matrix4();
  const motionDirection = new Vector3(), headingDirection = new Vector3();

  function advance(dt, moving, speedRequested) {
    desired = moving;
    if (moving) cadenceDistance = clamp(speedRequested * profile.period, height * .15, maximumStride);
    const targetSpeed = moving ? Math.min(speedRequested, maximumStride / (profile.period * .72)) : 0;
    speed += (targetSpeed - speed) * Math.min(1, dt / (moving ? .34 : .17));
    if (!moving && speed < .004) speed = 0;
    return speed;
  }

  function toWorld(p) {
    return p.clone().applyMatrix4(rootMatrix);
  }

  function footOnTerrain(at) {
    at.y = terrain.heightAt(at.x, at.z) + Math.min(.006, height * .009);
    return at;
  }

  function touchdown(leg, lead) {
    const turn = clamp(curvature * lead, -.45, .45);
    const future = new Quaternion().setFromAxisAngle(UP, turn);
    const arc = new Quaternion().setFromAxisAngle(UP, turn * .5);
    const target = toWorld(leg.neutral).sub(origin).applyQuaternion(future).add(origin)
      .addScaledVector(motionDirection.clone().applyQuaternion(arc), lead);
    return { position: footOnTerrain(target), heading: future.multiply(heading) };
  }

  function beginStep(leg, lead) {
    leg.stance = false;
    leg.progress = 0;
    leg.start.copy(leg.anchor);
    leg.fromHeading.copy(leg.toHeading);
    const future = touchdown(leg, lead);
    leg.landing.copy(future.position);
    leg.toHeading.copy(terrainOrientation(terrain, leg.landing, future.heading, footSampleRadius));
  }

  function updateContact(leg, phaseStep, dt) {
    if (leg.stance) {
      leg.target.copy(leg.anchor);
      leg.orientation.copy(leg.toHeading);
      return;
    }
    const settling = desired && stalled < .08 ? 0 : dt / Math.min(.31, swingFraction * profile.period);
    leg.progress = Math.min(1, leg.progress + Math.max(phaseStep / swingFraction, settling));
    if (leg.progress === 1) {
      leg.stance = true;
      leg.steps++;
      leg.anchor.copy(leg.landing);
    }
    const u = leg.progress, eased = smooth(u), lift = Math.sin(Math.PI * u) ** 1.35;
    leg.target.lerpVectors(leg.start, leg.landing, eased);
    // The swing clearance follows the intervening bed as the foot traverses
    // an uphill step. Both ends of the curve remain exactly on their anchors.
    const floor = terrain.heightAt(leg.target.x, leg.target.z);
    const stepHeight = Math.min(leg.reach * poseScale * profile.lift, cadenceDistance * .26);
    leg.target.y = Math.max(leg.target.y, floor) + lift * stepHeight;
    leg.orientation.slerpQuaternions(leg.fromHeading, leg.toHeading, eased);
  }

  function startNextStep(displacement, before) {
    if (displacement < .00001 || limbs.some(leg => !leg.stance)) return;
    let choice;
    let priority = 0;
    for (const leg of limbs) {
      const fromSole = toWorld(leg.neutral).sub(leg.anchor);
      fromSole.y = 0;
      const trail = fromSole.dot(motionDirection) / cadenceDistance;
      const side = Math.sqrt(Math.max(0, fromSole.lengthSq() - (trail * cadenceDistance) ** 2)) / cadenceDistance;
      const footPhase = fraction(phase + leg.offset);
      const nextInCycle = footPhase < swingFraction && fraction(before + leg.offset) >= swingFraction;
      const nearingLimit = trail + side * .45 > profile.duty * .47;
      const nextPlanned = desired && (nextInCycle || !started && footPhase < swingFraction) && trail > -.02;
      if (!nearingLimit && !nextPlanned) continue;
      const score = .1 + trail + side * .45 + (nextPlanned ? .04 : 0);
      if (score > priority) {
        choice = leg;
        priority = score;
      }
    }
    if (choice) {
      const lead = cadenceDistance * (desired ? swingFraction + profile.duty * .5 : .12);
      beginStep(choice, lead);
      started = true;
    }
  }

  function apply(sampledPose, { dt = 0, terrain: ground, behavior, alert, travelled, lookYaw = 0 } = {}) {
    if (!ground) return false;
    terrain = ground;
    const { group } = sampledPose;
    rootMatrix.compose(group.position, group.quaternion, group.scale);
    inverse.copy(group.quaternion).invert();
    origin.copy(toWorld(center));
    headingDirection.copy(forward).applyQuaternion(group.quaternion);
    headingDirection.y = 0;
    headingDirection.normalize();
    const yaw = Math.atan2(headingDirection.x, headingDirection.z) - Math.atan2(forward.x, forward.z);
    heading.setFromAxisAngle(UP, yaw);
    motionDirection.copy(origin).sub(previousOrigin);
    motionDirection.y = 0;
    const displacement = travelled ?? motionDirection.length();
    if (!seeded || motionDirection.lengthSq() < 1e-9) motionDirection.copy(headingDirection);
    else motionDirection.normalize();
    if (seeded && displacement > .001) {
      const measured = clamp(angleDifference(yaw, previousYaw) / displacement, -.6, .6);
      curvature += (measured - curvature) * Math.min(1, dt / .13);
    }
    if (!seeded) {
      for (const leg of limbs) {
        leg.anchor.copy(touchdown(leg, 0).position);
        leg.toHeading.copy(terrainOrientation(terrain, leg.anchor, heading, footSampleRadius));
      }
      seeded = true;
    }

    const movingDistance = dt > 0 ? displacement : 0;
    stalled = movingDistance > .00001 ? 0 : stalled + dt;
    const phaseStep = movingDistance / cadenceDistance;
    const before = phase;
    phase = fraction(phase + phaseStep);
    time += dt;
    const strength = desired && movingDistance > .00001 ? clamp(movingDistance / dt * profile.period / cadenceDistance, 0, 1) : 0;
    gaitWeight += (strength - gaitWeight) * Math.min(1, dt / .21);

    startNextStep(movingDistance, before);
    for (const leg of limbs) updateContact(leg, phaseStep, dt);
    previousOrigin.copy(origin);
    previousYaw = yaw;

    const planted = limbs.filter(leg => leg.stance);
    const supports = planted.length ? planted : limbs;
    const supportBalance = fore
      ? supports.reduce((sum, leg) => sum + leg.side, 0) / supports.length
      : Math.sin((phase + .03) * TAU);
    const postureBlend = dt === 0 ? 1 : Math.min(1, dt / .10);
    balance += (supportBalance - balance) * postureBlend;
    const rise = (fore ? .014 : .026) * Math.cos(phase * TAU * 2 - .5) * gaitWeight;
    const sway = (fore ? .022 : .05) * balance * gaitWeight;
    const crouch = shortestLeg * ((fore ? .024 : .035) + rise);
    const breath = Math.sin(time * 1.78) * shortestLeg * .007;
    const bodyShift = right.clone().multiplyScalar(sway * shortestLeg);
    const slope = terrainOrientation(terrain, origin, IDENTITY, supportSampleRadius);
    const modelNormal = UP.clone().applyQuaternion(slope).applyQuaternion(inverse);
    const lean = new Quaternion().setFromUnitVectors(UP, modelNormal);
    const roll = new Quaternion().rotateTowards(lean, .27).slerp(IDENTITY, fore ? .24 : .72)
      .multiply(new Quaternion().setFromAxisAngle(forward, sway * .72));

    const invGroup = rootMatrix.clone().invert();
    for (const leg of limbs) {
      const u = leg.stance ? 0 : leg.progress;
      const rock = Math.sin(Math.PI * u) * Math.cos(Math.PI * u) * (fore ? .44 : .64);
      leg.orientation.premultiply(inverse).multiply(correction.setFromAxisAngle(right, leg.pitch + rock));
      leg.ankleTarget.copy(leg.target).applyMatrix4(invGroup)
        .sub(leg.soleVector.clone().applyQuaternion(leg.orientation));
    }

    // Lower the trunk only as far as required to keep every stance ankle
    // inside its two-bone reach. This avoids stretching joints on uphill or
    // outward steps and shifts weight before an airborne foot touches down.
    const rootPivot = positionAt(sampledPose.world, root.i);
    const settleOnSlope = point => point.sub(rootPivot).applyQuaternion(roll).add(rootPivot);
    const groundOffset = supports.reduce((sum, leg) =>
      sum + (leg.target.y - toWorld(settleOnSlope(leg.neutral.clone())).y) / poseScale, 0) / supports.length;
    supportOffset ??= groundOffset;
    supportOffset += (groundOffset - supportOffset) * postureBlend;
    let baseY = supportOffset - crouch + breath;
    let minimumY = -Infinity;
    for (const leg of supports) {
      const hip = positionAt(sampledPose.world, leg.upper.i);
      const knee = positionAt(sampledPose.world, leg.lower.i);
      const ankle = positionAt(sampledPose.world, leg.foot.i);
      const reach = hip.distanceTo(knee) + knee.distanceTo(ankle);
      settleOnSlope(hip).add(bodyShift);
      const dx = hip.x - leg.ankleTarget.x, dz = hip.z - leg.ankleTarget.z;
      const verticalReach = Math.sqrt(Math.max(0, (reach * .995) ** 2 - dx * dx - dz * dz));
      baseY = Math.min(baseY, leg.ankleTarget.y + verticalReach - hip.y);
      const closedReach = Math.abs(reach - 2 * knee.distanceTo(ankle));
      const verticalClosure = closedReach ** 2 - dx * dx - dz * dz;
      if (verticalClosure > 0) minimumY = Math.max(minimumY, leg.ankleTarget.y + Math.sqrt(verticalClosure) - hip.y);
    }
    bodyShift.y = Math.max(groundOffset - shortestLeg * .36, Math.min(groundOffset + shortestLeg * .12, Math.max(minimumY, baseY)));
    warp(sampledPose, root, rigidTransform(roll, rootPivot, rootPivot.clone().add(bodyShift)));

    for (const leg of limbs) {
      const sole = moveLeg(sampledPose, leg, frame, leg.ankleTarget, leg.orientation);
      leg.sole.copy(sole.applyMatrix4(rootMatrix));
      leg.error = leg.sole.distanceTo(leg.target);
      leg.clearance = leg.sole.y - terrain.heightAt(leg.sole.x, leg.sole.z);
    }

    const feeding = behavior === 'graze' || behavior === 'browse' || behavior === 'forage';
    const lowering = Math.max(0, Math.sin(time * .86 - .86)) ** 3;
    const scan = Math.sin(time * .93) + .28 * Math.sin(time * 1.62 + .6);
    const still = (1 - gaitWeight) * (alert ? .19 : 1);
    const headPitch = gaitWeight * Math.sin(phase * TAU * 2 - .4) * (fore ? .034 : .06)
      + still * (feeding ? (behavior === 'browse' ? .095 : .19) * lowering : .038 * Math.sin(time * 1.3));
    orientBranch(sampledPose, head, headPitch, right);
    orientBranch(sampledPose, head, .085 * still * scan + clamp(lookYaw, -.18, .18), UP);
    orientBranch(sampledPose, tail, gaitWeight * Math.sin(phase * TAU + .6) * (fore ? .046 : .085), UP);
    return true;
  }

  return {
    advance, apply, headYawLimit: head ? .18 : 0,
    reset(seedPhaseSeconds = 0) {
      seeded = false;
      desired = started = false;
      phase = gaitWeight = speed = previousYaw = curvature = stalled = 0;
      time = seedPhaseSeconds;
      supportOffset = null;
      balance = 0;
      for (const leg of limbs) {
        leg.stance = true;
        leg.progress = leg.steps = 0;
      }
    },
    diagnostics() {
      return {
        strideMetres: cadenceDistance, phase, speedMetresPerSecond: speed,
        mode: desired && stalled < .08 ? 'walking' : limbs.some(leg => !leg.stance) ? 'settling' : 'holding',
        contacts: limbs.map(leg => ({
          joint: leg.foot.i, planted: leg.stance, steps: leg.steps,
          sole: leg.sole.toArray(), target: leg.target.toArray(), errorMetres: leg.error,
          terrainClearanceMetres: leg.clearance,
        })),
      };
    },
  };
}
