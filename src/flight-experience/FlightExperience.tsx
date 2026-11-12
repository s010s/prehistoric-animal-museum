import { FLIGHT_SPECIES, type FlightSpeciesProfile } from './species/profiles'
import { CameraInput } from './camera-input'
import { CameraPanel } from './CameraPanel'
import { cameraCopy } from './camera-messages'
import { LanguageMenu } from '../components/LanguageMenu'
import {FlightToggle} from './FlightToggle'
import {useQuietHud} from './useQuietHud'
import { ViewPreparation } from './viewpoints/ViewPreparation'
import { PostcardDock } from './living/PostcardDock'
import { TransientScrollbar } from '../components/TransientScrollbar'
import { useTransientScrollbar } from '../components/useTransientScrollbar'
import { usePanelMotion } from '../components/usePanelMotion'
import { useMovingHighlight } from '../components/useMovingHighlight'
import { drawerCurve, motionTime, playMotion, readOrigin, reducedMotion, type MotionOrigin } from '../motion'
import { ObservationNotes } from './living/ObservationNotes'
import { NaturePanel } from './living/NaturePanel'
import {DEFAULT_LIVING_INTENT,type LivingIntent} from './living/living-context'
import { WeatherPanel } from './WeatherPanel'
import type { WeatherState } from './environment/weather-controller'
import { LightViewpointPanel } from './LightViewpointPanel'
import { WORLD } from './world'
import { DEFAULT_FLIGHT_SETTINGS, type FlightSettings } from './settings'
import { FlightChoices } from './FlightChoices'
import { useFlightDisclosures } from './useFlightDisclosures'
import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore, type PointerEvent } from 'react'
import { ArrowDown, ArrowLeft, ArrowRight, ArrowUp, ChevronLeft, Pause, Play, Settings2, Sun, Binoculars, Feather, CloudSun, Waves, X } from 'lucide-react'
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
const sections = ['scenery', 'viewpoints', 'flight'] as const
export interface FlightRestartPreferences { settings:FlightSettings; living:LivingIntent; weather:WeatherState; sunlight:number }
interface Props { initialPreferences?:FlightRestartPreferences|undefined; onSpeciesChange?:(id:string,preferences:FlightRestartPreferences)=>void; availableSpecies?:readonly FlightSpeciesProfile[]; controller: ViewerController; descriptor: ViewerModelDescriptor; onClose: () => void; narrationActive?:boolean }
export function FlightExperience({ controller, descriptor, onClose, narrationActive=false, initialPreferences, onSpeciesChange, availableSpecies=FLIGHT_SPECIES }: Props) {
  const { locale } = useI18n(), copy = flightMessages[locale]
  const [nextSpecies,setNextSpecies]=useState('')
  const [runtime, setRuntime] = useState<FlightRuntime | null>(null)
  const [retry, setRetry] = useState(0), [settings, setSettings] = useState(false), [observe, setObserve] = useState(false), [galleryOpen,setGalleryOpen]=useState(false)
  const [section,setSection] = useState<(typeof sections)[number]>('scenery')
  const { handleScroll, isScrolling, metrics, scrollRef } = useTransientScrollbar(settings)
  const scrollPositions = useRef({scenery:0,viewpoints:0,flight:0})
  const settingsTrigger=useRef<HTMLButtonElement>(null)
  const settingsPanel=useRef<HTMLElement>(null), settingsOrigin=useRef<MotionOrigin | null>(null)
  const tabs=useRef<HTMLDivElement>(null), tabKeyboard=useRef(false), tabDirection=useRef(0)
  const selectSection = (next: typeof section, keyboard: boolean) => {
    if (next === section) return
    if (scrollRef.current) scrollPositions.current[section] = scrollRef.current.scrollTop
    tabKeyboard.current = keyboard
    tabDirection.current = Math.sign(sections.indexOf(next) - sections.indexOf(section))
    setSection(next)
  }
  const closeSettings=()=>{setSettings(false);settingsTrigger.current?.focus({preventScroll:true})}
  const root = useRef<HTMLElement>(null), nudgeTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const descriptorRef = useRef(descriptor)
  const chosenLiving = useRef<LivingIntent>({...initialPreferences?.living??DEFAULT_LIVING_INTENT})
  const chosenWeather = useRef<WeatherState | null>(initialPreferences?.weather??null)
  const chosenSunlight = useRef<number | null>(initialPreferences?.sunlight??null)
  const chosenSettings = useRef<FlightSettings>({ ...initialPreferences?.settings??DEFAULT_FLIGHT_SETTINGS })
  const [pendingStartDraft, setPendingStartDraft] = useState<Pick<FlightSettings,'start'|'height'>>({
    start: initialPreferences?.settings.start??DEFAULT_FLIGHT_SETTINGS.start,
    height: initialPreferences?.settings.height??DEFAULT_FLIGHT_SETTINGS.height,
  })
  const snapshot = useSyncExternalStore(runtime?.subscribe ?? noSubscription, runtime?.getSnapshot ?? initialSnapshot, initialSnapshot)
  const settingsOpen = settings && snapshot.reason !== 'error'
  const settingsMotion = usePanelMotion({
    open: settingsOpen, panel: settingsPanel, trigger: settingsTrigger, origin: settingsOrigin,
    phone: 390, desktop: 260, easing: drawerCurve, stagger: 25,
  })
  const toggleDisclosure = useFlightDisclosures(settingsOpen && section)
  useMovingHighlight({ root: tabs, selected: settingsOpen ? section : null, attribute: 'data-flight-tab', variant: 'flight-tab', keyboard: tabKeyboard })
  useLayoutEffect(() => {
    if (settingsOpen) tabs.current?.querySelector<HTMLElement>('[aria-selected="true"]')?.focus({ preventScroll: true })
  }, [settingsOpen])
  useLayoutEffect(() => {
    const scroll = scrollRef.current
    const direction = tabDirection.current
    tabDirection.current = 0
    if (!scroll || !settingsOpen) return
    scroll.scrollTop = scrollPositions.current[section]
    const tab = scroll.querySelector<HTMLElement>('.flight-tabpanel:not([hidden])')
    if (!direction || !tab) return
    const frames = reducedMotion() ? [{ opacity: .35 }, { opacity: 1 }] : [
      { opacity: .3, translate: `${direction * 14}px 0` }, { opacity: 1, translate: 'none' },
    ]
    const animation = playMotion(tab, frames, { duration: motionTime(255, 180, tabKeyboard.current), easing: 'ease-in-out' })
    return () => animation?.cancel()
  }, [section, settingsOpen, scrollRef])
  useEffect(()=>{runtime?.setNarrationActive(narrationActive)},[runtime,narrationActive])
  const cameraInteractive=Boolean(!galleryOpen&&(runtime?.canObserveCamera||runtime?.canAttemptResume))
  const cameraLayer = useRef<HTMLDivElement>(null)
  useEffect(()=>{
    const element=cameraLayer.current
    if(!runtime||!element||!cameraInteractive)return
    const input=new CameraInput(element,(yaw,pitch)=>runtime.orbitCamera(yaw,runtime.getSnapshot().cameraRig?.fixed?pitch:-pitch),()=>runtime.cancelCameraInput(),delta=>runtime.zoomCamera(delta))
    return ()=>input.dispose()
  },[runtime,cameraInteractive,snapshot.cameraInputEpoch])
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
      if(event.defaultPrevented)return
      if (event.code === 'Escape') {
        event.preventDefault(); event.stopPropagation()
        if (galleryOpen) { setGalleryOpen(false); root.current?.querySelector<HTMLButtonElement>('button[aria-controls="flight-postcard-gallery"]')?.focus(); return }
        if (snapshot.reason === 'error') { onClose(); return }
        if (settings) closeSettings(); else if (snapshot.observation && snapshot.observation !== 'inactive') runtime.navigateBack(); else if (observe) setObserve(false); else onClose()
        return
      }
      if (event.code === 'Tab') {
        const buttons = [...(root.current?.querySelectorAll<HTMLElement>('button:not(:disabled),select,input,a[href],summary,[tabindex="0"]') ?? [])].filter(e => e.tabIndex >= 0 && !e.matches(':disabled') && !e.closest('[hidden],[inert]') && e.getClientRects().length > 0)
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
  }, [runtime, snapshot.phase, snapshot.reason, snapshot.observation, onClose, settings, observe, galleryOpen])
  useEffect(() => {
    if (!runtime || !root.current) return
    const element = root.current
    // Local review telemetry; bounded by the runtime, never sent anywhere.
    const report = () => { element.dataset.flightDiagnostics = JSON.stringify(runtime.diagnostics()) }
    report(); const timer = window.setInterval(report, 2000)
    return () => window.clearInterval(timer)
  }, [runtime])
  const inViewpoint=snapshot.reason !== 'error' && Boolean(snapshot.observation && snapshot.observation!=='inactive')
  const preparingView=snapshot.viewTransition?.waiting||snapshot.observation==='preparing'||snapshot.observation==='returning'||snapshot.observation==='failed'
  const flying = snapshot.phase === 'flying'
  const canAttemptResume=Boolean(runtime?.canAttemptResume&&!document.hidden)
  const quietViewing=observe&&['ready','paused'].includes(snapshot.phase)&&canAttemptResume
  const hudIdle=useQuietHud(root,Boolean(snapshot.cameraRig&&(snapshot.cameraRig.moving||snapshot.cameraRig.rejection))||settings||galleryOpen||Boolean(preparingView)||Boolean(snapshot.photos?.capture)||['waiting','encoding','error'].includes(snapshot.photos?.status??'')||(!quietViewing&&!flying&&!inViewpoint&&snapshot.phase!=='paused')||(!quietViewing&&Boolean(snapshot.reason&&snapshot.reason!=='user')))
  const start = () => {
    if (document.hidden) return
    root.current?.focus()
    runtime?.restorePresentationFromGesture()
    runtime?.start()
    setSettings(false)
    setObserve(false)
  }
  const stopPointer = (event: PointerEvent<HTMLButtonElement>) => runtime?.input.release(event.pointerId)
  const direction = (event: PointerEvent<HTMLButtonElement>, turn: number, climb: number) => {
    event.preventDefault(); event.currentTarget.setPointerCapture(event.pointerId); runtime?.input.point(turn, climb, event.pointerId)
  }
  const patchLiveSettings = (patch: Partial<FlightSettings>) => {
    const next={...runtime?.getSnapshot().settings??chosenSettings.current,...patch}
    chosenSettings.current=next;runtime?.configure(next)
  }
  const restart = (next = {...runtime?.getSnapshot().settings??chosenSettings.current,...pendingStartDraft}, resetSunlight = false) => { chosenLiving.current=resetSunlight?{...DEFAULT_LIVING_INTENT}:{...runtime?.livingIntent??DEFAULT_LIVING_INTENT}; if(!resetSunlight&&runtime){runtime.weather.restart();chosenWeather.current=runtime.weather.serialize()}else chosenWeather.current=null; chosenSunlight.current=resetSunlight?null:runtime?.environmentClock.solarDayProgress??null; chosenSettings.current = next; setPendingStartDraft({start:next.start,height:next.height}); setSettings(false); setGalleryOpen(false); setObserve(false); setRetry(n => n + 1) }
  const reason = snapshot.reason === 'terrain' ? copy.terrain : ['safety', 'camera'].includes(snapshot.reason ?? '') ? copy.safety : snapshot.reason === 'context' ? copy.context : snapshot.reason === 'hidden' ? copy.hidden : copy.quiet
  return <section ref={root} className="flight-experience" role="dialog" aria-modal="true" aria-label={copy.title} tabIndex={-1} onPointerDownCapture={event=>{
      // A visible touch after screen unlock is enough to restore
      // presentation focus. The flight remains paused until Start is pressed.
      if(!document.hidden)runtime?.restorePresentationFromGesture()
      // Dismiss without stealing focus or consuming the press: a toolbar click
      // or the first scene drag must still reach its original target.
      if(settingsOpen && event.target instanceof Element && !event.target.closest('#flight-settings-panel,.flight-settings-trigger,.language-menu__popover,.flight-observation-backdrop'))setSettings(false)
    }} data-flight-phase={snapshot.phase} data-settings-open={settingsOpen} data-hud-idle={hudIdle} data-camera-offset={snapshot.cameraRig?.perspective!=='rear'}>
    {(cameraInteractive||settings)&&<div ref={cameraLayer} className="flight-camera-gesture" aria-hidden="true"/>}
    <header className="flight-toolbar">
      <button type="button" aria-label={copy.back} onClick={onClose}><ChevronLeft size={20}/><span>{copy.back}</span></button>
      <div className="flight-toolbar__right">
        {!settings&&snapshot.cameraRig&&(snapshot.cameraRig.perspective!=='rear'||snapshot.cameraRig.rejection)&&<button type="button" className="flight-camera-reset" onClick={()=>runtime?.selectPerspective('rear')}>{inViewpoint?cameraCopy[locale].fixedReset:cameraCopy[locale].reset}</button>}
        {inViewpoint && <button className="flight-travel-return" type="button" disabled={snapshot.observation==='returning'} onClick={()=>runtime?.navigateBack()}><ArrowLeft size={18}/><span>{locale==='zh-CN'?'回到飞行':'Back to flight'}</span></button>}
        {!inViewpoint && (['flying', 'paused'].includes(snapshot.phase)||(observe&&snapshot.phase==='ready')) && <button type="button" aria-label={flying?copy.pause:snapshot.phase==='ready'?copy.start:copy.resume} disabled={!flying && !canAttemptResume} onClick={() => flying ? runtime?.pause() : start()}>{flying ? <Pause size={19}/> : <Play size={19}/>}<span>{flying ? copy.pause : snapshot.phase==='ready'?copy.start:copy.resume}</span></button>}
        <button className="flight-settings-trigger" title={locale==='zh-CN'?'飞行与风景':'Flight & scenery'} type="button" ref={settingsTrigger} disabled={snapshot.phase==='preparing'||snapshot.phase==='recovering'||snapshot.reason==='error'} aria-label={locale==='zh-CN'?'飞行与风景':'Flight & scenery'} aria-controls="flight-settings-panel" aria-expanded={settingsOpen} onClick={event=>{runtime?.input.clear();settingsOrigin.current=readOrigin(event.currentTarget,event.detail===0);setGalleryOpen(false);if(settingsOpen)closeSettings();else setSettings(true)}}><Settings2 size={20}/><span>{locale==='zh-CN'?'飞行与风景':'Flight & scenery'}</span></button>
        {runtime&&<PostcardDock key={retry} runtime={runtime} snapshot={snapshot} locale={locale} onCapture={()=>setSettings(false)} galleryOpen={galleryOpen} onGalleryChange={open=>{setGalleryOpen(open);if(open)setSettings(false)}}/>}
      </div>
    </header>
    <div className="flight-place" aria-live="polite"><span>{copy.title}</span><strong>{copy.regions[snapshot.region]}</strong>{snapshot.simplified && <small>{copy.simplified}</small>}</div>
    {(preparingView||snapshot.viewTransition?.canvas) && <ViewPreparation snapshot={snapshot} zh={locale==='zh-CN'}/>}

    {snapshot.reason === 'error' && <section className="flight-card" role="alert"><h1>{copy.error}</h1>{runtime?.canReturnToTravel&&<button type="button" onClick={()=>runtime.navigateBack()}>{locale==='zh-CN'?'返回原飞行位置':'Return to flight position'}</button>}<button type="button" onClick={()=>restart()}>{copy.retry}</button><button type="button" onClick={onClose}>{copy.back}</button></section>}
    {settingsMotion.present && <section ref={settingsPanel} id="flight-settings-panel" className="flight-card flight-settings" aria-label={locale==='zh-CN'?'飞行与风景':'Flight & scenery'} data-exiting={settingsMotion.exiting} aria-hidden={settingsMotion.exiting || undefined} inert={settingsMotion.exiting}>
      <div className="flight-settings-heading"><div className="flight-card__heading"><div><h2>{locale==='zh-CN'?'飞行与风景':'Flight & scenery'}</h2></div><div className="flight-language"><LanguageMenu/></div><button type="button" aria-label={copy.close} onClick={closeSettings}><X size={20}/></button></div>
</div>
      <div ref={tabs} className="flight-panel-sections" role="tablist" aria-label={locale==='zh-CN'?'风景面板分区':'Scenery panel sections'}>{sections.map((value,i)=>{const Icon=[Sun,Binoculars,Feather][i]!;return <button key={value} id={`flight-tab-${value}`} data-flight-tab={value} type="button" role="tab" aria-selected={section===value} aria-controls={`flight-section-${value}`} tabIndex={section===value?0:-1} onKeyDown={event=>{if(['ArrowLeft','ArrowRight','Home','End'].includes(event.key)){event.preventDefault();event.stopPropagation();const next=event.key==='Home'?0:event.key==='End'?2:(i+(event.key==='ArrowRight'?1:2))%3;const target=sections[next]!;selectSection(target,true);document.getElementById(`flight-tab-${target}`)?.focus({preventScroll:true})}}} onClick={event=>selectSection(value,event.detail===0)}><Icon size={18} aria-hidden="true"/><span>{(locale==='zh-CN'?['风景','观景','飞行']:['Scenery','Views','Flight'])[i]}</span></button>})}</div>
      <div className="flight-settings-scroll-shell" data-scrollable={metrics.isScrollable}>
      {metrics.isScrollable&&<span className="flight-scroll-cue" aria-hidden="true">{locale==='zh-CN'?'滑动查看更多 ↕':'Scroll to explore ↕'}</span>}
      <div ref={scrollRef} className="flight-settings-scroll museum-scrollbar" onScroll={handleScroll} onWheel={event=>event.stopPropagation()} onPointerDown={()=>runtime?.input.clear()} onClick={toggleDisclosure}>
      <div className="flight-settings-body">
      <div id="flight-section-scenery" className="flight-tabpanel" role="tabpanel" aria-labelledby="flight-tab-scenery" hidden={section!=='scenery'}>
       <section className="flight-scenery-group flight-scenery-group--light"><h3><Sun size={18} aria-hidden="true"/>{locale==='zh-CN'?'光线':'Light'}</h3>{runtime&&<LightViewpointPanel runtime={runtime} snapshot={snapshot} locale={locale} mode="sunlight"/>}</section>
       <section className="flight-scenery-group flight-scenery-group--weather"><h3><CloudSun size={18} aria-hidden="true"/>{locale==='zh-CN'?'天气':'Weather'}</h3>{runtime&&<WeatherPanel runtime={runtime} snapshot={snapshot} locale={locale}/>}</section>
       <section className="flight-scenery-group flight-scenery-group--nature"><h3><Waves size={18} aria-hidden="true"/>{locale==='zh-CN'?'环境':'Coastal life'}</h3>{runtime&&<NaturePanel runtime={runtime} snapshot={snapshot} locale={locale}/>}</section>
      </div>
      <div id="flight-section-viewpoints" className="flight-tabpanel" role="tabpanel" aria-labelledby="flight-tab-viewpoints" hidden={section!=='viewpoints'}>
       <h3 className="flight-view-heading">{locale==='zh-CN'?'推荐观景位':'A few favourite views'}</h3>
       {runtime&&<LightViewpointPanel runtime={runtime} snapshot={snapshot} locale={locale} mode="viewpoints"/>}
       {runtime?.cameraObservationEnabled&&inViewpoint&&<CameraPanel runtime={runtime} snapshot={snapshot} locale={locale}/>}
       <details className="flight-new-start"><summary>{locale==='zh-CN'?'重新选择出发位置':'Choose a new starting point'} <span aria-hidden="true">→</span></summary>
        <FlightChoices selected={pendingStartDraft.start} className="flight-start-places" role="group" aria-label={copy.startPlace}>{(['coast','valley','overview'] as const).map((place,i)=><button type="button" key={place} data-flight-choice={place} aria-pressed={pendingStartDraft.start===place} onClick={()=>setPendingStartDraft({...pendingStartDraft,start:place})}><svg viewBox="0 0 96 54" aria-hidden="true"><path d={['M0 35 Q24 40 40 28 T96 18 L96 54 H0Z','M0 38 L24 12 49 43 73 15 96 37 V54 H0Z','M0 42 L28 22 45 36 69 12 96 38 V54 H0Z'][i]}/><path className="flight-start-route" d={['M12 43 Q38 50 50 31 T84 16','M40 52 Q66 42 52 31 T47 6','M8 18 Q50 4 87 17'][i]}/></svg><span>{copy.starts[i]}<small>{(locale==='zh-CN'?['沿着海陆交界飞行','顺着山谷向前探索','从高处俯瞰山与海']:['Follow the coastline','Explore along the valley','See the land from above'])[i]}</small></span></button>)}</FlightChoices>
        <div className="flight-setting flight-choice-setting"><span>{copy.height}</span><FlightChoices selected={String(pendingStartDraft.height)} className="flight-inline-choices" role="group" aria-label={copy.height}>{([100,190,350] as const).map((v,i)=><button type="button" key={v} data-flight-choice={v} aria-pressed={pendingStartDraft.height===v} onClick={()=>setPendingStartDraft({...pendingStartDraft,height:v})}>{copy.heights[i]}</button>)}</FlightChoices></div>
        <p className="flight-start-notice">{locale==='zh-CN'?'会重新准备风景，并清空尚未保存的明信片。':'Prepares a new landscape and clears unsaved postcards.'}</p><button className="flight-primary" type="button" onClick={()=>restart()}>{locale==='zh-CN'?`从${copy.starts[(['coast','valley','overview'] as const).indexOf(pendingStartDraft.start)]}出发`:`Start from ${copy.starts[(['coast','valley','overview'] as const).indexOf(pendingStartDraft.start)]}`}</button>
        <details className="flight-more"><summary>{locale==='zh-CN'?'恢复初始设置':'Restore initial settings'}</summary><button type="button" onClick={()=>restart({...DEFAULT_FLIGHT_SETTINGS},true)}>{copy.defaults}</button></details>
       </details>
       {runtime&&<ObservationNotes runtime={runtime} locale={locale}/>}

      </div>
      <div id="flight-section-flight" className="flight-tabpanel" role="tabpanel" aria-labelledby="flight-tab-flight" hidden={section!=='flight'}>
       {onSpeciesChange&&<details className="flight-species-picker"><summary><span>{availableSpecies.find(p=>p.id===descriptor.id)?.name[locale]}</span><small>{locale==='zh-CN'?'换一只':'Change animal'}</small></summary>
        <FlightChoices selected={nextSpecies||descriptor.id} className="flight-inline-choices" role="group" aria-label={locale==='zh-CN'?'更换飞行生物':'Change flying animal'}>{availableSpecies.map(p=><button type="button" key={p.id} data-flight-choice={p.id} aria-pressed={(nextSpecies||descriptor.id)===p.id} onClick={()=>setNextSpecies(p.id===descriptor.id?'':p.id)}>{p.name[locale]}</button>)}</FlightChoices>
        {nextSpecies&&<><p>{locale==='zh-CN'?'换生物将重新出发，未保存的明信片会清空。新画面准备好后，需要再次开始并主动开启声音。':'Changing animal restarts the journey and clears unsaved postcards. Start again and enable sound when the new scene is ready.'}</p>
        <button type="button" onClick={()=>setNextSpecies('')}>{locale==='zh-CN'?'取消':'Cancel'}</button><button type="button" onClick={()=>{if(!runtime)return;runtime.pause();runtime.weather.restart();const preferences={settings:{...runtime.getSnapshot().settings},living:{...runtime.livingIntent},weather:runtime.weather.serialize(),sunlight:runtime.environmentClock.solarDayProgress};runtime.close();onSpeciesChange(nextSpecies,preferences)}}>{locale==='zh-CN'?'确认并重新出发':'Confirm and start a new journey'}</button></>}
       </details>}

      {runtime?.cameraObservationEnabled&&!inViewpoint&&<CameraPanel runtime={runtime} snapshot={snapshot} locale={locale}/>}
      <p className="flight-control-help flight-key-help">{locale==='zh-CN'?'↑ 爬升　↓ 下降　← → 转向':'↑ Climb　↓ Descend　← → Turn'}</p>
      <details className="flight-more-settings"><summary>{locale==='zh-CN'?'飞行与画面设置':'Flight & display settings'}</summary>
      <div className="flight-setting flight-choice-setting"><span>{copy.speed}</span><FlightChoices selected={String(snapshot.settings.speed)} className="flight-inline-choices flight-speed-choices" role="group" aria-label={copy.speed}>{([18,28,36] as const).map((speed,i)=><button type="button" key={speed} data-flight-choice={speed} aria-pressed={snapshot.settings.speed===speed} onClick={()=>patchLiveSettings({speed})}>{(locale==='zh-CN'?['慢','适中','快']:['Slow','Steady','Fast'])[i]}</button>)}</FlightChoices></div>
      <FlightToggle label={locale==='zh-CN'?'减少晃动':'Reduce motion'} checked={snapshot.gentle} onChange={gentle=>patchLiveSettings({gentle})}/>
      <div className="flight-setting flight-choice-setting"><span>{copy.quality}</span><FlightChoices selected={snapshot.quality} className="flight-inline-choices" role="group" aria-label={copy.quality}>{(['low','balanced'] as const).map(quality=><button type="button" key={quality} data-flight-choice={quality} disabled={inViewpoint} aria-pressed={snapshot.quality===quality} onClick={()=>patchLiveSettings({quality})}>{quality==='low'?copy.low:copy.balanced}</button>)}</FlightChoices></div>
      </details>

      </div>
      {!observe&&!inViewpoint&&snapshot.phase==='ready'&&runtime?.canResume&&<button type="button" className="flight-primary flight-panel-return" onClick={()=>{closeSettings();start()}}>{copy.start}</button>}
      </div></div><TransientScrollbar isScrolling={isScrolling} metrics={metrics}/></div>
    </section>}
    {snapshot.reason !== 'error' && !settingsOpen && !flying && !inViewpoint && !galleryOpen && !quietViewing && (snapshot.phase!=='paused'||Boolean(snapshot.reason&&snapshot.reason!=='user')) && <section className="flight-card flight-intro" aria-live="polite">
      <span className="flight-eyebrow">{copy.title} · {descriptor.id?.toUpperCase()??'PTERANODON'}</span>
      <h1>{snapshot.phase === 'buffering' ? copy.terrain : snapshot.phase === 'preparing' ? (snapshot.preparation?.phase==='warmup'?(locale==='zh-CN'?'正在准备光线与画面…':'Preparing lighting and the first frame…'):snapshot.preparation?.phase==='world'?(locale==='zh-CN'?'正在准备海岸与安全航线…':'Preparing the coast and a safe route…'):copy.preparing) : snapshot.phase === 'recovering' ? copy.error : snapshot.phase === 'ready' ? copy.ready : copy.paused}</h1>
      <p>{snapshot.phase === 'ready' ? (locale==='zh-CN'?`跟随${descriptor.label??'无齿翼龙'}，看看海岸那一边。`:`Follow ${descriptor.label??'Pteranodon'} beyond the coastline.`) : reason}</p>
      {snapshot.phase === 'ready' && <p className="flight-instructions">{copy.instruction}</p>}
      {snapshot.phase !== 'preparing' && <div className="flight-card__actions">
        {canAttemptResume && <button type="button" className="flight-primary" onClick={start}><Play size={18}/>{snapshot.phase === 'ready' ? copy.start : copy.resume}</button>}
        {(snapshot.phase === 'recovering' || ['safety', 'camera', 'terrain'].includes(snapshot.reason ?? '')) && <button type="button" className="flight-primary" onClick={() => restart()}>{copy.retry}</button>}
        <button type="button" disabled={!canAttemptResume} onClick={() => {setObserve(true);root.current?.focus()}}>{copy.static}</button>
      </div>}
    </section>}
    {import.meta.env.DEV && runtime && !inViewpoint && !settings && !galleryOpen && <FlightReviewControls runtime={runtime}/>}
    {flying && !settings && !galleryOpen && <>
      <div className="flight-direction-pad" role="group" aria-label={copy.directions}>
        {([{ label: copy.up, icon: ArrowUp, turn: 0, climb: 1, position: 'up' }, { label: copy.left, icon: ArrowLeft, turn: -1, climb: 0, position: 'left' }, { label: copy.down, icon: ArrowDown, turn: 0, climb: -1, position: 'down' }, { label: copy.right, icon: ArrowRight, turn: 1, climb: 0, position: 'right' }]).map(({ label, icon: Icon, turn, climb, position }) => <button type="button" key={position} className={`flight-direction flight-direction--${position}`} aria-label={label}
          onPointerDown={e => direction(e, turn, climb)} onPointerUp={stopPointer} onPointerCancel={stopPointer} onLostPointerCapture={stopPointer}
          onClick={e => { if (e.detail === 0) { runtime?.input.point(turn, climb); if (nudgeTimer.current) clearTimeout(nudgeTimer.current); nudgeTimer.current = setTimeout(() => runtime?.input.release(-1), 300) } }}><Icon size={24}/></button>)}
      </div>
      <div className="flight-assist"><button type="button" onClick={() => { runtime?.assist(); root.current?.focus() }}>{copy.assist}</button>{snapshot.assisted && <small>{copy.assisting}</small>}</div>
    </>}
  </section>
}
