import {useEffect,useRef,useState} from 'react'
import type {FlightRuntime,FlightSnapshot} from '../FlightRuntime'
import {observationCards} from './observation-content'
export function NaturePanel({runtime,snapshot,locale}:{runtime:FlightRuntime;snapshot:FlightSnapshot;locale:'en'|'zh-CN'}){
 const cardRoot=useRef<HTMLElement>(null)
 const zh=locale==='zh-CN',[card,setCard]=useState<number|null>(null),trigger=useRef<HTMLButtonElement|null>(null),[photoWaiting,setPhotoWaiting]=useState(false)
 useEffect(()=>{if(card!==null)cardRoot.current?.querySelector<HTMLButtonElement>('button')?.focus()},[card])
 const sound=runtime.soundscape.getSnapshot(),photos=snapshot.photos??runtime.photos.getSnapshot()
 useEffect(()=>()=>runtime.setObservationCard(false),[runtime])
 const closeCard=()=>{setCard(null);runtime.setObservationCard(false);trigger.current?.focus()}
 return <div className="flight-nature" onKeyDown={event=>{if(card!==null&&event.key==='Escape'){event.preventDefault();event.stopPropagation();closeCard()}}}>
  <label className="flight-setting"><span>{zh?'植被微风':'Vegetation breeze'}</span><input type="checkbox" checked={runtime.livingIntent.wind} onChange={e=>runtime.setLivingIntent('wind',e.target.checked)}/></label>
  <label className="flight-setting"><span>{zh?'同类同行':'Flying companions'}<small>{zh?'少量同类短暂经过 · 艺术化表现':'Brief encounters · artistic interpretation'}</small></span><input type="checkbox" checked={runtime.livingIntent.companions} onChange={e=>runtime.setLivingIntent('companions',e.target.checked)}/></label>
  {runtime.livingIntent.companions&&<p role="status">{snapshot.companions?.status==='degraded'?(zh?'远处同伴暂时没有准备好，可关闭后重新开启':'Distant companions could not load. Turn off and on to retry.'):snapshot.companions?.status==='loading'?(zh?'同伴正在准备':'Preparing companions'):zh?'同伴从远处经过，短暂同行后离开':'Companions pass in the distance, join briefly, then leave'}</p>}
  <button type="button" onClick={()=>{if(sound.enabled)runtime.disableSound();else void runtime.enableSound()}}>{sound.enabled?(zh?'关闭自然声音':'Turn off nature sounds'):(zh?'开启自然声音':'Enable nature sounds')}</button>
  {sound.status==='retry'&&<button type="button" onClick={()=>void runtime.enableSound()}>{zh?'重试自然声音':'Retry nature sounds'}</button>}
  <p role="status">{sound.status==='loading'?(zh?'声音正在准备':'Preparing sounds'):sound.status==='retry'?(zh?'声音暂时不可用，可重新开启':'Sounds unavailable. Try enabling again.'):sound.enabled?(zh?'暂停或离开时，声音也会停下':'Sound stops when you pause or leave'):(zh?'声音默认关闭，点击后才开启':'Sound starts only when you choose')}</p>
  <label className="flight-setting">{zh?'声音音量':'Sound volume'}<input type="range" aria-label={zh?'声音音量':'Sound volume'} min="0" max="1" step="0.05" value={sound.volume} onChange={e=>runtime.setSoundVolume(Number(e.target.value))}/></label>
  <div className="flight-card__actions">{observationCards[locale].map((item,index)=><button type="button" key={item.id} onClick={e=>{trigger.current=e.currentTarget;runtime.setObservationCard(true);setCard(index)}}>{item.title}</button>)}</div>
  {card!==null&&<div className="flight-observation-backdrop"><section ref={cardRoot} className="flight-observation-card" role="dialog" aria-modal="true" aria-label={observationCards[locale][card]!.title} onKeyDown={e=>{if(e.key==='Escape'){e.preventDefault();closeCard()}if(e.key==='Tab'){const focusable=[...e.currentTarget.querySelectorAll<HTMLElement>('button,summary,a[href]')];const first=focusable[0],last=focusable.at(-1);if(e.shiftKey&&document.activeElement===first){e.preventDefault();last?.focus()}else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first?.focus()}}e.stopPropagation()}}>
    <p>{zh?'景色已暂停，声音已静音':'Scenery paused and sound muted'}</p><h3>{observationCards[locale][card]!.title}</h3><p>{observationCards[locale][card]!.body}</p>
    <details><summary>{zh?'给家长的说明':'For grown-ups'}</summary><p>{observationCards[locale][card]!.parent}</p>{observationCards[locale][card]!.url?<a href={observationCards[locale][card]!.url} target="_blank" rel="noreferrer">{observationCards[locale][card]!.source}</a>:<small>{observationCards[locale][card]!.source}</small>}</details>
    <button type="button" onClick={closeCard}>{zh?'关闭，保持暂停':'Close and stay paused'}</button>
  </section></div>}
  <button type="button" disabled={photos.status==='waiting'||photos.status==='encoding'} onClick={()=>setPhotoWaiting(!runtime.requestPhoto())}>{zh?'制作明信片':'Make a postcard'}</button>
  <p role="status">{photos.status==='error'?(zh?'这次没有保存成功，请再试一次':'Could not capture this frame. Try again.'):photos.status==='waiting'||photos.status==='encoding'?(zh?'正在准备图片…':'Preparing image…'):photoWaiting?(zh?'等风景准备好后再试':'Wait for the scenery, then try again'):zh?'图片只保存在本机，不会上传':'Pictures stay on your device'}</p>
  {photos.photos.map(photo=><figure key={photo.url}><img src={photo.url} width={photo.width} height={photo.height} alt={zh?'刚刚看到的海岸':'The coast you just saw'} style={{width:'100%',height:'auto'}}/><figcaption><a href={photo.url} download="prehistoric-coast.png">{zh?'保存 PNG':'Save PNG'}</a> <button type="button" onClick={()=>runtime.photos.remove(photo.url)}>{zh?'移除预览':'Remove preview'}</button></figcaption></figure>)}
 </div>
}
