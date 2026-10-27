import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';
import { mkdir, writeFile } from 'node:fs/promises';
import { writeBuildInfo } from './tools/write-build-info.mjs';
import { submergedShadingContract } from './tools/submerged-shading-contract.mjs';
await writeBuildInfo();
const path = name => fileURLToPath(new URL(name, import.meta.url));
export default defineConfig({
  root: path('./'), base: './', publicDir: path('vendor/tidewater/public'),
  plugins: [submergedShadingContract(),{ name: 'private-native-review', configureServer(server) {
    server.middlewares.use('/__native-review', (request, response) => {
      if (request.method !== 'POST' || request.headers.origin !== `http://${request.headers.host}` || !/^127\.0\.0\.1:\d+$/.test(request.headers.host ?? '')) { response.statusCode = 403; response.end(); return; }
      const chunks = []; let bytes = 0;
      request.on('data', chunk => { bytes += chunk.length; if (bytes > 50000000) request.destroy(); else chunks.push(chunk); });
      request.on('end', async () => { try {
        const data = JSON.parse(Buffer.concat(chunks).toString());
        if (!/^(timing|observation|acceptance|video|audio|scene)$/.test(data.kind) || !/^[a-z-]+$/.test(data.app)) throw Error('Invalid evidence kind');
        const artifact = `${data.app}-${data.kind}-${Date.now()}`;
        const folder = path(`../../docs/research/tidewater-migration/results/${artifact}`);
        await mkdir(folder, { recursive: true });
        if(data.kind==='scene'){
          if(data.data?.packet?.schema!=='museum-scene-report-v1'||typeof data.data?.imageBase64!=='string'||typeof data.data?.text!=='string'||data.data.text.length>24000)throw Error('Invalid scene capture');
          const png=Buffer.from(data.data.imageBase64,'base64');
          if(png.length<32||png.length>8000000||png.subarray(0,8).toString('hex')!=='89504e470d0a1a0a')throw Error('Invalid PNG');
          await writeFile(folder+'/scene.png',png);await writeFile(folder+'/scene.txt',data.data.text);
          delete data.data.imageBase64;data.data.imageFile='scene.png';data.data.imageBytes=png.length;
        }
        if(data.kind==='video'){
          if(!['video/webm;codecs=vp9','video/webm;codecs=vp8'].includes(data.data?.mimeType)||typeof data.data?.videoBase64!=='string')throw Error('Invalid video');
          const video=Buffer.from(data.data.videoBase64,'base64');
          if(video.length>32000000||video.readUInt32BE(0)!==0x1a45dfa3)throw Error('Invalid WebM');
          await writeFile(`${folder}/walk.webm`,video);delete data.data.videoBase64;data.data.videoFile='walk.webm';data.data.videoBytes=video.length;
        }
        if(data.kind==='audio'){
          if(!['audio/webm;codecs=opus','audio/webm'].includes(data.data?.mimeType)||typeof data.data?.audioBase64!=='string')throw Error('Invalid audio');
          const audio=Buffer.from(data.data.audioBase64,'base64');if(audio.length<4||audio.length>3000000||audio.readUInt32BE(0)!==0x1a45dfa3)throw Error('Invalid audio WebM');
          await writeFile(`${folder}/waves.webm`,audio);delete data.data.audioBase64;data.data.audioFile='waves.webm';data.data.audioBytes=audio.length;
        }
        await writeFile(`${folder}/record.json`, JSON.stringify(data, null, 2));
        response.setHeader('Content-Type', 'application/json'); response.end(JSON.stringify({ saved: true, artifact }));
      } catch (error) { response.statusCode = 400; response.end(String(error.message)); } });
    });
  } }],
  build: { target: 'esnext', outDir: '.review-dist', chunkSizeWarningLimit: 4000, assetsInlineLimit: 0, rollupOptions: { input: { home: path('index.html'), island: path('island/index.html'), reference: path('reference/index.html'), museum: path('museum/index.html'), creek: path('creek/index.html') } } },
  server: { host: '127.0.0.1', port: 4402, strictPort: true, hmr: false },
});
