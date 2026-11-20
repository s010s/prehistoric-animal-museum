"""Anatomical tracks in the museum rigs. Duplicated sockets use their actual source names."""

RIGS = {
    'stegosaurus': (
        ['Spine1_03', 'Spine2_04', 'Spine3_05'],
        ['Neck1_00', 'Neck3_07', 'Head_09'],
        ['Tail1_027', 'Tail2_028', 'Tail3_029', 'Tail4_030', 'Tail5_031', 'Tail6_032', 'Tail7_033'],
        ['Shoulder.L_015', 'Shoulder.R_020', 'Hip.L_034', 'Hip.R_039']),
    'apatosaurus': (
        ['Stride haunch', 'Stride chest'], ['Stride neck', 'Stride neck mid', 'Stride head'],
        ['Stride tail', 'Stride tail mid', 'Stride tail tip'], []),
    'sauropelta': (
        ['Stride haunch', 'Stride chest'], ['Stride neck', 'Stride head'],
        ['Stride tail', 'Stride tail mid', 'Stride tail tip'], []),
    'ankylosaurus': (['Chest'], ['Head'], ['Tail1', 'Tail2', 'Tail3'], []),
    'dimetrodon': (['Chest'], ['Head'], ['Tail1', 'Tail2', 'Tail3'], []),
    'lystrosaurus': (['abdomen_034_66', 'chest_035_65'], ['Neck_1_063_64', 'Neck_2_064_63', 'head_065_62'],
                     ['Tail_1_031_31', 'Tail_2_032_30', 'Tail_3_033_29'],
                     ['Shoulder_L_036_45', 'Shoulder_R_050_59', None, None]),
    'maiasaura': (['spine.002_014', 'spine.004_016', 'spine.006_018'],
                  ['neck.001_019', 'neck.003_021', 'head_023'],
                  ['tail.001_02', 'tail.003_04', 'tail.006_07', 'tail.009_010', 'tail.012_013'],
                  ['shoulder.L_036', 'shoulder.R_043', 'pelvis.L_053', 'pelvis.R_059']),
    'parasaurolophus': (['骨骼.001', '骨骼.002'], ['骨骼.003', '骨骼.004', '骨骼.006'],
                       ['骨骼.026', '骨骼.025', '骨骼.027', '骨骼.028', '骨骼.029'],
                       ['骨骼.014', '骨骼.031', '骨骼.019', '骨骼.036']),
    'regaliceratops': (['Body', 'Chest'], ['Neck', 'Head'], ['TailBase', 'TailMid', 'TailTip'], []),
    'triceratops': ([], ['head'], ['tail_1', 'tail_2', 'tail_3', 'tail_4'], []),
    'mammoth': ([], ['head'], ['tail_1', 'tail_2'], []),
}

# Longitudinal stride and foot clearance are fractions of hip-to-ankle height.
# Load gives lateral travel, vertical travel, advance, roll and pelvic yaw.
# Spine, head and tail are total degrees distributed down their own chains.
# Socket excursion changes the shoulder/hip independently from the trunk.
# Smaller phase delays keep stiff terminal weapons and tusks with the trunk.
class Profile:
    def __init__(self, stride, lift, load, spine, head, tail, socket, delay, splay):
        self.stride, self.lift, self.load = stride, lift, load
        self.spine, self.head, self.tail = spine, head, tail
        self.socket, self.delay, self.splay = socket, delay, splay

PROFILES = {
    'stegosaurus': Profile(.91, (.16,.18), (.047,.027,.029,3.4,2.3), 3.1, 5.3, 6.7, (.068,.047), .16, .12),
    'apatosaurus': Profile(.72, (.105,.12), (.038,.020,.027,2.3,1.8), 2.4, 3.3, 7.6, (.048,.032), .26, .075),
    'sauropelta': Profile(.85, (.16,.15), (.055,.025,.025,3.8,2.9), 3.4, 4.5, 7.5, (.063,.046), .15, .18),
    'ankylosaurus': Profile(.78, (.16,.16), (.059,.022,.024,4.1,2.0), 2.4, 3.9, 4.5, (.061,.045), .095, .15),
    'dimetrodon': Profile(1.10, (.21,.19), (.069,.024,.041,2.1,5.5), 8.2, 5.6, 12.8, (.088,.076), .22, .29),
    'lystrosaurus': Profile(.94, (.17,.21), (.05,.045,.035,4.6,3.0), 5.0, 7.0, 9.0, (.068,.059), .16, .18),
    'maiasaura': Profile(.98, (.19,.17), (.052,.032,.040,3.5,3.0), 5.5, 6.3, 7.2, (.079,.057), .19, .14),
    'parasaurolophus': Profile(.93, (.16,.17), (.048,.031,.032,3.1,2.7), 4.8, 5.2, 6.0, (.066,.056), .17, .12),
    'regaliceratops': Profile(.88, (.17,.16), (.055,.032,.029,4.0,2.8), 3.4, 4.8, 8.0, (.079,.042), .17, .19),
    'triceratops': Profile(.87, (.17,.15), (.054,.034,.031,3.5,2.3), 2.8, 4.9, 5.4, (.077,.046), .16, .15),
    'mammoth': Profile(.84, (.15,.14), (.06,.035,.034,3.6,2.9), 2.5, 3.2, 9.6, (.074,.057), .21, .11),
}
