import { build } from 'vite';
import { fileURLToPath } from 'node:url';
import { writeBuildInfo } from './tools/write-build-info.mjs';
await writeBuildInfo();
await build({ configFile: fileURLToPath(new URL('vite.config.mjs', import.meta.url)) });
