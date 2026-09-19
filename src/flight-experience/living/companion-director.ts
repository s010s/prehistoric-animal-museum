import { Group, Mesh, Vector3, type AnimationClip, type BufferGeometry, type Material, type Object3D } from 'three'
import type { WorldSampler } from '../world'
import type { LivingContext } from './living-context'
import { createCompanion, loadFarCompanionTemplate, type CompanionInstance, type FarCompanionTemplate } from './companion-assets'

type Point = Readonly<{ x: number; y: number; z: number }>
export interface CompanionRoute { readonly id: number; readonly near: boolean; readonly start: Point; readonly heading: number; readonly side: number; readonly duration: number; readonly speed: number; readonly approach?: number }
export function routePoint(route: CompanionRoute, age: number): Point {
  const t = Math.max(0, Math.min(age, route.duration)), departure = Math.max(0, t - route.duration * .62)
  const forward=route.speed*t-(route.approach??0)*Math.min(t,110/Math.max(.001,route.approach??0))
  const lateral = route.side * departure * departure * .10
  return { x: route.start.x + Math.sin(route.heading) * forward + Math.cos(route.heading) * lateral,
    y: route.start.y + departure * .65,
    z: route.start.z - Math.cos(route.heading) * forward + Math.sin(route.heading) * lateral }
}
const distance = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z)
/** A segment check catches high-speed crossings between admitted frames. */
export function segmentDistance(a: Point, b: Point, p: Point): number {
  const dx=b.x-a.x,dy=b.y-a.y,dz=b.z-a.z,length=dx*dx+dy*dy+dz*dz
  const t=length===0?0:Math.max(0,Math.min(1,((p.x-a.x)*dx+(p.y-a.y)*dy+(p.z-a.z)*dz)/length))
  return distance({x:a.x+dx*t,y:a.y+dy*t,z:a.z+dz*t},p)
}
/** Fixed bounded cohort routes are validated against terrain before entering view. */
export function planCompanionRoute(id: number, near: boolean, context: LivingContext, surface: (x:number,z:number)=>number, travelSpeed=28): CompanionRoute | null {
  const side=id%2===0?1:-1, spread=near?32+(id%2)*6:90+(id%3)*18
  const forward=near?150:260+(id%3)*22
  const anchor=distance(context.camera,context.player)>100?context.camera:context.player
  const start={x:anchor.x+Math.sin(context.heading)*forward+Math.cos(context.heading)*spread*side,
    y:anchor.y+(near?-12:-3)+(id%3)*2,
    z:anchor.z-Math.cos(context.heading)*forward+Math.sin(context.heading)*spread*side}
  const route: CompanionRoute={id,near,start,heading:context.heading,side,duration:near?55:68,speed:travelSpeed>1?travelSpeed:13,approach:near&&travelSpeed>1?6:0}
  // Height is chosen before spawn, so no teleport to clear a late hill. The
  // surface contract already includes all resident LODs and vegetation height.
  let floor=start.y
  const horizon = 12, samples = Math.ceil(route.speed * horizon / 10)
  for(let i=0;i<=samples;i++) {
    const p=routePoint(route,horizon*i/samples),height=surface(p.x,p.z)
    if(!Number.isFinite(height)) return null
    floor=Math.max(floor,height+18)
  }
  start.y=floor
  if(distance(start,context.camera)<80||distance(start,context.player)<80)return null
  return route
}
export function companionGeometryLod(nearCohort:boolean,distanceMetres:number,previous:'source'|'far',farAvailable:boolean):'source'|'far' {
  if(!farAvailable)return 'source'
  if(!nearCohort)return 'far'
  // Fraction of vertical screen span at the runtime's 55-degree camera FOV.
  // Hysteresis prevents repeated geometry swaps as flight oscillates at a boundary.
  const projectedHeight=7/(2*Math.max(1,distanceMetres)*Math.tan(55*Math.PI/360))
  return previous==='source'?(projectedHeight<.052?'far':'source'):(projectedHeight>.072?'source':'far')
}
interface Bird { lod:'source'|'far'; route: CompanionRoute; born: number; previous: Point; offset: {x:number;y:number;z:number}; departure: number | null; blocked: boolean; visual: CompanionInstance; wrapper: Group }
export class CompanionDirector {
  readonly root = new Group()
  private readonly birds: Bird[] = []
  private far: FarCompanionTemplate | null = null
  private loading = false
  private loadFailed = false
  private quality: LivingContext['quality'] = 'low'
  private revision = 0
  private disposed = false
  private enabled = false
  private generation: number | null = null
  private nextSpawn = 0
  private serial = 0
  private localTime = 0
  private lastMotion: number | null = null
  private readonly material: Material | Material[] | null
  private readonly modelScale: number
  private readonly surface: (x:number,z:number)=>number
  private rejected = 0
  private safetyTick = -1
  private travelSpeed = 28
  private previousPlayer: Point | null = null
  private previousCamera: Point | null = null
  constructor(scene: Object3D, private readonly world: WorldSampler, private readonly heroRoot: Object3D, private readonly clip: AnimationClip, safeSurface?: (x:number,z:number)=>number) {
    scene.add(this.root); this.root.name='Living companions'
    this.surface=safeSurface??world.safeSurface
    // Match the hero correction group exactly; retain its source-space center.
    this.modelScale=heroRoot.parent?heroRoot.getWorldScale(new Vector3()).x/heroRoot.scale.x:7/1.01251906
    let material: Material | Material[] | null=null
    heroRoot.traverse(object=>{if(material===null&&object instanceof Mesh)material=(object as Mesh<BufferGeometry,Material|Material[]>).material})
    this.material=material
  }
  get metrics() {
    const near=this.birds.filter(b=>b.route.near).length,far=this.birds.length-near
    const budgetTransition=this.quality==='low'&&(near>1||far>3)
    return {near,far,loading:this.loading,status:!this.enabled?'off':this.loadFailed?'degraded':this.loading?'loading':'ready',
      triangles:this.birds.reduce((sum,bird)=>sum+(bird.lod==='source'?13494:4048),0),sourceLod:this.birds.filter(bird=>bird.lod==='source').length,budgetTransition,budgetTransitionMaxEffectiveSeconds:6,
      rejectedRoutes:this.rejected,resourceReferences:this.far?.references??0}
  }
  private clearBirds() { for(const bird of this.birds) { bird.visual.dispose(); bird.wrapper.removeFromParent() } this.birds.length=0 }
  private stop() {
    this.revision++;this.loading=false;this.loadFailed=false;this.clearBirds();this.far?.dispose();this.far=null
  }
  private load() {
    if(this.loading||this.loadFailed||this.far||this.material===null)return
    this.loading=true;const revision=this.revision
    void loadFarCompanionTemplate(this.material).then(library=>{
      if(this.disposed||!this.enabled||revision!==this.revision){library.dispose();return}
      this.loading=false;this.far=library
    },()=>{if(revision===this.revision){this.loading=false;this.loadFailed=true}})
  }
  update(context: LivingContext, origin: Readonly<{x:number;z:number}>) {
    if(this.disposed)return
    this.quality=context.quality
    if(this.generation!==context.generation){this.stop();this.generation=context.generation;this.nextSpawn=this.localTime+3;this.lastMotion=null}
    if(this.enabled!==context.intent.companions){
      this.enabled=context.intent.companions;this.revision++;this.loading=false;this.loadFailed=false;this.nextSpawn=this.localTime+3
      if(!this.enabled)for(const bird of this.birds)bird.departure??=this.localTime
    }
    if(!this.enabled&&!context.active)this.stop()
    if(!this.enabled&&this.birds.length===0){this.far?.dispose();this.far=null;return}
    if(this.enabled)this.load()
    // Presentation origin is independent of environment time and may change
    // while paused; motion remains frozen while root coordinates are rebased.
    if(context.active&&this.previousPlayer&&context.delta>0){
      const measured=Math.hypot(context.player.x-this.previousPlayer.x,context.player.z-this.previousPlayer.z)/context.delta
      if(measured<50)this.travelSpeed=measured
    }
    if(context.active){this.localTime+=Math.max(0,Math.min(context.delta,.1));this.lastMotion=context.motionSeconds}
    const now=this.localTime
    if(context.active&&this.enabled&&now>=this.nextSpawn&&context.weather.resolved.rain<.08){this.spawn(context);this.nextSpawn=now+82}
    let near=0,far=0
    for(const bird of this.birds){
      const over=context.quality==='low'&&(bird.route.near?++near>1:++far>3)
      if(over||context.weather.resolved.rain>=.08)bird.departure??=now
    }
    const checkTerrain=Math.floor(now*10)!==this.safetyTick
    this.safetyTick=Math.floor(now*10)
    const dt=context.active?Math.max(0,Math.min(context.delta,.1)):0
    const teleported=this.previousCamera!==null&&distance(context.camera,this.previousCamera)>100
    if(teleported){for(const bird of this.birds)bird.departure??=now;this.nextSpawn=now+7}
    const playerSpeed=this.previousPlayer&&dt>0?{
      x:(context.player.x-this.previousPlayer.x)/dt,
      y:(context.player.y-this.previousPlayer.y)/dt,
      z:(context.player.z-this.previousPlayer.z)/dt,
    }:{x:0,y:0,z:0}
    for(let i=this.birds.length-1;i>=0;i--){
      const bird=this.birds[i]!, age=now-bird.born,base=routePoint(bird.route,age)
      const predicted={x:context.player.x+playerSpeed.x*2,y:context.player.y+playerSpeed.y*2,z:context.player.z+playerSpeed.z*2}
      // Two-second lookahead creates a continuous sideways/upward NPC detour.
      // It never changes the player's velocity or camera.
      const routeAhead=routePoint(bird.route,age+2)
      const predictedBird={x:bird.previous.x+routeAhead.x-base.x,y:bird.previous.y+routeAhead.y-base.y,z:bird.previous.z+routeAhead.z-base.z}
      const proximity=Math.min(distance(bird.previous,context.player),distance(predictedBird,predicted),distance(bird.previous,context.camera))
      if(proximity<45||bird.departure!==null){
        const threat=distance(bird.previous,context.camera)<distance(bird.previous,predicted)?context.camera:predicted
        const dx=bird.previous.x-threat.x,dz=bird.previous.z-threat.z,length=Math.hypot(dx,dz)||1
        const speed=proximity<30?38:18
        bird.offset.x+=dx/length*dt*speed;bird.offset.z+=dz/length*dt*speed;bird.offset.y+=dt*(proximity<30?8:1)
        if(proximity<35)bird.departure??=now
      }
      let current:Point={x:base.x+bird.offset.x,y:base.y+bird.offset.y,z:base.z+bird.offset.z}
      // Bounded rolling lookahead verifies every <= 10m point in the next 2s.
      // Unknown/unloaded space starts a departure at the last safe position.
      if(dt>0&&checkTerrain){
        const ahead=routePoint(bird.route,age+2),dx=ahead.x-base.x,dz=ahead.z-base.z
        const steps=Math.max(1,Math.ceil(Math.hypot(dx,dz)/10))
        let safe=true
        for(let step=0;step<=steps;step++){
          const height=this.surface(current.x+dx*step/steps,current.z+dz*step/steps)
          if(!Number.isFinite(height)||height+12>current.y){safe=false;break}
        }
        bird.blocked=!safe
        if(!safe)bird.departure??=now
      }
      if(dt>0&&bird.blocked){
        current={x:bird.previous.x,y:bird.previous.y+dt*8,z:bird.previous.z}
        bird.offset.x=current.x-base.x;bird.offset.y=current.y-base.y;bird.offset.z=current.z-base.z
      }
      const emergency=teleported&&distance(current,context.camera)<25
      const departureAge=bird.departure===null?0:now-bird.departure
      if(age>=bird.route.duration||departureAge>=6||emergency||distance(current,context.camera)>2200){bird.visual.dispose();bird.wrapper.removeFromParent();this.birds.splice(i,1);continue}
      const lod=companionGeometryLod(bird.route.near,distance(current,context.camera),bird.lod,this.far!==null)
      if(lod!==bird.lod){
        const replacement=this.makeVisual(lod,bird.route.id)
        if(replacement){bird.wrapper.add(replacement.root);bird.visual.dispose();bird.visual=replacement;bird.lod=lod}
      }
      bird.wrapper.position.set(current.x-origin.x,current.y,current.z-origin.z)
      const dx=current.x-bird.previous.x,dz=current.z-bird.previous.z
      if(Math.hypot(dx,dz)>.001)bird.wrapper.rotation.y=Math.atan2(dx,-dz)+Math.PI
      bird.visual.setOpacity(Math.min(1,age/4,(bird.route.duration-age)/6,1-departureAge/6))
      bird.visual.setMotionSeconds((this.lastMotion??context.motionSeconds)*.7)
      bird.previous=current
    }
    this.previousPlayer={...context.player};this.previousCamera={...context.camera}
  }
  private spawn(context: LivingContext) {
    const nearLimit=context.quality==='low'?1:2,farLimit=context.quality==='low'?3:6
    // Existing birds finish their routes across quality/weather changes. A new
    // cohort never exceeds the requested quality's available slots.
    const existingNear=this.birds.filter(b=>b.route.near).length, existingFar=this.birds.length-existingNear
    for(let i=0;i<nearLimit+farLimit;i++){
      const near=i<nearLimit
      if(near?i<existingNear:i-nearLimit<existingFar)continue
      if(!near&&!this.far)continue
      const id=this.serial++ + (this.world.config.seed%101),route=planCompanionRoute(id,near,context,this.surface,this.travelSpeed)
      if(!route){this.rejected++;continue}
      const lod=companionGeometryLod(near,distance(route.start,context.camera),'source',this.far!==null)
      const visual=this.makeVisual(lod,id)
      if(!visual)continue
      const wrapper=new Group();wrapper.scale.setScalar(this.modelScale);wrapper.rotation.y=route.heading+Math.PI;wrapper.add(visual.root);this.root.add(wrapper)
      visual.setOpacity(0)
      this.birds.push({lod,route,born:this.localTime,previous:route.start,offset:{x:0,y:0,z:0},departure:null,blocked:false,visual,wrapper})
    }
  }
  private makeVisual(lod:'source'|'far',id:number):CompanionInstance|null {
    const options={phase:id*.73,independentMaterials:true}
    const visual=lod==='source'?createCompanion(this.heroRoot,this.clip,options):this.far?.create(options)
    if(!visual)return null
    visual.root.position.copy(this.heroRoot.position);visual.root.rotation.copy(this.heroRoot.rotation);visual.root.scale.copy(this.heroRoot.scale)
    return visual
  }
  dispose(){if(this.disposed)return;this.disposed=true;this.enabled=false;this.stop();this.root.removeFromParent()}
}
