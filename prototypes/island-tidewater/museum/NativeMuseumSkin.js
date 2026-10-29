// Preserve every skinned piece while feeding Tidewater's single-skin renderer.
// Bones remain source node indices; differing inverse binds receive their own row.
export function mergeMuseumSkins(gltf) {
  const nodes = gltf.nodes.map(n => ({ ...n, children: [...n.children] }));
  const joints = [], inverse = [], rows = new Map(), primitives = [];
  let first = -1, sourcePieces = 0;
  for (let i = 0; i < nodes.length; i++) {
    const node = nodes[i];
    if (node.mesh === undefined) continue;
    if (node.skin === undefined) throw Error(`Museum skin: unhandled rigid piece ${node.name}`);
    if (first < 0) first = i;
    const skin = gltf.skins[node.skin];
    if (!skin) throw Error(`Museum skin: missing skin ${node.skin}`);
    const remap = skin.joints.map((joint, j) => {
      const matrix = Array.from(skin.inverseBindMatrices.subarray(j * 16, j * 16 + 16));
      const key = joint + ':' + matrix.join(',');
      if (!rows.has(key)) { rows.set(key, joints.length); joints.push(joint); inverse.push(...matrix); }
      return rows.get(key);
    });
    for (const primitive of gltf.meshes[node.mesh]) {
      const source = primitive.attributes.JOINTS_0;
      if (!source || !primitive.attributes.WEIGHTS_0) throw Error(`Museum skin: missing weights ${node.name}`);
      const index = Uint32Array.from(source.array, j => {
        if (remap[j] === undefined) throw Error(`Museum skin: joint ${j} outside palette`);
        return remap[j];
      });
      primitives.push({ ...primitive, attributes: { ...primitive.attributes, JOINTS_0: { ...source, array: index, normalized: false, componentType: 5125 } } });
      sourcePieces++;
    }
    delete node.mesh; delete node.skin;
  }
  if (first < 0 || !joints.length) throw Error('Museum skin: no animated geometry');
  nodes[first].mesh = 0; nodes[first].skin = 0;
  return { ...gltf, nodes, meshes: [primitives], skins: [{ name: 'museum unified palette', joints, inverseBindMatrices: Float32Array.from(inverse) }], museumPieces: sourcePieces };
}
