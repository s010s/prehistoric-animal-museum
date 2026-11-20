import { access, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import { HEIGHT_BLOCK_WORDS, isHeightGrid, unpackTerrainAsset } from '../creek/TerrainTransport.js';

const creek = new URL('../creek/', import.meta.url);
const output = new URL('assets/.transport/', creek);

function packHeightGrid(bytes) {
  const words = new Uint32Array(bytes.buffer, bytes.byteOffset, bytes.length / 4);
  const packed = Buffer.allocUnsafe(bytes.length);
  // The prediction operates on the IEEE-754 bits. There is no quantization or
  // new rounding. Independent blocks allow the browser to decode into a final
  // Float32 backing buffer with one small scratch array.
  for (let start = 0; start < words.length; start += HEIGHT_BLOCK_WORDS) {
    const count = Math.min(HEIGHT_BLOCK_WORDS, words.length - start);
    const base = start * 4;
    let previous = 0;
    for (let i = 0; i < count; i++) {
      const word = words[start + i];
      const delta = (word - previous) | 0;
      const predicted = (delta << 1) ^ (delta >> 31);
      packed[base + i] = predicted;
      packed[base + count + i] = predicted >>> 8;
      packed[base + count * 2 + i] = predicted >>> 16;
      packed[base + count * 3 + i] = predicted >>> 24;
      previous = word;
    }
  }
  return packed;
}

async function publishFile(url, contents) {
  const temporary = new URL(`${randomUUID()}.tmp`, output);
  try {
    await writeFile(temporary, contents);
    await rename(temporary, url);
  } finally {
    await rm(temporary, { force: true });
  }
}

// writeBuildInfo verifies the canonical hashes before this package step runs.
export async function prepareTerrainTransport() {
  await mkdir(output, { recursive: true });
  const entries = [];
  for (const label of ['geography', 'coast', 'watershed', 'island']) {
    const lock = JSON.parse(await readFile(new URL(`${label}.lock.json`, creek), 'utf8'));
    for (const asset of lock.outputs) {
      const name = asset.path.slice('assets/'.length);
      const filename = `${name}-v1-${asset.sha256.slice(0, 16)}.gzip`;
      const target = new URL(filename, output);
      const exists = await access(target).then(() => true, error => {
        if (error.code === 'ENOENT') return false;
        throw error;
      });
      if (!exists) {
        const source = await readFile(new URL(asset.path, creek));
        if (source.length !== asset.bytes) throw Error(`Incorrect terrain asset size: ${name}`);
        const packed = isHeightGrid(name) ? packHeightGrid(source) : source;
        const gzip = gzipSync(packed, { level: 4 });
        const unpacked = await unpackTerrainAsset(new Blob([gzip]).stream(), name, asset.bytes);
        if (!source.equals(Buffer.from(unpacked))) throw Error(`Terrain encoding changed source bytes: ${name}`);
        await publishFile(target, gzip);
      }
      entries.push(`  ${JSON.stringify(name)}: { url: new URL('./${filename}', import.meta.url), bytes: ${asset.bytes} },`);
    }
  }
  const contents = `export default {\n${entries.join('\n')}\n};\n`;
  const manifest = new URL('index.js', output);
  const previous = await readFile(manifest, 'utf8').catch(error => {
    if (error.code === 'ENOENT') return '';
    throw error;
  });
  if (previous !== contents) await publishFile(manifest, contents);
}
