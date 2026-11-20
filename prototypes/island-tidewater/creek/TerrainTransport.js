// The authoring files remain the reference. Vite serves the lossless transport
// copies so the same payload works with a plain static server as well as dev.
const packedAssets = import.meta.env && import.meta.glob('./assets/.transport/index.js', {
  eager: true, import: 'default',
})['./assets/.transport/index.js'];

export const HEIGHT_BLOCK_WORDS = 65536;
export const isHeightGrid = name => /(?:^|-)heights\.bin$/.test(name);

function decodeHeightBlock(block, output, start) {
  const words = block.length / 4;
  let previous = 0;
  for (let i = 0; i < words; i++) {
    const word = block[i] | block[words + i] << 8 | block[words * 2 + i] << 16 | block[words * 3 + i] << 24;
    previous = (previous + ((word >>> 1) ^ -(word & 1))) | 0;
    output[start + i] = previous;
  }
}

export async function unpackTerrainAsset(stream, name, byteLength) {
  const heights = isHeightGrid(name);
  if (heights && byteLength % 4) throw Error(`Invalid height grid length: ${name}`);
  const output = heights ? new Uint32Array(byteLength / 4) : new Uint8Array(byteLength);
  const scratch = heights ? new Uint8Array(Math.min(HEIGHT_BLOCK_WORDS * 4, byteLength)) : null;
  const reader = stream.pipeThrough(new DecompressionStream('gzip')).getReader();
  let received = 0;
  let buffered = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      if (received + value.length > byteLength) throw Error(`Oversized terrain asset: ${name}`);
      if (scratch) {
        let offset = 0;
        while (offset < value.length) {
          const base = received - buffered;
          const blockSize = Math.min(scratch.length, byteLength - base);
          const count = Math.min(blockSize - buffered, value.length - offset);
          scratch.set(value.subarray(offset, offset + count), buffered);
          buffered += count;
          offset += count;
          received += count;
          if (buffered === blockSize) {
            decodeHeightBlock(scratch.subarray(0, blockSize), output, base / 4);
            buffered = 0;
          }
        }
      } else {
        output.set(value, received);
        received += value.length;
      }
    }
  } catch (error) {
    await reader.cancel().catch(() => {});
    throw error;
  } finally {
    reader.releaseLock();
  }
  if (received !== byteLength) throw Error(`Incomplete terrain asset: ${name}`);
  return output.buffer;
}

export async function readTerrainAsset(name) {
  const packed = packedAssets?.[name];
  if (packedAssets && !packed) throw Error(`Unknown terrain asset: ${name}`);
  const url = packed?.url ?? new URL('./assets/' + name, import.meta.url);
  const response = await fetch(url);
  if (!response.ok) throw Error(`Terrain asset ${response.status}: ${name}`);
  const bytes = packed ? await unpackTerrainAsset(response.body, name, packed.bytes) : await response.arrayBuffer();
  return name.endsWith('.json') ? JSON.parse(new TextDecoder().decode(bytes)) : bytes;
}
