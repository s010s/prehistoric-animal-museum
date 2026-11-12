import {angleDelta} from './camera-rig'
import {cameraCopy} from './camera-messages'
import {FlightChoices} from './FlightChoices'
import type { FlightRuntime, FlightSnapshot } from './FlightRuntime'
export function CameraPanel({runtime,snapshot,locale}:{runtime:FlightRuntime;snapshot:FlightSnapshot;locale:'en'|'zh-CN'}) {
  const c=cameraCopy[locale],state=snapshot.cameraRig, fixed=state?.fixed
  const transitioning=Boolean(state && !state.rejection && (Math.abs(angleDelta(state.resolved.yaw,state.requested.yaw))+Math.abs(state.resolved.pitch-state.requested.pitch)>1e-6))
  return <section className="flight-camera-panel" aria-label={c.title}>
    <h3>{locale==='zh-CN'?'看它飞':'Watch it fly'}</h3><p className="flight-control-help">{fixed?c.fixed:locale==='zh-CN'?'拖动画面换角度 · 滚轮拉近拉远':'Drag to orbit · Scroll to zoom'}</p>
    {!fixed&&<FlightChoices selected={state?.perspective} className="flight-inline-choices">{(['rear','front','left','right'] as const).map((preset,i)=><button key={preset} type="button" data-flight-choice={preset} aria-pressed={state?.perspective===preset} onClick={()=>runtime.selectPerspective(preset)}>{c.presets[i]}</button>)}</FlightChoices>}
    {!fixed&&<label className="flight-camera-distance"><span>{locale==='zh-CN'?'离它多远':'Camera distance'}</span><input aria-label={locale==='zh-CN'?'镜头距离':'Camera distance'} type="range" min="0.72" max="1.7" step="0.01" value={snapshot.settings.zoom??1} onChange={e=>runtime.configure({...snapshot.settings,zoom:Number(e.target.value)})}/><small><span>{locale==='zh-CN'?'近一点':'Closer'}</span><span>{locale==='zh-CN'?'远一点':'Farther'}</span></small></label>}
    <details><summary>{c.adjust}</summary><div className="flight-camera-nudges" role="group" aria-label={c.adjust} onKeyDown={event=>{
      const delta:Record<string,[number,number]>={ArrowLeft:[-.15,0],ArrowRight:[.15,0],ArrowUp:[0,.1],ArrowDown:[0,-.1]}
      const step=delta[event.key];if(step){event.preventDefault();event.stopPropagation();runtime.orbitCamera(step[0],step[1])}
    }}>{([[-.15,0],[.15,0],[0,.1],[0,-.1]] as const).map((step,i)=><button key={i} type="button" onClick={()=>runtime.orbitCamera(step[0],step[1])}>{c.nudges[i]}</button>)}</div></details>
    {fixed&&<button type="button" onClick={()=>runtime.selectPerspective('rear')}>{c.fixedReset}</button>}
    {(state?.rejection||transitioning)&&<p role="status">{state?.rejection?c.blocked:c.transitioning}</p>}
  </section>
}
