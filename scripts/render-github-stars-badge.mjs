import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const count = Number.parseInt(process.argv[2] ?? '', 10);

if (!Number.isSafeInteger(count) || count < 0) {
  throw new Error('Pass a non-negative integer GitHub star count.');
}

function formatStars(value) {
  if (value < 1_000) return String(value);
  if (value < 10_000) {
    const rounded = (value / 1_000).toFixed(1).replace(/\.0$/, '');
    return `${rounded}k`;
  }
  return `${Math.round(value / 1_000)}k`;
}

const templateUrl = new URL('../assets/readme/github-stars-template.svg', import.meta.url);
const outputUrl = new URL('../assets/readme/github-stars.svg', import.meta.url);
const template = readFileSync(templateUrl, 'utf8');
const rendered = template
  .replaceAll('{{STAR_COUNT}}', String(count))
  .replaceAll('{{STAR_DISPLAY}}', formatStars(count));

writeFileSync(outputUrl, rendered, 'utf8');
console.log(`Rendered ${fileURLToPath(outputUrl)} with ${count} GitHub stars.`);
