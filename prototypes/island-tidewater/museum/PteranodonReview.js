// Local causal review only. Every mode restores the captured material/cascade
// state before applying one isolation; normal restores that state completely.
const sessions = new WeakMap();
const modes = new Set(['normal', 'shadows-off', 'normalmap-off', 'fresh-shadows']);
const owns = (o, key) => Object.prototype.hasOwnProperty.call(o, key);

export function setPteranodonReview(app, mode = 'normal') {
  if (!modes.has(mode)) throw Error('Unknown Pteranodon review mode: ' + mode);
  const actor = app.sampleMuseumLife?.actors.find(a => a.definition.data.id === 'pteranodon');
  if (!actor) return { mode, available: false, reason: 'Pteranodon actor unavailable' };
  const shadows = app.shadows ?? app.csm;
  const materials = [...new Set(actor.model.meshes.map(mesh => mesh.material))];
  let session = sessions.get(app);
  if (!session) {
    session = { shadows, periods: shadows?.periods ? [...shadows.periods] : null, materials: new Map() };
    sessions.set(app, session);
  }
  for (const material of materials) if (!session.materials.has(material)) {
    session.materials.set(material, {
      receiveShadows: material.receiveShadows,
      hadNormalDefine: owns(material.defines, 'HAS_NORMAL'),
      normalDefine: material.defines.HAS_NORMAL,
      shadow: material.shadow,
    });
  }
  for (const [material, original] of session.materials) {
    const before = [material.receiveShadows, material.defines.HAS_NORMAL, material.shadow];
    material.receiveShadows = original.receiveShadows;
    if (original.hadNormalDefine) material.defines.HAS_NORMAL = original.normalDefine;
    else delete material.defines.HAS_NORMAL;
    material.shadow = original.shadow;
    if (materials.includes(material)) {
      if (mode === 'normalmap-off') material.defines.HAS_NORMAL = 0;
      if (mode === 'shadows-off') {
        material.receiveShadows = false;
        // The vendored lighting code does not consume RECEIVE_SHADOWS. Reject
        // only this animal's shadow/depth fragments to isolate its self-shadow;
        // external shadows and every world system keep running. A one-time
        // mesh.castShadow=false is overwritten by SampleMuseumLife.update().
        material.shadow = 'return false;';
      }
    }
    if (before[0] !== material.receiveShadows || before[1] !== material.defines.HAS_NORMAL || before[2] !== material.shadow) material.version++;
  }
  if (session.shadows && session.periods) {
    session.shadows.periods = mode === 'fresh-shadows' ? session.periods.map(() => 1) : [...session.periods];
    // Remove a previously cached animal silhouette before comparing modes.
    for (const cascade of session.shadows.cascades ?? []) cascade.dirty = true;
  }
  const stats = {
    mode, available: true, actor: actor.definition.data.id,
    cascadePeriods: session.shadows?.periods ? [...session.shadows.periods] : null,
    nativeReceiverFlagConsumed: false,
    isolation: mode === 'shadows-off' ? 'Pteranodon self-caster rejected in depth/shadow passes; external receivers unchanged'
      : mode === 'normalmap-off' ? 'Pteranodon normal texture disabled'
      : mode === 'fresh-shadows' ? 'all sun cascades temporarily refreshed every submitted frame'
      : 'captured material and cascade state restored',
    materials: materials.map(m => ({ id: m.id, name: m.name, receiveShadows: m.receiveShadows,
      hasNormalDefine: owns(m.defines, 'HAS_NORMAL'), normalMapEnabled: Number(m.defines.HAS_NORMAL ?? 0) !== 0,
      selfCasterRejected: m.shadow === 'return false;', side: m.side, alphaTest: m.alphaTest, version: m.version })),
    meshes: actor.model.meshes.map(m => ({ name: m.name, castShadow: m.castShadow, visible: m.visible })),
  };
  if (mode === 'normal') sessions.delete(app);
  return stats;
}
