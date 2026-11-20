// Generate the visitor-facing images from the locked cartography samples.
import assert from 'node:assert/strict';
import sharp from 'sharp';

const channel = (from, to, amount) => from + (to - from) * amount;
const unit = value => Math.max(0, Math.min(1, value));

function terrainPixels({ meta, heights, water, habitat }, layer) {
  const pixels = new Uint8ClampedArray(meta.res ** 2 * 4);
  const { res, seaLevel, texelMetres } = meta;

  for (let row = 0; row < res; row++) {
    for (let col = 0; col < res; col++) {
      const index = row * res + col;
      const offset = index * 4;
      const h = heights[index];
      const east = heights[row * res + Math.min(res - 1, col + 1)];
      const south = heights[Math.min(res - 1, row + 1) * res + col];
      let r, g, b;

      if (h < seaLevel) {
        const deep = unit((seaLevel - h) / 125) ** 0.46;
        const contour = h > -96 && Math.floor(h / 18) !== Math.floor(east / 18) ? 5 : 0;
        r = channel(183, 142, deep) - contour;
        g = channel(214, 181, deep) - contour;
        b = channel(206, 184, deep) - contour;
      } else if (water[index] > seaLevel + 0.2 && h < water[index]) {
        const deep = unit((water[index] - h) / 18);
        r = channel(124, 81, deep);
        g = channel(173, 134, deep);
        b = channel(162, 141, deep);
      } else {
        const rise = unit((h - 180) / 750);
        const wood = habitat[offset + 3] / 255 * (layer === 'habitat' ? 0.8 : 0.42);
        r = channel(channel(182, 216, rise), 105, wood);
        g = channel(channel(183, 205, rise), 135, wood);
        b = channel(channel(138, 181, rise), 91, wood);
        if (layer === 'habitat') {
          const open = habitat[offset + 1] / 255 * 0.82;
          const wet = habitat[offset] / 255 * 0.86;
          const wind = habitat[offset + 2] / 255 * 0.7;
          r = channel(channel(channel(r, 204, open), 87, wet), 151, wind);
          g = channel(channel(channel(g, 179, open), 158, wet), 162, wind);
          b = channel(channel(channel(b, 111, open), 132, wet), 147, wind);
        }
        const west = heights[row * res + Math.max(0, col - 1)];
        const north = heights[Math.max(0, row - 1) * res + col];
        const dx = (east - west) / (2 * texelMetres);
        const dz = (south - north) / (2 * texelMetres);
        const light = Math.max(0.57, Math.min(1.23, (1 - dx * 0.64 - dz * 0.75) / Math.hypot(dx, 1, dz) * 0.5 + 0.53));
        const contour = h > 80 && Math.floor(h / 100) !== Math.floor(Math.max(east, south) / 100) ? 12 : 0;
        r = r * light - contour;
        g = g * light - contour;
        b = b * light - contour;
      }

      pixels[offset] = r;
      pixels[offset + 1] = g;
      pixels[offset + 2] = b;
      pixels[offset + 3] = 255;
    }
  }
  return pixels;
}

export async function bakeAtlasImages(samples, { size, webpQuality }) {
  const { res } = samples.meta;
  const raw = { width: res, height: res, channels: 4 };
  const buffers = {
    terrain: terrainPixels(samples, 'terrain'),
    habitat: terrainPixels(samples, 'habitat'),
  };
  const maps = await Promise.all(Object.entries(buffers).map(async ([layer, pixels]) => {
    const image = await sharp(pixels, { raw }).webp({ lossless: true }).toBuffer();
    const decoded = await sharp(image).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    assert.equal(decoded.info.width, res);
    assert.equal(decoded.info.height, res);
    assert.equal(decoded.info.channels, 4);
    assert.ok(decoded.data.equals(Buffer.from(pixels)), layer + ' WebP changed atlas pixels');
    return ['island/assets/' + layer + '.webp', image];
  }));
  const preview = await sharp(buffers.terrain, { raw }).resize(size, size).webp({ quality: webpQuality }).toBuffer();
  return [['creek/assets/arrival-map.webp', preview], ...maps];
}
