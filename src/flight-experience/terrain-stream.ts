import { farSurfaceHeight } from './far-surface'
import { attachSurfaceAttributes } from './materials/surface-attributes'
import type { FrameWorkBudget } from './frame-work-budget'
import { decorateShadowFade } from './environment/shadow-fade'
import { groupTerrainPatches, patchBlend } from './terrain-patches'
import { sampleDisplayed, sampleDisplayedHeight, type DisplayedSurface } from './displayed-surface'
import { MeshDepthMaterial, RGBADepthPacking, Box3, Sphere, Vector3, Vector2, Vector4, BufferAttribute, BufferGeometry, Group, Mesh, MeshStandardMaterial } from 'three'
import { chunkWindow, localChunkPosition, type WantedChunk } from './chunk-window'
import { generateTerrainSteps, resultBytes, validTerrainResult, type TerrainJob, type TerrainResult } from './terrain-protocol'
import { CHUNK_SIZE, WORLD, chunkAt, chunkKey, createWorldSampler, type WorldConfig, type WorldSampler, type Position, type Address, type Lod } from './world'

let nextSession = 0
interface PatchResident extends DisplayedSurface { replacement?: TerrainResult; mesh: Mesh<BufferGeometry, MeshStandardMaterial> }
interface PatchBuild { tile: Resident; index: number; target: TerrainResult; source: DisplayedSurface; result: TerrainResult; cursor: number; startNormals: Float32Array; startColors: Float32Array; replacement?: TerrainResult }
interface Resident extends DisplayedSurface { patches: Map<number,PatchResident>; patchTargets:Map<number,TerrainResult>; patchTarget?:TerrainResult; replacement: TerrainResult | undefined; mesh: Mesh<BufferGeometry, MeshStandardMaterial | MeshStandardMaterial[]> }
interface Slot { worker: Worker; job: TerrainJob | null; started: number }
export class TerrainStream {
  readonly root = new Group()
  readonly resident = new Map<string, Resident>()
  readonly material = new MeshStandardMaterial({ vertexColors: true, roughness: .96, metalness: 0 })
  readonly depthMaterial = new MeshDepthMaterial({ depthPacking: RGBADepthPacking })
  readonly sessionId = ++nextSession
  surfaceRevision = 0
  private dirtyGround = new Set<string>()
  private key(address: Address) { return chunkKey(address, this.world) }
  readonly metrics = { generated: 0, rejected: 0, generationMs: 0, installMs: 0, surfacePrepareMs: 0, geometryPrepareMs: 0, retireMs: 0, installBytes: 0, peakInstallMs: 0, readyBytes: 0, peakReadyBytes: 0, peakResident: 0, peakQueue: 0,
    fallbackGenerationMs: 0, peakFallbackGenerationMs: 0, fallbackGenerated: 0, peakGenerationMs: 0,
    morphMs: 0, peakMorphMs: 0, morphUploadBytes: 0, updateMs: 0, peakUpdateMs: 0,
    planMs: 0, peakPlanMs: 0, planRetireMs: 0, peakRetireMs: 0,
    mainThreadBudgetMs: 2, budgetOverruns: 0, deferredInstalls: 0, patchPrepareMs:0, patchInstalls:0, activeMorphArea:0, snapshotCount:0,forcedRetirements:0,peakRetired:0 }
  readonly review = { legacy: false, detail: true, bands: false, gray: false, freezeLod: false, wireframe:false, normals: false, patchGrid: false }
  private readonly inspectUniform = { value: new Vector2() }
  private readonly reviewUniform = { value: new Vector4(0, 1, 0, 0) }
  simplified = false
  private readonly sampler: WorldSampler
  private disposed = false
  private serial = 0
  private wanted = new Map<string, WantedChunk>()
  private patchKeys = new Set<string>()
  private patchBuild: PatchBuild | null = null
  private fallbackTask: {job:TerrainJob;steps:Generator<void,TerrainResult>} | null = null
  private retired:BufferGeometry[]=[]
  private topologyTables=new Map<string,Int16Array>()
  private projection={focalPixels:600,configured:false,position:null as Position|null}
  setViewProjection(framebufferHeight:number,fovYDegrees:number,position?:Position){this.projection={focalPixels:framebufferHeight/(2*Math.tan(fovYDegrees*Math.PI/360)),configured:true,position:position?{...position}:this.projection.position}}
  private prepared: TerrainResult[] = []
  private rawResults:Array<{data:unknown;job:TerrainJob;slot:Slot;bytes:number}>=[]
  private slots: Slot[] = []
  private failures = 0
  private readonly surfaceOrigin = { value: new Vector2() }
  private lastPlan = ''
  private fixedCenter: Address | null = null
  origin: Address = { x: 0, z: 0 }
  radius = 4
  constructor(private readonly wake: () => void, private readonly onFailure: () => void, readonly world: WorldConfig = WORLD) {
    this.sampler = createWorldSampler(world)
    this.depthMaterial.onBeforeCompile = shader => {
      shader.vertexShader = shader.vertexShader.replace('#include <common>', '#include <common>\nattribute float coarseHeight; attribute float terrainBlend;').replace('#include <begin_vertex>', '#include <begin_vertex>\ntransformed.y = mix(coarseHeight, position.y, terrainBlend);')
    }
    this.depthMaterial.customProgramCacheKey = () => 'flight-terrain-depth-morph-v1'
    this.material.onBeforeCompile = shader => {
      shader.uniforms.flightReview = this.reviewUniform
      shader.uniforms.flightInspect = this.inspectUniform
      shader.uniforms.flightSurfaceOrigin = this.surfaceOrigin
      shader.vertexShader = shader.vertexShader.replace('#include <common>', '#include <common>\nattribute float coarseHeight; attribute float terrainBlend; attribute vec3 startNormal; attribute vec3 startColor; varying vec3 flightWorld; varying vec3 flightObjectNormal;')
        .replace('#include <beginnormal_vertex>', '#include <beginnormal_vertex>\nobjectNormal = normalize(mix(startNormal, normal, terrainBlend));')
        .replace('#include <color_vertex>', '#include <color_vertex>\nvColor.rgb = mix(startColor, color.rgb, terrainBlend);')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\ntransformed.y = mix(coarseHeight, position.y, terrainBlend);')
        .replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nflightWorld = (modelMatrix * vec4(transformed, 1.)).xyz; flightObjectNormal = objectNormal;')
      shader.fragmentShader = shader.fragmentShader.replace('#include <common>', '#include <common>\nuniform vec2 flightInspect; uniform vec4 flightReview; uniform vec2 flightSurfaceOrigin; varying vec3 flightWorld; varying vec3 flightObjectNormal;')

      shader.fragmentShader = shader.fragmentShader.replace('#include <opaque_fragment>', `if(flightInspect.x>.5)outgoingLight=normal*.5+.5; if(flightInspect.y>.5){vec2 edge=abs(fract((flightWorld.xz+flightSurfaceOrigin)/128.)-.5);float line=smoothstep(.485,.498,max(edge.x,edge.y));outgoingLight=mix(outgoingLight,vec3(1.,.18,.03),line);}\n#include <opaque_fragment>`)
      shader.fragmentShader = shader.fragmentShader.replace('#include <color_fragment>','#include <color_fragment>\nif(flightReview.w>.5)diffuseColor.rgb=vec3(.45);')
    }
    this.material.customProgramCacheKey = () => 'flight-terrain-patch-material-v3'
    decorateShadowFade(this.material)
    this.createWorker()

  }
  private createWorker() {
    try {
      const worker = new Worker(new URL('./terrain.worker.ts', import.meta.url), { type: 'module' })
      const slot: Slot = { worker, job: null, started: 0 }
      worker.onmessage = (event: MessageEvent<unknown>) => {
        const job = slot.job; slot.job = null
        if (this.disposed || !job) return
        const payload=event.data as Partial<TerrainResult>|null
        let bytes=0
        if(payload&&typeof payload==='object')for(const field of ['positions','normals','colors','indices','coarseHeights','boundaryHeights','patchErrors','topologyNodes'] as const){const array=payload[field];if(ArrayBuffer.isView(array))bytes+=array.byteLength}
        if(this.rawResults.length+this.prepared.length>=8||this.metrics.readyBytes+bytes>8*1024*1024){this.metrics.rejected++;return}
        this.rawResults.push({data:event.data,job,slot,bytes});this.metrics.readyBytes+=bytes;this.metrics.peakReadyBytes=Math.max(this.metrics.peakReadyBytes,this.metrics.readyBytes)
        this.wake()
      }
      worker.onerror = () => this.workerFailed(slot)
      this.slots.push(slot)
    } catch { this.enterFallback() }
  }
  private acceptRawResult(){
    const raw=this.rawResults.shift();if(!raw)return
    const {data,job,slot}=raw
    this.metrics.readyBytes-=raw.bytes
        if (!validTerrainResult(data, job)) { this.metrics.rejected++; this.workerFailed(slot); return }
        const result = data
        // A packet for one128m patch can never provide missing512m coverage.
        if(result.patchIndex!==undefined&&!this.resident.has(this.key(result.chunk))){this.metrics.rejected++;return}
        const shared=this.topologyTables.get(result.topologyLayoutId)
        if(shared)result.topologyNodes=shared;else this.topologyTables.set(result.topologyLayoutId,result.topologyNodes)
        const wanted = this.wanted.get(this.key(job.chunk))
        if ((wanted?.lod !== job.lod && !(wanted&&job.lod===this.coverageLod(this.key(job.chunk))&&!this.resident.has(this.key(job.chunk)))) || resultBytes(result) + this.metrics.readyBytes > 8 * 1024 * 1024 || this.prepared.length >= 8) {
          this.metrics.rejected++; return
        }
        this.metrics.generated++
        this.metrics.generationMs = result.generatedInMs
        this.metrics.peakGenerationMs = Math.max(this.metrics.peakGenerationMs, result.generatedInMs)
        this.prepared.push(result)
        this.metrics.readyBytes += resultBytes(result)
        this.metrics.peakReadyBytes = Math.max(this.metrics.peakReadyBytes, this.metrics.readyBytes)
  }
  // A paused first view must already contain a usable slope, rather than a128m
  // radial fan whose12m ridge error only disappears after simulation resumes.
  private riverChunk(a:Address){return this.sampler.river.points.some(p=>p.x+64>=a.x*512&&p.x-64<=(a.x+1)*512&&p.z+64>=a.z*512&&p.z-64<=(a.z+1)*512)}
  private criticalPatch(tile:Resident,index:number){
    const p=this.projection.position;if(!p)return false
    const x=tile.result.chunk.x*512+index%4*128+64,z=tile.result.chunk.z*512+Math.floor(index/4)*128+64
    if(Math.hypot(x-p.x,z-p.z)>300)return false
    const q=this.sampler.river.query(x,z)
    const h=[this.sampler.terrainAt(x-64,z).height,this.sampler.terrainAt(x+64,z).height]
    return Boolean(q&&Math.abs(q.signedBankDistance)<32)||Math.min(...h)<2&&Math.max(...h)>-.7
  }
  get previewReady(){return this.ready&&[...this.resident.entries()].every(([key,tile])=>!this.patchKeys.has(key)||Array.from({length:16},(_,i)=>i).every(i=>!this.criticalPatch(tile,i)||(tile.patches.get(i)?.result.lod===0&&tile.patches.get(i)?.morph===1)))}
  private coverageLod(key:string):Lod { const item=this.wanted.get(key);if(item&&this.riverChunk(item.chunk))return 2; return !this.simplified&&this.patchKeys.has(key)?2:3 }
  private workerFailed(slot: Slot) {
    slot.worker.terminate(); this.slots = this.slots.filter(s => s !== slot)
    if (this.disposed) return
    if (this.failures++ === 0) this.createWorker()
    else this.enterFallback()
    this.wake()
  }
  private enterFallback() { this.simplified = true; this.radius = 2; this.lastPlan = ''; this.onFailure() }
  plan(x: number, z: number, heading: number, altitude = 0) {
    if (this.disposed) return
    if (this.review.freezeLod && this.lastPlan) return
    if(!this.projection.configured)this.projection.position={x,y:altitude,z}
    const center = chunkAt(x, z)
    if (this.simplified) {
      this.fixedCenter ??= center
      x = (this.fixedCenter.x + .5) * CHUNK_SIZE; z = (this.fixedCenter.z + .5) * CHUNK_SIZE
    }
    const signature = `${chunkAt(x, z).x},${chunkAt(x, z).z}:${Math.round(x / 100)},${Math.round(z / 100)}:${Math.round(heading * 4)}:${this.radius}:${Math.round(altitude / 80)}`
    if (signature === this.lastPlan) return
    const planStart=performance.now()
    this.lastPlan = signature
    this.wanted = chunkWindow(x, z, this.radius, heading, this.wanted, this.world, altitude)
    this.patchKeys = new Set([...this.wanted.entries()].filter(([,item])=>item.lod===0)
      .sort(([,a],[,b])=>Math.hypot((a.chunk.x+.5)*CHUNK_SIZE-x,(a.chunk.z+.5)*CHUNK_SIZE-z)-Math.hypot((b.chunk.x+.5)*CHUNK_SIZE-x,(b.chunk.z+.5)*CHUNK_SIZE-z))
      .slice(0,4).map(([key])=>key))
    const retireStart=performance.now()
    for (const [key, resident] of this.resident) if (!this.wanted.has(key)) {
      resident.mesh.removeFromParent(); this.retireGeometry(resident.mesh.geometry); resident.patches.forEach(p=>{p.mesh.removeFromParent();this.retireGeometry(p.mesh.geometry)}); if(this.patchBuild?.tile===resident)this.patchBuild=null; this.resident.delete(key); this.dirtyGround.delete(key)
    }
    this.metrics.planRetireMs=performance.now()-retireStart
    this.metrics.peakRetireMs=Math.max(this.metrics.peakRetireMs,this.metrics.planRetireMs)
    for(const [key,resident] of this.resident){
      resident.mesh.material=this.material
      if(!this.patchKeys.has(key)){resident.patchTargets.clear();if(resident.patches.size>0)resident.patchTarget=resident.result}
    }
    for(const [key,item] of this.wanted)if(!this.patchKeys.has(key)&&(item.lod<2||this.riverChunk(item.chunk)))item.lod=2
    this.prepared = this.prepared.filter(r => this.wanted.get(this.key(r.chunk))?.lod === r.lod || (r.lod===this.coverageLod(this.key(r.chunk))&&this.wanted.has(this.key(r.chunk))&&!this.resident.has(this.key(r.chunk))))
    this.metrics.readyBytes = this.prepared.reduce((sum, r) => sum + resultBytes(r), 0)+this.rawResults.reduce((sum,r)=>sum+r.bytes,0)
    this.metrics.planMs=performance.now()-planStart
    this.metrics.peakPlanMs=Math.max(this.metrics.peakPlanMs,this.metrics.planMs)
  }
  /** Explicit discontinuous review-camera jump only; never called by ordinary flight. */
  prepareStaticView(){
    const removed=new Set<string>()
    for(const key of this.patchKeys){
      const tile=this.resident.get(key)
      if(!tile||tile.result.lod<=this.coverageLod(key)&&tile.morph===1&&[...tile.patches.values()].every(p=>p.morph===1))continue
      tile.mesh.removeFromParent();this.retireGeometry(tile.mesh.geometry)
      for(const patch of tile.patches.values()){patch.mesh.removeFromParent();this.retireGeometry(patch.mesh.geometry)}
      if(this.patchBuild?.tile===tile)this.patchBuild=null
      this.resident.delete(key);removed.add(key);this.dirtyGround.add(key);this.surfaceRevision++
    }
    this.prepared=this.prepared.filter(result=>!removed.has(this.key(result.chunk)))
    this.rawResults=this.rawResults.filter(raw=>!removed.has(this.key(raw.job.chunk)))
    this.metrics.readyBytes=this.prepared.reduce((sum,result)=>sum+resultBytes(result),0)+this.rawResults.reduce((sum,result)=>sum+result.bytes,0)
    return removed.size
  }
  private job(item: WantedChunk,patchIndex?:number): TerrainJob {
    return { type: 'generate', sessionId: this.sessionId, requestId: ++this.serial, world: this.world,
      chunk: item.chunk, lod: item.lod, configHash: 'terrain-v3',...(patchIndex===undefined?{}:{patchIndex}) }
  }
  update(delta: number, dispatch: boolean, budget?:FrameWorkBudget) {
    this.inspectUniform.value.set(Number(this.review.normals),Number(this.review.patchGrid))
    this.material.wireframe=this.review.wireframe
    this.reviewUniform.value.set(Number(this.review.legacy), Number(this.review.detail), Number(this.review.bands), Number(this.review.gray))
    if (this.disposed || !dispatch) return
    const updateStart=performance.now()
    this.metrics.installMs=0;this.metrics.installBytes=0;this.metrics.fallbackGenerationMs=0;this.metrics.retireMs=0
    this.metrics.surfacePrepareMs=0;this.metrics.geometryPrepareMs=0;this.metrics.morphUploadBytes=0
    try {
    if(this.rawResults.length&&(!budget||budget.canStart(.15))){if(budget)budget.measure('terrain.validate',()=>this.acceptRawResult());else this.acceptRawResult()}
    if (this.review.freezeLod) delta = 0
    const morphStart=performance.now()
    let morphUploadBudgetBytes=0
    if(delta>0)for(const tile of this.resident.values()){
      if(tile.patches.size===0&&this.patchBuild?.tile!==tile&&tile.morph<1)morphUploadBudgetBytes+=tile.mesh.geometry.getAttribute('terrainBlend').array.byteLength
      for(const patch of tile.patches.values())if(patch.morph<1)morphUploadBudgetBytes+=patch.mesh.geometry.getAttribute('terrainBlend').array.byteLength
    }
    const morphStep=()=>{
    for (const resident of this.resident.values()) if (resident.patches.size===0 && this.patchBuild?.tile!==resident && resident.morph < 1 && delta > 0) {
      resident.morph = Math.min(1, resident.morph + delta / .8)
      const attribute = resident.mesh.geometry.getAttribute('terrainBlend')
      const weights = attribute.array as Float32Array
      for(let i=0;i<weights.length;i++)weights[i]=resident.result.lod<=1?patchBlend(resident.result.positions[i*3]!,resident.result.positions[i*3+2]!,resident.morph):resident.morph
      resident.vertexBlend=weights
      this.surfaceRevision++;this.dirtyGround.add(this.key(resident.result.chunk))
      attribute.needsUpdate = true
      this.metrics.morphUploadBytes+=weights.byteLength
    }
    let activePatches=0
    for(const resident of this.resident.values())for(const patch of resident.patches.values())if(patch.morph<1){
      activePatches++
      if(delta>0){patch.morph=Math.min(1,patch.morph+delta/.8);const attribute=patch.mesh.geometry.getAttribute('terrainBlend');(attribute.array as Float32Array).fill(patch.morph);attribute.needsUpdate=true;this.metrics.morphUploadBytes+=attribute.array.byteLength;this.surfaceRevision++;this.dirtyGround.add(this.key(resident.result.chunk))}
    }
    this.metrics.activeMorphArea=activePatches*128*128
    }
    if(budget)budget.measure('terrain.morph',morphStep,morphUploadBudgetBytes);else morphStep()
    this.metrics.morphMs=performance.now()-morphStart
    this.metrics.peakMorphMs=Math.max(this.metrics.peakMorphMs,this.metrics.morphMs)
    // Yield before a new atomic install when this frame's morph work has exhausted
    // the soft CPU budget. A single install may still exceed it; record that honestly.
    if(performance.now()-updateStart>=this.metrics.mainThreadBudgetMs){this.metrics.deferredInstalls++;return}
    const finished = [...this.resident.values()].find(r => r.patches.size===0 && r.replacement && r.morph === 1)
    if (finished?.replacement) { if(!budget||budget.canStart(.2)){if(budget)budget.measure('terrain.coarseCommit',()=>this.install(finished.replacement!,true),this.installUploadBytes(finished.replacement,true));else this.install(finished.replacement,true)} return }
    const ordered = [...this.wanted.entries()].sort((a, b) => a[1].priority - b[1].priority)
    // Basic coverage is prepared by the worker before refinement. Failure mode
    // yields after one128m generator step rather than doing a whole tile synchronously.
    const missing = ordered.find(([key]) => !this.resident.has(key))
    if(missing&&this.simplified){
      if(!this.fallbackTask||this.key(this.fallbackTask.job.chunk)!==missing[0]){const job={...this.job({...missing[1],lod:this.coverageLod(missing[0])}),errorSampling:false};this.fallbackTask={job,steps:generateTerrainSteps(job)}}
      if(!budget||budget.canStart(.15)){
        const start=performance.now(),step=()=>this.fallbackTask!.steps.next(),next=budget?budget.measure('terrain.fallbackStep',step):step()
        this.metrics.fallbackGenerationMs=performance.now()-start;this.metrics.peakFallbackGenerationMs=Math.max(this.metrics.peakFallbackGenerationMs,this.metrics.fallbackGenerationMs)
        if(next.done){this.metrics.fallbackGenerated++;if(budget)budget.measure('terrain.fallbackInstall',()=>this.install(next.value),this.installUploadBytes(next.value));else this.install(next.value);this.fallbackTask=null}
      }
    }
    const result=this.prepared[0]
    if(result&&(!budget||budget.canStart(.2,this.installUploadBytes(result),1))){
      this.prepared.shift();this.metrics.readyBytes-=resultBytes(result)
      if(this.wanted.has(this.key(result.chunk))&&(this.wanted.get(this.key(result.chunk))?.lod===result.lod||!this.resident.has(this.key(result.chunk)))){
        if(budget)budget.measure('terrain.install',()=>this.install(result),this.installUploadBytes(result),1);else this.install(result)
      }
    }
    if(this.retired.length&&(!budget||budget.canStart(.02))){const retire=()=>this.retired.shift()!.dispose();if(budget)budget.measure('terrain.retire',retire);else retire()}
    if(!missing)this.processPatchWork(budget)
    if (this.simplified) return
    const dispatchJobs=()=>{
    const pending = new Set([...this.slots.flatMap(s=>s.job?[`${this.key(s.job.chunk)}:${s.job.patchIndex??'tile'}`]:[]),...this.prepared.map(r=>`${this.key(r.chunk)}:${r.patchIndex??'tile'}`),...this.rawResults.map(r=>`${this.key(r.job.chunk)}:${r.job.patchIndex??'tile'}`)])
    const candidates:Array<{item:WantedChunk;patchIndex?:number}>=[]
    for(const [key,item] of ordered){
      const tile=this.resident.get(key)
      if(!tile){if(!pending.has(`${key}:tile`))candidates.push({item:{...item,lod:this.coverageLod(key)}});continue}
      if(this.patchKeys.has(key)){
        for(let index=0;index<16;index++)if((this.projectedPatchError(tile,index)>2||this.criticalPatch(tile,index))&&!tile.patchTargets.has(index)&&!pending.has(`${key}:${index}`))candidates.push({item:{...item,lod:0},patchIndex:index})
      }else if(tile.patches.size===0&&(tile.patchTarget?.lod??tile.replacement?.lod??tile.result.lod)!==item.lod&&!pending.has(`${key}:tile`))candidates.push({item})
    }
    candidates.sort((a,b)=>Number(this.resident.has(this.key(a.item.chunk)))-Number(this.resident.has(this.key(b.item.chunk)))||(a.patchIndex!==undefined&&b.patchIndex!==undefined?Number(this.criticalPatch(this.resident.get(this.key(b.item.chunk))!,b.patchIndex))-Number(this.criticalPatch(this.resident.get(this.key(a.item.chunk))!,a.patchIndex))||this.projectedPatchError(this.resident.get(this.key(b.item.chunk))!,b.patchIndex)-this.projectedPatchError(this.resident.get(this.key(a.item.chunk))!,a.patchIndex):0))
    candidates.length=Math.min(candidates.length,this.radius===4?24:48)
    this.metrics.peakQueue=Math.max(this.metrics.peakQueue,candidates.length)
    for(const slot of [...this.slots]){
      if(slot.job&&performance.now()-slot.started>8000){this.workerFailed(slot);continue}
      if(slot.job||this.prepared.length>=8||this.metrics.readyBytes>7*1024*1024)continue
      const next=candidates.shift();if(!next)break
      slot.job=this.job(next.item,next.patchIndex);slot.started=performance.now();slot.worker.postMessage(slot.job)
    }
    }
    if(budget)budget.measure('terrain.dispatch',dispatchJobs);else dispatchJobs()
    } finally {
      this.metrics.updateMs=performance.now()-updateStart
      this.metrics.peakUpdateMs=Math.max(this.metrics.peakUpdateMs,this.metrics.updateMs)
      if(this.metrics.updateMs>this.metrics.mainThreadBudgetMs)this.metrics.budgetOverruns++
    }
  }
  private geometryUploadBytes(result:TerrainResult,startNormals=result.normals,startColors=result.colors){
    return result.positions.byteLength+result.normals.byteLength+result.colors.byteLength+startNormals.byteLength+startColors.byteLength+2*result.coarseHeights.byteLength+result.indices.byteLength
  }
  private installUploadBytes(result:TerrainResult,settled=false){
    const previous=this.resident.get(this.key(result.chunk))
    if(previous&&(result.patchIndex!==undefined||this.patchKeys.has(this.key(result.chunk))||previous.patches.size>0))return 0
    return this.geometryUploadBytes(previous&&result.lod>previous.result.lod&&!settled?previous.result:result)
  }
  private install(result:TerrainResult,settled=false){
    const previous=this.resident.get(this.key(result.chunk))
    if(!previous&&result.patchIndex!==undefined){this.metrics.rejected++;return}
    if(previous&&result.patchIndex!==undefined){previous.patchTargets.set(result.patchIndex,result);return}
    if(previous&&(this.patchKeys.has(this.key(result.chunk))||previous.patches.size>0)){
      previous.patchTarget=this.patchKeys.has(this.key(result.chunk))?result:previous.result
      return
    }
    this.installFull(result,settled)
  }
  private installFull(result: TerrainResult, settled = false) {
    const start = performance.now(), key = this.key(result.chunk), previous = this.resident.get(key)
    let replacement: TerrainResult | undefined
    if (previous && result.lod > previous.result.lod && !settled) {
      // Keep the fine topology until it has morphed onto the coarse triangles.
      // Replacing it immediately would discard fine interior vertices on frame zero.
      replacement = result
      const fine = previous.result, positions = fine.positions.slice(), normals = fine.normals.slice(), colors = fine.colors.slice()
      const target = { result, morph: 1, startNormals: result.normals, startColors: result.colors }
      for (let i = 0; i < positions.length / 3; i++) {
        const sample = sampleDisplayed(target, positions[i * 3]!, positions[i * 3 + 2]!)
        positions[i * 3 + 1] = sample.height; normals.set(sample.normal, i * 3); colors.set(sample.color, i * 3)
      }
      result = { ...fine, positions, normals, colors, coarseHeights: fine.coarseHeights.slice() }
    }
    // Includes fine-topology coarsening preparation above as well as source sampling.
    const geometryStart = start
    const geometry = new BufferGeometry()
    geometry.setAttribute('position', new BufferAttribute(result.positions, 3))
    geometry.setAttribute('normal', new BufferAttribute(result.normals, 3))
    geometry.setAttribute('color', new BufferAttribute(result.colors, 3))
    attachSurfaceAttributes(geometry,this.sampler,result.chunk.x*CHUNK_SIZE,result.chunk.z*CHUNK_SIZE)
    const morph = new Float32Array(result.coarseHeights.length)
    const startNormals = result.normals.slice(), startColors = result.colors.slice()
    if (previous && !settled) {
      for (let i = 0; i < morph.length; i++) {
        const sample = sampleDisplayed(previous, result.positions[i * 3]!, result.positions[i * 3 + 2]!)
        result.coarseHeights[i] = sample.height
        startNormals.set(sample.normal, i * 3); startColors.set(sample.color, i * 3)
      }
    } else { result.coarseHeights.set(result.positions.filter((_, i) => i % 3 === 1)); morph.fill(1) }
    if(previous && !settled && result.lod<=1)for(let i=0;i<morph.length;i++)morph[i]=patchBlend(result.positions[i*3]!,result.positions[i*3+2]!,0)
    this.metrics.surfacePrepareMs = performance.now() - geometryStart
    const geometryUploadStart=performance.now()
    geometry.setAttribute('startNormal', new BufferAttribute(startNormals, 3))
    geometry.setAttribute('startColor', new BufferAttribute(startColors, 3))
    geometry.setAttribute('coarseHeight', new BufferAttribute(result.coarseHeights, 1))
    geometry.setAttribute('terrainBlend', new BufferAttribute(morph, 1))
    const patches = groupTerrainPatches(result)
    geometry.setIndex(new BufferAttribute(patches.indices.slice(), 1))
    for(const group of patches.groups)geometry.addGroup(group.start,group.count,0)
    geometry.boundingBox = new Box3(new Vector3(0, Math.min(result.bounds[1], ...result.coarseHeights), 0), new Vector3(CHUNK_SIZE, Math.max(result.bounds[4], ...result.coarseHeights), CHUNK_SIZE))
    geometry.boundingSphere = geometry.boundingBox.getBoundingSphere(new Sphere())
    const usePatches=false
    const mesh = new Mesh(geometry, usePatches?[this.material]:this.material), local = localChunkPosition(result.chunk, this.origin)
    mesh.position.set(local.x, 0, local.z); mesh.customDepthMaterial=this.depthMaterial; mesh.receiveShadow=true; this.root.add(mesh)
    this.resident.set(key, { mesh, result, morph: previous && !settled ? 0 : 1, startNormals, startColors, replacement, vertexBlend: morph, patches:new Map(),patchTargets:new Map() })
    this.surfaceRevision++;this.dirtyGround.add(key)
    this.metrics.geometryPrepareMs=performance.now()-geometryUploadStart
    this.metrics.installBytes=resultBytes(result)+startNormals.byteLength+startColors.byteLength+morph.byteLength
    const retireStart=performance.now()
    if (previous) { previous.mesh.removeFromParent(); this.retireGeometry(previous.mesh.geometry) }
    this.metrics.retireMs=performance.now()-retireStart
    this.metrics.peakRetireMs=Math.max(this.metrics.peakRetireMs,this.metrics.retireMs)
    this.metrics.peakResident = Math.max(this.metrics.peakResident, this.resident.size)
    this.metrics.installMs = performance.now() - start
    this.metrics.peakInstallMs = Math.max(this.metrics.peakInstallMs, this.metrics.installMs)
  }
  private retireGeometry(geometry:BufferGeometry){
    this.retired.push(geometry);this.metrics.peakRetired=Math.max(this.metrics.peakRetired,this.retired.length)
    // Teleport/quality stress may outpace deferred disposal; the hard memory cap
    // takes precedence and the exceptional synchronous release remains counted.
    if(this.retired.length>256){this.retired.shift()!.dispose();this.metrics.forcedRetirements++}
  }
  private projectedPatchError(tile:Resident,index:number){
    const camera=this.projection.position;if(!camera)return Infinity
    const x=tile.result.chunk.x*512+index%4*128,z=tile.result.chunk.z*512+Math.floor(index/4)*128
    const dx=Math.max(x-camera.x,0,camera.x-x-128),dz=Math.max(z-camera.z,0,camera.z-z-128),dy=Math.max(tile.result.bounds[1]-camera.y,0,camera.y-tile.result.bounds[4])
    const source=tile.patches.get(index)?.result??tile.result
    return source.patchErrors[index]!*this.projection.focalPixels/Math.max(1,Math.hypot(dx,dy,dz))
  }
  private patchResult(result:TerrainResult,index:number):TerrainResult{
    if(result.patchIndex===index)return result
    const count=result.verticesPerPatch,offset=index*count,triangleCount=result.indices.length/16
    const indices=result.indices.slice(index*triangleCount,(index+1)*triangleCount)
    for(let i=0;i<indices.length;i++)indices[i]!-=offset
    return {...result,patchIndex:index,positions:result.positions.slice(offset*3,(offset+count)*3),normals:result.normals.slice(offset*3,(offset+count)*3),colors:result.colors.slice(offset*3,(offset+count)*3),coarseHeights:result.coarseHeights.slice(offset,offset+count),indices}
  }
  private patchGeometry(surface:DisplayedSurface){
    const r=surface.result,g=new BufferGeometry(),blend=new Float32Array(r.coarseHeights.length);blend.fill(surface.morph)
    g.setAttribute('position',new BufferAttribute(r.positions,3));g.setAttribute('normal',new BufferAttribute(r.normals,3));g.setAttribute('color',new BufferAttribute(r.colors,3))
    attachSurfaceAttributes(g,this.sampler,r.chunk.x*CHUNK_SIZE,r.chunk.z*CHUNK_SIZE)
    g.setAttribute('startNormal',new BufferAttribute(surface.startNormals,3));g.setAttribute('startColor',new BufferAttribute(surface.startColors,3));g.setAttribute('coarseHeight',new BufferAttribute(r.coarseHeights,1));g.setAttribute('terrainBlend',new BufferAttribute(blend,1))
    g.setIndex(new BufferAttribute(r.indices,1));g.computeBoundingBox()
    if(g.boundingBox){for(const height of r.coarseHeights){g.boundingBox.min.y=Math.min(g.boundingBox.min.y,height);g.boundingBox.max.y=Math.max(g.boundingBox.max.y,height)}g.boundingSphere=g.boundingBox.getBoundingSphere(new Sphere())}
    return g
  }
  private maskBase(tile:Resident){
    const per=tile.result.indices.length/16,attribute=tile.mesh.geometry.index!,indices=attribute.array as Uint16Array;let cursor=0
    for(let i=0;i<16;i++)if(!tile.patches.has(i)){indices.set(tile.result.indices.subarray(i*per,(i+1)*per),cursor);cursor+=per}
    attribute.needsUpdate=true;tile.mesh.geometry.setDrawRange(0,cursor);tile.mesh.geometry.clearGroups();tile.mesh.visible=cursor>0
  }
  private processPatchWork(budget?:FrameWorkBudget){
    if(budget&&!budget.canStart(.15))return
    const perform=<T>(label:string,fn:()=>T,bytes=0)=>budget?budget.measure(label,fn,bytes,1):fn()
    let active=0
    for(const tile of this.resident.values())for(const patch of tile.patches.values())if(patch.morph<1)active++
    // Completed coarsening swaps only after the fine topology equals its parent exactly.
    for(const tile of this.resident.values())for(const patch of tile.patches.values())if(patch.morph===1&&patch.replacement){
      const result=patch.replacement
      perform('terrain.patchCommit',()=>{const surface={result,morph:1,startNormals:result.normals,startColors:result.colors};const old=patch.mesh.geometry;patch.mesh.geometry=this.patchGeometry(surface);patch.result=result;patch.startNormals=result.normals;patch.startColors=result.colors;delete patch.replacement;this.retireGeometry(old);this.surfaceRevision++},this.geometryUploadBytes(result));return
    }
    // Retired near tiles merge patch-by-patch into the unchanged coarse fallback.
    for(const [key,tile] of this.resident)if(!this.patchKeys.has(key))for(const [index,patch] of tile.patches)if(patch.morph===1&&patch.result.lod===tile.result.lod&&patch.result.requestId===tile.result.requestId){
      perform('terrain.patchRetire',()=>{patch.mesh.removeFromParent();this.retireGeometry(patch.mesh.geometry);tile.patches.delete(index);this.maskBase(tile);this.surfaceRevision++;this.dirtyGround.add(key)},tile.mesh.geometry.index?.array.byteLength??0);return
    }
    if(!this.patchBuild){
      if(active>=2)return
      for(const tile of [...this.resident.values()].sort((a,b)=>Number([...b.patchTargets.keys()].some(i=>this.criticalPatch(b,i)))-Number([...a.patchTargets.keys()].some(i=>this.criticalPatch(a,i))))){
        for(const index of Array.from({length:16},(_,i)=>i).sort((a,b)=>Number(this.criticalPatch(tile,b))-Number(this.criticalPatch(tile,a)))){
          const target=this.patchKeys.has(this.key(tile.result.chunk))?tile.patchTargets.get(index):tile.patchTarget
          if(!target)continue
          const old=tile.patches.get(index)
          if(old&&(old.morph<1||old.result.requestId===target.requestId))continue
          if(!old&&!this.patchKeys.has(this.key(tile.result.chunk)))continue
          if(!old&&tile.patches.size===0&&[...this.resident.values()].filter(r=>r.patches.size>0).length>=5)continue
          perform('terrain.patchBegin',()=>{
            const prior=old??tile,source={result:prior.result,morph:Math.fround(prior.morph),startNormals:prior.startNormals,startColors:prior.startColors}
            const destination=this.patchResult(target,index),coarsening=destination.lod>source.result.lod
            const result=coarsening?{...this.patchResult(source.result,index),requestId:target.requestId,positions:this.patchResult(source.result,index).positions.slice(),normals:this.patchResult(source.result,index).normals.slice(),colors:this.patchResult(source.result,index).colors.slice(),coarseHeights:this.patchResult(source.result,index).coarseHeights.slice()}:destination
            this.patchBuild={tile,index,target,source,result,cursor:0,startNormals:new Float32Array(result.normals.length),startColors:new Float32Array(result.colors.length),...(coarsening?{replacement:destination}:{})}
          });break
        }
        if(this.patchBuild)break
      }
    }
    const task=this.patchBuild;if(!task)return
    if((this.patchKeys.has(this.key(task.tile.result.chunk))?task.tile.patchTargets.get(task.index):task.tile.patchTarget)!==task.target){this.patchBuild=null;return}
    const start=performance.now()
    perform('terrain.patchPrepare',()=>{
      const end=Math.min(task.result.coarseHeights.length,task.cursor+128)
      const destination=task.replacement?{result:task.replacement,morph:1,startNormals:task.replacement.normals,startColors:task.replacement.colors}:null
      for(;task.cursor<end;task.cursor++){
        const i=task.cursor,x=task.result.positions[i*3]!,z=task.result.positions[i*3+2]!,source=sampleDisplayed(task.source,x,z)
        task.result.coarseHeights[i]=source.height;task.startNormals.set(source.normal,i*3);task.startColors.set(source.color,i*3)
        if(destination){const target=sampleDisplayed(destination,x,z);task.result.positions[i*3+1]=target.height;task.result.normals.set(target.normal,i*3);task.result.colors.set(target.color,i*3)}
      }
    })
    this.metrics.patchPrepareMs=performance.now()-start
    const uploadBytes=this.geometryUploadBytes(task.result,task.startNormals,task.startColors)+(task.tile.mesh.geometry.index?.array.byteLength??0)
    if(task.cursor<task.result.coarseHeights.length||budget&&!budget.canStart(.2,uploadBytes,1))return
    perform('terrain.patchInstall',()=>{
      const surface={result:task.result,morph:0,startNormals:task.startNormals,startColors:task.startColors},mesh=new Mesh(this.patchGeometry(surface),this.material)
      mesh.userData.flightPatch={index:task.index,lod:task.result.lod,topologyLayoutId:task.result.topologyLayoutId,geometricError:task.target.patchErrors[task.index]};mesh.position.copy(task.tile.mesh.position);mesh.customDepthMaterial=this.depthMaterial;mesh.receiveShadow=true;this.root.add(mesh)
      const previous=task.tile.patches.get(task.index);task.tile.patches.set(task.index,{...surface,mesh,...(task.replacement?{replacement:task.replacement}:{})})
      previous?.mesh.removeFromParent();if(previous)this.retireGeometry(previous.mesh.geometry);this.maskBase(task.tile)
      this.patchBuild=null;this.metrics.patchInstalls++;this.surfaceRevision++;this.dirtyGround.add(this.key(task.tile.result.chunk))
    },uploadBytes)
  }
  forEachRenderable(callback:(mesh:Mesh<BufferGeometry,MeshStandardMaterial|MeshStandardMaterial[]>)=>void){
    for(const tile of this.resident.values()){if(tile.mesh.visible)callback(tile.mesh);for(const patch of tile.patches.values())callback(patch.mesh)}
  }
  captureDisplayedSurface(rect:{minX:number;minZ:number;maxX:number;maxZ:number}){
    const frozen=new Map<string,{base:DisplayedSurface;patches:Map<number,DisplayedSurface>}>(),revision=this.surfaceRevision
    const copy=(s:DisplayedSurface):DisplayedSurface=>({result:s.result,morph:Math.fround(s.morph),startNormals:s.startNormals,startColors:s.startColors})
    for(const [key,tile] of this.resident){const x=tile.result.chunk.x*512,z=tile.result.chunk.z*512;if(x>rect.maxX||x+512<rect.minX||z>rect.maxZ||z+512<rect.minZ)continue;frozen.set(key,{base:copy(tile),patches:new Map([...tile.patches].map(([index,p])=>[index,copy(p)]))})}
    const worldKey=JSON.stringify(this.world),sampler=this.sampler,key=(a:Address)=>chunkKey(a,this.world)
    this.metrics.snapshotCount++
    return {worldKey,epoch:revision,topologyLayoutId:'nested-bisection-128-v2',coverageRect:{...rect},worldOrigin:{...this.origin},
      sampleHeight(x:number,z:number){const address=chunkAt(x,z),tile=frozen.get(key(address));if(!tile)return farSurfaceHeight(sampler,x,z);const lx=x-address.x*512,lz=z-address.z*512,index=Math.min(3,Math.floor(lz/128))*4+Math.min(3,Math.floor(lx/128));return sampleDisplayedHeight(tile.patches.get(index)??tile.base,lx,lz)},
      contentKey(area:{minX:number;minZ:number;maxX:number;maxZ:number}){let result=worldKey;for(const [tileKey,tile] of frozen)for(let index=0;index<16;index++){const x=tile.base.result.chunk.x*512+index%4*128,z=tile.base.result.chunk.z*512+Math.floor(index/4)*128;if(x>=area.maxX||x+128<=area.minX||z>=area.maxZ||z+128<=area.minZ)continue;const s=tile.patches.get(index)??tile.base;result+=`|${tileKey}/${index}:${s.result.requestId}:${s.result.lod}:${s.morph}`;}return result},
      release(){frozen.clear()}}
  }

  relocate(origin: Address) {
    this.origin = { ...origin }
    this.surfaceOrigin.value.set(origin.x, origin.z)
    for (const resident of this.resident.values()) {
      const local = localChunkPosition(resident.result.chunk, origin)
      resident.mesh.position.set(local.x, 0, local.z)
      resident.patches.forEach(p=>p.mesh.position.set(local.x,0,local.z))
    }
  }
  displayedHeight(x: number, z: number) {
    const address = chunkAt(x, z), resident = this.resident.get(this.key(address))
    if(!resident)return farSurfaceHeight(this.sampler,x,z)
    const lx=x-address.x*512,lz=z-address.z*512,index=Math.min(3,Math.floor(lz/128))*4+Math.min(3,Math.floor(lx/128))
    return sampleDisplayedHeight(resident.patches.get(index)??resident,lx,lz)
  }
  surfaceIdentity(x:number,z:number){
    const a=chunkAt(x,z),tile=this.resident.get(this.key(a));if(!tile)return `${this.key(a)}:far64`
    const index=Math.min(3,Math.floor((z-a.z*512)/128))*4+Math.min(3,Math.floor((x-a.x*512)/128)),s=tile.patches.get(index)??tile
    return `${this.key(a)}:${index}:${s.result.requestId}:${s.result.lod}:${s.morph}`
  }
  /** Returns and clears tile keys whose actual displayed surface changed. */
  consumeGroundDirty() { const keys=[...this.dirtyGround];this.dirtyGround.clear();return keys }
  get ready() { return this.resident.size >= this.wanted.size && this.wanted.size > 0 }
  get busy() { return !this.ready || this.prepared.length > 0 || this.rawResults.length>0 || this.slots.some(s => s.job !== null) }
  safeToEnter(x: number, z: number) {
    return [-100, 0, 100].every(dx => [-100, 0, 100].every(dz => this.resident.has(this.key(chunkAt(x + dx, z + dz)))))
  }
  diagnostics() {
    const buffers=new Set<ArrayBufferLike>(),add=(array:ArrayBufferView)=>buffers.add(array.buffer)
    const results=new Set<TerrainResult>(),geometries=new Set<BufferGeometry>()
    let independentPatches=0,draws=0
    for(const tile of this.resident.values()){
      results.add(tile.result);if(tile.replacement)results.add(tile.replacement);if(tile.patchTarget)results.add(tile.patchTarget)
      tile.patchTargets.forEach(r=>results.add(r));geometries.add(tile.mesh.geometry);draws+=Number(tile.mesh.visible)
      for(const patch of tile.patches.values()){independentPatches++;draws++;results.add(patch.result);if(patch.replacement)results.add(patch.replacement);geometries.add(patch.mesh.geometry)}
    }
    for(const result of this.prepared)results.add(result)
    if(this.patchBuild){results.add(this.patchBuild.result);add(this.patchBuild.startNormals);add(this.patchBuild.startColors)}
    for(const result of results)for(const array of [result.positions,result.normals,result.colors,result.indices,result.coarseHeights,result.boundaryHeights,result.patchErrors,result.topologyNodes])add(array)
    let gpuGeometryBytes=0
    for(const geometry of [...geometries,...this.retired]){for(const attribute of Object.values(geometry.attributes)){add(attribute.array);gpuGeometryBytes+=attribute.array.byteLength}if(geometry.index){add(geometry.index.array);gpuGeometryBytes+=geometry.index.array.byteLength}}
    return {...this.metrics,resident:this.resident.size,prepared:this.prepared.length,rawPending:this.rawResults.length,pending:this.slots.filter(s=>s.job).length,sessionId:this.sessionId,simplified:this.simplified,
      renderPatches:draws,independentPatches,pendingPatchBuild:Number(this.patchBuild!==null),retiredGeometries:this.retired.length,
      surfaceRevision:this.surfaceRevision,projectionConfigured:this.projection.configured,topologyLayouts:this.topologyTables.size,
      gpuGeometryBytes,geometryBytes:[...buffers].reduce((sum,buffer)=>sum+buffer.byteLength,0)}
  }
  dispose() {
    if (this.disposed) return
    this.disposed = true; this.slots.forEach(s => s.worker.terminate()); this.slots = []
    this.prepared = [];this.rawResults=[]; this.wanted.clear(); this.patchKeys.clear(); this.dirtyGround.clear(); this.metrics.readyBytes = 0
    this.patchBuild=null; this.fallbackTask=null;this.topologyTables.clear(); this.retired.forEach(g=>g.dispose());this.retired=[]; this.resident.forEach(r => {r.mesh.geometry.dispose();r.patches.forEach(p=>p.mesh.geometry.dispose())}); this.resident.clear()
    this.root.clear(); this.root.removeFromParent(); this.material.dispose(); this.depthMaterial.dispose()
  }
}
