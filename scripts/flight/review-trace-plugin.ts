import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import type { Plugin } from 'vite'

/** Local review evidence only. Never installed in a build or exposed to remote clients. */
export function flightReviewTracePlugin(): Plugin {
  return {
    name: 'flight-local-trace',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use('/__flight-review/capture',(request,response)=>{
        if(request.method!=='POST'||!['127.0.0.1','::1','::ffff:127.0.0.1'].includes(request.socket.remoteAddress??'')||request.headers.origin!==`http://${request.headers.host}`){response.writeHead(403).end();return}
        const chunks:Buffer[]=[];let bytes=0
        request.on('data',(chunk:Buffer)=>{bytes+=chunk.length;if(bytes>16*1024*1024){response.writeHead(413).end();request.destroy();return}chunks.push(chunk)})
        request.on('end',()=>{void(async()=>{
          const data=JSON.parse(Buffer.concat(chunks).toString('utf8')) as {image?:string;metadata?:unknown}
          if(typeof data.image!=='string'||!data.image.startsWith('data:image/png;base64,')){response.writeHead(400).end();return}
          const png=Buffer.from(data.image.slice(22),'base64');if(png.readUInt32BE(0)!==0x89504e47){response.writeHead(400).end();return}
          const directory=path.join(server.config.root,'.flight-evidence/w1/visual');await mkdir(directory,{recursive:true});const name=`pbr-${Date.now()}`
          await writeFile(path.join(directory,name+'.png'),png,{flag:'wx'});await writeFile(path.join(directory,name+'.json'),JSON.stringify(data.metadata,null,2),{flag:'wx'});response.end(name)
        })().catch(()=>{if(!response.headersSent)response.writeHead(500);response.end()})})
      })
      server.middlewares.use('/__flight-review/video' ,(request,response)=>{
        if(request.method!=='POST'||!['127.0.0.1','::1','::ffff:127.0.0.1'].includes(request.socket.remoteAddress??'')||request.headers.origin!==`http://${request.headers.host}`||request.headers['content-type']!=='video/webm'){response.writeHead(403).end();return}
        const chunks:Buffer[]=[];let bytes=0
        request.on('data',(chunk:Buffer)=>{bytes+=chunk.length;if(bytes>32*1024*1024){response.writeHead(413).end();request.destroy();return}chunks.push(chunk)})
        request.on('end',()=>{void(async()=>{const data=Buffer.concat(chunks);if(data.length<4||data.readUInt32BE(0)!==0x1a45dfa3){response.writeHead(400).end();return}const directory=path.join(server.config.root,'.flight-evidence/r6/videos');await mkdir(directory,{recursive:true});const filename=`capture-${Date.now()}.webm`;await writeFile(path.join(directory,filename),data,{flag:'wx'});response.end(filename)})().catch(()=>{if(!response.headersSent)response.writeHead(500);response.end()})})
      })
      server.middlewares.use('/__flight-review/trace', (request, response) => {
        const address = request.socket.remoteAddress
        if (request.method !== 'POST' || !['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(address ?? '') || request.headers.origin !== `http://${request.headers.host}`) {
          response.writeHead(403).end(); return
        }
        const chunks: Buffer[] = []; let bytes = 0
        request.on('data', (chunk: Buffer) => {
          bytes += chunk.length
          if (bytes > 64 * 1024 * 1024) { response.writeHead(413).end(); request.destroy(); return }
          chunks.push(chunk)
        })
        request.on('end', () => {
          void (async () => {
            const text = Buffer.concat(chunks).toString('utf8')
            const data = JSON.parse(text) as { schema?: unknown; route?: unknown; frames?: unknown }
            if (data.schema !== 'flight-frame-trace-v1' || typeof data.route !== 'string' || !/^(manual|[A-F]-[a-z0-9-]+)$/.test(data.route) || !Array.isArray(data.frames) || data.frames.length > 14400) {
              response.writeHead(400).end(); return
            }
            const directory = path.join(server.config.root, '.flight-evidence/r6/traces')
            await mkdir(directory, { recursive: true })
            const filename = `${data.route}-${Date.now()}.json`
            await writeFile(path.join(directory, filename), text, { flag: 'wx' })
            response.setHeader('Content-Type', 'application/json')
            response.end(JSON.stringify({ saved: filename, frames: data.frames.length }))
          })().catch(() => { if (!response.headersSent) response.writeHead(500); response.end() })
        })
      })
    },
  }
}
