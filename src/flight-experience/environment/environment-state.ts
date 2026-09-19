import type { WeatherState } from './weather-controller'
import { Color } from 'three'
export type SolarLayout = 'legacy' | 'sunset-bay'
export type SolarPreset = 'morning' | 'noon' | 'afternoon' | 'evening'
export type LinearRGB = readonly [number, number, number]
/** Colours are linear working RGB; intensities are artistic multipliers, positions/metres. */
export interface EnvironmentFrame {
  readonly revision: number
  readonly motionSeconds: number
  readonly solarDayProgress: number
  readonly presentationSeconds: number
  readonly dayProgress: number
  readonly sunDirectionWorld: readonly [number, number, number]
  readonly sunColor: LinearRGB
  readonly sunIntensity: number
  readonly skyZenith: LinearRGB
  readonly horizon: LinearRGB
  readonly skyLow: LinearRGB
  readonly skyMid: LinearRGB
  readonly skyUpper: LinearRGB
  readonly photographicSky: number
  readonly groundFill: LinearRGB
  readonly fillIntensity: number
  readonly windWorld: readonly [number, number]
  readonly waveStrength: number
  readonly visibility: number
  readonly cloudCoverage: number
  readonly cloudBase: number
  readonly cloudThickness: number
  readonly rainRate: number
  readonly wetness: number
}
const rgb = (hex: string): LinearRGB => { const c = new Color(hex); return [c.r,c.g,c.b] }
const looks = {
  morning: { p: .08, sun: [-.88,.29,-.36], color: '#ffddb0', sky: '#649bbf', horizon: '#c6cbd0', intensity: 2.2 },
  noon: { p: .42, sun: [-.25,.94,-.23], color: '#fff6de', sky: '#609fc7', horizon: '#c4d6dd', intensity: 2.8 },
  afternoon: { p: .68, sun: [.63,.65,-.43], color: '#ffe4ba', sky: '#689cbd', horizon: '#cbd3d3', intensity: 2.6 },
  evening: { p: .94, sun: [.91,.18,-.37], color: '#ffc894', sky: '#718baf', horizon: '#dbc5b5', intensity: 1.8 },
} as const
// One photographic palette, continuously sampled with the same global sun.
const photographicLooks = {
  morning: { color:'#ffe0b5',sky:'#567e9f',horizon:'#dec6a2',low:'#d4b7aa',mid:'#a4b2bf',upper:'#7895af',intensity:2.15,fill:1.35 },
  noon: { color:'#fff5e2',sky:'#48789b',horizon:'#bbcdd5',low:'#a9bfcd',mid:'#8bacc2',upper:'#678fab',intensity:2.8,fill:1.6 },
  afternoon: { color:'#ffe3b7',sky:'#526f91',horizon:'#dfc1a0',low:'#cbb5b1',mid:'#a8afc1',upper:'#7b96ae',intensity:2.4,fill:1.4 },
  evening: { color:'#ffda94',sky:'#526e8c',horizon:'#f5a64a',low:'#e98755',mid:'#c996a1',upper:'#7590ac',intensity:1.65,fill:.95 },
} as const
const solarAngles = { morning: [2.55,20], noon: [1.05,78], afternoon: [-.2,38], evening: [-.59,3.2] } as const
const presets: readonly SolarPreset[] = ['morning','noon','afternoon','evening']
export function solarProgress(preset: SolarPreset) { return looks[preset].p }
export function sampleEnvironment(selection: SolarPreset | number = 'afternoon', presentationSeconds = 0, layout: SolarLayout = 'legacy', revision = 0): EnvironmentFrame {
  const progress = typeof selection === 'number' ? Math.max(.08,Math.min(.94,Number.isFinite(selection)?selection:.68)) : looks[selection].p
  const upper = presets.findIndex(p => looks[p].p >= progress)
  const a = presets[Math.max(0,upper-1)]!, b = presets[Math.max(0,upper)]!
  const first = looks[a], last = looks[b]
  const t = first.p === last.p ? 0 : (progress-first.p)/(last.p-first.p)
  const mix = (a:number,b:number) => a+(b-a)*t
  const color = (a:string,b:string):LinearRGB => {const x=rgb(a),y=rgb(b);return x.map((v,i)=>mix(v,y[i]!)) as [number,number,number]}
  const photo=layout==='sunset-bay',pa=photographicLooks[a],pb=photographicLooks[b]
  // Unwrapped artistic azimuth, in one world coordinate system for every observer.
  const heading=mix(solarAngles[a][0],solarAngles[b][0]),elevation=mix(solarAngles[a][1],solarAngles[b][1])*Math.PI/180
  const sun = layout === 'legacy' ? first.sun.map((n,i)=>mix(n,last.sun[i]!)) : [Math.sin(heading)*Math.cos(elevation),Math.sin(elevation),-Math.cos(heading)*Math.cos(elevation)]
  const length=Math.hypot(...sun),motion=Number.isFinite(presentationSeconds)?Math.max(0,presentationSeconds):0
  return Object.freeze({ revision,motionSeconds:motion,solarDayProgress:progress,presentationSeconds:motion,dayProgress:progress,
    sunDirectionWorld:sun.map(n=>n/length) as [number,number,number],sunColor:color(photo?pa.color:first.color,photo?pb.color:last.color),sunIntensity:photo?mix(pa.intensity,pb.intensity):mix(first.intensity,last.intensity),
    skyZenith:color(photo?pa.sky:first.sky,photo?pb.sky:last.sky),horizon:color(photo?pa.horizon:first.horizon,photo?pb.horizon:last.horizon),
    skyLow:color(pa.low,pb.low),skyMid:color(pa.mid,pb.mid),skyUpper:color(pa.upper,pb.upper),photographicSky:Number(photo),
    groundFill:rgb(photo?'#8d8176':'#aaa58e'),fillIntensity:photo?mix(pa.fill,pb.fill):1.65,
    windWorld:[.91,.41] as const,waveStrength:1,visibility:10000,cloudCoverage:0,cloudBase:1400,cloudThickness:300,rainRate:0,wetness:0 })
}

/** CPU counterpart of the shader's diffuse sky, without the solar disc. */
export function sampleSky(frame: EnvironmentFrame, direction: readonly [number,number,number]): LinearRGB {
  const length=Math.hypot(...direction)||1, d=direction.map(v=>v/length),y=Math.max(0,d[1]!)
  const smooth=(a:number,b:number,v:number)=>{const t=Math.max(0,Math.min(1,(v-a)/(b-a)));return t*t*(3-2*t)}
  const blend=(a:LinearRGB,b:LinearRGB,t:number):LinearRGB=>a.map((v,i)=>v+(b[i]!-v)*t) as [number,number,number]
  if(!frame.photographicSky)return blend(frame.horizon,frame.skyZenith,Math.pow(y,.55))
  let c=blend(frame.horizon,frame.skyLow,smooth(0,.055,y))
  c=blend(c,frame.skyMid,smooth(.02,.18,y));c=blend(c,frame.skyUpper,smooth(.10,.36,y));c=blend(c,frame.skyZenith,smooth(.27,.75,y))
  const sun=frame.sunDirectionWorld,denom=Math.hypot(d[0]!, .001, d[2]!)*Math.hypot(sun[0],.001,sun[2])
  const alignment=Math.pow(Math.max(0,(d[0]!*sun[0]+.000001+d[2]!*sun[2])/denom),8)
  const haze=Math.exp(-y/.035)*(.035+.09*alignment)*(1-smooth(.10,.36,sun[1]))
  return c.map((v,i)=>v+[1,.68,.32][i]!*haze) as [number,number,number]
}

/** Clear/dry is exactly the accepted solar frame. Dense weather shares a softer direct / diffuse balance across all scene receivers. */
export function composeWeather(frame:EnvironmentFrame,weather:WeatherState):EnvironmentFrame {
 const w=weather.resolved
 if(w.coverage===0&&weather.wetness===0)return frame
 const dense=Math.max(0,Math.min(1,(w.coverage-.55)/.35)),overcast=dense*dense*(3-2*dense)
 const blend=(a:LinearRGB,b:LinearRGB,t:number):LinearRGB=>a.map((v,i)=>v+(b[i]!-v)*t) as [number,number,number]
 const tint=(v:LinearRGB):LinearRGB=>v.map((n,i)=>n*(1-w.haze*.25)+[.20,.23,.27][i]!*w.haze*.25) as [number,number,number]
 return Object.freeze({...frame,cloudCoverage:w.coverage,cloudBase:2400,cloudThickness:w.thickness,rainRate:w.rain,wetness:weather.wetness,
 sunIntensity:frame.sunIntensity*(1-overcast*.32),groundFill:blend(frame.groundFill,[.18,.19,.22],overcast*.7),
 skyZenith:blend(tint(frame.skyZenith),[.12,.15,.20],overcast*.65),skyLow:tint(frame.skyLow),skyMid:tint(frame.skyMid),skyUpper:tint(frame.skyUpper),horizon:tint(frame.horizon),fillIntensity:frame.fillIntensity*(1+w.haze*.12+overcast*.5),visibility:frame.visibility/(1+w.haze)})
}
