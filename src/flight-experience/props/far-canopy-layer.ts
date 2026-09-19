import { DynamicDrawUsage, Group, InstancedBufferAttribute, InstancedMesh, Matrix4, Object3D, type BufferGeometry, type Material, type PerspectiveCamera } from 'three'
import { chunkAt, type Address,type Prop } from '../world'
import { dimensions } from './prop-lod'
import { VISIBILITY_PROFILES } from '../visibility-profile'
import type { BathymetryBudget } from '../environment/bathymetry'
export interface CanopyTemplate { asset:string;parts:readonly {geometry:BufferGeometry;material:Material|Material[]}[] }
interface Source {scatter(address:Address):Prop[];noise?:(x:number,z:number,namespace:number)=>number}
interface Ownership {templates:()=>readonly CanopyTemplate[];hasRepresentation:(id:string)=>boolean;surface:(x:number,z:number)=>number}
interface CachedTile {address:Address;props:Prop[]}
interface Pool {meshes:InstancedMesh[];matrix:InstancedBufferAttribute;staging:Float32Array;ids:string[];nextIds:string[];count:number;origin:Address}
const CAPACITY=4096
/** Same original trees, finite cache, and compact submitted instances. Shared source
 * geometry/material/texture ownership remains with PropStream, disposed after us.
 */
export class FarCanopyLayer {
  clustered=true
  readonly root=new Group()
  readonly metrics={ready:false,tiles:0,candidates:0,pendingTiles:0,live:0,submitted:0,visible:0,bytes:0,drawCalls:0,overflow:0,prepareMs:0,compactionFrames:0}
  private readonly cache=new Map<string,CachedTile>()
  private readonly pools=new Map<string,Pool>()
  private wanted:{key:string;address:Address}[]=[]
  private wantedKey=''
  private frame=0
  private disposed=false
  private cursor=0
  private candidates:Prop[]=[]
  private building=false
  private dirty=true
  private readonly suppressed=new Set<string>()
  private readonly ground=new Map<string,number>()
  markGroundDirty(keys:readonly string[]){for(const key of keys){const tile=this.cache.get(key);if(!tile)continue;for(const p of tile.props)this.ground.delete(p.id);if(tile.props.some(p=>!this.ownership.hasRepresentation(p.id)))this.dirty=true}}
  private readonly transform=new Object3D()
  private readonly zero=new Matrix4().makeScale(0,0,0)
  private readonly submission=new Map<string,{pool:Pool;index:number}>()
  private buildOrigin:Address={x:0,z:0}
  private commitIndex=0
  private currentOrigin:Address={x:0,z:0}
  private buildCamera={x:0,y:0,z:0}
  private buildRange=0
  private buildQuality:'low'|'balanced'='low'
  constructor(parent:Group,private readonly source:Source,private readonly ownership:Ownership){this.root.name='flight-far-canopy';parent.add(this.root)}
  get busy(){return !this.disposed&&(!this.metrics.ready||this.metrics.pendingTiles>0||this.building)}
  private initialize(){
    const templates=this.ownership.templates();if(!templates.length)return false
    const template=templates.find(t=>!this.pools.has(t.asset))
    if(template){
      const matrix=new InstancedBufferAttribute(new Float32Array(CAPACITY*16),16).setUsage(DynamicDrawUsage)
      const meshes=template.parts.map(part=>{const mesh=new InstancedMesh(part.geometry,part.material,CAPACITY);mesh.instanceMatrix=matrix;mesh.count=0;mesh.frustumCulled=false;mesh.castShadow=false;mesh.receiveShadow=false;this.root.add(mesh);return mesh})
      this.pools.set(template.asset,{meshes,matrix,staging:new Float32Array(CAPACITY*16),ids:[],nextIds:[],count:0,origin:{x:0,z:0}})
    }
    this.metrics.ready=templates.every(t=>this.pools.has(t.asset));this.metrics.bytes=this.pools.size*CAPACITY*16*4*3;return this.metrics.ready
  }
  private plan(camera:PerspectiveCamera,origin:Address,quality:'low'|'balanced'){
    const profile=VISIBILITY_PROFILES[quality],a=chunkAt(camera.position.x+origin.x,camera.position.z+origin.z),key=`${a.x},${a.z}:${quality}`
    if(key===this.wantedKey)return
    this.wantedKey=key;this.dirty=true;const radius=Math.ceil(profile.canopyCache/512),wanted=[]
    for(let z=a.z-radius;z<=a.z+radius;z++)for(let x=a.x-radius;x<=a.x+radius;x++)wanted.push({key:`${x},${z}`,address:{x,z},distance:(x-a.x)**2+(z-a.z)**2})
    wanted.sort((a,b)=>a.distance-b.distance);this.wanted=wanted.slice(0,profile.maxCanopyTiles)
    const keys=new Set(this.wanted.map(t=>t.key));for(const key of this.cache.keys())if(!keys.has(key)){for(const p of this.cache.get(key)!.props){this.ground.delete(p.id);this.suppressed.delete(p.id)}this.cache.delete(key)}
  }
  update(camera:PerspectiveCamera,origin:Address,quality:'low'|'balanced',budget?:BathymetryBudget){
    if(this.disposed)return
    this.frame++;const started=performance.now(),canStart=()=>!budget||budget.canStart(.02)
    if(!this.metrics.ready){if(!canStart()||(budget&&!budget.canStart(.05,CAPACITY*16*4,3)))return;if(budget)budget.measure('canopy.initialize',()=>this.initialize(),CAPACITY*16*4,3);else this.initialize();if(!this.metrics.ready)return}
    if(this.currentOrigin.x!==origin.x||this.currentOrigin.z!==origin.z){
      // Existing matrices were built in buildOrigin; group shift keeps them in place until next commit.
      for(const pool of this.pools.values())for(const mesh of pool.meshes)mesh.position.set(pool.origin.x-origin.x,0,pool.origin.z-origin.z);this.currentOrigin={...origin}
    }
    const ownership=()=>{
    this.plan(camera,origin,quality)
    if(Math.hypot(camera.position.x+origin.x-this.buildCamera.x,camera.position.z+origin.z-this.buildCamera.z)>32)this.dirty=true
    for(const id of this.suppressed)if(!this.ownership.hasRepresentation(id)){this.suppressed.delete(id);this.dirty=true}
    // Suppress an old far representation as soon as the near pool owns its stable ID.
    for(const [id,slot] of this.submission)if(this.ownership.hasRepresentation(id)){
      this.zero.toArray(slot.pool.matrix.array,slot.index*16);slot.pool.matrix.addUpdateRange(slot.index*16,16);slot.pool.matrix.needsUpdate=true;this.submission.delete(id);this.suppressed.add(id)
    }
    }
    if(budget)budget.measure('canopy.ownership',ownership);else ownership()
    const prepare=()=>{
      if(!canStart())return
      const target=this.wanted.find(t=>!this.cache.has(t.key));if(!target)return
      const run=()=>{
        const remaining=VISIBILITY_PROFILES[quality].maxCanopyCandidates-[...this.cache.values()].reduce((n,t)=>n+t.props.length,0)
        const props=this.source.scatter(target.address).filter(p=>p.kind==='plant').slice(0,Math.max(0,remaining))
        this.cache.set(target.key,{address:target.address,props});this.dirty=true
      }
      if(budget)budget.measure('canopy.scatter',run,0,1);else run()
    }
    const compact=()=>{
      if(!canStart())return
      const run=()=>{
        if(!this.building){
          if(!this.dirty)return;this.dirty=false
          this.candidates=[...this.cache.values()].flatMap(t=>t.props);this.cursor=0;this.commitIndex=0;this.building=true;this.buildOrigin={...origin};this.buildQuality=quality
          this.buildCamera={x:camera.position.x+origin.x,y:camera.position.y,z:camera.position.z+origin.z};this.buildRange=VISIBILITY_PROFILES[quality].canopyVisible
          for(const p of this.pools.values()){p.nextIds=[];p.count=0}
        }
        const start=this.cursor
        while(this.cursor<this.candidates.length&&this.cursor-start<1024){
          if((this.cursor-start)%32===0&&!canStart())break
          const prop=this.candidates[this.cursor++]!
          // Thin the same source trees by coherent woodland patches, not new random positions.
          const woodland=this.clustered?this.source.noise?.(prop.x/600,prop.z/600,71):undefined
          const t=woodland===undefined?1:Math.max(0,Math.min(1,(woodland-.32)/.38))
          const cluster=.3+.7*t*t*(3-2*t)
          if(prop.priority>=(this.buildQuality==='low'?.55:.85)*cluster)continue
          if(this.ownership.hasRepresentation(prop.id)){this.suppressed.add(prop.id);continue}
          const dx=prop.x-this.buildCamera.x,dz=prop.z-this.buildCamera.z;if(dx*dx+dz*dz>this.buildRange*this.buildRange)continue
          const d=dimensions(prop),pool=this.pools.get(d.asset);if(!pool)continue
          // Retain a complete 360-degree canopy. Turning never waits for a CPU rebuild.
          if(pool.count>=CAPACITY){this.metrics.overflow++;continue}
          let ground=this.ground.get(prop.id);if(ground===undefined){ground=this.ownership.surface(prop.x,prop.z);this.ground.set(prop.id,ground)}
          this.transform.position.set(prop.x-this.buildOrigin.x,ground,prop.z-this.buildOrigin.z);this.transform.rotation.set(0,prop.yaw,0);this.transform.scale.setScalar(d.scale);this.transform.updateMatrix()
          this.transform.matrix.toArray(pool.staging,pool.count*16);pool.nextIds.push(prop.id);pool.count++
        }
        this.metrics.compactionFrames++
        if(this.cursor===this.candidates.length){
          const pools=[...this.pools.values()]
          while(this.commitIndex<pools.length){
            const pool=pools[this.commitIndex]!,bytes=pool.count*16*4
            if(budget&&!budget.canStart(.04,bytes))break
            const commit=()=>{
              for(const id of pool.ids)this.submission.delete(id)
              // Near ownership can change while preparation spans frames.
              let retained=0
              for(let index=0;index<pool.nextIds.length;index++){const id=pool.nextIds[index]!;if(this.ownership.hasRepresentation(id)){this.suppressed.add(id);continue}
                if(retained!==index)pool.staging.copyWithin(retained*16,index*16,index*16+16)
                pool.nextIds[retained++]=id
              }
              pool.nextIds.length=retained;pool.count=retained
              pool.matrix.array.set(pool.staging.subarray(0,pool.count*16));pool.matrix.clearUpdateRanges();if(pool.count)pool.matrix.addUpdateRange(0,pool.count*16);pool.matrix.needsUpdate=true;pool.ids=pool.nextIds
              pool.ids.forEach((id,index)=>this.submission.set(id,{pool,index}));pool.origin={...this.buildOrigin}
              for(const mesh of pool.meshes){mesh.count=pool.count;mesh.position.set(pool.origin.x-origin.x,0,pool.origin.z-origin.z)}
              this.commitIndex++
            }
            if(budget)budget.measure('canopy.upload',commit,bytes);else commit()
          }
          this.metrics.submitted=pools.reduce((n,p)=>n+(p.meshes[0]?.count??0),0);this.metrics.visible=this.submission.size
          this.metrics.drawCalls=pools.reduce((n,p)=>n+(p.meshes[0]?.count?p.meshes.length:0),0)
          if(this.commitIndex===pools.length)this.building=false
        }
      }
      if(budget)budget.measure('canopy.compact',run);else run()
    }
    if(this.frame%2===0){compact();prepare()}else{prepare();compact()}
    this.metrics.tiles=this.cache.size;this.metrics.candidates=[...this.cache.values()].reduce((n,t)=>n+t.props.length,0);this.metrics.live=this.submission.size
    this.metrics.pendingTiles=this.wanted.filter(t=>!this.cache.has(t.key)).length;this.metrics.prepareMs=performance.now()-started
  }
  dispose(){if(this.disposed)return;this.disposed=true;this.root.removeFromParent();for(const pool of this.pools.values())for(const mesh of pool.meshes)mesh.dispose();this.root.clear();this.pools.clear();this.cache.clear();this.submission.clear();this.ground.clear();this.suppressed.clear();this.candidates=[];this.wanted=[]}
}
