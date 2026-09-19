import { admittedEnvironmentDelta, type ClockPolicy } from './environment-clock'
export const WEATHER_PRESETS = ['clear', 'fair', 'overcast', 'light-rain'] as const
export type WeatherPreset = typeof WEATHER_PRESETS[number]
export type WeatherMode = 'fixed' | 'auto'
export interface ResolvedWeather { coverage:number; thickness:number; haze:number; rain:number; curtain:number }
export interface WeatherState {
  version:1; mode:WeatherMode; target:WeatherPreset|null; resolved:ResolvedWeather
  from:ResolvedWeather; elapsed:number; duration:number; sequence:number
  phase:[number,number]; wetness:number; rainSeconds:number
}
export const WEATHER_TARGETS:Record<WeatherPreset,ResolvedWeather> = {
  clear:{coverage:0,thickness:0,haze:0,rain:0,curtain:0},
  fair:{coverage:.30,thickness:1.7,haze:.035,rain:0,curtain:0},
  overcast:{coverage:.9,thickness:3,haze:.55,rain:0,curtain:0},
  'light-rain':{coverage:.98,thickness:3.8,haze:.8,rain:.32,curtain:.45},
}
const copy=(v:ResolvedWeather)=>({...v})
const smooth=(v:number)=>{const t=Math.max(0,Math.min(1,v));return t*t*(3-2*t)}
export const CLOUD_PERIOD=65536
export const wrapCloud=(v:number)=>((v%CLOUD_PERIOD)+CLOUD_PERIOD)%CLOUD_PERIOD
const stages=[{at:45,target:'fair',duration:25},{at:150,target:'overcast',duration:30},{at:225,target:'light-rain',duration:25},{at:295,target:'fair',duration:45},{at:410,target:'clear',duration:45}] as const
export class WeatherController {
  private state:WeatherState={version:1,mode:'fixed',target:'clear',resolved:copy(WEATHER_TARGETS.clear),from:copy(WEATHER_TARGETS.clear),elapsed:0,duration:0,sequence:0,phase:[0,0],wetness:0,rainSeconds:0}
  snapshot(active=true){return {...this.serialize(),status:!active?'suspended':this.state.elapsed<this.state.duration?'transitioning':'stable'} as const}
  serialize():WeatherState{return {...this.state,resolved:copy(this.state.resolved),from:copy(this.state.from),phase:[...this.state.phase]}}
  restore(value:WeatherState){
    if(value.version!==1||!['fixed','auto'].includes(value.mode)|| (value.target!==null&&!WEATHER_PRESETS.includes(value.target)))return false
    if(![...[value.resolved,value.from].flatMap(v=>[v.coverage,v.thickness,v.haze,v.rain,v.curtain]),value.elapsed,value.duration,value.sequence,...value.phase,value.wetness,value.rainSeconds].every(Number.isFinite))return false
    if(value.wetness<0||value.wetness>1||value.duration<0||value.elapsed<0||value.sequence<0||value.sequence>=480||value.rainSeconds<0)return false
    for(const v of [value.resolved,value.from])if(v.coverage<0||v.coverage>1||v.thickness<0||v.thickness>4||v.haze<0||v.haze>1||v.rain<0||v.rain>1||v.curtain<0||v.curtain>1)return false
    this.state={...value,resolved:copy(value.resolved),from:copy(value.from),phase:[wrapCloud(value.phase[0]),wrapCloud(value.phase[1])]};return true
  }
  restart(){this.state.mode='fixed';this.state.target=null;this.state.duration=0;this.state.elapsed=0;this.state.from=copy(this.state.resolved)}
  setTarget(target:WeatherPreset,duration?:number){
    if(!WEATHER_PRESETS.includes(target))return
    this.state.mode='fixed'
    if(this.state.target===target)return
    this.transition(target,duration??(target==='light-rain'||this.state.resolved.rain>0?35:25))
  }
  private transition(target:WeatherPreset,duration:number){this.state.target=target;this.state.from=copy(this.state.resolved);this.state.elapsed=0;this.state.duration=Number.isFinite(duration)?Math.max(.1,duration):25}
  setMode(mode:WeatherMode){
    if(!['fixed','auto'].includes(mode)||this.state.mode===mode)return
    this.state.mode=mode
    if(mode==='auto'){
      const r=this.state.resolved
      this.state.sequence=r.rain>.05?250:r.coverage>.65?180:r.coverage>.1?70:0
    }
  }
  /** DEV static capture only. Production input always transitions on admitted time. */
  capture(target:WeatherPreset){if(!WEATHER_PRESETS.includes(target))return;this.state.target=target;this.state.mode='fixed';this.state.resolved=copy(WEATHER_TARGETS[target]);this.state.from=copy(this.state.resolved);this.state.duration=0;this.state.elapsed=0}
  tick(delta:number,policy:ClockPolicy,freeze={clouds:false,weather:false},wind:readonly[number,number]=[12,4]){
    const dt=policy.advanceEnvironmentMotion?admittedEnvironmentDelta(delta):0
    if(!dt)return
    if(!freeze.clouds&&wind.every(Number.isFinite))this.state.phase=[wrapCloud(this.state.phase[0]+wind[0]*dt),wrapCloud(this.state.phase[1]+wind[1]*dt)]
    if(freeze.weather)return
    this.state.rainSeconds+=dt
    if(this.state.mode==='auto'){
      const before=this.state.sequence, next=before+dt
      for(const stage of stages)if(before<stage.at&&next>=stage.at)this.transition(stage.target,stage.duration)
      this.state.sequence=next>=480?next-480:next
    }
    if(this.state.target&&this.state.elapsed<this.state.duration){
      this.state.elapsed=Math.min(this.state.duration,this.state.elapsed+dt)
      const p=this.state.elapsed/this.state.duration,to=WEATHER_TARGETS[this.state.target],from=this.state.from
      for(const k of Object.keys(to) as (keyof ResolvedWeather)[]){
        const t=k==='rain'?(to.rain>from.rain?smooth((p-.58)/.42):smooth(p/.3)):k==='curtain'&&to.curtain>from.curtain?smooth((p-.32)/.68):smooth(p)
        this.state.resolved[k]=from[k]+(to[k]-from[k])*t
      }
    }
    const rain=this.state.resolved.rain/.32
    this.state.wetness=Math.max(0,Math.min(1,this.state.wetness+dt*(rain/45-(1-rain)/180)))
  }
}
