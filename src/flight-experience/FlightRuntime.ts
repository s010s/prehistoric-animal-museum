import { CompanionDirector } from './living/companion-director'
import { Soundscape } from './living/soundscape'
import { PhotoService } from './living/photo-service'
import { DEFAULT_LIVING_INTENT, LivingScope, livingContext, type LivingContext, type LivingIntent } from './living/living-context'
import { WeatherController, type WeatherPreset, type WeatherMode } from './environment/weather-controller'
import { ObservationSession, type ObservationPhase } from './viewpoints/observation-session'
import { VIEWPOINTS, viewpointTarget, type Viewpoint } from './viewpoints/viewpoint-catalog'
import { EnvironmentClock, clockPolicy, admittedEnvironmentDelta, type DaylightSnapshot, type SolarMode } from './environment/environment-clock'
import {loadLookdevMaterials} from './lookdev/material-library'
import {decorateMaterialTerrain} from './lookdev/material-terrain'
import { FlightAnimationController } from './flight-animation'
import { animationWeights } from './flight-animation-default'
import poweredFlapData from './assets/pteranodon-powered-flap.json'
import { VisibleSurfaceSnapshot } from './visible-surface'
import { HorizonTerrain } from './horizon-terrain'
import { FarTerrain } from './far-terrain'
import { VISIBILITY_PROFILES } from './visibility-profile'
import type { LookdevScene } from './lookdev/LookdevScene'
import { FrameWorkBudget } from './frame-work-budget'
import { FrameTrace } from './frame-trace'
import { decorateAnimalRim } from './environment/animal-rim'
import { decorateShadowFade } from './environment/shadow-fade'
import { coastValleyLandmarks, createLandscapeSurface, scenicRouteAnchors } from './world-presets/coast-valley'
import { DEFAULT_FLIGHT_SETTINGS, framingDistance, spawnState, type FlightSettings } from './settings'
import { Vector2, NormalAnimationBlendMode, AnimationClip, type AnimationAction, Box3, Mesh, type Material, type BufferGeometry, Fog, Group, PerspectiveCamera, Scene, Vector3 } from 'three'
import type { StagedViewerModel, ViewerController, ViewerModelDescriptor } from 'virtual:viewer-controller'
import type { ExperienceLease, ExternalExperience } from '../viewer/external-experience'
import { FlightInputState } from './input'
import { FlightSimulation, type RenderState } from './simulation'
import { cameraPathSafe, followOffset } from './camera'
import { CHUNK_SIZE, WORLD, createWorldSampler, type WorldConfig, type WorldSampler, type Address } from './world'
import { solarProgress, type SolarPreset } from './environment/environment-state'
import { REVIEW_ROUTES, type CaptureAnchor } from './review-anchors'
import { FlightScenery } from './scenery'
import { TerrainStream } from './terrain-stream'
import glideData from './assets/pteranodon-glide.json'
export type FlightPhase = 'preparing' | 'buffering' | 'ready' | 'flying' | 'paused' | 'recovering' | 'closed'
export type PauseReason = 'user' | 'hidden' | 'settings' | 'terrain' | 'safety' | 'camera' | 'context' | 'error'
export interface FlightSnapshot {
  companions?: CompanionDirector['metrics']
  living?: LivingIntent
  sound?: ReturnType<Soundscape['getSnapshot']>
  photos?: ReturnType<PhotoService['getSnapshot']>
  weather?: ReturnType<WeatherController['snapshot']>
  daylight?: DaylightSnapshot
  observation?: ObservationPhase; viewpoint?: Viewpoint['id']; sceneryPaused?: boolean; solarDayProgress?: number
  phase: FlightPhase; reason: PauseReason | null; simplified: boolean
  region: ReturnType<WorldSampler['regionAt']>; gentle: boolean; assisted: boolean; quality: 'low' | 'balanced'; settings: FlightSettings
}
export class FlightRuntime implements ExternalExperience {
  private companions: CompanionDirector | null = null
  readonly soundscape: Soundscape
  private readonly livingCpu:number[]=[]
  private observationCard = false
  private narrationActive = false
  setNarrationActive(active:boolean){this.narrationActive=active;this.soundscape.setMuted(active||this.observationCard)}
  setObservationCard(open:boolean) {
    this.observationCard=open
    if(open){this.pause('user');this.observation.suspend();this.soundscape.setMuted(true)}
    else this.soundscape.setMuted(this.narrationActive)
    this.publishObservation();this.invalidate()
  }
  setLivingIntent(key:keyof LivingIntent,enabled:boolean){this.livingIntent[key]=enabled;this.publish({});this.invalidate()}
  async enableSound(){const pending=this.soundscape.enable();this.publish({});await pending;this.publish({})}
  disableSound(){this.soundscape.disable();this.publish({})}
  setSoundVolume(value:number){this.soundscape.setVolume(value);this.publish({})}
  readonly photos = new PhotoService(() => this.publish({}))
  requestPhoto() {
    if(!this.available || !this.modelAttached || this.preparationPending || this.observationPreparing || !this.terrain.previewReady)return false
    const requested=this.photos.request();if(requested)this.invalidate();return requested
  }
  completedFrame(canvas:HTMLCanvasElement) {
    if(!this.available || !this.modelAttached || this.preparationPending || this.observationPreparing || !this.terrain.previewReady){if(this.photos.getSnapshot().status==='waiting')this.photos.cancel();return}
    this.photos.completedFrame(canvas,{frame:this.frameId,sun:this.environmentClock.solarDayProgress,weather:this.weather.serialize().resolved.rain>0?'light-rain':this.weather.serialize().resolved.coverage>.65?'overcast':this.weather.serialize().resolved.coverage>.1?'fair':'clear'})
  }
  readonly livingScope = new LivingScope()
  readonly livingIntent: LivingIntent = { ...DEFAULT_LIVING_INTENT }
  livingFrame: LivingContext | null = null
  frameId = 0
  readonly workBudget = new FrameWorkBudget()
  readonly trace = new FrameTrace()
  private frameCpu: Record<string,number> = {}
  readonly scene = new Scene()
  readonly camera = new PerspectiveCamera(55, 1, .5, 6000)
  readonly input = new FlightInputState()
  readonly simulation: FlightSimulation
  readonly world: WorldSampler
  private readonly safeSurface: (x:number,z:number)=>number
  get shadowsEnabled(){return this.scenery.review.shadows}
  lookdev: LookdevScene | null = null
  lookdevActive = false
  reviewHideFarTerrain = false
  reviewHideWater = false
  readonly reviewIsolation={freezeCamera:false,freezeWorld:false,animateWater:false,hideRiver:false}
  reviewAnimation:'auto'|'source'|'powered'|'glide'='auto'
  setReviewAnimation(mode:typeof this.reviewAnimation){this.reviewAnimation=mode;this.refreshReview()}
  readonly environmentClock = new EnvironmentClock()
  readonly observation = new ObservationSession<{ camera: Vector3; quaternion: number[]; visible: boolean }>()
  private modelAttached = false
  readonly weather = new WeatherController()
  readonly weatherFreeze = {clouds:false,weather:false,sun:false}
  private solarDirty = false
  setWeatherReviewEnabled(enabled:boolean){if(!import.meta.env.DEV)return;this.scenery.environment.weatherEnabled=enabled;this.refreshReview()}
  setWeather(target:WeatherPreset){if(!this.available)return;this.weather.setTarget(target);this.publishObservation();this.invalidate()}
  setWeatherMode(mode:WeatherMode){if(!this.available)return;this.weather.setMode(mode);this.publishObservation();this.invalidate()}
  private get observationPreparing() { return this.observation.phase === 'preparing' || this.observation.phase === 'returning' }
  private get observationActive() { return this.observation.phase === 'active' }
  private publishObservation() { this.publish({observation:this.observation.phase,sceneryPaused:this.observation.sceneryPaused,...(this.observation.target?{viewpoint:this.observation.target.id}:{}),solarDayProgress:this.environmentClock.solarDayProgress}) }
  private daylightPublishSeconds = 0
  private environmentPolicy(snapshot = this.snapshot) {
    const activity = this.disposed ? 'closed' : this.fatalError ? 'error' : !this.contextAvailable ? 'context-lost'
      : !this.visible || !this.focused ? 'hidden' : this.observationCard ? 'paused' : this.observationPreparing ? 'viewpoint-preparing'
      : snapshot.phase === 'preparing' || snapshot.phase === 'buffering' ? 'viewpoint-preparing'
      : this.observationActive ? 'viewpoint' : snapshot.phase === 'flying' ? 'flying'
      : this.reviewMotionActive ? 'viewpoint' : 'paused'
    return clockPolicy(activity, (this.observation.phase !== 'inactive' && this.observation.sceneryPaused))
  }
  setSolarMode(mode: SolarMode) {
    if (this.disposed || this.fatalError || !this.contextAvailable) return
    this.environmentClock.setSolarMode(mode)
    this.solarDirty = true; this.publishObservation(); this.invalidate()
  }
  restartDaylightFromMorning() {
    if (this.disposed || this.fatalError || !this.contextAvailable) return
    this.environmentClock.restartDaylightFromMorning()
    this.solarDirty = true; this.publishObservation(); this.invalidate()
  }
  setSolarDayProgress(progress: number) {
    if (!Number.isFinite(progress) || this.disposed || this.fatalError || !this.contextAvailable) return
    this.environmentClock.setSolarDayProgress(progress)
    this.scenery.environment.solarLayout = 'sunset-bay'; this.solarDirty = true
    this.publishObservation(); this.invalidate()
  }
  enterViewpoint(id: Viewpoint['id']) {
    const target=VIEWPOINTS.find(v=>v.id===id)
    if (!target || !this.modelAttached || !this.available) return
    this.preparationPending=false
    this.pause('user'); this.publish({phase:'paused',reason:'user'}); this.reviewCaptureCamera=undefined
    this.scenery.environment.solarLayout='sunset-bay';this.solarDirty=true
    this.observation.request(target,{camera:this.camera.position.clone().add(new Vector3(this.origin.x,0,this.origin.z)),quaternion:this.camera.quaternion.toArray(),visible:this.root.visible},performance.now())
    this.root.visible=false; this.input.clear();this.simulation.clearAccumulator()
    this.terrain.plan(target.position.x,target.position.z,target.heading,target.position.y);this.terrain.prepareStaticView()
    this.publishObservation();this.invalidate()
  }
  get canReturnToTravel() { return !this.disposed && this.contextAvailable && this.visible && this.focused && this.observation.bookmark !== null }
  returnFromViewpoint() {
    if (this.observation.phase === 'inactive' || !this.canReturnToTravel) return
    // Only this explicit return command may retry a failed observation.
    if (this.fatalError) { this.fatalError = false; this.observation.suspend(); this.syncAvailability() }
    this.publish({phase:'paused',reason:'user'});this.observation.returnToTravel(performance.now());this.input.clear();this.simulation.clearAccumulator()
    const p=this.simulation.position;this.terrain.plan(p.x,p.z,this.simulation.heading,p.y);this.terrain.prepareStaticView()
    this.publishObservation();this.invalidate()
  }
  toggleScenery() { if(!this.observationActive||!this.available||this.observationCard)return;this.publish({reason:'user'});this.observation.sceneryPaused=!this.observation.sceneryPaused;this.publishObservation();this.invalidate() }
  private reviewWaterTime=0
  reviewPropLod:0|1|2|undefined
  reviewOverlayUpdate:(()=>void)|undefined
  get reviewOrigin(){return this.origin}
  private reviewCaptureCamera: CaptureAnchor['camera']
  private reviewPitch = 0
  private lastReviewRouteId = 'manual'
  private reviewRoute: { id:string; startTime:number; waiting:boolean; turnAt:number; turn:number } | null = null
  private renderMetrics = { cpuMs:0,calls:0,triangles:0,geometries:0,textures:0 }
  private readonly cpuTimes: number[] = []
  private readonly gpuTimes: number[] = []
  readonly root = new Group()
  readonly pose = new Group()
  readonly surface: VisibleSurfaceSnapshot
  readonly terrain: TerrainStream
  readonly scenery: FlightScenery
  readonly horizonTerrain: HorizonTerrain
  readonly farTerrain: FarTerrain
  private readonly abort = new AbortController()
  private lease: ExperienceLease | null = null
  private model: StagedViewerModel | null = null
  private glideAction: AnimationAction | null = null
  private readonly flightAnimation=new FlightAnimationController()
  private poweredAction:AnimationAction|null=null
  private groundLibrary:Awaited<ReturnType<typeof loadLookdevMaterials>>|null=null
  private readonly groundOrigin={value:new Vector2()}
  readonly surfaceReview={value:new Vector2(0,0)}
  setSurfaceReview(mode:number,layer=0){if(!import.meta.env.DEV)return;this.surfaceReview.value.set(mode,layer);this.invalidate()}
  private disposed = false
  private origin: Address = { x: 0, z: 0 }
  private cameraInitialized = false
  private reviewDistanceBaseline = false
  private contextAvailable = true
  private visible = true
  private focused = true
  // Resource preparation survives presentation suspension; it never grants travel.
  private preparationPending = false
  private fatalError = false
  private get available() { return !this.disposed && !this.fatalError && this.contextAvailable && this.visible && this.focused }
  private invalidate() { if (this.available) this.lease?.invalidate() }
  private syncAvailability() {
    if(!this.available){this.photos.cancel();this.soundscape?.update({camera:{x:0,y:0,z:0},rain:0,wind:0,active:false,delta:0})}
    this.observation.setPreparationAvailable(this.available, performance.now())
    this.publishObservation()
    if (this.available) this.invalidate()
  }
  setVisibilityState(visible: boolean) {
    if (this.disposed) return
    this.visible = visible
    if (!visible) this.pause('hidden')
    this.syncAvailability()
  }
  setFocusState(focused: boolean) {
    if (this.disposed) return
    this.focused = focused
    if (!focused) { const visible = this.visible; this.pause('hidden'); this.visible = visible }
    this.syncAvailability()
  }
  private snapshot: FlightSnapshot = { phase: 'preparing', reason: null, simplified: false, region: 'coast', gentle: false, assisted: false, quality: 'low', settings: { ...DEFAULT_FLIGHT_SETTINGS } }
  private readonly listeners = new Set<() => void>()
  private readonly frameTimes: number[] = []
  private slowSeconds = 0
  private framebufferHeight = 720
  setFramebufferHeight(height:number){this.framebufferHeight=height}
  private reportingSeconds = 0
  private originShifts = 0
  private cameraOffset = new Vector3(0, 5, 17)
  private animationTime = 0
  private readonly followPosition = new Vector3()
  private readonly lookPosition = new Vector3()
  constructor(private readonly controller: ViewerController, gentle: boolean, settings: FlightSettings = DEFAULT_FLIGHT_SETTINGS, worldConfig: WorldConfig = WORLD) {
    if(import.meta.env.DEV){
      const params=new URLSearchParams(location.search),a0=params.get('flightA0')
      this.reviewDistanceBaseline=params.get('flightDistanceReview')==='baseline'
      if(a0==='layered'||a0==='standalone')this.surfaceReview.value.set(a0==='layered'?2:10,5)
      else if(params.get('flightSurfaceReview')==='semantic')this.surfaceReview.value.x=1
    }
    this.world = createWorldSampler(worldConfig)
    this.soundscape = new Soundscape(this.world)
    const landmarks=coastValleyLandmarks(this.world)
    const landscapeSurface=createLandscapeSurface(this.world,landmarks,(x,z)=>this.terrain?this.terrain.displayedHeight(x,z):this.world.meshHeight(x,z,8))
    this.safeSurface=(x,z)=>Math.max(landscapeSurface(x,z),this.terrain?this.terrain.displayedHeight(x,z)+16:-Infinity)
    this.simulation = new FlightSimulation(this.safeSurface, scenicRouteAnchors(this.world))
    this.snapshot.settings = { ...settings }
    const spawn = spawnState(settings, this.world); Object.assign(this.simulation.position, spawn.position); this.simulation.heading = spawn.heading
    this.simulation.cruiseSpeed = settings.speed; this.simulation.speed = settings.speed; this.simulation.clearAccumulator()
    this.snapshot.gentle = gentle || settings.gentle; this.simulation.gentle = this.snapshot.gentle
    this.scene.fog = new Fog('#b8d0d3', 750, 1650)
    this.root.add(this.pose); this.scene.add(this.root)
    this.scenery = new FlightScenery(this.scene, () => this.invalidate(), (x, z) => this.scenerySurface(x, z), this.world, (x,z)=>this.scenerySurface(x,z))
    this.environmentClock.setSolarDayProgress(solarProgress(this.scenery.preset))
    this.snapshot.solarDayProgress=this.environmentClock.solarDayProgress
    this.snapshot.daylight=this.environmentClock.snapshot(clockPolicy('viewpoint-preparing'))
    this.scenery.props.setLandmarks(landmarks)
    this.terrain = new TerrainStream(() => this.invalidate(), () => this.publish({ simplified: true }), worldConfig)
    this.surface=new VisibleSurfaceSnapshot(this.terrain,this.world)
    this.scenery.farCanopy.clustered=!this.reviewDistanceBaseline
    this.scenery.environment.fog.decorate(this.terrain.material,true)
    this.scene.add(this.terrain.root)
    this.farTerrain=new FarTerrain(this.world,material=>this.scenery.environment.fog.decorate(material,true));this.scene.add(this.farTerrain.root)
    this.horizonTerrain=new HorizonTerrain(this.world,material=>this.scenery.environment.fog.decorate(material,true));this.scene.add(this.horizonTerrain.root)
    this.setQuality(settings.quality, false)
  }
  private scenerySurface(x:number,z:number){
    return this.surface.height(x,z)
  }
  async prepare(descriptor: ViewerModelDescriptor) {
    const timeout = window.setTimeout(() => { this.abort.abort(); this.fail(new Error('flight-model-timeout')) }, 20000)
    try {
      this.lease = this.controller.acquireExternalExperience(this)
      this.terrain.plan(this.simulation.position.x, this.simulation.position.z, this.simulation.heading, this.simulation.position.y)
      const model = await this.controller.stageModel(descriptor, this.abort.signal)
      if (this.disposed || this.fatalError || this.abort.signal.aborted) { this.controller.disposeStagedModel(model); return }
      this.model = model
      const ground=await loadLookdevMaterials()
      if(this.disposed||this.fatalError||this.abort.signal.aborted){ground.dispose();return}
      this.groundLibrary=ground
      for(const material of [this.terrain.material,this.farTerrain.material])decorateMaterialTerrain(material,ground.materials,{method:'histogram',channel:'pbr',scale:1,layers:4},this.groundOrigin,import.meta.env.DEV?this.surfaceReview:undefined)
      if (model.mixer && model.action) {
        this.glideAction = model.mixer.clipAction(AnimationClip.parse({ ...glideData, blendMode: NormalAnimationBlendMode }))
        this.glideAction.setEffectiveWeight(0).play()
        this.poweredAction=model.mixer.clipAction(AnimationClip.parse({...poweredFlapData,blendMode:NormalAnimationBlendMode}))
        this.poweredAction.setEffectiveWeight(0).play();model.action.setEffectiveWeight(1).play()
      }
      model.modelRoot.rotation.set(0, 0, 0); model.modelRoot.updateMatrixWorld(true)
      const bounds = new Box3().setFromObject(model.modelRoot, true), size = bounds.getSize(new Vector3())
      const correction = new Group(); correction.scale.setScalar(7 / Math.max(size.x, size.z))
      correction.rotation.y = Math.PI
      model.modelRoot.position.sub(bounds.getCenter(new Vector3()))
      correction.add(model.group); this.pose.add(correction)
      model.group.traverse(object => { if (object instanceof Mesh) { object.castShadow = true; object.receiveShadow = true;const mesh=object as Mesh<BufferGeometry,Material|Material[]>; for(const material of Array.isArray(mesh.material)?mesh.material:[mesh.material]){ decorateShadowFade(material); this.scenery.environment.fog.decorate(material); decorateAnimalRim(material,this.scenery.environment.fog.uniforms) } } })
      if(model.action)this.companions=new CompanionDirector(this.scene,this.world,model.modelRoot,model.action.getClip(),(x,z)=>this.terrain.safeToEnter(x,z)?this.safeSurface(x,z):Infinity)
      this.modelAttached=true
      this.invalidate()
    } catch (error) { if (!this.disposed) this.fail(error) } finally { window.clearTimeout(timeout) }
  }
  get pixelRatio() { return this.snapshot.quality === 'low' ? 1 : 1.5 }
  private get reviewMotionActive() { return import.meta.env.DEV && this.reviewIsolation.animateWater && this.contextAvailable && ['ready', 'paused'].includes(this.snapshot.phase) && (this.snapshot.reason === null || this.snapshot.reason === 'user') }
  get running() { return this.available && (this.preparationPending || this.snapshot.phase === 'flying' || (this.contextAvailable && (this.observationPreparing || (this.observationActive && !this.observation.sceneryPaused))) || this.reviewMotionActive || this.snapshot.phase === 'preparing' || this.snapshot.phase === 'buffering' || (['ready','paused'].includes(this.snapshot.phase) && this.contextAvailable && (this.scenery.busy || this.farTerrain.metrics.pending>0 || (this.horizonTerrain.metrics.pending>0&&!this.reviewDistanceBaseline) || Boolean(this.lookdev?.busy)))) }
  getSnapshot = () => this.snapshot
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => this.listeners.delete(listener) }
  private publish(patch: Partial<FlightSnapshot>) {
    if (this.disposed) return
    if (patch.phase === 'buffering') this.preparationPending = true
    const next = { ...this.snapshot, ...patch }
    if(this.companions)next.companions = this.companions.metrics
    next.living = {...this.livingIntent}
    next.sound = this.soundscape?.getSnapshot()
    next.photos = this.photos.getSnapshot()
    next.weather = this.weather.snapshot(this.environmentPolicy(next).advanceEnvironmentMotion)
    next.daylight = this.environmentClock.snapshot(this.environmentPolicy(next))
    if (JSON.stringify(next) === JSON.stringify(this.snapshot)) return
    this.snapshot = next; this.listeners.forEach(l => l())
  }
  get canResume() {
    return this.available && this.observation.phase === 'inactive' && ['ready', 'paused'].includes(this.snapshot.phase) && this.contextAvailable &&
      !this.simulation.safetyStop && !['camera', 'safety', 'error'].includes(this.snapshot.reason ?? '') && this.terrain.ready
  }
  start() {
    if (this.observation.phase !== 'inactive' || this.observationCard) return
    if (!this.canResume) {
      if (['ready', 'paused'].includes(this.snapshot.phase) && this.contextAvailable && !this.terrain.ready && !this.simulation.safetyStop)
        this.publish({ phase: 'buffering', reason: 'terrain' })
      this.invalidate(); return
    }
    this.input.clear(); this.simulation.clearAccumulator(); this.animationTime = this.simulation.time
    if (import.meta.env.DEV && this.reviewCaptureCamera) { this.reviewCaptureCamera = undefined; this.root.visible = true; this.cameraInitialized = false }
    this.publish({ phase: 'flying', reason: null }); this.invalidate()
  }
  pause(reason: PauseReason = 'user') {
    if (this.disposed || this.fatalError) return
    this.soundscape.update({camera:{x:0,y:0,z:0},rain:0,wind:0,active:false,delta:0})
    if (reason === 'hidden') { this.visible = false; this.syncAvailability() }
    if (this.observation.phase !== 'inactive' && reason !== 'user') { this.observation.suspend(); this.publish({reason});this.publishObservation() }
    this.input.clear(); this.simulation.clearAccumulator(); this.animationTime = this.simulation.time
    if (this.snapshot.phase === 'flying' || this.snapshot.phase === 'buffering')
      this.publish({ phase: reason === 'terrain' ? 'buffering' : 'paused', reason })
  }
  turnReview(degrees: number) {
    const state = this.simulation.renderState()
    this.applyCaptureAnchor({id:'heading-check',world:this.world.config,position:state.position,heading:state.heading+degrees*Math.PI/180,view:this.snapshot.settings.view,pitch:this.reviewPitch,presentationSeconds:state.time,preset:this.scenery.preset})
  }
  async toggleLookdev(active:boolean){
    if(!import.meta.env.DEV)return
    this.pause('user');this.reviewRoute=null;this.lookdevActive=active
    if(active&&!this.lookdev){
      const {LookdevScene}=await import('./lookdev/LookdevScene')
      if(this.disposed)return
      if(!this.lookdev)this.lookdev=new LookdevScene(material=>{decorateShadowFade(material);this.scenery.environment.fog.decorate(material)},()=>this.invalidate())
      this.scene.add(this.lookdev.root)
    }
    active=this.lookdevActive
    this.scenery.environment.sun.shadow.normalBias=active?.08:.8
    if(this.lookdev)this.lookdev.root.visible=active
    this.root.visible=!active;this.terrain.root.visible=!active;this.farTerrain.root.visible=!active;this.scenery.root.visible=!active
    this.scenery.environment.water.visible=!active
    this.cameraInitialized=false;this.invalidate()
  }
  runReviewRoute(id:string) {
    if(!import.meta.env.DEV)return
    const route=REVIEW_ROUTES.find(r=>r.id===id);if(!route)return
    this.applyCaptureAnchor(route.anchor)
    this.simulation.cruiseSpeed=18;this.simulation.speed=18;this.simulation.assisted=false
    this.scenery.review.freezeWater=true
    this.lastReviewRouteId=id
    this.reviewRoute={id,startTime:route.anchor.presentationSeconds,waiting:true,turnAt:route.turnAt,turn:route.turn}
    this.trace.start();this.invalidate()
  }
  traceEvidence(){return {schema:'flight-frame-trace-v1',world:this.world.config,route:this.reviewRoute?.id??this.lastReviewRouteId,gpuScope:'whole-render; per-water/per-shadow not isolated',frames:this.trace.export()}}
  pitchReview(pitch: number) { this.reviewPitch=pitch;this.refreshReview() }
  setReviewPreset(preset: SolarPreset) { this.environmentClock.setSolarDayProgress(solarProgress(preset)); this.scenery.preset = preset; this.scenery.environment.solarDayProgress = undefined; this.publishObservation(); this.refreshReview() }
  setAnimalRimReview(value:boolean) { this.scenery.environment.fog.uniforms.animalRim.value=Number(value);this.refreshReview() }
  setWaterReview(key:'highlight'|'flatWater',value:boolean) { this.scenery.review[key]=value;this.refreshReview() }
  setReviewVisibility(key:'reviewHideWater'|'reviewHideFarTerrain',value:boolean){this[key]=value;this.refreshReview()}
  setReviewPropLod(value:0|1|2|undefined){this.reviewPropLod=value;this.refreshReview()}
  refreshReview() { this.terrain.update(0, false); this.invalidate() }
  configure(settings: FlightSettings) { this.simulation.cruiseSpeed = settings.speed; this.setGentle(settings.gentle); if (settings.quality !== this.snapshot.quality) this.setQuality(settings.quality); this.publish({ settings: { ...settings, start: this.snapshot.settings.start, height: this.snapshot.settings.height } }); this.invalidate() }
  setGentle(gentle: boolean) { this.simulation.gentle = gentle; this.publish({ gentle }) }
  assist() { this.simulation.assisted = true; this.publish({ assisted: true }); this.start() }
  setQuality(quality: 'low' | 'balanced', pause = true) {
    if (pause) this.pause('settings'); this.terrain.radius = this.terrain.simplified ? 2 : quality === 'low' ? 4 : 6
    const fog = this.scene.fog as Fog
    fog.near = quality === 'low' ? 750 : 1200; fog.far = quality === 'low' ? 1650 : 2400
    if (pause && ['ready', 'paused'].includes(this.snapshot.phase)) {
      const p = this.observation.target?.position ?? this.simulation.position; this.terrain.plan(p.x, p.z, this.observation.target?.heading ?? this.simulation.heading, p.y)
      this.publish({ phase: 'buffering', reason: 'terrain' })
    }
    this.publish({ quality }); this.invalidate()
  }
  update(deltaSeconds: number) {
    if (!this.available) return
    this.frameId++; this.workBudget.begin(this.frameId); this.frameCpu = {}
    const preparing = this.snapshot.phase === 'preparing', buffering = this.snapshot.phase === 'buffering', flying = this.snapshot.phase === 'flying' && this.observation.phase === 'inactive'
    const observer = this.observation.target
    const p = observer?.position ?? this.simulation.position
    const observerWork = this.contextAvailable && (this.observationPreparing || this.observationActive)
    const worldWork = preparing || flying || buffering || this.preparationPending || observerWork
    this.terrain.setViewProjection(this.framebufferHeight,this.camera.fov,{x:this.camera.position.x+this.origin.x,y:this.camera.position.y,z:this.camera.position.z+this.origin.z})
    if (!this.reviewIsolation.freezeWorld && worldWork) {
      const planStart=performance.now()
      this.terrain.plan(p.x, p.z, observer?.heading ?? this.simulation.heading, p.y)
      this.frameCpu.terrainPlan=performance.now()-planStart

    }
    if (this.preparationPending && this.terrain.ready) {
      this.preparationPending = false
      if (buffering || (this.snapshot.phase === 'paused' && !['camera', 'safety', 'error'].includes(this.snapshot.reason ?? '')))
        this.publish({ phase: 'paused', reason: null })
    }
    if (preparing && this.modelAttached && this.terrain.previewReady) this.publish({ phase: 'ready' })
    if(import.meta.env.DEV && this.reviewRoute?.waiting && this.canResume){this.reviewRoute.waiting=false;this.start()}
    if (flying) {
      if(import.meta.env.DEV && this.reviewRoute){
        const elapsed=this.simulation.time-this.reviewRoute.startTime
        if(elapsed>=65){this.pause('user');this.trace.stop();this.reviewRoute=null;return}
        this.input.point(elapsed>=this.reviewRoute.turnAt?this.reviewRoute.turn:0,0,-99)
      }
      const horizon = Math.max(120, this.simulation.speed * 6)
      const aheadX = p.x + Math.sin(this.simulation.heading) * horizon
      const aheadZ = p.z - Math.cos(this.simulation.heading) * horizon
      if (!this.terrain.safeToEnter(aheadX, aheadZ)) this.pause('terrain')
      else {
        const simulationStart=performance.now()
        this.simulation.advance(deltaSeconds, this.input.read())
        this.frameCpu.simulation=performance.now()-simulationStart
        const render = this.simulation.renderState()
        const advanced = Math.max(0, render.time - this.animationTime)
        this.animationTime = render.time
        if (this.glideAction && this.poweredAction) {
          this.flightAnimation.update(advanced,this.input.read().climb,this.simulation.commands.targetClimb)
          const weights=animationWeights(import.meta.env.DEV?this.reviewAnimation:'auto')
          this.model?.action?.setEffectiveWeight(weights.source)
          this.glideAction.setEffectiveWeight(weights.glide);this.poweredAction.setEffectiveWeight(weights.powered)
        }
        this.model?.mixer?.update(advanced)
        if (this.simulation.safetyStop) this.pause('safety')
      }
      this.frameTimes.push(deltaSeconds * 1000)
      if (this.frameTimes.length > 3600) this.frameTimes.shift()
      this.slowSeconds = deltaSeconds > .036 ? this.slowSeconds + deltaSeconds : Math.max(0, this.slowSeconds - deltaSeconds * .3)
      if (this.slowSeconds > 8 && this.snapshot.quality === 'balanced') { this.setQuality('low', false); this.slowSeconds = 0 }
    }
    if (Math.max(Math.abs(p.x - this.origin.x), Math.abs(p.z - this.origin.z)) > 2048) {
      const next = { x: Math.floor(p.x / CHUNK_SIZE) * CHUNK_SIZE, z: Math.floor(p.z / CHUNK_SIZE) * CHUNK_SIZE }
      this.camera.position.x -= next.x - this.origin.x; this.camera.position.z -= next.z - this.origin.z
      this.origin = next; this.groundOrigin.value.set(next.x,next.z); this.originShifts++; this.terrain.relocate(next); this.farTerrain.relocate(next); this.horizonTerrain.relocate(next); this.scenery.relocate(next)
    }
    const render = this.simulation.renderState(), rp = render.position
    const focus = observer?.position ?? rp
    this.root.position.set(rp.x - this.origin.x, rp.y, rp.z - this.origin.z)
    this.root.rotation.y = -render.heading
    this.pose.rotation.z = -render.turnRate * (this.snapshot.gentle ? .6 : .78)
    this.pose.rotation.x = render.climbRate * .025
    if(this.lookdevActive&&this.lookdev)this.lookdev.update(this.camera,this.origin)
    else if(observer) {
      const breath=observer.id==='waterline'&&!this.snapshot.gentle?Math.sin(this.environmentClock.motionSeconds*.3)*.005:0
      this.camera.position.set(observer.position.x-this.origin.x,observer.position.y+breath,observer.position.z-this.origin.z)
      const target=viewpointTarget(observer,this.camera.aspect,this.camera.fov)
      this.camera.up.set(0,1,0);this.camera.lookAt(target.x-this.origin.x,target.y+breath,target.z-this.origin.z)
    }
    else if(this.observation.phase === 'returning' && this.observation.bookmark) {
      this.camera.position.copy(this.observation.bookmark.camera).sub(new Vector3(this.origin.x,0,this.origin.z))
      this.camera.quaternion.fromArray(this.observation.bookmark.quaternion)
    }
    else if(!this.reviewIsolation.freezeCamera) this.updateCamera(render, flying ? Math.min(deltaSeconds, 1 / 15) : 0)
    this.horizonTerrain.root.visible=!this.lookdevActive&&!this.reviewHideFarTerrain&&!this.reviewDistanceBaseline
    this.farTerrain.root.visible=!this.lookdevActive&&!this.reviewHideFarTerrain
    this.scenery.environment.water.visible=!this.lookdevActive&&!this.reviewHideWater
    if(this.frameId%6===5&&!this.reviewIsolation.freezeWorld&&!this.reviewDistanceBaseline)this.horizonTerrain.update(focus.x,focus.z,this.workBudget)
    const terrainWork=()=>{
      if(!this.reviewIsolation.freezeWorld&&worldWork){const t=performance.now();this.terrain.update(deltaSeconds,true,this.workBudget);this.frameCpu.terrainUpdate=performance.now()-t}
    }
    // Rotate first access to the shared budget. Data preparation may lag one frame;
    // existing terrain remains authoritative until its replacement is installed.
    if(this.frameId%5===0)terrainWork()
    const profile=VISIBILITY_PROFILES[this.snapshot.quality]
    const farWork=()=>!this.reviewIsolation.freezeWorld&&this.farTerrain.update(focus.x,focus.z,profile.terrainVisible,this.terrain.radius*512,this.workBudget)
    if(this.frameId%5===4)farWork()
    const dirtyGround=this.terrain.consumeGroundDirty();this.scenery.props.markGroundDirty(dirtyGround,this.terrain.surfaceRevision);this.scenery.farCanopy.markGroundDirty(dirtyGround)
    const sceneryStart=performance.now()
    const beforeDaylight = this.environmentClock.snapshot(this.environmentPolicy())
    const weatherPolicy=this.environmentPolicy()
    this.environmentClock.tick(deltaSeconds, {...weatherPolicy,advanceAutomaticSun:weatherPolicy.advanceAutomaticSun&&!this.weatherFreeze.sun})
    this.weather.tick(deltaSeconds,weatherPolicy,this.weatherFreeze)
    this.scenery.environment.weatherState=this.weather.serialize()
    if (this.solarDirty || this.environmentClock.solarMode === 'auto') {
      this.scenery.environment.solarDayProgress = this.environmentClock.solarDayProgress
      this.solarDirty = false
    }
    this.daylightPublishSeconds += admittedEnvironmentDelta(deltaSeconds)
    const daylight = this.environmentClock.snapshot(this.environmentPolicy())
    if (daylight.status !== beforeDaylight.status || (weatherPolicy.advanceEnvironmentMotion && this.daylightPublishSeconds >= .25)) {
      this.daylightPublishSeconds = 0; this.publishObservation()
    }
    this.reviewWaterTime = this.environmentClock.motionSeconds
    this.scenery.river.root.visible=!this.lookdevActive&&!this.reviewIsolation.hideRiver&&!this.reviewHideWater
    this.scenery.environment.setWaterOwner(this.world.river.bounds,this.scenery.river.ready&&!this.reviewIsolation.hideRiver)
    this.scenery.props.setWind(this.environmentClock.motionSeconds,this.livingIntent.wind ? .65 + this.weather.serialize().resolved.rain : 0,this.camera,this.snapshot.gentle)
    this.scenery.update(focus.x, focus.y, focus.z, this.reviewWaterTime, this.snapshot.quality, this.camera, {freezeObjects:this.reviewIsolation.freezeWorld,framebufferHeight:this.framebufferHeight,budget:this.workBudget,frameId:this.frameId,groundEpoch:this.terrain.surfaceRevision,surfaceRevision:this.terrain.surfaceRevision,captureSurface:rect=>this.terrain.captureDisplayedSurface(rect),immutableSurface:(x,z)=>this.world.terrainAt(x,z).height,allowPublish:!this.reviewIsolation.freezeWorld&&(preparing||flying||observerWork),propsFirst:this.frameId%5===2,canopyFirst:this.frameId%5===3,...(this.reviewPropLod===undefined?{}:{fixedLod:this.reviewPropLod})})
    this.frameCpu.scenery=performance.now()-sceneryStart
    if(this.frameId%5!==0)terrainWork()
    if(this.frameId%5!==4)farWork()
    if(this.frameId%6!==5&&!this.reviewIsolation.freezeWorld&&!this.reviewDistanceBaseline)this.horizonTerrain.update(focus.x,focus.z,this.workBudget)
    this.horizonTerrain.setCoverage([...this.terrain.resident.values()].map(tile=>tile.result.chunk).concat(this.farTerrain.coveredChunks))
    this.scenery.environment.fog.uniforms.landDistanceReady.value=Number(this.horizonTerrain.ready&&!this.reviewDistanceBaseline)
    this.farTerrain.setNearCoverage([...this.terrain.resident.values()].map(tile=>tile.result.chunk))
    // Expand visibility only after both coarse layers can cover it; no empty-far-land reveal.
    if(this.farTerrain.metrics.pending===0 && this.scenery.farCanopy.metrics.pendingTiles===0 && this.scenery.farCanopy.metrics.submitted>0){
      const fog=this.scene.fog as Fog;fog.near=profile.fogStart;fog.far=profile.fogEnd
      const cameraFar=this.horizonTerrain.ready&&!this.reviewDistanceBaseline?24000:profile.cameraFar
      if(this.camera.far!==cameraFar){this.camera.far=cameraFar;this.camera.updateProjectionMatrix()}
    }
    if (this.scenery.metrics.failed) this.publish({simplified:true})
    this.livingFrame = livingContext({generation:this.livingScope.generation,motionSeconds:this.environmentClock.motionSeconds,
      camera:{x:this.camera.position.x+this.origin.x,y:this.camera.position.y,z:this.camera.position.z+this.origin.z},
      player:{...rp},heading:render.heading,quality:this.snapshot.quality,gentle:this.snapshot.gentle,weather:this.weather.serialize(),intent:{...this.livingIntent}},weatherPolicy,deltaSeconds)
    const livingStart=performance.now()
    this.companions?.update(this.livingFrame,this.origin)
    this.soundscape.update({camera:{...this.livingFrame.camera},rain:this.livingFrame.weather.resolved.rain,wind:this.livingFrame.weather.resolved.coverage,active:this.livingFrame.active,delta:this.livingFrame.delta,narrationActive:this.narrationActive})
    this.livingCpu.push(performance.now()-livingStart);if(this.livingCpu.length>3600)this.livingCpu.shift()
    const environment = this.scenery.environment.frame
    ;(this.scene.fog as Fog).color.setRGB(...environment.horizon)
    this.terrain.forEachRenderable(mesh=>{
      const bounds=mesh.geometry.boundingSphere
      mesh.receiveShadow=true
      mesh.castShadow=Math.hypot(mesh.position.x+(bounds?.center.x??64)-(focus.x-this.origin.x),mesh.position.z+(bounds?.center.z??64)-(focus.z-this.origin.z))<600
    })
    if(this.observationPreparing && observerWork) {
      const token=this.observation.generation
      if(this.observation.checkTimeout(performance.now())) this.publishObservation()
      else if(this.terrain.previewReady && this.modelAttached && !this.scenery.environment.busy && !this.scenery.river.busy && (this.scenery.metrics.failed || (!this.scenery.props.busy && !this.scenery.farCanopy.busy)) && this.farTerrain.metrics.pending===0 && (this.horizonTerrain.ready||this.reviewDistanceBaseline)) {
        const bookmark=this.observation.bookmark, returning=this.observation.phase==='returning'
        if(this.observation.complete(token)) {
          if(returning && bookmark) {this.root.visible=bookmark.visible;this.cameraInitialized=true;this.input.clear();this.simulation.clearAccumulator();this.publish({phase:'paused',reason:'user'})}
          this.publishObservation()
        }
      }
    }
    if(import.meta.env.DEV)this.reviewOverlayUpdate?.()
    if(import.meta.env.DEV&&this.trace.active) this.trace.append({frameId:this.frameId,time:render.time,phase:this.snapshot.phase,pauseReason:this.snapshot.reason,position:[rp.x,rp.y,rp.z],camera:{position:this.camera.position.toArray(),quaternion:this.camera.quaternion.toArray(),fov:this.camera.fov,near:this.camera.near,far:this.camera.far},surface:{weather:this.weather.serialize(),freeze:{...this.weatherFreeze,water:this.scenery.review.freezeWater},daylight:this.environmentClock.snapshot(this.environmentPolicy()),activeView:this.observation.target?.id??'flight',generation:this.observation.generation,waterTime:this.scenery.environment.waterMotionSeconds,waveFrozen:this.scenery.review.freezeWater,shadowEnabled:this.scenery.review.shadows,depthFrozen:this.scenery.review.freezeBathymetry,identity:this.terrain.surfaceIdentity(rp.x,rp.z),riverReady:this.scenery.river.ready,waterOwner:this.scenery.river.ready&&!this.reviewIsolation.hideRiver&&rp.x>=this.world.river.bounds.minX&&rp.x<this.world.river.bounds.maxX&&rp.z>=this.world.river.bounds.minZ&&rp.z<this.world.river.bounds.maxZ?'finite-water':'ocean',isolation:{...this.reviewIsolation}},quality:this.snapshot.quality,deltaMs:deltaSeconds*1000,cpu:{...this.frameCpu},budget:{...this.workBudget.metrics},terrain:{...this.terrain.diagnostics(),far:{...this.farTerrain.metrics}},props:{...this.scenery.metrics,farCanopy:{...this.scenery.farCanopy.metrics}},bathymetry:{...this.scenery.environment.metrics},gpuMs:null})
    if(((this.observationActive && !this.observation.sceneryPaused) || this.reviewMotionActive) && Number.isFinite(deltaSeconds)) {
      this.frameTimes.push(deltaSeconds*1000);if(this.frameTimes.length>3600)this.frameTimes.shift()
    }
    this.reportingSeconds += deltaSeconds
    if (this.reportingSeconds > 1 || preparing) {
      this.reportingSeconds = 0
      this.publish({ region: this.world.regionAt(p.x, p.z), assisted: this.simulation.assisted })
    }
  }
  private updateCamera(render: RenderState, delta: number) {
    if (import.meta.env.DEV && this.reviewCaptureCamera && this.snapshot.phase !== 'flying') {
      const { position, target } = this.reviewCaptureCamera
      this.camera.position.set(position.x - this.origin.x, position.y, position.z - this.origin.z)
      this.camera.up.set(0, 1, 0)
      this.camera.lookAt(target.x - this.origin.x, target.y, target.z - this.origin.z)
      return
    }
    const p = render.position, heading = render.heading
    const distance = framingDistance(this.camera.aspect, this.snapshot.settings.view)
    if (!this.cameraInitialized || delta > 0) this.cameraOffset = followOffset(this.cameraOffset, heading, distance, this.cameraInitialized ? delta : 0)
    this.followPosition.copy(this.cameraOffset).add(new Vector3(p.x, p.y, p.z))
    const from = this.cameraInitialized ? { x: this.camera.position.x + this.origin.x, y: this.camera.position.y, z: this.camera.position.z + this.origin.z } : this.followPosition
    let safe = cameraPathSafe(from, this.followPosition, this.safeSurface)
    if (!safe && this.cameraInitialized) for (const side of [0, -6, 6]) {
      const candidate = new Vector3(p.x - Math.sin(heading) * distance * .65 + Math.cos(heading) * side, p.y + 5,
        p.z + Math.cos(heading) * distance * .65 + Math.sin(heading) * side)
      if (cameraPathSafe(from, candidate, this.safeSurface)) { this.followPosition.copy(candidate); safe = true; break }
    }
    if (safe) {
      this.camera.position.set(this.followPosition.x - this.origin.x, this.followPosition.y, this.followPosition.z - this.origin.z)
      this.cameraInitialized = true
    } else { this.pause('camera'); return }
    this.lookPosition.set(p.x - this.origin.x + Math.sin(heading) * 20, p.y - 5, p.z - this.origin.z - Math.cos(heading) * 20)
    this.camera.up.set(0, 1, 0); this.camera.lookAt(this.lookPosition)
    if (import.meta.env.DEV && this.reviewPitch) this.camera.rotateX(this.reviewPitch)
  }
  resize(width: number, height: number) { this.camera.aspect = width / height; this.camera.updateProjectionMatrix(); this.cameraInitialized = false }
  contextLost() {
    if (this.disposed) return
    this.contextAvailable = false; this.pause('context'); this.syncAvailability()
    if (!this.fatalError) this.publish({ phase: 'recovering', reason: 'context' })
  }
  contextRestored() {
    if (this.disposed) return
    this.contextAvailable = true; this.syncAvailability()
    if (!this.fatalError) this.publish({ phase: this.model ? 'paused' : 'recovering', reason: 'context' })
  }
  fail(error: unknown) {
    if (this.disposed || this.fatalError) return
    console.error('Flight experience:', error)
    this.fatalError = true; this.input.clear(); this.simulation.clearAccumulator()
    if (this.observation.phase !== 'inactive') this.observation.fail()
    this.syncAvailability(); this.publish({ phase: 'recovering', reason: 'error' }); this.publishObservation()
  }
  diagnostics() {
    const sorted = [...this.frameTimes].sort((a, b) => a - b)
    const percentile = (p: number) => sorted[Math.floor((sorted.length - 1) * p)] ?? null
    return { observation:{phase:this.observation.phase,generation:this.observation.generation,target:this.observation.target,sceneryPaused:this.observation.sceneryPaused}, animation:{sourceTime:this.model?.action?.time??null,sourceWeight:this.model?.action?.getEffectiveWeight()??null,visible:this.root.visible,mode:this.reviewAnimation,state:this.reviewAnimation==='powered'?'powered':this.reviewAnimation==='glide'?'glide':'source',poweredWeight:this.poweredAction?.getEffectiveWeight()??0,clip:this.reviewAnimation==='powered'?poweredFlapData.name:this.reviewAnimation==='glide'?glideData.name:this.model?.action?.getClip().name},surface:this.surface.sample(this.simulation.position.x,this.simulation.position.z),river:{ready:this.scenery.river.ready,error:this.scenery.river.error,length:this.world.river.length},isolation:{...this.reviewIsolation},frameId:this.frameId, living:{cpuMs:this.percentiles(this.livingCpu),cpuScope:'companion and sound update; wind shader GPU excluded',intent:{...this.livingIntent},sound:this.soundscape.getSnapshot(),companions:this.companions?.metrics??null,card:this.observationCard}, preparation:{...this.workBudget.metrics}, traceFrames:this.trace.size, lookdev:this.lookdevActive?this.lookdev?.metadata():null, world: this.world.config, phase: this.snapshot.phase, quality: this.snapshot.quality,
      position: { ...this.simulation.position }, heading: this.simulation.heading, time: this.simulation.time,
      commands: { ...this.simulation.commands, mode: this.simulation.avoidance, vY: this.simulation.climbRate, aY: this.simulation.verticalAcceleration },
      daylight: this.environmentClock.snapshot(this.environmentPolicy()),
      weatherRendering:{enabled:this.scenery.environment.weatherEnabled,degraded:this.scenery.environment.weatherDegraded,waterSeconds:this.scenery.environment.waterMotionSeconds},weather: this.weather.snapshot(this.environmentPolicy().advanceEnvironmentMotion), freeze:{...this.weatherFreeze,water:this.scenery.review.freezeWater},
      clock: { motionSeconds: this.environmentClock.motionSeconds, solarDayProgress: this.environmentClock.solarDayProgress, solarMode: this.environmentClock.solarMode },
      origin: this.origin, originShifts: this.originShifts, droppedSeconds: this.simulation.droppedSeconds,
      frameTimeMs: { samples: sorted.length, p50: percentile(.5), p95: percentile(.95), p99: percentile(.99), spikes100: sorted.filter(n => n > 100).length },
      camera: { position: this.camera.position.toArray(), quaternion: this.camera.quaternion.toArray(), aspect:this.camera.aspect, view:this.snapshot.settings.view, pitch:this.reviewPitch, fov:this.camera.fov, near:this.camera.near, far:this.camera.far }, environment: this.scenery.environment.frame, environmentResources: {...this.scenery.environment.metrics}, render: {...this.renderMetrics}, cpuTimeMs: this.percentiles(this.cpuTimes), gpuTimeMs:this.percentiles(this.gpuTimes),
      horizonTerrain:{...this.horizonTerrain.metrics},farTerrain:{...this.farTerrain.metrics},farCanopy:{...this.scenery.farCanopy.metrics}, props: { ...this.scenery.metrics }, terrain: this.terrain.diagnostics() }
  }
  resetReviewMetrics() { if(!import.meta.env.DEV)return;this.frameTimes.length=0;this.cpuTimes.length=0;this.gpuTimes.length=0 }
  recordRender(data: typeof this.renderMetrics) {
    this.renderMetrics = data
    this.trace.render(this.frameId,data)
    if (this.snapshot.phase === 'flying' || this.observationActive || this.reviewMotionActive) { this.cpuTimes.push(data.cpuMs); if (this.cpuTimes.length > 3600) this.cpuTimes.shift() }
  }
  recordGpu(milliseconds: number, frameId = this.frameId) { this.trace.gpu(frameId,milliseconds); if(this.snapshot.phase === 'flying' || this.observationActive || this.reviewMotionActive) { this.gpuTimes.push(milliseconds);if(this.gpuTimes.length>240)this.gpuTimes.shift() } }
  private percentiles(values: number[]) {
    const sorted = [...values].sort((a,b)=>a-b)
    return { samples:sorted.length,p50:sorted[Math.floor(sorted.length*.5)]??null,p95:sorted[Math.floor(sorted.length*.95)]??null,p99:sorted[Math.floor(sorted.length*.99)]??null }
  }
  applyCaptureAnchor(anchor: CaptureAnchor) {
    if (!import.meta.env.DEV || this.observation.phase !== 'inactive') return
    this.reviewRoute=null;this.lastReviewRouteId='manual'
    this.pause('user'); this.input.clear()
    Object.assign(this.simulation.position,anchor.position);this.simulation.heading=anchor.heading
    this.environmentClock.setSolarDayProgress(solarProgress(anchor.preset))
    if(anchor.weather)this.weather.restore(anchor.weather)
    this.environmentClock.restoreCaptureMotion(anchor.presentationSeconds)
    this.scenery.environment.restoreWaterMotion(anchor.presentationSeconds)
    this.scenery.environment.solarDayProgress = this.environmentClock.solarDayProgress
    this.solarDirty = true
    this.simulation.time=anchor.presentationSeconds;this.simulation.turnRate=0;this.simulation.climbRate=0;this.simulation.verticalAcceleration=0;this.simulation.safetyStop=false;this.simulation.clearAccumulator()
    this.reviewCaptureCamera = anchor.camera
    this.root.visible = !anchor.camera
    this.scenery.environment.solarLayout = anchor.solarLayout ?? 'legacy'
    this.reviewPitch=anchor.pitch;this.scenery.preset=anchor.preset;this.cameraInitialized=false
    this.publish({solarDayProgress:this.environmentClock.solarDayProgress,settings:{...this.snapshot.settings,view:anchor.view},phase:'buffering',reason:'terrain'})
    this.terrain.plan(anchor.position.x,anchor.position.z,anchor.heading,anchor.position.y);this.terrain.prepareStaticView();this.invalidate()
  }
  close() { if (this.lease) this.lease.release(); else this.dispose(); this.lease = null }
  dispose() {
    this.companions?.dispose();this.companions=null
    this.soundscape.dispose()
    this.photos.dispose()
    this.livingScope.dispose()
    if (this.disposed) return
    this.observation.close();this.disposed = true; this.abort.abort(); this.input.clear(); this.groundLibrary?.dispose(); this.terrain.dispose(); this.farTerrain.dispose(); this.horizonTerrain.dispose(); this.scenery.dispose(); this.lookdev?.dispose()
    if (this.model) this.controller.disposeStagedModel(this.model)
    this.model = null; this.scene.clear(); this.listeners.clear(); this.frameTimes.length = 0; this.cpuTimes.length = 0; this.gpuTimes.length = 0
  }
}
