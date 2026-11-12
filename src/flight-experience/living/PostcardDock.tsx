import {useEffect,useLayoutEffect,useRef,useState} from 'react'
import {useTransientScrollbar} from '../../components/useTransientScrollbar'
import {TransientScrollbar} from '../../components/TransientScrollbar'
import {usePanelMotion} from '../../components/usePanelMotion'
import {captureContainedImage, drawerCurve, flyVisual, motionTime, playMotion, readOrigin, reducedMotion, type MotionOrigin, type SharedFlight} from '../../motion'
import {Camera,Images,X,Download} from 'lucide-react'
import type {FlightRuntime,FlightSnapshot} from '../FlightRuntime'
import './postcard.css'

/** The exact completed frame floats above the still-running scene, then joins the dock. */
export function PostcardDock({runtime,snapshot,locale,galleryOpen,onGalleryChange,onCapture}:{onCapture?:()=>void;galleryOpen?:boolean;onGalleryChange?:(open:boolean)=>void;runtime:FlightRuntime;snapshot:FlightSnapshot;locale:'en'|'zh-CN'}) {
 const zh=locale==='zh-CN',state=snapshot.photos??runtime.photos.getSnapshot()
 const [localOpen,setLocalOpen]=useState(false),[unavailable,setUnavailable]=useState(false)
 const open=galleryOpen??localOpen,setOpen=onGalleryChange??setLocalOpen
 const destination=useRef<HTMLButtonElement>(null),stage=useRef<HTMLDivElement>(null),close=useRef<HTMLButtonElement>(null)
 const gallery=useRef<HTMLElement>(null),origin=useRef<MotionOrigin | null>(null)
 const galleryMotion=usePanelMotion({open,panel:gallery,trigger:destination,origin,phone:380,desktop:255,easing:drawerCurve,stagger:25})
 const {scrollRef,handleScroll,isScrolling,metrics}=useTransientScrollbar(open)
 const capture=state.capture
 useLayoutEffect(()=>{
  if(!capture)return
  const host=stage.current,target=destination.current
  if(!host||!target){runtime.photos.releaseCapture(capture.id);return}
  const canvas=capture.canvas
  host.appendChild(canvas)
  let ended=false
  const motion:{animation?:Animation}={}
  const finish=()=>{if(ended)return;ended=true;motion.animation?.cancel();canvas.remove();runtime.photos.releaseCapture(capture.id)}
  const bounds=host.getBoundingClientRect(),to=target.getBoundingClientRect()
  const scale=Math.min((to.width-8)/bounds.width,(to.height-8)/bounds.height)
  const x=to.left+to.width/2-(bounds.left+bounds.width/2),y=to.top+to.height/2-(bounds.top+bounds.height/2)
  if(document.hidden||matchMedia('(prefers-reduced-motion: reduce)').matches||!canvas.animate){finish();return}
  motion.animation=canvas.animate([
   {transform:'translate(0,0) scale(1)',borderRadius:'0px',boxShadow:'0 0 0 0px #fffaf0',offset:0},
   {transform:'translate(0,0) scale(.95)',borderRadius:'8px',boxShadow:'0 0 0 7px #fffaf0, 0 12px 40px #102d3840',offset:.24},
   {transform:`translate(${x}px,${y}px) scale(${scale})`,borderRadius:'12px',boxShadow:'0 0 0 7px #fffaf0, 0 12px 40px #102d3840',offset:1},
  ],{duration:820,easing:'cubic-bezier(.22,.7,.18,1)',fill:'forwards'})
  motion.animation.onfinish=finish
  const visibility=()=>{if(document.hidden)finish()}
  window.addEventListener('resize',finish);document.addEventListener('visibilitychange',visibility)
  return ()=>{window.removeEventListener('resize',finish);document.removeEventListener('visibilitychange',visibility);finish()}
 },[capture,runtime])
 const photoMotion=useRef<SharedFlight | null>(null)
 useLayoutEffect(()=>()=>photoMotion.current?.cancel(),[])
 useLayoutEffect(()=>{
  if(open)close.current?.focus({preventScroll:true})
  const thumbnail=destination.current?.querySelector('img')
  const full=gallery.current?.querySelector<HTMLImageElement>('figure img')
  const port=scrollRef.current?.getBoundingClientRect()
  const box=full?.getBoundingClientRect()
  if(!thumbnail||!full||!port||!box||box.bottom<=port.top||box.top>=port.bottom||
     thumbnail.src!==full.src||!thumbnail.complete||!thumbnail.naturalWidth){photoMotion.current?.cancel();return}
  const duration=motionTime(380,255,origin.current?.keyboard)
  const target=open?full:thumbnail
  if(photoMotion.current?.running){photoMotion.current.flyTo(target,duration,drawerCurve);return}
  photoMotion.current=flyVisual(captureContainedImage(open?thumbnail:full),target,duration,drawerCurve)
 },[open,scrollRef])
 const latest=state.photos[0]?.url
 const acknowledgedFrame=useRef(-1)
 const frame=state.photos[0]?.frame
 const [noticed,setNoticed]=useState<string>()
 const [expired,setExpired]=useState<string>()
 useEffect(()=>{
  if(!latest||capture||frame===undefined||frame<=acknowledgedFrame.current)return
  acknowledgedFrame.current=frame
  let active=true
  const pulse=matchMedia('(prefers-reduced-motion: reduce)').matches?undefined:destination.current?.animate?.([{transform:'scale(1)'},{transform:'scale(1.08)'},{transform:'scale(1)'}],{duration:360,easing:'ease-out'})
  queueMicrotask(()=>{if(active)setNoticed(latest)})
  const timer=setTimeout(()=>setExpired(latest),2600)
  return ()=>{active=false;clearTimeout(timer);pulse?.cancel()}
 },[latest,capture,frame])
 const busy=Boolean(capture)||state.status==='waiting'||state.status==='encoding'
 const photos=state.photos.filter(photo=>photo.frame!==capture?.frame)
 const dismiss=()=>{setOpen(false);destination.current?.focus({preventScroll:true})}
 const listPositions=useRef<{ rows: Map<string, number>; keyboard: boolean } | null>(null)
 const listAnimations=useRef<Animation[]>([])
 const readRows=()=>Array.from(scrollRef.current?.querySelectorAll<HTMLElement>('[data-postcard-url]')??[])
 useLayoutEffect(()=>()=>listAnimations.current.forEach(animation=>animation.cancel()),[])
 useLayoutEffect(()=>{
  const positions=listPositions.current
  listPositions.current=null
  if(!positions||!open)return
  const duration=motionTime(240,175,positions.keyboard)
  listAnimations.current.forEach(animation=>animation.cancel())
  listAnimations.current=[]
  if(!reducedMotion())for(const row of readRows()){
   const before=positions.rows.get(row.dataset.postcardUrl!)
   const dy=before===undefined?0:before-row.getBoundingClientRect().top
   if(Math.abs(dy)<1)continue
   const animation=playMotion(row,[{translate:`0 ${dy}px`},{translate:'none'}],{duration,easing:'ease-in-out'})
   if(animation)listAnimations.current.push(animation)
  }
  if(!state.photos.length){
   const empty=gallery.current?.querySelector('.flight-postcard-empty')
   const animation=empty&&playMotion(empty,[{opacity:0},{opacity:1}],{duration,easing:'ease-out'})
   if(animation)listAnimations.current.push(animation)
  }
 },[state.photos,open])
 return <div className="flight-postcards" data-gallery-open={open} onKeyDown={e=>{if(e.key==='Escape'&&open){e.preventDefault();e.stopPropagation();dismiss()}}}>
  <button className="flight-postcard-shutter" type="button" disabled={busy||snapshot.viewTransition?.waiting||Boolean(snapshot.viewTransition?.canvas)||snapshot.phase==='preparing'||snapshot.phase==='recovering'} onClick={()=>{runtime.input.clear();setOpen(false);const captured=runtime.requestPhoto();setUnavailable(!captured);if(captured)onCapture?.()}} aria-label={zh?'拍张明信片':'Take a postcard'}><Camera size={20}/><span>{zh?'拍张明信片':'Take a postcard'}</span></button>
  <button ref={destination} className="flight-postcard-pocket" type="button" aria-label={zh?`查看明信片，${photos.length}张`:`View postcards, ${photos.length}`} aria-expanded={open} aria-controls="flight-postcard-gallery" onClick={event=>{runtime.input.clear();origin.current=readOrigin(event.currentTarget,event.detail===0);if(open)dismiss();else setOpen(true)}}>
   {photos[0]?<img src={photos[0].url} alt=""/>:<Images size={22}/>}{photos.length>0&&<small>{photos.length}</small>}
  </button>
  <span className="flight-postcard-feedback" role="status">{state.status==='error'?(zh?'没能拍下，请再试一次':'Could not capture. Try again.'):unavailable?(zh?'等风景准备好再拍':'Wait for the scenery to be ready'):busy?(zh?'正在收好这一刻…':'Keeping this moment…'):latest&&noticed===latest&&expired!==latest?(zh?'✓ 已留住这一刻':'✓ Moment captured'):''}</span>
  {capture&&<div ref={stage} className="flight-postcard-stage" aria-hidden="true"/>}
  {galleryMotion.present&&<section ref={gallery} id="flight-postcard-gallery" className="flight-postcard-gallery" data-exiting={galleryMotion.exiting} aria-hidden={galleryMotion.exiting || undefined} inert={galleryMotion.exiting} aria-label={zh?'这一程的明信片':'Postcards from this flight'}>
   <header><div><h2>{zh?'这一程的明信片':'Your postcards'}</h2></div><button ref={close} type="button" aria-label={zh?'关闭明信片':'Close postcards'} onClick={dismiss}><X size={20}/></button></header>
   <p>{zh?'最多暂存三张。关闭飞行前，记得保存到设备。':'Up to three previews. Save to your device before leaving flight.'}</p>
   {!state.photos.length&&<div className="flight-postcard-empty"><Camera size={32}/><p>{zh?'遇见喜欢的风景，就拍一张。':'See something you love? Take a postcard.'}</p></div>}
   <div className="drawer-scroll-shell"><div ref={scrollRef} onScroll={handleScroll} className="flight-postcard-list museum-scrollbar">{state.photos.map(photo=><figure key={photo.url} data-postcard-url={photo.url}><img src={photo.url} width={photo.width} height={photo.height} alt={zh?'拍下的海岸风景':'The coastal view you captured'}/><figcaption><a href={photo.url} download="prehistoric-coast.png"><Download size={16}/>{zh?'保存到设备':'Save to device'}</a><button type="button" onClick={event=>{
    listPositions.current={rows:new Map(readRows().map(row=>[row.dataset.postcardUrl!,row.getBoundingClientRect().top])),keyboard:event.detail===0}
    if(photo.url===latest)photoMotion.current?.cancel()
    runtime.photos.remove(photo.url);destination.current?.focus({preventScroll:true})
   }}>{zh?'移除':'Remove'}</button></figcaption></figure>)}</div><TransientScrollbar isScrolling={isScrolling} metrics={metrics}/></div>
  </section>}
 </div>
}
