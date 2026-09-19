import { NaturePanel } from './living/NaturePanel'
import {DEFAULT_LIVING_INTENT,type LivingIntent} from './living/living-context'
import { WeatherPanel } from './WeatherPanel'
import type { WeatherState } from './environment/weather-controller'
import { LightViewpointPanel } from './LightViewpointPanel'
import { WORLD } from './world'
import { DEFAULT_FLIGHT_SETTINGS, type FlightSettings } from './settings'
import { useEffect, useRef, useState, useSyncExternalStore, type PointerEvent } from 'react'
import { ArrowDown, ArrowLeft, ArrowRight, ArrowUp, ChevronLeft, Pause, Play, Settings2, X } from 'lucide-react'
import type { ViewerController, ViewerModelDescriptor } from 'virtual:viewer-controller'
import { useI18n } from '../i18n/I18nProvider'
import { FlightRuntime, type FlightSnapshot } from './FlightRuntime'
import { isFlightShortcutTarget } from './input'
import { flightMessages } from './messages'
import './flight.css'
import { FlightReviewControls } from './FlightReviewControls'
const initial: FlightSnapshot = { phase: 'preparing', reason: null, simplified: false, region: 'coast', gentle: false, assisted: false, quality: 'low', settings: { ...DEFAULT_FLIGHT_SETTINGS } }
const noSubscription = () => () => {}
const initialSnapshot = () => initial
interface Props { controller: ViewerController; descriptor: ViewerModelDescriptor; onClose: () => void; narrationActive?:boolean }
export function FlightExperience({ controller, descriptor, onClose, narrationActive=false }: Props) {
  const { locale, setPreference } = useI18n(), copy = flightMessages[locale]
  const [runtime, setRuntime] = useState<FlightRuntime | null>(null)
  const [retry, setRetry] = useState(0), [settings, setSettings] = useState(false), [observe, setObserve] = useState(false)
  const [section,setSection] = useState<'sunlight'|'flight'|'viewpoints'|'weather'|'nature'>('sunlight')
  const settingsTrigger=useRef<HTMLButtonElement>(null)
  const closeSettings=()=>{setSettings(false);settingsTrigger.current?.focus()}
  const root = useRef<HTMLElement>(null), nudgeTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const descriptorRef = useRef(descriptor)
  const chosenLiving = useRef<LivingIntent>({...DEFAULT_LIVING_INTENT})
  const chosenWeather = useRef<WeatherState | null>(null)
  const chosenSunlight = useRef<number | null>(null)
  const chosenSettings = useRef<FlightSettings>({ ...DEFAULT_FLIGHT_SETTINGS })
  const [draft, setDraft] = useState<FlightSettings>({ ...DEFAULT_FLIGHT_SETTINGS })
  const snapshot = useSyncExternalStore(runtime?.subscribe ?? noSubscription, runtime?.getSnapshot ?? initialSnapshot, initialSnapshot)
  useEffect(()=>{runtime?.setNarrationActive(narrationActive)},[runtime,narrationActive])
  const previousObservation = useRef(snapshot.observation)
  useEffect(() => {
    if (previousObservation.current && previousObservation.current !== 'inactive' && snapshot.observation === 'inactive') settingsTrigger.current?.focus()
    previousObservation.current = snapshot.observation
  }, [snapshot.observation])
  useEffect(() => {
    const instance = new FlightRuntime(controller, window.matchMedia('(prefers-reduced-motion: reduce)').matches, chosenSettings.current, import.meta.env.DEV && [193706,193707,193708].includes(Number(new URLSearchParams(location.search).get('flightSeed'))) ? {...WORLD,seed:Number(new URLSearchParams(location.search).get('flightSeed'))} : WORLD)
    Object.assign(instance.livingIntent,chosenLiving.current)
    if(chosenWeather.current)instance.weather.restore(chosenWeather.current)
    if(chosenSunlight.current!==null)instance.setSolarDayProgress(chosenSunlight.current)
    let active = true
    queueMicrotask(() => { if (active) setRuntime(instance) })
    root.current?.focus()
    instance.setVisibilityState(!document.hidden); instance.setFocusState(document.hasFocus())
    void instance.prepare(descriptorRef.current)
    return () => { active = false; instance.close(); if (nudgeTimer.current) clearTimeout(nudgeTimer.current) }
  }, [controller, retry])
  useEffect(() => {
    if (!runtime) return
    const clear = () => runtime.setFocusState(false)
    const focus = () => runtime.setFocusState(true)
    const visibility = () => runtime.setVisibilityState(!document.hidden)
    const keydown = (event: KeyboardEvent) => {
      if (event.code === 'Escape') {
        event.preventDefault(); event.stopPropagation()
        if (snapshot.reason === 'error') { onClose(); return }
        if (settings) closeSettings(); else if (snapshot.observation && snapshot.observation !== 'inactive') runtime.returnFromViewpoint(); else if (observe) setObserve(false); else onClose()
        return
      }
      if (event.code === 'Tab') {
        const buttons = [...(root.current?.querySelectorAll<HTMLElement>('button:not(:disabled),select,input,[tabindex="0"]') ?? [])].filter(e => e.getClientRects().length > 0)
        const first = buttons[0], last = buttons.at(-1)
        if (event.shiftKey && (document.activeElement === first || document.activeElement === root.current)) { event.preventDefault(); last?.focus() }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus() }
        return
      }
      if (isFlightShortcutTarget(event.target)) return
      if(snapshot.observation && snapshot.observation!=='inactive') {if(event.code==='Space'){event.preventDefault();if(!event.repeat)runtime.toggleScenery()}return}
      if (event.code === 'Space' && !event.repeat) {
        event.preventDefault(); if (snapshot.phase === 'flying') runtime.pause(); else runtime.start()
      }
      if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'KeyW', 'KeyA', 'KeyS', 'KeyD'].includes(event.code)) {
        event.preventDefault(); runtime.input.key(event.code, true)
      }
    }
    const keyup = (event: KeyboardEvent) => runtime.input.key(event.code, false)
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)')
    const changed = () => { if (reduced.matches) runtime.setGentle(true) }
    window.addEventListener('keydown', keydown); window.addEventListener('keyup', keyup)
    window.addEventListener('blur', clear); window.addEventListener('focus', focus); document.addEventListener('visibilitychange', visibility)
    reduced.addEventListener('change', changed)
    return () => {
      window.removeEventListener('keydown', keydown); window.removeEventListener('keyup', keyup)
      window.removeEventListener('blur', clear); window.removeEventListener('focus', focus); document.removeEventListener('visibilitychange', visibility)
      reduced.removeEventListener('change', changed); runtime.input.clear()
    }
  }, [runtime, snapshot.phase, snapshot.reason, snapshot.observation, onClose, settings, observe])
  useEffect(() => {
    if (!runtime || !root.current) return
    const element = root.current
    // Local review telemetry; bounded by the runtime, never sent anywhere.
    const report = () => { element.dataset.flightDiagnostics = JSON.stringify(runtime.diagnostics()) }
    report(); const timer = window.setInterval(report, 2000)
    return () => window.clearInterval(timer)
  }, [runtime])
  const inViewpoint=snapshot.reason !== 'error' && Boolean(snapshot.observation && snapshot.observation!=='inactive')
  const preparingView=snapshot.observation==='preparing'||snapshot.observation==='returning'||snapshot.observation==='failed'
  const flying = snapshot.phase === 'flying'
  const start = () => { setObserve(false); runtime?.start(); root.current?.focus() }
  const stopPointer = (event: PointerEvent<HTMLButtonElement>) => runtime?.input.release(event.pointerId)
  const direction = (event: PointerEvent<HTMLButtonElement>, turn: number, climb: number) => {
    event.preventDefault(); event.currentTarget.setPointerCapture(event.pointerId); runtime?.input.point(turn, climb, event.pointerId)
  }
  const configure = (next: FlightSettings) => { setDraft(next); chosenSettings.current = next; runtime?.configure(next) }
  const restart = (next = draft, resetSunlight = false) => { chosenLiving.current=resetSunlight?{...DEFAULT_LIVING_INTENT}:{...runtime?.livingIntent??DEFAULT_LIVING_INTENT}; if(!resetSunlight&&runtime){runtime.weather.restart();chosenWeather.current=runtime.weather.serialize()}else chosenWeather.current=null; chosenSunlight.current=resetSunlight?null:runtime?.environmentClock.solarDayProgress??null; chosenSettings.current = next; setDraft(next); setSettings(false); setObserve(false); setRetry(n => n + 1) }
  const reason = snapshot.reason === 'terrain' ? copy.terrain : ['safety', 'camera'].includes(snapshot.reason ?? '') ? copy.safety : snapshot.reason === 'context' ? copy.context : snapshot.reason === 'hidden' ? copy.hidden : copy.quiet
  return <section ref={root} className="flight-experience" role="dialog" aria-modal="true" aria-label={copy.title} tabIndex={-1} data-flight-phase={snapshot.phase}>
    <header className="flight-toolbar">
      <button type="button" onClick={onClose}><ChevronLeft size={20}/><span>{copy.back}</span></button>
      <div className="flight-toolbar__right">
        {!inViewpoint && ['flying', 'paused'].includes(snapshot.phase) && <button type="button" disabled={!flying && !runtime?.canResume} onClick={() => flying ? runtime?.pause() : start()}>{flying ? <Pause size={19}/> : <Play size={19}/>}<span>{flying ? copy.pause : copy.resume}</span></button>}
        <button type="button" ref={settingsTrigger} disabled={snapshot.phase==='preparing'||snapshot.phase==='recovering'} aria-label={locale==='zh-CN'?'飞行与风景':'Flight & scenery'} aria-controls="flight-settings-panel" aria-expanded={settings} onClick={()=>{runtime?.input.clear();setSettings(v=>!v)}}><Settings2 size={20}/><span>{locale==='zh-CN'?'飞行与风景':'Flight & scenery'}</span></button>
      </div>
    </header>
    <div className="flight-place" aria-live="polite"><span>{copy.title}</span><strong>{copy.regions[snapshot.region]}</strong>{snapshot.simplified && <small>{copy.simplified}</small>}</div>
    {preparingView && <div className="flight-view-preparing" aria-hidden="true"/>}
    {inViewpoint && !settings && <button className="flight-view-return" type="button" onClick={()=>runtime?.returnFromViewpoint()}>{locale==='zh-CN'?'返回原飞行位置':'Return to flight position'}</button>}
    {snapshot.reason === 'error' ? <section className="flight-card" role="alert"><h1>{copy.error}</h1>{runtime?.canReturnToTravel&&<button type="button" onClick={()=>runtime.returnFromViewpoint()}>{locale==='zh-CN'?'返回原飞行位置':'Return to flight position'}</button>}<button type="button" onClick={()=>restart()}>{copy.retry}</button><button type="button" onClick={onClose}>{copy.back}</button></section> : settings ? <section id="flight-settings-panel" className="flight-card flight-settings" aria-label={locale==='zh-CN'?'飞行与风景':'Flight & scenery'}>
      <div className="flight-card__heading"><h2>{locale==='zh-CN'?'飞行与风景':'Flight & scenery'}</h2><button type="button" aria-label={copy.close} onClick={closeSettings}><X size={20}/></button></div>
      <p className="flight-panel-status">{inViewpoint ? (locale==='zh-CN'?'已停下观景':'Stopped at a viewpoint') : flying ? (locale==='zh-CN'?'飞翔继续中 · 可以边飞边调':'Still flying · adjust as you go') : (locale==='zh-CN'?'飞翔已停下 · 可以安心调整':'Flight stopped · take your time')}</p>
      <div className="flight-panel-sections" role="group" aria-label={locale==='zh-CN'?'设置分类':'Settings sections'}>{(['sunlight','weather','flight','viewpoints','nature'] as const).map((value,i)=><button key={value} type="button" aria-pressed={section===value} onClick={()=>setSection(value)}>{(locale==='zh-CN'?['阳光','天气','飞行','观景','自然动静']:['Sunlight','Weather','Flying','Viewpoints','Nature'])[i]}</button>)}</div>
      {section==='nature'&&runtime&&<NaturePanel runtime={runtime} snapshot={snapshot} locale={locale}/>}
      {section==='weather'&&runtime&&<WeatherPanel runtime={runtime} snapshot={snapshot} locale={locale}/>}
      {(section==='sunlight'||section==='viewpoints')&&runtime&&<LightViewpointPanel runtime={runtime} snapshot={snapshot} locale={locale} mode={section}/>}
      {section==='flight'&&<>
      <label className="flight-setting"><span>{copy.gentle}<small>{copy.gentleHelp}</small></span><input type="checkbox" checked={snapshot.gentle} onChange={e => configure({ ...draft, quality:snapshot.quality, gentle: e.target.checked })}/></label>
      <label className="flight-setting"><span>{copy.quality}<small>{locale==='zh-CN'?'切换画质会短暂停留':'Changing quality briefly stops flight'}</small></span><select disabled={inViewpoint} value={snapshot.quality} onChange={e => configure({ ...draft, gentle:snapshot.gentle, quality: e.target.value === 'balanced' ? 'balanced' : 'low' })}><option value="low">{copy.low}</option><option value="balanced">{copy.balanced}</option></select></label>
      <label className="flight-setting">{copy.speed}<select value={draft.speed} onChange={e => configure({ ...draft, quality:snapshot.quality, gentle:snapshot.gentle, speed: Number(e.target.value) as FlightSettings['speed'] })}>{([18, 28, 36] as const).map((v, i) => <option key={v} value={v}>{copy.speeds[i]}</option>)}</select></label>
      <label className="flight-setting">{copy.camera}<select value={draft.view} onChange={e => configure({ ...draft, quality:snapshot.quality, gentle:snapshot.gentle, view: e.target.value as FlightSettings['view'] })}>{(['near', 'standard', 'wide'] as const).map((v, i) => <option key={v} value={v}>{copy.views[i]}</option>)}</select></label>
      <details className="flight-more"><summary>{locale==='zh-CN'?'换个起点':'Choose a new start'}</summary><fieldset className="flight-restart"><legend>{copy.nextStart}</legend>
        <label className="flight-setting">{copy.startPlace}<select value={draft.start} onChange={e => setDraft({ ...draft, start: e.target.value as FlightSettings['start'] })}>{(['coast', 'valley', 'overview'] as const).map((v, i) => <option key={v} value={v}>{copy.starts[i]}</option>)}</select></label>
        <label className="flight-setting">{copy.height}<select value={draft.height} onChange={e => setDraft({ ...draft, height: Number(e.target.value) as FlightSettings['height'] })}>{([100, 190, 350] as const).map((v, i) => <option key={v} value={v}>{copy.heights[i]}</option>)}</select></label>
        <small>{copy.restartHelp}</small><button type="button" onClick={() => restart()}>{copy.restart}</button>
      </fieldset>
      <button type="button" onClick={() => restart({ ...DEFAULT_FLIGHT_SETTINGS }, true)}>{copy.defaults}</button></details>
      <label className="flight-setting">{copy.language}<select value={locale} onChange={e => setPreference(e.target.value === 'en' ? 'en' : 'zh-CN')}><option value="zh-CN">简体中文</option><option value="en">English</option></select></label>
      </>}
      {inViewpoint&&section!=='viewpoints'&&<button type="button" className="flight-panel-return" onClick={()=>runtime?.returnFromViewpoint()}>{locale==='zh-CN'?'返回原飞行位置':'Return to flight position'}</button>}
      {!inViewpoint&&!flying&&runtime?.canResume&&<button type="button" className="flight-primary flight-panel-return" onClick={()=>{closeSettings();start()}}>{snapshot.phase==='ready'?copy.start:copy.resume}</button>}
    </section> : !flying && !inViewpoint && <section className="flight-card flight-intro" aria-live="polite">
      <span className="flight-eyebrow">{copy.title} · PTERANODON</span>
      <h1>{snapshot.phase === 'buffering' ? copy.terrain : snapshot.phase === 'preparing' ? copy.preparing : snapshot.phase === 'recovering' ? copy.error : observe ? copy.observation : snapshot.phase === 'ready' ? copy.ready : copy.paused}</h1>
      <p>{observe ? copy.observeText : snapshot.phase === 'ready' ? copy.subtitle : reason}</p>
      {snapshot.phase === 'ready' && <p className="flight-instructions">{copy.instruction}</p>}
      {snapshot.phase !== 'preparing' && <div className="flight-card__actions">
        {runtime?.canResume && <button type="button" className="flight-primary" onClick={start}><Play size={18}/>{snapshot.phase === 'ready' ? copy.start : copy.resume}</button>}
        {(snapshot.phase === 'recovering' || ['safety', 'camera', 'terrain'].includes(snapshot.reason ?? '')) && <button type="button" className="flight-primary" onClick={() => restart()}>{copy.retry}</button>}
        <button type="button" onClick={() => setObserve(v => !v)}>{copy.static}</button>
      </div>}
      <small>{copy.art}</small>
    </section>}
    {import.meta.env.DEV && runtime && !inViewpoint && !settings && <FlightReviewControls runtime={runtime}/>}
    {flying && <>
      <div className="flight-direction-pad" role="group" aria-label={copy.directions}>
        {([{ label: copy.up, icon: ArrowUp, turn: 0, climb: 1, position: 'up' }, { label: copy.left, icon: ArrowLeft, turn: -1, climb: 0, position: 'left' }, { label: copy.down, icon: ArrowDown, turn: 0, climb: -1, position: 'down' }, { label: copy.right, icon: ArrowRight, turn: 1, climb: 0, position: 'right' }]).map(({ label, icon: Icon, turn, climb, position }) => <button type="button" key={position} className={`flight-direction flight-direction--${position}`} aria-label={label}
          onPointerDown={e => direction(e, turn, climb)} onPointerUp={stopPointer} onPointerCancel={stopPointer} onLostPointerCapture={stopPointer}
          onClick={e => { if (e.detail === 0) { runtime?.input.point(turn, climb); if (nudgeTimer.current) clearTimeout(nudgeTimer.current); nudgeTimer.current = setTimeout(() => runtime?.input.release(-1), 300) } }}><Icon size={24}/></button>)}
      </div>
      <div className="flight-assist"><button type="button" onClick={() => { runtime?.assist(); root.current?.focus() }}>{copy.assist}</button>{snapshot.assisted && <small>{copy.assisting}</small>}</div>
    </>}
  </section>
}
