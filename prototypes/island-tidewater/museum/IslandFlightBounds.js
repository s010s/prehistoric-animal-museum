// Evaluated native mesh extrema for the Blender flight cycles, in model space.
// These include the supplemental joints and a .03 model-unit sampling margin.
export const islandFlightBounds = {
  anurognathus: { min: [-.677, -.671, -1.598], max: [.793, 1.078, 1.598] },
  sordes: { min: [-1.103, -.364, -1.603], max: [1.085, 1.326, 1.623] },
  archaeopteryx: { min: [-1.747, -.215, -2.198], max: [1.686, 2.000, .958] },
  quetzalcoatlus: { min: [-1.038, -.973, -1.734], max: [1.544, .790, 1.743] },
  meganeura: { min: [-1.289, -1.005, -1.888], max: [1.241, 1.149, 1.919] },
  rhamphorhynchus: { min: [-1.118, -.760, -1.626], max: [1.115, .925, 1.628] },
  tupandactylus: { min: [-.703, -.987, -1.636], max: [.713, .714, 1.648] },
};
