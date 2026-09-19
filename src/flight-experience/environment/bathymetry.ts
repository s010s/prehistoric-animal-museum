/** Packed RG height, metres. Nearest texels are decoded then bilinearly interpolated. */
export const DEPTH_MIN=-128, DEPTH_RANGE=1024, DEPTH_SIZE=130, DEPTH_STEP=8
export interface CoverageRect { minX:number;minZ:number;maxX:number;maxZ:number }
export interface SurfaceSnapshot {
  readonly worldKey:string
  readonly epoch:number
  readonly topologyLayoutId:string
  readonly worldOrigin?:{x:number;z:number}
  /** Stable local identity; unlike epoch, unchanged outside the queried rectangle. */
  contentKey?(rect:CoverageRect):string
  sampleHeight(x:number,z:number):number
  release():void
}
export interface BathymetryBudget {
  remainingMs?():number
  canStart(estimatedMs?:number,bytes?:number,objects?:number):boolean
  measure<T>(label:string,fn:()=>T,bytes?:number,objects?:number):T
}
export interface BathymetryOptions {
  captureSurface?:(rect:CoverageRect)=>SurfaceSnapshot
  surfaceRevision?:number
  allowPublish?:boolean
  presentationSeconds?:number
  budget?:BathymetryBudget
}
export interface DepthPublication {
  worldKey:string;epoch:number;topologyLayoutId:string;coverageRect:CoverageRect
  worldOrigin:{x:number;z:number};gpuValid:boolean;dirtyRects:CoverageRect[]
}
export function encodeHeight(height:number):readonly[number,number]{const code=Math.round(Math.max(0,Math.min(1,(height-DEPTH_MIN)/DEPTH_RANGE))*65535);return[Math.floor(code/256),code%256]}
export function decodeHeight(r:number,g:number){return DEPTH_MIN+(r*256+g)/65535*DEPTH_RANGE}
export function coverageWeight(x:number,z:number,rect:CoverageRect,guard=64){const edge=Math.min(x-rect.minX,z-rect.minZ,rect.maxX-x,rect.maxZ-z),t=Math.max(0,Math.min(1,edge/guard));return t*t*(3-2*t)}
interface Page {x:number;z:number;width:number;height:number;key:string;rect:CoverageRect}
/** One pinned display epoch per preparation. Updates reuse unchanged 128m pages. */
export class BathymetryField {
  readonly data=new Uint8Array(DEPTH_SIZE*DEPTH_SIZE*4)
  readonly previousData=new Uint8Array(this.data.length)
  private readonly pending=new Uint8Array(this.data.length)
  startX=Infinity;startZ=Infinity;previousX=Infinity;previousZ=Infinity;revision=0;blend=1;pendingAgeFrames=0;starvedFrames=0
  publication:DepthPublication|null=null
  constructor(readonly step=DEPTH_STEP){}
  private snapshot:SurfaceSnapshot|null=null
  private disposed=false
  private pages:Page[]=[]
  private keys=new Map<string,string>()
  private nextKeys=new Map<string,string>()
  private pageIndex=0;private pixel=0;private pendingX=0;private pendingZ=0
  private requestedRevision=-1;private ready=false;private transitionStart=0
  private dirtyRects:CoverageRect[]=[]
  get busy(){return this.snapshot!==null&&!this.ready}
  get prepared(){return this.ready}
  dispose(){this.disposed=true;this.snapshot?.release();this.snapshot=null;this.ready=false}
  update(x:number,z:number,surface:(x:number,z:number)=>number,budgetMs=1,options:BathymetryOptions={}):number{
    if(this.disposed)return 0
    const allow=options.allowPublish!==false,time=options.presentationSeconds??0
    if(this.snapshot&&!this.ready)this.pendingAgeFrames++
    if(allow&&this.blend<1)this.blend=Math.min(1,Math.max(0,(time-this.transitionStart)/.35))
    const sx=Math.floor(x/(this.step*16))*(this.step*16)-this.step*64,sz=Math.floor(z/(this.step*16))*(this.step*16)-this.step*64,epoch=options.surfaceRevision??0
    if(!this.snapshot&&this.blend>=1&&(sx!==this.startX||sz!==this.startZ||epoch!==this.requestedRevision)){
      if(options.budget&&!options.budget.canStart(.03,0,1)){this.starvedFrames++;return 0}
      const prepare=()=>{
      const rect={minX:sx,minZ:sz,maxX:sx+(DEPTH_SIZE-1)*this.step,maxZ:sz+(DEPTH_SIZE-1)*this.step}
      // Without a capture provider the callback contract is immutable world data only.
      this.snapshot=options.captureSurface?.(rect)??{worldKey:'immutable-world',epoch,topologyLayoutId:'world-grid',sampleHeight:surface,release(){}}
      this.pendingX=sx;this.pendingZ=sz;this.requestedRevision=epoch;this.pageIndex=0;this.pixel=0;this.ready=false;this.pages=[];this.nextKeys=new Map();this.dirtyRects=[]
      const sameOrigin=sx===this.startX&&sz===this.startZ
      if(sameOrigin)this.pending.set(this.data)
      for(let pz=0;pz<DEPTH_SIZE;pz+=16)for(let px=0;px<DEPTH_SIZE;px+=16){
        const width=Math.min(16,DEPTH_SIZE-px),height=Math.min(16,DEPTH_SIZE-pz)
        const pageRect={minX:sx+px*this.step,minZ:sz+pz*this.step,maxX:sx+(px+width-1)*this.step,maxZ:sz+(pz+height-1)*this.step}
        const id=`${px},${pz}`,key=this.snapshot.contentKey?.(pageRect)??`${this.snapshot.worldKey}:${this.snapshot.epoch}:${this.snapshot.topologyLayoutId}`
        this.nextKeys.set(id,key)
        if(!sameOrigin||this.keys.get(id)!==key){this.pages.push({x:px,z:pz,width,height,key,rect:pageRect});this.dirtyRects.push(pageRect)}
      }
      if(this.pages.length===0){this.snapshot.release();this.snapshot=null;return}
      }
      if(options.budget)options.budget.measure('bathymetry.snapshot',prepare,0,1);else prepare()
    }
    if(!this.snapshot)return 0
    const started=performance.now(),localLimit=Math.min(budgetMs,options.budget?.remainingMs?.()??Infinity);let count=0
    const work=()=>{
      while(this.pageIndex<this.pages.length&&count<520){
        if(count%16===0&&((count>0&&performance.now()-started>=localLimit)||(options.budget&&!options.budget.canStart())))break
        const p=this.pages[this.pageIndex]!,col=p.x+this.pixel%p.width,row=p.z+Math.floor(this.pixel/p.width),i=(row*DEPTH_SIZE+col)*4
        const[r,g]=encodeHeight(this.snapshot!.sampleHeight(this.pendingX+col*this.step,this.pendingZ+row*this.step))
        this.pending[i]=r;this.pending[i+1]=g;this.pending[i+3]=255;count++;this.pixel++
        if(this.pixel===p.width*p.height){this.pageIndex++;this.pixel=0}
      }
    }
    if(!this.ready){if(options.budget)options.budget.measure('bathymetry.prepare',work);else work()}
    if(!this.ready&&count===0)this.starvedFrames++
    if(this.pageIndex===this.pages.length)this.ready=true
    if(this.ready&&(allow||this.revision===0)&&(!options.budget||options.budget.canStart(.04,this.data.byteLength,0))){
      const publish=()=>{
        this.previousData.set(this.data);this.previousX=this.startX;this.previousZ=this.startZ
        this.data.set(this.pending);this.startX=this.pendingX;this.startZ=this.pendingZ;this.revision++
        this.blend=this.revision===1?1:0;this.transitionStart=time;this.keys=this.nextKeys
        this.publication={worldKey:this.snapshot!.worldKey,epoch:this.snapshot!.epoch,topologyLayoutId:this.snapshot!.topologyLayoutId,
          coverageRect:{minX:this.startX,minZ:this.startZ,maxX:this.startX+(DEPTH_SIZE-1)*this.step,maxZ:this.startZ+(DEPTH_SIZE-1)*this.step},
          worldOrigin:this.snapshot!.worldOrigin??{x:0,z:0},gpuValid:true,dirtyRects:this.dirtyRects}
        this.snapshot!.release();this.snapshot=null;this.ready=false;this.pendingAgeFrames=0
      }
      if(options.budget)options.budget.measure('bathymetry.publish',publish,this.data.byteLength,0);else publish()
    }
    return count
  }
}
