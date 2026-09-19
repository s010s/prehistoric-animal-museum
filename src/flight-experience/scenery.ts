import { RiverScene } from './hydrology/river-scene'
import { FarCanopyLayer } from './props/far-canopy-layer'
import { Group, PerspectiveCamera, type Scene } from 'three'
import { EnvironmentScene, type EnvironmentUpdateOptions } from './environment/environment-scene'
import type { SolarPreset } from './environment/environment-state'
import { PropStream, type PropFrameContext } from './props/prop-stream'
import { createWorldSampler, type Address } from './world'
/** Scene resources belong to this flight session; no renderer or independent clock. */
export class FlightScenery {
  readonly root = new Group()
  readonly environment: EnvironmentScene
  readonly river: RiverScene
  readonly props: PropStream
  readonly farCanopy: FarCanopyLayer
  readonly review = { hideProps: false, flatWater: false, freezeWater: false, oceanEdges: false, skyColors: false, shadows: true, highlight: true, freezeBathymetry:false,ownerColors:false,depthColors:false }
  preset: SolarPreset = 'noon'
  private origin: Address = {x:0,z:0}
  private disposed = false
  private readonly fallbackCamera = new PerspectiveCamera(55,1,.5,6000)
  constructor(scene: Scene, wake: () => void, surface: (x: number,z: number)=>number = (x,z)=>createWorldSampler().terrainAt(x,z).height, world = createWorldSampler(), farSurface: (x:number,z:number)=>number = surface) {
    scene.add(this.root)
    this.environment = new EnvironmentScene(scene, surface, wake)
    this.river = new RiverScene(world, ()=>this.environment.createRiverMaterial(),ready=>this.environment.setWaterOwner(world.river.bounds,ready), wake);this.root.add(this.river.root)
    this.props = new PropStream(this.root, wake, surface, world, material => this.environment.fog.decorate(material))
    this.farCanopy=new FarCanopyLayer(this.root,world,{templates:()=>this.props.getCanopyTemplates(),hasRepresentation:id=>this.props.hasSubmittedRepresentation(id),surface:farSurface})
  }
  get sky() { return this.environment.sky }
  get metrics() { return this.props.metrics }
  get busy() { return this.river.busy || this.props.busy || this.environment.busy || this.farCanopy.busy }
  update(x:number,y:number,z:number,time:number,quality:'low'|'balanced',camera?:PerspectiveCamera, options:EnvironmentUpdateOptions & PropFrameContext & {propsFirst?:boolean;canopyFirst?:boolean;freezeObjects?:boolean} = {}) {
    this.fallbackCamera.position.set(x-this.origin.x,y,z-this.origin.z)
    Object.assign(this.environment.review,{flatWater:this.review.flatWater,freezeWater:this.review.freezeWater,oceanEdges:this.review.oceanEdges,skyColors:this.review.skyColors,shadows:this.review.shadows,highlight:this.review.highlight,freezeBathymetry:this.review.freezeBathymetry,ownerColors:this.review.ownerColors,depthColors:this.review.depthColors})
    this.environment.sun.castShadow=this.review.shadows
    this.props.visible=!this.review.hideProps
    this.farCanopy.root.visible=!this.review.hideProps
    const props=()=>!options.freezeObjects&&this.props.update(x,y,z,quality,{...options,camera:camera??this.fallbackCamera})
    const canopy=()=>!options.freezeObjects&&this.farCanopy.update(camera??this.fallbackCamera,this.origin,quality,options.budget)
    if(options.canopyFirst)canopy()
    if(options.propsFirst)props()
    this.environment.update(camera ?? this.fallbackCamera,this.origin,time,quality,this.preset,options)
    if(!options.propsFirst)props()
    if(!options.canopyFirst)canopy()
  }
  relocate(origin:Address) { this.origin={...origin};this.props.relocate(origin);this.river.relocate(origin) }
  dispose() { if(this.disposed)return;this.disposed=true;this.river.dispose();this.farCanopy.dispose();this.props.dispose();this.environment.dispose();this.root.removeFromParent() }
}
