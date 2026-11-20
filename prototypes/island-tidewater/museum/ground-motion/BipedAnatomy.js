// Named controls in anatomical order. The three tail controls on Allosaurus
// are sibling bones; its 144 hand aliases carry the original blended weights.
const supplemental = {
  chest: 'Museum Thorax', neck: 'Museum Neck', head: 'Museum Skull',
  left: ['Museum Left arm', 'Museum Left wrist'], right: ['Museum Right arm', 'Museum Right wrist'],
  tail: ['Museum Tail', 'Museum Tail middle', 'Museum Tail end'],
};
export const bipedAnatomy = {
  carnotaurus: {
    ...supplemental, jaw: 'Museum Mandible',
    tail: [...supplemental.tail, 'Museum Tail distal', 'Museum Tail penultimate', 'Museum Tail tip'],
  },
  dilophosaurus: { ...supplemental, jaw: 'Museum Mandible' },
  'allosaurus-pandras': {
    chest: 'Chest', neck: null, head: 'Head', jaw: 'Jaw',
    left: ['IdleClawL_Root_01'], right: ['IdleClawR_Root_01'], tail: ['Tail1', 'Tail2', 'Tail3'],
  },
  baryonyx: {
    chest: 'Bone.001', neck: 'Bone.004', head: 'Bone.018',
    left: ['Bone.019.L.001', 'Bone.020.L.001'], right: ['Bone.019.R.001', 'Bone.020.R.001'],
    tail: ['Bone.009', 'Bone.011', 'Bone.014'],
  },
  spinosaurus: {
    chest: 'Spine1_02', neck: 'Neck1_06', head: 'Head_010', jaw: 'Jaw_011',
    left: ['Arm.L_013', 'Forearm.L_014'], right: ['Arm.R_00', 'Forearm.R_026'],
    tail: ['TailBase_037', 'Tail4_041', 'Tail10_047'],
  },
  pachycephalosaurus: {
    chest: 'Spine2_04', neck: 'Neck1_06', head: 'Head_09',
    left: ['UpperArm.L_018', 'LowerArm.L_019'], right: ['UpperArm.R_033', 'LowerArm.R_034'],
    tail: ['SpineTail_048', 'Tail3_051', 'Tail6_054'],
  },
  gallimimus: {
    chest: '骨骼.001', neck: '骨骼.003', head: '骨骼.005', jaw: '骨骼.006',
    left: ['骨骼.007', '骨骼.008'], right: ['骨骼.028', '骨骼.029'], tail: ['骨骼.011', '骨骼.012', '骨骼.013'],
  },
  gigantoraptor: {
    chest: 'chest_04_42_28', neck: 'neck2_06_14_30', head: 'head_012_8_36', jaw: 'jaws_013_5_37',
    left: ['lArm_035_40_59', 'lForearm_036_39_60'], right: ['rArm_022_27_46', 'rForearm_023_26_47'],
    tail: ['tail01_047_53_71', 'tail04_049_50_74', 'tail07_052_47_77'],
  },
  therizinosaurus: {
    chest: 'Torso', neck: 'Neck', head: 'Head', left: ['UpperL', 'ForeL'], right: ['UpperR', 'ForeR'],
    tail: ['TailBase', 'TailTip', 'TailFan'],
  },
  phorusrhacos: {
    // Body also parents the grounded leg rig, so keep its rotation in the
    // support solver. NeckBase and the independently weighted wings remain free.
    neck: 'NeckBase', head: 'Head', jaw: 'Museum lower beak', left: ['Wing_L'], right: ['Wing_R'], tail: ['Tail'],
  },
  'tyrannosaurus-rex': {
    chest: 'spine', neck: 'neck', head: 'head', jaw: 'jaw', left: ['arm_left'], right: ['arm_right'],
    tail: ['tail_1', 'tail_2', 'tail_4'],
  },
};
