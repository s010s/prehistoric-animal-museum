/** Presentation-only state machine. No simulation position, speed or clock writes. */
export class FlightAnimationController {
 state:'PoweredFlap'|'Glide'='Glide'
 poweredWeight=0
 private releasedFor=0
 update(dt:number,manualClimb:number,targetClimb:number,active=true){
  if(!active||dt<=0)return this.poweredWeight
  const wantsLift=manualClimb>.08||targetClimb>.5
  this.releasedFor=wantsLift?0:this.releasedFor+dt
  if(wantsLift)this.state='PoweredFlap'
  else if(this.releasedFor>.65)this.state='Glide'
  const target=this.state==='PoweredFlap'?1:0,duration=target? .25:.65
  this.poweredWeight+=Math.sign(target-this.poweredWeight)*Math.min(Math.abs(target-this.poweredWeight),dt/duration)
  return this.poweredWeight
 }
}
