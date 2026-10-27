import { readFile, readdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
const root = new URL('../', import.meta.url);
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
export async function writeBuildInfo() {
  const upstream = JSON.parse(await readFile(new URL('upstream.lock.json', root), 'utf8'));
  for (const item of upstream.files) {
    const bytes = await readFile(new URL(`vendor/tidewater/${item.path}`, root));
    if (sha(bytes) !== item.sha256) throw Error(`Unrecorded upstream edit: ${item.path}`);
  }
  const names = [];
  async function collect(dir = '') {
    for (const item of await readdir(new URL(dir || './', root), { withFileTypes: true })) {
      if (item.name.startsWith('.') || item.name === 'vendor' || item.name === 'assets') continue;
      const name = dir + item.name;
      if (item.isDirectory()) await collect(name + '/');
      else if (name !== 'runtime/build-info.json' && /\.(js|mjs|css|html|json)$/.test(name)) names.push(name);
    }
  }
  await collect();
  const source = createHash('sha256');
  for (const name of names.sort()) { source.update(name); source.update(await readFile(new URL(name, root))); }
  const converted = JSON.parse(await readFile(new URL('museum/assets/conversion.json', root), 'utf8'));
  for (const animal of converted.animals) {
    const bytes = await readFile(new URL(`museum/assets/${animal.id}.glb`, root));
    if (sha(bytes) !== animal.derivedSha256) throw Error(`Derived animal changed: ${animal.id}`);
    if (animal.morph) {
      const bytes = await readFile(new URL(`museum/assets/${animal.id}-morph.bin`, root));
      if (sha(bytes) !== animal.morph.sha256) throw Error(`Morph data changed: ${animal.id}`);
    }
  }
  const island=JSON.parse(await readFile(new URL('island/export.lock.json',root),'utf8'));
  for(const item of island.outputs){if(sha(await readFile(new URL('island/'+item.path,root)))!==item.sha256)throw Error('Island cartography changed: '+item.path);}
  const lock = await readFile(new URL('../../../package-lock.json', import.meta.url));
  const creek = JSON.parse(await readFile(new URL('creek/geography.lock.json', root), 'utf8'));
  for (const item of creek.outputs) {
    const bytes = await readFile(new URL(`creek/${item.path}`, root));
    if (sha(bytes) !== item.sha256) throw Error(`Creek geography changed: ${item.path}`);
  }
  const wholeIsland=JSON.parse(await readFile(new URL('creek/island.lock.json',root),'utf8'));
  for(const item of wholeIsland.outputs){if(sha(await readFile(new URL('creek/'+item.path,root)))!==item.sha256)throw Error('Whole-island data changed: '+item.path);}
  const coast=JSON.parse(await readFile(new URL('creek/coast.lock.json',root),'utf8'));
  const materials=JSON.parse(await readFile(new URL('creek/materials.lock.json',root),'utf8'));
  const watershed=JSON.parse(await readFile(new URL('creek/watershed.lock.json',root),'utf8'));
  for(const item of watershed.outputs){if(sha(await readFile(new URL('creek/'+item.path,root)))!==item.sha256)throw Error('Watershed data changed: '+item.path);}
  for(const item of [...coast.outputs,...materials.assets]){const bytes=await readFile(new URL('creek/'+item.path,root));if(sha(bytes)!==item.sha256)throw Error('Museum coast/material changed: '+item.path);}
  const sample=JSON.parse(await readFile(new URL('creek/sample.lock.json',root),'utf8'));
  for(const item of sample.assets){if(sha(await readFile(new URL('creek/'+item.path,root)))!==item.sha256)throw Error('Authored sample asset changed: '+item.path);}
  const info = { wholeIslandSha256:sha(Buffer.from(JSON.stringify(wholeIsland))),watershedSha256:sha(Buffer.from(JSON.stringify(watershed))),coastGeographySha256:sha(Buffer.from(JSON.stringify(coast))), originalMaterialsSha256:sha(Buffer.from(JSON.stringify(materials))), schema: 'museum-native-build-v1', sourceHash: source.digest('hex'), upstreamCommit: upstream.commit, upstreamFiles: upstream.files.length, upstreamUnmodified: true, dependencyLockSha256: sha(lock), animalConversionSha256: sha(Buffer.from(JSON.stringify(converted))), creekGeographySha256: sha(Buffer.from(JSON.stringify(creek))), sourceFiles: names };
  const text = JSON.stringify(info, null, 2) + '\n';
  const target = new URL('runtime/build-info.json', root);
  let previous = ''; try { previous = await readFile(target, 'utf8'); } catch {}
  if (text !== previous) await writeFile(target, text);
  return info;
}
if (process.argv[1] && new URL(import.meta.url).pathname === process.argv[1]) console.log(JSON.stringify(await writeBuildInfo()));
