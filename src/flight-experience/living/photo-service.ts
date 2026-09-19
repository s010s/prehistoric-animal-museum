export interface Photo { url: string; width: number; height: number; frame: number; sun: number; weather: string }
export type PhotoState = { status: 'idle'|'waiting'|'encoding'|'error'; photos: readonly Photo[] }
/** The host supplies only the completed canvas, never renderer ownership. */
export class PhotoService {
  private generation = 0
  private closed = false
  private encodingBusy = false
  private state: PhotoState = {status:'idle',photos:[]}
  constructor(private readonly changed:()=>void) {}
  getSnapshot = () => this.state
  request() {
    if(this.closed || this.encodingBusy || this.state.status==='waiting' || this.state.status==='encoding')return false
    this.state={...this.state,status:'waiting'};this.changed();return true
  }
  cancel() {this.generation++;this.state={...this.state,status:'idle'};this.changed()}
  completedFrame(canvas:HTMLCanvasElement, metadata:Omit<Photo,'url'|'width'|'height'>) {
    if(this.closed||this.state.status!=='waiting')return
    const token=this.generation
    this.encodingBusy=true
    this.state={...this.state,status:'encoding'};this.changed()
    try {
      const ratio=Math.min(1,1280/Math.max(canvas.width,canvas.height),Math.sqrt(1500000/(canvas.width*canvas.height)))
      if(!Number.isFinite(ratio)||canvas.width<1||canvas.height<1)throw new Error('empty-frame')
      const copy=document.createElement('canvas');copy.width=Math.max(1,Math.floor(canvas.width*ratio));copy.height=Math.max(1,Math.floor(canvas.height*ratio))
      const context=copy.getContext('2d');if(!context)throw new Error('canvas-unavailable')
      // Synchronous copy within renderer.render's callback, before the drawing buffer clears.
      context.drawImage(canvas,0,0,copy.width,copy.height)
      const width=copy.width,height=copy.height
      copy.toBlob(blob=>{
        copy.width=copy.height=0;this.encodingBusy=false
        if(this.closed||token!==this.generation)return
        if(!blob){this.error();return}
        let url:string
        try {url=URL.createObjectURL(blob)} catch {this.error();return}
        const photo={...metadata,width,height,url}
        const photos=[photo,...this.state.photos]
        for(const removed of photos.splice(3))URL.revokeObjectURL(removed.url)
        this.state={status:'idle',photos};this.changed()
      },'image/png')
    } catch {this.encodingBusy=false;if(token===this.generation&&!this.closed)this.error()}
  }
  private error(){this.state={...this.state,status:'error'};this.changed()}
  remove(url:string){URL.revokeObjectURL(url);this.state={...this.state,photos:this.state.photos.filter(p=>p.url!==url)};this.changed()}
  dispose(){if(this.closed)return;this.closed=true;this.generation++;for(const p of this.state.photos)URL.revokeObjectURL(p.url);this.state={status:'idle',photos:[]}}
}
