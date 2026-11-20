// Evaluated native mesh extrema for the Blender flight cycles, in model space.
// These include the supplemental joints and a .03 model-unit sampling margin.
export const islandFlightBounds = {
  anurognathus: { min: [-.677, -.671, -1.598], max: [.793, 1.078, 1.598] },
  sordes: { min: [-1.103, -.373, -1.609], max: [1.085, 1.332, 1.625] },
  archaeopteryx: { min: [-1.750, -.222, -2.198], max: [1.687, 2.002, .960] },
  quetzalcoatlus: { min: [-1.141, -.978, -1.736], max: [1.544, .790, 1.749] },
  meganeura: { min: [-1.289, -1.005, -1.888], max: [1.241, 1.149, 1.919] },
  rhamphorhynchus: { min: [-1.119, -.760, -1.626], max: [1.115, .926, 1.628] },
  tupandactylus: { min: [-.703, -.987, -1.636], max: [.713, .719, 1.648] },
};
