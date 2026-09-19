import { useState } from 'react'
import { DAYLIGHT_START, DAYLIGHT_END } from './environment/environment-clock'
import type { FlightRuntime, FlightSnapshot } from './FlightRuntime'
import { solarProgress, type SolarPreset } from './environment/environment-state'
const copy = {
 'zh-CN': {title:'阳光与观景',close:'收起面板',sea:'向海 · 120 米',cliff:'海崖 · 210 米',waterline:'海面 · 1.6 米',morning:'晨光',afternoon:'午后',evening:'夕照',time:'白昼进度',pause:'暂停景色',resume:'继续景色',back:'返回原飞行位置',preparing:'正在准备观景点…',returning:'正在准备原飞行位置…',failed:'风景未能及时准备好。可换一个机位，或返回原位置。',active:'观景中 · 飞行已暂停',help:'选择机位会暂时停下飞翔。返回原位置后，可继续飞翔。'},
 en:{title:'Light & viewpoints',close:'Hide panel',sea:'Seaward · 120 m',cliff:'Cliffs · 210 m',waterline:'Waterline · 1.6 m',morning:'Morning',afternoon:'Afternoon',evening:'Sunset',time:'Daylight progress',pause:'Pause scenery',resume:'Resume scenery',back:'Return to flight position',preparing:'Preparing viewpoint…',returning:'Preparing your flight position…',failed:'The scenery could not be prepared in time. Choose another view or return.',active:'Observing · flight paused',help:'Choosing a viewpoint pauses flight. Return to your position, then continue flying.'},
} as const
export function LightViewpointPanel({runtime,snapshot,locale,mode='sunlight'}:{runtime:FlightRuntime;snapshot:FlightSnapshot;mode?:'sunlight'|'viewpoints';locale:'en'|'zh-CN'}) {
 const [recording,setRecording]=useState(false),[evidenceStatus,setEvidenceStatus]=useState('')
 const daylight=snapshot.daylight, automatic=daylight?.mode==='auto'
 const percent=Math.round(((snapshot.solarDayProgress??.68)-DAYLIGHT_START)/(DAYLIGHT_END-DAYLIGHT_START)*100)
 const status=daylight?.status??'idle'
 const statusText=locale==='zh-CN'?{idle:'固定时刻',running:'白昼正在前进',suspended:'白昼已暂停，继续飞翔或景色后恢复',ended:'已停留在夕照'}[status]:{idle:'Fixed time',running:'Daylight is advancing',suspended:'Daylight paused; resume flight or scenery to continue',ended:'Holding at sunset'}[status]
 const t=copy[locale],phase=snapshot.observation??'inactive',preparing=phase==='preparing'||phase==='returning'
 return <section className="flight-light-content" aria-label={mode==='sunlight'?t.time:t.title}>
  {mode==='viewpoints'&&<><p>{t.help}</p>
  <div className="flight-light-options" role="group" aria-label={t.title}>
   <button type="button" aria-pressed={phase!=='inactive'&&snapshot.viewpoint==='seaward'} onClick={()=>runtime.enterViewpoint('seaward')}>{t.sea}</button>
   <button type="button" aria-pressed={phase!=='inactive'&&snapshot.viewpoint==='cliff'} onClick={()=>runtime.enterViewpoint('cliff')}>{t.cliff}</button>
   <button type="button" aria-pressed={phase!=='inactive'&&snapshot.viewpoint==='waterline'} onClick={()=>runtime.enterViewpoint('waterline')}>{t.waterline}</button>
  </div>
  </>}
  {mode==='sunlight'&&<>
  <div className="flight-light-options" role="group" aria-label={locale==='zh-CN'?'阳光模式':'Sunlight mode'}>
   <button type="button" aria-pressed={!automatic} onClick={()=>runtime.setSolarMode('fixed')}>{locale==='zh-CN'?'固定时刻':'Fixed time'}</button>
   <button type="button" aria-pressed={automatic} onClick={()=>runtime.setSolarMode('auto')}>{locale==='zh-CN'?'自动白昼':'Automatic daylight'}</button>
  </div>
  <small>{locale==='zh-CN'?'从当前时刻继续，完整白昼约10分钟。手动调节会切回固定时刻。':'Continues from here; a full daylight sequence takes about 10 minutes. Manual adjustments switch back to a fixed time.'}</small>
  <p role="status">{statusText}</p>
  {status==='ended'&&<button type="button" onClick={()=>runtime.restartDaylightFromMorning()}>{locale==='zh-CN'?'从晨光重新播放白昼':'Replay daylight from morning'}</button>}
  <div className="flight-light-options" role="group" aria-label={t.time}>{(['morning','afternoon','evening'] as SolarPreset[]).map(p=><button type="button" key={p} disabled={preparing} aria-pressed={Math.abs((snapshot.solarDayProgress??.42)-solarProgress(p))<.001} onClick={()=>runtime.setSolarDayProgress(solarProgress(p))}>{t[p as 'morning'|'afternoon'|'evening']}</button>)}</div>
  <label className="flight-light-range">{t.time}<input type="range" min={DAYLIGHT_START} max={DAYLIGHT_END} aria-valuetext={`${t.time} ${percent}%`} step="0.005" disabled={preparing} value={snapshot.solarDayProgress??.42} onChange={e=>runtime.setSolarDayProgress(Number(e.target.value))}/></label>
  <small>{locale==='zh-CN'?'即时生效，不打断飞翔。':'Applies immediately without interrupting flight.'}</small></>}
  {mode==='viewpoints'&&phase!=='inactive'&&<><p role="status">{phase==='failed'?t.failed:preparing?phase==='returning'?t.returning:t.preparing:t.active}</p><div className="flight-light-options">
    {phase==='active'&&<button type="button" onClick={()=>runtime.toggleScenery()}>{snapshot.sceneryPaused?t.resume:t.pause}</button>}
    <button type="button" onClick={()=>runtime.returnFromViewpoint()}>{t.back}</button>
  </div></>}

  {mode==='sunlight'&&import.meta.env.DEV&&<details><summary>{locale==='zh-CN'?'本地验收工具':'Local review tools'}</summary>
   <label><input type="checkbox" defaultChecked={runtime.scenery?.review.highlight??true} onChange={e=>{runtime.setWaterReview('highlight',e.target.checked)}}/>{locale==='zh-CN'?'太阳反射':'Sun reflection'}</label>
   <label><input type="checkbox" defaultChecked={(runtime.scenery?.environment?.fog.uniforms.animalRim.value??1)>0} onChange={e=>runtime.setAnimalRimReview(e.target.checked)}/>{locale==='zh-CN'?'翼龙轮廓光':'Animal rim light'}</label>
   <label><input type="checkbox" defaultChecked={runtime.scenery?.review.flatWater??false} onChange={e=>{runtime.setWaterReview('flatWater',e.target.checked)}}/>{locale==='zh-CN'?'平水面对照':'Flat normals'}</label>
   <button type="button" onClick={()=>{runtime.trace.start();setEvidenceStatus('Trace recording')}}>Start raw trace</button>
   <button type="button" onClick={()=>{runtime.trace.stop();void fetch('/__flight-review/trace',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(runtime.traceEvidence())}).then(async response=>{setEvidenceStatus(response.ok?`Saved locally: ${await response.text()}`:`Save failed: ${response.status}`)}).catch(()=>setEvidenceStatus('Local save unavailable'))}}>Save trace locally</button>
   <button type="button" onClick={()=>runtime.resetReviewMetrics()}>Reset performance sample</button>
   <button type="button" disabled={recording} onClick={()=>{setRecording(true);void import('./review-recording').then(m=>m.recordFlightReview()).then(setEvidenceStatus).catch(e=>setEvidenceStatus(String(e))).finally(()=>setRecording(false))}}>{recording?'Recording 12s…':'Record 12s locally'}</button>
   <button type="button" disabled={recording} onClick={()=>{setRecording(true);void import('./weather-review-cycle').then(m=>m.recordWeatherCycle(runtime)).then(setEvidenceStatus).catch(e=>setEvidenceStatus(String(e))).finally(()=>setRecording(false))}}>Record 10.5m W1 cycle</button>
   <button type="button" onClick={()=>{void import('./weather-review-capture').then(m=>m.saveWeatherCapture(runtime)).then(setEvidenceStatus).catch(e=>setEvidenceStatus(String(e)))}}>Save W1 PBR locally</button>
   {evidenceStatus&&<output>{evidenceStatus}</output>}
  </details>}
 </section>
}
