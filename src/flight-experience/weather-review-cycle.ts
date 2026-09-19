import type { FlightRuntime } from './FlightRuntime'
import { WeatherController } from './environment/weather-controller'
import { recordFlightReview } from './review-recording'
import { captureBrowserMetadata } from './review-browser'
/** Real wall-time segmented video and 1Hz telemetry; never advances the simulation. */
export async function recordWeatherCycle(runtime:FlightRuntime):Promise<string>{
 if(runtime.observation.phase!=='active'||runtime.observation.sceneryPaused)throw new Error('Choose and resume a viewpoint first')
 runtime.weather.restore(new WeatherController().serialize());runtime.setWeatherMode('auto');runtime.restartDaylightFromMorning()
 const frames:Record<string,unknown>[]=[],events:Record<string,unknown>[]=[],videos:string[]=[]
 const sample=()=>frames.push({at:new Date().toISOString(),...runtime.diagnostics()})
 const event=()=>events.push({at:new Date().toISOString(),hidden:document.hidden,focused:document.hasFocus()})
 let saved:boolean
 const interval=setInterval(sample,1000);sample();event()
 document.addEventListener('visibilitychange',event);window.addEventListener('focus',event);window.addEventListener('blur',event)
 try{
  for(let segment=0;segment<40;segment++){
   if(!runtime.scene.children.length)throw new Error('Scene closed during recording')
   videos.push(await recordFlightReview(30))
   if(runtime.weather.snapshot().rainSeconds>=630)break
  }
 }finally{
  clearInterval(interval);document.removeEventListener('visibilitychange',event);window.removeEventListener('focus',event);window.removeEventListener('blur',event);sample()
  const result=await fetch('/__flight-review/trace',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({schema:'flight-frame-trace-v1',route:'manual',kind:'W1-real-time-cycle-1Hz',...captureBrowserMetadata(),events,videos,frames})})
  saved=result.ok
 }
 if(!saved)throw new Error('Cycle evidence save failed')
 return `W1 cycle saved: ${videos.length} real-time segments; ${frames.length} samples`
}
