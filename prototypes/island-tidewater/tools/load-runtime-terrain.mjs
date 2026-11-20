// Run the same terrain composition as the visitor app with checked-in local
// inputs. Node has no Vite asset imports or browser fetch for file: URLs.
import * as nodeModule from 'node:module';
import { readFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';

function load(url, context, next) {
  if (url.startsWith('file:') && url.endsWith('.json')) {
    const json = readFileSync(new URL(url), 'utf8');
    return { format: 'module', source: 'export default ' + json + ';', shortCircuit: true };
  }
  return next(url, context);
}

export async function loadRuntimeTerrain() {
  const hooks = nodeModule.registerHooks?.({ load });
  if (!hooks) {
    nodeModule.register('data:text/javascript,' + encodeURIComponent("import {readFileSync} from 'node:fs'; export " + load.toString()));
  }

  const previousFetch = globalThis.fetch;
  const previousLocation = globalThis.location;
  globalThis.location = { search: '' };
  globalThis.fetch = async url => new Response(await readFile(new URL(url)));
  try {
    const { loadCreekData } = await import('../creek/CreekData.js');
    const { expandMuseumCoast } = await import('../creek/CoastTerrain.js');
    const { expandWatershed } = await import('../creek/WatershedData.js');
    const { expandWholeIsland } = await import('../creek/WholeIslandData.js');
    return await expandWholeIsland(await expandWatershed(await expandMuseumCoast(await loadCreekData())));
  } finally {
    globalThis.fetch = previousFetch;
    if (previousLocation === undefined) delete globalThis.location;
    else globalThis.location = previousLocation;
    hooks?.deregister();
  }
}
