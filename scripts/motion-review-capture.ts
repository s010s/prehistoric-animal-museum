import { validateLoopingMotion, validateWalkingJourney, type JourneyFrame } from '../src/review/motion-review-validation'
import { mkdirSync, writeFileSync } from 'node:fs'
import { createHash, randomUUID } from 'node:crypto'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { resolve } from 'node:path'

/** Bounded, same-origin local evidence ingestion. No arbitrary paths or overwrites. */
export async function saveMotionReviewCapture(request: IncomingMessage, response: ServerResponse, hashes: Readonly<Record<string, string>>, version: 'motion-v2' | 'motion-v3' | 'motion-v4' | 'motion-v5' = 'motion-v2', clips: Readonly<Record<string, string>> = {}, durations: Readonly<Record<string, number>> = {}) {
  try {
    if (request.method !== 'POST') { response.writeHead(405).end(); return }
    const origin = request.headers.origin
    if (!origin || new URL(origin).host !== request.headers.host ||
        !['127.0.0.1', 'localhost', '[::1]'].includes(new URL(origin).hostname)) {
      response.writeHead(403).end('Local same-origin capture only.'); return
    }
    const buffers: Buffer[] = []
    let bytes = 0
    for await (const chunk of request) {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as Uint8Array)
      bytes += buffer.length
      if (bytes > 40 * 1024 * 1024) { response.writeHead(413).end(); return }
      buffers.push(buffer)
    }
    const body = Uint8Array.from(Buffer.concat(buffers))
    const form = await new Response(body, { headers: { 'Content-Type': request.headers['content-type'] ?? '' } }).formData()
    const raw = form.get('metadata'), video = form.get('video')
    if (typeof raw !== 'string' || raw.length > 3_000_000 || !(video instanceof Blob)) throw new Error('Invalid capture payload')
    const meta = JSON.parse(raw) as Record<string, unknown>
    if (!meta || typeof meta.id !== 'string' || typeof meta.mode !== 'string' || typeof meta.clip !== 'string' ||
        !/^expansion-[a-z0-9-]+$/.test(meta.id) || hashes[meta.id] !== meta.hash || (version !== 'motion-v2' && clips[meta.id] !== meta.clip) ||
        !['gallery', 'comparison'].includes(meta.mode) || !Array.isArray(meta.frames) || meta.frames.length < 100) throw new Error('Capture state/hash mismatch')
    let timelineCheck: object
    if (meta.journey === true) {
      if (meta.mode !== 'comparison' || meta.clip !== 'Walk' || !['expansion-dimetrodon', 'expansion-gallimimus', 'expansion-ankylosaurus', 'expansion-allosaurus-pandras', 'expansion-parasaurolophus'].includes(meta.id)) throw new Error('Invalid walking journey')
      timelineCheck = validateWalkingJourney(meta.frames as JourneyFrame[])
    } else {
      const duration = durations[meta.id] ?? (version === 'motion-v5' ? NaN : 8)
      if (version === 'motion-v5' && meta.duration !== duration) throw new Error('Capture clip duration mismatch')
      timelineCheck = validateLoopingMotion(meta.frames as JourneyFrame[], duration, meta.clip)
    }
    const saved = `${meta.id}-${meta.mode}-${randomUUID()}`
    const dir = resolve('.handoff/expansion-12', version, 'runtime-recordings')
    mkdirSync(dir, { recursive: true })
    const data = Buffer.from(await video.arrayBuffer())
    if (data.length < 10000 || data.readUInt32BE(0) !== 0x1a45dfa3) throw new Error('Missing WebM capture')
    writeFileSync(resolve(dir, saved + '.webm'), data, { flag: 'wx' })
    writeFileSync(resolve(dir, saved + '.json'), JSON.stringify({ ...meta, timelineCheck, videoBytes: data.length,
      videoSha256: createHash('sha256').update(data).digest('hex') }, null, 2), { flag: 'wx' })
    response.setHeader('Content-Type', 'application/json')
    response.end(JSON.stringify({ saved }))
  } catch (error) { response.writeHead(400).end(String(error)) }
}
