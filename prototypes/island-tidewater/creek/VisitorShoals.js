// Anchors follow submerged shelves and pools along the visitor approaches.
// The short final search fits them to the same water and bed used for swimming.
// Depth bands are fractions down the water column, measured from the surface.
export function visitorShoals() {
  const habitats = [];
  function place(id, x, z, kind, count, length, patrol, options) {
    habitats.push([id, { x, z }, count, length, patrol, {
      radius: 3, step: .5, vault: kind, ...options,
    }]);
  }

  place('lake-shingle-shoal', 3217, -1975, 'diplomystus', 10, .29, 3.9,
    { min: 1.15, max: 3.2, target: 1.75, school: true });
  place('lake-ledge', 3229, -1881, 'coccosteus', 3, .48, 2.8,
    { min: 1.25, max: 3, target: 1.65, lowerDwell: true, cruise: .7 });
  place('lake-basin-slope', 2893, -1940, 'diplomystus', 12, .32, 5,
    { min: 3, max: 8, target: 4, school: true, depthBand: [.47, .72] });
  place('lake-deep', 2844, -1952, 'coccosteus', 4, .54, 4.8,
    { min: 7, max: 18, target: 13, depthBand: [.86, .94], cruise: .66 });
  place('tarn-basin-slope', 3811, -5283, 'cheiracanthus', 8, .33, 3.8,
    { min: 3, max: 7, target: 4.4, school: true, depthBand: [.42, .69] });
  place('tarn-deep', 3629, -5281, 'coccosteus', 3, .46, 4.2,
    { min: 5, max: 13, target: 9, depthBand: [.80, .92], cruise: .67 });

  place('tributary-pool', 8602.5, 1120, 'diplomystus', 8, .21, 1.45,
    { min: .65, max: 1.65, target: .9, school: true });
  place('wetland-runnel-shoal', 5486, 5910, 'diplomystus', 10, .24, 2.8,
    { min: 1.1, max: 3, target: 1.5, school: true });
  place('alluvial-channel', 7863, 4196, 'diplomystus', 12, .32, 3.2,
    { min: 1, max: 3.2, target: 1.5, school: true });
  place('estuary-tidal-channel', -532, 3652, 'eusthenopteron', 4, .63, 4.3,
    { min: 2.45, max: 5.5, target: 3, sea: true, depthBand: [.54, .78], cruise: .79 });

  place('east-bay-sand-channel', 11280, 2977, 'aspidorhynchus', 7, .53, 4.5,
    { min: 1.6, max: 4, target: 1.7, sea: true, school: true });
  place('east-bay-dive', 11319, 2981, 'falcatus', 4, .34, 2.6,
    { min: 1.7, max: 4.5, target: 2.2, sea: true, depthBand: [.52, .74] });
  place('east-marine-ledge', 10590, 198, 'aspidorhynchus', 5, .47, 3.1,
    { min: 1.8, max: 7, target: 2.9, sea: true, school: true, depthBand: [.46, .68] });
  place('jurassic-lagoon-shoal', -350, 5827, 'aspidorhynchus', 8, .52, 4.7,
    { min: 3, max: 12, target: 6, sea: true, school: true, depthBand: [.29, .47] });
  return habitats;
}
