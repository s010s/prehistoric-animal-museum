// Source joint names and sole points in unscaled model coordinates.
// Sole positions come from the low, distal-weighted vertices
// of each foot, rather than from ankle pivots or the overall mesh bounding box.
// Limb order is front pair then rear pair for quadrupeds, left then right.
export const museumGroundRigs = {
  dimetrodon: {
    root: 'Root', head: 'Head', tail: 'Tail1', period: .95, stride: .89, lift: .15, duty: .78,
    legs: [
      ['FL_Upper', 'FL_Lower', 'FL_Foot', [-1.016, 0, .145]],
      ['FR_Upper', 'FR_Lower', 'FR_Foot', [-1.016, 0, -.145]],
      ['HL_Upper', 'HL_Lower', 'HL_Foot', [-.215, 0, .122]],
      ['HR_Upper', 'HR_Lower', 'HR_Foot', [-.215, 0, -.122]],
    ],
  },
  lystrosaurus: {
    root: 'hip_02_67', head: 'Neck_1_063_64', tail: 'Tail_1_031_31',
    period: .86, stride: .82, lift: .18, duty: .78, bindFeet: true,
    legs: [
      ['Arm_L_037_44', 'Forearm_L_038_43', 'Hand_L_039_42', [.245, -.104, .881]],
      ['Arm_R_051_58', 'Forearm_R_052_57', 'Hand_R_053_56', [-.245, -.104, .881]],
      ['Thigh_L_03_14', 'Shin_L_04_13', 'Ankle_L_05_12', [.207, -.102, -.034]],
      ['Thigh_R_017_28', 'Shin_R_018_27', 'Ankle_R_019_26', [-.207, -.102, -.033]],
    ],
  },
  stegosaurus: {
    root: 'Pelvis_02', head: 'Neck1_00', tail: 'Tail1_027', period: 1.75, stride: .77, lift: .082, duty: .76,
    legs: [
      ['UpperArm.L_016', 'LowerArm.L_017', 'Foot.L_018', [.625, -.014, .278]],
      ['UpperArm.R_021', 'LowerArm.R_022', 'Foot.R_023', [-.625, -.014, .278]],
      ['UpperLeg.L_035', 'LowerLeg.L_036', 'BackFoot.L_037', [.714, -.001, -1.514]],
      ['UpperLeg.R_040', 'LowerLeg.R_041', 'BackFoot.R_042', [-.714, -.001, -1.514]],
    ],
  },
  'allosaurus-pandras': {
    root: 'Root', head: 'Head', tail: 'Tail1', period: 1.43, stride: .78, lift: .122, duty: .63,
    legs: [
      ['L_Upper', 'L_Lower', 'L_Foot', [.505, 0, .634]],
      ['R_Upper', 'R_Lower', 'R_Foot', [.677, 0, -.633]],
    ],
  },
  baryonyx: {
    root: 'Armature.001', head: 'Bone.004', tail: 'Bone.009', period: 1.56, stride: .67, lift: .14, duty: .68,
    legs: [
      ['Bone.018.L', 'Bone.019.L', 'Bone.020.L', [1.301, -3.283, 1.535]],
      ['Bone.018.R', 'Bone.019.R', 'Bone.020.R', [-1.755, -3.328, -.207]],
    ],
  },
  spinosaurus: {
    root: '_rootJoint', head: 'Neck1_06', tail: 'Tail1_038', period: 1.48, stride: .7, lift: .12, duty: .69,
    legs: [
      ['Femur.L_054', 'Shin.L_055', 'Metacarpal.L_056', [42.95, -.342, 47.707]],
      ['Femur.R_067', 'Shin.R_068', 'Metacarpal.R_069', [-42.389, -.322, -114.165]],
    ],
  },
  maiasaura: {
    root: 'spine.001_01', head: 'neck.001_019', tail: 'tail.001_02', period: 1.24, stride: .76, lift: .10, duty: .78,
    legs: [
      ['upper_arm.L_037', 'forearm.L_00', 'forefoot.L_038', [.208, -.019, .793]],
      ['upper_arm.R_044', 'forearm.R_045', 'forefoot.R_046', [-.21, -.013, .797]],
      ['thigh.L_054', 'lower_leg.L_055', 'hind_foot.L_056', [.241, -.023, -.068]],
      ['thigh.R_060', 'lower_leg.R_061', 'hind_foot.R_062', [-.24, -.023, -.068]],
    ],
  },
  parasaurolophus: {
    root: 'parasaurolophus_IdleRig', head: '骨骼.003', tail: '骨骼.026',
    period: 1.58, stride: .68, lift: .095, duty: .78,
    legs: [
      ['骨骼.015', '骨骼.016', '骨骼.017', [-2.345, .003, .37]],
      ['骨骼.032', '骨骼.033', '骨骼.034', [-2.346, .003, -.373]],
      ['骨骼.020', '骨骼.021', '骨骼.022', [-1.539, 0, .582]],
      ['骨骼.037', '骨骼.038', '骨骼.039', [-1.537, 0, -.579]],
    ],
  },
  ankylosaurus: {
    root: 'Root', head: 'Head', tail: 'Tail1', period: 1.68, stride: .8, lift: .086, duty: .79,
    legs: [
      ['FrontLUpper', 'FrontLLower', 'FrontLFoot', [-1.550, .001, .689]],
      ['FrontRUpper', 'FrontRLower', 'FrontRFoot', [-1.557, .001, -.673]],
      ['HindLUpper', 'HindLLower', 'HindLFoot', [.098, 0, .706]],
      ['HindRUpper', 'HindRLower', 'HindRFoot', [.091, 0, -.707]],
    ],
  },
  pachycephalosaurus: {
    root: 'Pelvis_02', head: 'Neck1_06', tail: 'Tail1_049', period: 1.12, stride: 1.05, lift: .17, duty: .63,
    legs: [
      ['UpperLeg.L_060', 'LowerLeg.L_061', 'Ankle.L_062', [.283, .001, -.008]],
      ['UpperLeg.R_072', 'LowerLeg.R_073', 'Ankle.R_074', [-.299, 0, -.005]],
    ],
  },
  gallimimus: {
    root: 'Bone', head: '骨骼.003', tail: '骨骼.012', period: .86, stride: 1.05, lift: .165, duty: .61,
    legs: [
      ['骨骼.014', '骨骼.015', '骨骼.016', [-1.604, .001, .319]],
      ['骨骼.018', '骨骼.019', '骨骼.020', [-1.603, 0, -.317]],
    ],
  },
  gigantoraptor: {
    root: 'hip_02_74_26', head: 'neck1_05_15_29', tail: 'tail01_047_53_71',
    period: 1.48, stride: .69, lift: .12, duty: .66,
    legs: [
      ['lThigh_056_63_81', 'lShin_057_62_82', 'lAnkle_058_61_83', [-.573, -.345, .468]],
      ['rThigh_066_73_91', 'rShin_067_72_92', 'rAnkle_068_71_93', [-1.342, -.114, -.7], -.38],
    ],
  },
};
