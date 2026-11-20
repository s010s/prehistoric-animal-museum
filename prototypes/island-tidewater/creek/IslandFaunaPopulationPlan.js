// Approximate habitat patches in island-local metres. These routes connect
// different ecological exhibits and their time labels still belong to each
// animal. Group size illustrates a plausible encounter.
function patch(id, districtId, center, spread, species, habitat = null, route = null) {
  return { id, districtId, center, spread, species, habitat, route };
}

export const ISLAND_FAUNA_POPULATION_PLAN = [
  // The original side-spring path and the meadows beyond the creek crossing.
  patch('side-spring-gap', 'creek', [-57, -79], 11, [['anurognathus', 2]]),
  patch('side-spring-woodland', 'creek', [-36, -47], 19, [['anurognathus', 3]]),
  patch('ford-woodland', 'creek', [25, -9], 43, [['stegosaurus', 2]]),
  patch('river-meadow', 'creek', [24, 167], 78, [['apatosaurus', 3], ['stegosaurus', 2]]),
  patch('lower-creek-meadow', 'creek', [18, 324], 110, [['stegosaurus', 3], ['apatosaurus', 2]]),
  patch('lower-creek-margin', 'creek', [-108, 560], 120, [['stegosaurus', 3]]),
  patch('west-jurassic-meadow', 'creek', [-478, 372], 182, [['apatosaurus', 3]]),
  patch('mixed-forest-edge', 'creek', [-559, 677], 135, [['apatosaurus', 3], ['stegosaurus', 2]]),
  patch('ridge-meadow', 'creek', [692, -715], 125, [['stegosaurus', 3]]),
  patch('west-valley-pool', 'creek', [-649, -456], 29, [['anurognathus', 3]]),
  patch('west-valley-trees', 'creek', [-689, -350], 38, [['anurognathus', 4]]),
  patch('west-valley-bank', 'creek', [-700, -258], 61, [['stegosaurus', 3]]),
  patch('west-valley-bend', 'creek', [-723, -173], 32, [['sordes', 3]]),
  patch('west-valley-spur', 'creek', [-660, -56], 92, [['stegosaurus', 3]]),
  patch('west-valley-outwash', 'creek', [-659, 137], 108, [['apatosaurus', 3]]),
  patch('west-valley-upper-slope', 'creek', [-528, -382], 130, [['allosaurus-pandras', 1]]),

  // Late Jurassic nearshore exhibits from the sample strand northward and
  // around the distant lagoon. The Cambrian shelf is a separate stretch.
  patch('sample-strand', 'west-coast', [-855, 126], 55, [['rhamphorhynchus', 4]], 'sea-edge'),
  patch('shell-beach', 'west-coast', [-890, -35], 66, [['rhamphorhynchus', 4]], 'sea-edge'),
  patch('west-cove-sand', 'west-coast', [-983, 175], 55, [['ammonite', 5]], 'shoal'),
  patch('west-cove-channel', 'west-coast', [-1070, 30], 80, [['ichthyosaur', 3]], 'shelf'),
  patch('west-shore-spur', 'west-coast', [-893, -535], 100, [['rhamphorhynchus', 4]], 'sea-edge'),
  patch('west-shingle-cove', 'west-coast', [-924, -1070], 90, [['rhamphorhynchus', 4]], 'sea-edge'),
  patch('main-estuary-fishing-reach', 'west-coast', [-365, 3617], 38, [['rhamphorhynchus', 2]], 'sea-edge'),
  patch('main-estuary-mouth-bar', 'west-coast', [-543, 3646], 54, [['ammonite', 3]], 'shoal'),
  patch('cambrian-flats', 'west-coast', [-1447, 242], 31, [['anomalocaris', 5], ['opabinia', 4], ['hallucigenia', 3]], 'shoal'),
  patch('lagoon-north-shoals', 'west-coast', [-120, 5500], 120, [['rhamphorhynchus', 5], ['ammonite', 5]], 'sea-edge'),
  patch('lagoon-channel', 'west-coast', [-380, 5900], 180, [['ichthyosaur', 4], ['plesiosaurus', 2]], 'shelf'),

  patch('grove-west-entrance', 'giant-forest', [1380, -2102], 23, [['archaeopteryx', 3]]),
  patch('grove-north-glades', 'giant-forest', [1484, -2081], 36, [['archaeopteryx', 4]]),
  patch('grove-log-break', 'giant-forest', [1521, -2171], 38, [['archaeopteryx', 3]]),
  patch('grove-heart-glade', 'giant-forest', [1525, -2265], 38, [['archaeopteryx', 4]]),
  patch('grove-southern-verge', 'giant-forest', [1416, -2329], 66, [['anurognathus', 4]]),
  patch('grove-outer-slope', 'giant-forest', [1720, -1840], 135, [['stegosaurus', 3]]),
  patch('grove-outer-clearing', 'giant-forest', [1755, -2490], 135, [['stegosaurus', 3]]),

  // Keep the Early Jurassic lakeshore away from Late Jurassic grove glades.
  patch('lake-shingle-terrace', 'lake', [3270, -1970], 68, [['dilophosaurus', 1]], 'lake-edge'),
  patch('lake-southeast-terrace', 'lake', [3240, -1785], 120, [['dilophosaurus', 1]], 'lake-edge'),
  patch('lake-north-shore', 'lake', [3115, -2350], 160, [['dilophosaurus', 1]], 'lake-edge'),
  patch('lake-south-bench', 'lake', [2860, -1325], 142, [['stegosaurus', 3]], 'lake-edge'),
  patch('lake-west-bench', 'lake', [2465, -2125], 135, [['stegosaurus', 3]], 'lake-edge'),
  patch('lake-west-grove', 'lake', [2475, -2290], 113, [['archaeopteryx', 4]], 'lake-edge'),

  patch('meadow-crest', 'grassland', [8035, 2800], 142, [['maiasaura', 7]]),
  patch('meadow-north-ridge', 'grassland', [7970, 2360], 188, [['maiasaura', 6], ['parasaurolophus', 4]]),
  patch('meadow-south-swale', 'grassland', [8020, 3060], 132, [['parasaurolophus', 5], ['ankylosaurus', 2]]),
  patch('meadow-eastern-terrace', 'grassland', [8280, 2765], 175, [['parasaurolophus', 6], ['pachycephalosaurus', 3]]),
  patch('meadow-west-fan', 'grassland', [7520, 3015], 198, [['triceratops', 4], ['ankylosaurus', 2]]),
  patch('meadow-trail', 'grassland', [7680, 3490], 175, [['triceratops', 3], ['pachycephalosaurus', 3]]),
  patch('meadow-river-approach', 'grassland', [8125, 3880], 120, [['sauropelta', 4]], 'river-bank'),
  patch('east-river-bend', 'grassland', [7848, 4335], 90, [['sarcosuchus', 1]], 'river'),
  patch('east-river-bank', 'grassland', [7914, 4270], 95, [['baryonyx', 1], ['sauropelta', 3]], 'river-bank'),
  patch('east-river-lower', 'grassland', [7957, 4700], 110, [['sarcosuchus', 1], ['sauropelta', 3]], 'river-bank'),

  // Earlier Cretaceous river-edge specimens near the route, with a separate
  // Carboniferous flight and marine stretch beyond the southern wetlands.
  patch('wetland-upper-bank', 'wetland', [5408, 5880], 85, [['tupandactylus', 4]], 'river-bank'),
  patch('wetland-channel-edge', 'wetland', [5545, 5955], 115, [['spinosaurus', 1]], 'river-bank'),
  patch('wetland-mud-islands', 'wetland', [5650, 6136], 155, [['tupandactylus', 5]], 'river-bank'),
  patch('wetland-confluence', 'wetland', [5980, 5930], 160, [['tupandactylus', 4]], 'river-bank'),
  patch('wetland-lower-bank', 'wetland', [5755, 6465], 155, [['spinosaurus', 1]], 'river-bank'),
  patch('coal-age-south-reeds', 'wetland', [5650, 6985], 93, [['meganeura', 6]], 'river-bank'),
  patch('coal-age-tidal-margin', 'wetland', [5500, 7240], 108, [['meganeura', 6]], 'sea-edge'),
  patch('coal-age-sea', 'wetland', [5350, 7880], 95, [['tullimonstrum', 5]], 'shoal'),

  patch('tarn-moraine-basin', 'highland', [3815, -4890], 115, [['mammoth', 5]], 'tarn-forage'),
  patch('tarn-moraine-crest', 'highland', [3942, -4821], 88, [['mammoth', 4]], 'tarn-forage'),
  patch('tarn-east-shore', 'highland', [3900, -5240], 138, [['mammoth', 5]], 'tarn-forage'),
  patch('tarn-northern-bench', 'highland', [3589, -5686], 180, [['mammoth', 3]], 'tarn-forage'),
  patch('highland-pass', 'highland', [4496, -5920], 112, [['mammoth', 4]], 'tarn-forage'),
  patch('highland-open-tundra', 'highland', [4180, -5230], 120, [['mammoth', 4]], 'tarn-forage'),

  patch('dry-valley-terrace', 'dry-upland', [4815, 716], 95, [['lystrosaurus', 5]]),
  patch('dry-valley-upper', 'dry-upland', [4960, 465], 120, [['dimetrodon', 1]]),
  patch('dry-valley-lower', 'dry-upland', [4575, 933], 98, [['lystrosaurus', 5]]),
  patch('dry-valley-transition', 'dry-upland', [5075, 908], 165, [['lystrosaurus', 4]]),
  patch('dry-southern-grass', 'dry-upland', [4665, 1600], 165, [['gallimimus', 6], ['therizinosaurus', 2]]),
  patch('dry-southern-terraces', 'dry-upland', [4890, 1980], 190, [['gallimimus', 6], ['therizinosaurus', 2]]),
  patch('dry-eastern-fan', 'dry-upland', [5390, 1390], 170, [['gigantoraptor', 3]]),
  patch('dry-eastern-benches', 'dry-upland', [5500, 1830], 175, [['gigantoraptor', 3]]),

  patch('east-bay-shingle', 'east-bay', [11170, 2980], 110, [['pteranodon', 4]], 'sea-edge'),
  patch('east-bay-north-shore', 'east-bay', [11090, 2710], 135, [['pteranodon', 4]], 'sea-edge'),
  patch('east-bay-south-shore', 'east-bay', [11260, 3310], 138, [['pteranodon', 4]], 'sea-edge'),
  patch('east-bay-shallow-sand', 'east-bay', [11250, 3045], 100, [['dallasaurus', 4]], 'shoal'),
  patch('east-bay-offshore-channel', 'east-bay', [11460, 2920], 176, [['xiphactinus', 5]], 'shelf'),
  patch('east-cliff-slope', 'east-bay', [10452, 337], 170, [['pteranodon', 5]], 'sea-edge'),
  patch('east-cliff-high-air', 'east-bay', [10110, 565], 210, [['quetzalcoatlus', 2]]),
  patch('east-cliff-reef', 'east-bay', [10750, 60], 155, [['xiphactinus', 5], ['dallasaurus', 4]], 'shelf'),

  // The spring bench is narrow beside the walking line. One animal grazes
  // in the opening while the other can move along the contour farther back.
  patch('entrance-graze-bench', 'creek', [-54, -90], 0, [['stegosaurus', 1]], null,
    { radius: 0, axis: Math.PI / 3 }),
  patch('entrance-graze-shoulder', 'creek', [-52, -104], 24, [['stegosaurus', 1]], null,
    { radius: 7.5, axis: Math.PI / 4, form: { aspect: .86, phase: .7 } }),

  // Small groups along connected terrain between the busier habitat patches.
  patch('west-north-headland', 'west-coast', [-902, -282], 70, [['rhamphorhynchus', 3]], 'sea-edge'),
  patch('west-outer-bank', 'west-coast', [-895, -775], 80, [['rhamphorhynchus', 2]], 'sea-edge'),
  patch('grove-lake-pass', 'giant-forest', [2055, -2340], 138, [['stegosaurus', 2]]),
  patch('dry-meadow-shoulder', 'dry-upland', [5990, 2110], 150, [['gallimimus', 3]]),
  patch('dry-meadow-outskirts', 'dry-upland', [6450, 2510], 155, [['gallimimus', 2]]),
  patch('western-meadow-approach', 'grassland', [6930, 2790], 155, [['triceratops', 3]]),
  patch('tributary-upper-bank', 'grassland', [8030, 3660], 78, [['sauropelta', 3]], 'river-bank'),
  patch('tributary-delta-terrace', 'grassland', [7970, 5035], 88, [['sauropelta', 2]], 'river-bank'),
  patch('tributary-mudflat', 'wetland', [7470, 5270], 117, [['tupandactylus', 2]], 'river-bank'),
  patch('tributary-marsh-bend', 'wetland', [6940, 5500], 130, [['tupandactylus', 3]], 'river-bank'),
  patch('tributary-west-levees', 'wetland', [6480, 5620], 122, [['tupandactylus', 2]], 'river-bank'),
  patch('tarn-eastern-pass', 'highland', [4125, -5480], 120, [['mammoth', 3]], 'tarn-forage'),
  patch('east-cliff-beach', 'east-bay', [10535, 919], 110, [['pteranodon', 3]], 'sea-edge'),
  patch('east-bay-spur', 'east-bay', [10799, 1548], 128, [['pteranodon', 3]], 'sea-edge'),
  patch('east-bay-inlet', 'east-bay', [10925, 2190], 115, [['pteranodon', 2]], 'sea-edge'),
];
