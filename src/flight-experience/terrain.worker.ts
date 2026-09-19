import { generateTerrain, type TerrainJob } from './terrain-protocol'
self.onmessage = (event: MessageEvent<TerrainJob>) => {
  const job = event.data
  if (job.type !== 'generate') return
  try {
    const result = generateTerrain(job)
    self.postMessage(result, { transfer: [result.positions.buffer, result.normals.buffer, result.colors.buffer,
      result.indices.buffer, result.boundaryHeights.buffer, result.coarseHeights.buffer, result.patchErrors.buffer, result.topologyNodes.buffer] })
  } catch {
    self.postMessage({ type: 'failed', sessionId: job.sessionId, requestId: job.requestId })
  }
}
