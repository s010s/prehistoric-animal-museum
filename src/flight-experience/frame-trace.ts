/** Review-only bounded raw evidence. No network, wall-clock simulation, or frame sorting. */
export interface FlightFrameTrace {
  camera?:Record<string,unknown>;surface?:Record<string,unknown>
  frameId: number; time: number; phase: string; pauseReason: string | null
  position: [number, number, number]; quality: string; deltaMs: number
  cpu: Record<string, number>; budget: Record<string, number>
  terrain: Record<string, unknown>; props: Record<string, unknown>; bathymetry: Record<string, unknown>
  render?: { cpuMs:number; calls:number; triangles:number; geometries:number; textures:number }
  gpuMs: number | null
}
export class FrameTrace {
  active = false
  private rows: FlightFrameTrace[] = []
  private byId = new Map<number, FlightFrameTrace>()
  private cursor = 0
  constructor(readonly capacity = 14400) {}
  start() { this.rows=[];this.byId.clear();this.cursor=0;this.active=true }
  stop() { this.active=false }
  append(row: FlightFrameTrace) {
    if (!this.active) return
    if(this.rows.length===this.capacity){this.byId.delete(this.rows[this.cursor]!.frameId);this.rows[this.cursor]=row;this.cursor=(this.cursor+1)%this.capacity}
    else this.rows.push(row)
    this.byId.set(row.frameId,row)
  }
  gpu(frameId:number,milliseconds:number){const row=this.byId.get(frameId);if(row)row.gpuMs=milliseconds}
  render(frameId:number,data:NonNullable<FlightFrameTrace['render']>){const row=this.byId.get(frameId);if(row)row.render={...data}}
  export(){return this.rows.length<this.capacity?[...this.rows]:[...this.rows.slice(this.cursor),...this.rows.slice(0,this.cursor)]}
  get size(){return this.rows.length}
}
