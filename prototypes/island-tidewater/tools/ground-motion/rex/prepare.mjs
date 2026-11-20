import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

// Bake into the actual island asset. Existing visitors only download the GLB.
export function bindTyrannosaurus(bytes) {
  const directory = mkdtempSync(join(tmpdir(), 'museum-rex-rig-'));
  const mac = '/Applications/Blender.app/Contents/MacOS/Blender';
  const blender = process.env.BLENDER_BIN ?? (existsSync(mac) ? mac : 'blender');
  const author = fileURLToPath(new URL('author.py', import.meta.url));
  const source = join(directory, 'source.glb'), output = join(directory, 'bound.glb');
  try {
    writeFileSync(source, bytes);
    execFileSync(blender, ['-b', '--factory-startup', '-t', '2', '--python-exit-code', '1',
      '--python', author, '--', source, output], { stdio: ['ignore', 'inherit', 'inherit'] });
    return readFileSync(output);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}
