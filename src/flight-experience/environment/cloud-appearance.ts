/** Optional data readiness never advances presentation. Uses the runtime's effective motion clock. */
export class CloudAppearance {
  dataReady=false
  appearanceWeight=0
  private elapsed=0
  private previousMotion:number|null=null
  markDataReady(){this.dataReady=true}
  update(motionSeconds:number,enabled=true){
    const delta=this.previousMotion===null?0:Math.max(0,motionSeconds-this.previousMotion)
    this.previousMotion=motionSeconds
    if(this.dataReady&&enabled){
      this.elapsed=Math.min(2,this.elapsed+delta)
      const t=this.elapsed/2
      this.appearanceWeight=t*t*(3-2*t)
    }
    return this.appearanceWeight
  }
}
