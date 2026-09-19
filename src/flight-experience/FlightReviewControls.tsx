import { recordWeatherCycle } from './weather-review-cycle'
import { WEATHER_PRESETS, type WeatherPreset } from './environment/weather-controller'
import { saveWeatherCapture } from './weather-review-capture'
import type { MaterialTrial } from './lookdev/material-terrain'
import { recordFlightReview } from './review-recording'
import { installPropPicker } from './review-prop-picker'
import { captureBrowserMetadata, reviewContextRecovery } from './review-browser'
import { useEffect, useState } from 'react'
import type { FlightRuntime } from './FlightRuntime'
import { CAPTURE_ANCHORS, REVIEW_ROUTES } from './review-anchors'
import type { SolarPreset } from './environment/environment-state'
import {classifySurface,surfaceContext} from './materials/surface-context'
export function FlightReviewControls({ runtime }: { runtime: FlightRuntime }) {
  const [, render] = useState(0)
  const [capture, setCapture] = useState('')
  const [savedTrace,setSavedTrace]=useState('')
  const [recording,setRecording]=useState(false)
  const [lookdev,setLookdev]=useState(()=>new URLSearchParams(location.search).get('flightLookdev')==='1')
  useEffect(()=>{if(new URLSearchParams(location.search).get('flightLookdev')==='1')void runtime.toggleLookdev(true)},[runtime])
  useEffect(()=>{
    const id=new URLSearchParams(location.search).get('flightAnchor'),anchor=CAPTURE_ANCHORS.find(a=>a.id===id)
    if(!anchor)return
    let applied=false
    const apply=()=>{if(!applied&&runtime.getSnapshot().phase==='ready'){applied=true;runtime.applyCaptureAnchor(anchor)}}
    const unsubscribe=runtime.subscribe(apply);apply();return ()=>{unsubscribe()}
  },[runtime])
  const [asset,setAsset]=useState(()=>new URLSearchParams(location.search).get('flightMaterialScene')==='1'?'material-scene':'tree-0-0')
  const [assetLod,setAssetLod]=useState(0)
  const [angle,setAngle]=useState(0)
  const [elevation,setElevation]=useState(4)
  const [trackedId,setTrackedId]=useState('')
  const [picking,setPicking]=useState(false)
  useEffect(()=>picking?installPropPicker(runtime,setTrackedId):undefined,[runtime,picking])
  return <details className="flight-review" data-lookdev-active={lookdev}><summary>{lookdev?'材质与植被预览':'Visual diagnostics'}</summary>
    <label>Main terrain diagnosis<select aria-label="Main terrain diagnosis" defaultValue={String(runtime.surfaceReview.value.x)} onChange={e=>{runtime.setSurfaceReview(Number(e.target.value),runtime.surfaceReview.value.y);render(n=>n+1)}}><option value="0">PBR</option><option value="1">Six surface IDs</option><option value="2">One-hot source layer</option><option value="3">Weight grayscale</option><option value="4">Processed albedo, unlit</option><option value="5">Tangent normal</option><option value="6">Roughness</option><option value="7">Shading normal (view)</option><option value="8">Indirect diffuse</option><option value="9">Direct diffuse</option>{new URLSearchParams(location.search).get('flightA0')==='standalone'&&<option value="10">A0 standalone groundcover</option>}<option value="11">Raw source, unlit</option><option value="12">Raw source with stochastic blend, unlit</option></select></label>
    <label>Diagnostic layer<select aria-label="Diagnostic layer" defaultValue={String(runtime.surfaceReview.value.y)} onChange={e=>{runtime.setSurfaceReview(runtime.surfaceReview.value.x,Number(e.target.value));render(n=>n+1)}}>{['rock PBR','soil PBR','sand PBR','mud PBR','organic PBR','groundcover PBR','rock semantic','soil semantic','beach semantic','mud semantic','organic semantic','groundcover semantic'].map((name,i)=><option key={name} value={i}>{name}</option>)}</select></label>
    <button type="button" onClick={()=>{const p=runtime.simulation.position,context=surfaceContext(runtime.world,p.x,p.z);setCapture(JSON.stringify({position:{x:p.x,z:p.z},context,classification:classifySurface(context)},null,2))}}>Inspect surface under flight position</button>
    <label><input type="checkbox" checked={lookdev} onChange={e=>{setLookdev(e.target.checked);void runtime.toggleLookdev(e.target.checked)}}/>Finite material and asset sample</label>
    {lookdev&&<>
      <p>{asset.startsWith('material-scene')?'局部地形试验：岩坡、干土、湿沙与林下地表混合。可选择各材质近景，并旋转查看。':'左侧：前版资产 · 右侧：本轮资产。所有样板使用同一运行时光照。'}</p>
      <label>Sample asset<select aria-label="Sample asset" value={asset} onChange={e=>{setAsset(e.target.value);runtime.lookdev?.select(e.target.value,assetLod,angle,elevation)}}>{['material-scene','material-scene-rock','material-scene-soil','material-scene-sand','material-scene-floor','tree-0-0','tree-0-1','tree-1-0','tree-1-1','understory-0','understory-1','rock-group-0','rock-group-1','cliff-group-0','material-rock','material-soil','material-sand','material-floor'].map(id=><option key={id}>{id}</option>)}</select></label>
      {asset.startsWith('material-scene')&&<>
       <label>Material method<select aria-label="Material method" defaultValue="histogram" onChange={e=>runtime.lookdev?.setTrial({method:e.target.value as MaterialTrial['method']})}>{['tiled','four','triangle','histogram'].map(v=><option key={v}>{v}</option>)}</select></label>
       <label>Material channel<select aria-label="Material channel" defaultValue="pbr" onChange={e=>runtime.lookdev?.setTrial({channel:e.target.value as MaterialTrial['channel']})}>{['pbr','albedo','normal','roughness','weights'].map(v=><option key={v}>{v}</option>)}</select></label>
       <label>Material scale<select aria-label="Material scale" defaultValue="1" onChange={e=>runtime.lookdev?.setTrial({scale:Number(e.target.value)})}>{[.5,1,2].map(v=><option key={v}>{v}</option>)}</select></label>
       <label>Material layers<select aria-label="Material layers" defaultValue="2" onChange={e=>runtime.lookdev?.setTrial({layers:Number(e.target.value) as 2|4})}>{[2,4].map(v=><option key={v}>{v}</option>)}</select></label>
      </>}
      <label>Sample LOD<select aria-label="Sample LOD" value={assetLod} onChange={e=>{const n=Number(e.target.value);setAssetLod(n);runtime.lookdev?.select(asset,n,angle,elevation)}}>{[0,1,2].map(n=><option key={n}>{n}</option>)}</select></label>
      <label>Sample elevation<select aria-label="Sample elevation" value={elevation} onChange={e=>{const n=Number(e.target.value);setElevation(n);runtime.lookdev?.select(asset,assetLod,angle,n)}}><option value="-5">Below crown</option><option value="0">Level crown</option><option value="12">Above crown</option><option value="4">Overview</option></select></label>
      <button type="button" onClick={()=>{const n=(angle+15)%360;setAngle(n);runtime.lookdev?.select(asset,assetLod,n,elevation)}}>Rotate sample 15° ({angle}°)</button>
    </>}
    {(['freezeCamera','freezeWorld','animateWater','hideRiver'] as const).map(key=><label key={key}><input type="checkbox" checked={runtime.reviewIsolation[key]} onChange={e=>{runtime.reviewIsolation[key]=e.target.checked;runtime.refreshReview();render(n=>n+1)}}/>{key}</label>)}
    <label><input type="checkbox" checked={runtime.reviewHideFarTerrain} onChange={e=>{runtime.setReviewVisibility('reviewHideFarTerrain',e.target.checked);render(n=>n+1)}}/>hideFarTerrain</label>
    <label><input type="checkbox" checked={runtime.reviewHideWater} onChange={e=>{runtime.setReviewVisibility('reviewHideWater',e.target.checked);render(n=>n+1)}}/>hideWater</label>
    <label><input type="checkbox" checked={picking} onChange={e=>{if(runtime.getSnapshot().phase==='flying')runtime.pause('user');setPicking(e.target.checked)}}/>Pick prop in paused scene</label>
    <label>Fixed prop LOD<select aria-label="Fixed prop LOD" value={runtime.reviewPropLod??'auto'} onChange={e=>{runtime.setReviewPropLod(e.target.value==='auto'?undefined:Number(e.target.value) as 0|1|2);render(n=>n+1)}}><option value="auto">Automatic</option>{[0,1,2].map(n=><option key={n}>{n}</option>)}</select></label>
    <label>Tracked prop ID<input aria-label="Tracked prop ID" value={trackedId} onChange={e=>setTrackedId(e.target.value)}/></label>
    <button type="button" onClick={()=>runtime.scenery.props.setTracing(true,trackedId||undefined)}>Trace prop lifecycle</button>
    <button type="button" onClick={()=>setCapture(JSON.stringify({object:runtime.scenery.props.inspectObject(trackedId),events:runtime.scenery.props.getLifecycleTrace()},null,2))}>Export prop trace</button>
    <label><input type="checkbox" defaultChecked onChange={e=>{runtime.setWeatherReviewEnabled(e.target.checked)}}/>W1 enabled</label>
    <label>Static weather capture<select aria-label="Static weather capture" defaultValue="clear" onChange={e=>{runtime.weather.capture(e.target.value as WeatherPreset);runtime.refreshReview();render(n=>n+1)}}>{WEATHER_PRESETS.map(p=><option key={p}>{p}</option>)}</select></label>
    <button type="button" disabled={recording} onClick={()=>{setRecording(true);void recordWeatherCycle(runtime).then(setSavedTrace).catch(e=>setSavedTrace(String(e))).finally(()=>setRecording(false))}}>Record 10.5m W1 cycle</button>
    <button type="button" onClick={()=>{void saveWeatherCapture(runtime).then(setSavedTrace).catch(e=>setSavedTrace(String(e)))}}>Save W1 PBR locally</button>
    {(['clouds','weather','sun'] as const).map(key=><label key={key}><input type="checkbox" checked={runtime.weatherFreeze[key]} onChange={e=>{runtime.weatherFreeze[key]=e.target.checked;runtime.refreshReview();render(n=>n+1)}}/>freeze {key}</label>)}
    <label>Capture anchor<select aria-label="Capture anchor" defaultValue="" onChange={e=>{const anchor=CAPTURE_ANCHORS.find(a=>a.id===e.target.value);if(anchor)runtime.applyCaptureAnchor(anchor)}}><option value="" disabled>Select view</option>{CAPTURE_ANCHORS.map(a=><option key={a.id}>{a.id}</option>)}</select></label>
    <label>Trace route<select aria-label="Trace route" defaultValue="" onChange={e=>runtime.runReviewRoute(e.target.value)}><option value="" disabled>Select 65s route</option>{REVIEW_ROUTES.map(r=><option key={r.id}>{r.id}</option>)}</select></label>
    <button type="button" disabled={recording} onClick={()=>{setRecording(true);void recordFlightReview().then(name=>setSavedTrace(`Video saved locally: ${name}`)).catch(e=>setSavedTrace(String(e))).finally(()=>setRecording(false))}}>{recording?'Recording 12s…':'Record 12s locally'}</button>
    <label>Animation comparison<select aria-label="Animation comparison" defaultValue="auto" onChange={e=>{runtime.setReviewAnimation(e.target.value as typeof runtime.reviewAnimation)}}>{['auto','source','powered','glide'].map(mode=><option key={mode}>{mode}</option>)}</select></label>
    <button type="button" onClick={()=>{runtime.start();runtime.input.point(0,1,-98);setTimeout(()=>runtime.input.release(-98),10000)}}>Test 10s climb</button>
    <button type="button" onClick={()=>{runtime.trace.start();render(n=>n+1)}}>Start raw trace</button>
    <button type="button" onClick={()=>{runtime.trace.stop();setCapture(JSON.stringify({...runtime.traceEvidence(),...captureBrowserMetadata()}))}}>Export raw trace</button>
    <button type="button" onClick={()=>{runtime.trace.stop();const data={...runtime.traceEvidence(),...captureBrowserMetadata()};const url=URL.createObjectURL(new Blob([JSON.stringify(data)],{type:'application/json'}));const link=document.createElement('a');link.href=url;link.download=`flight-${data.route}-trace.json`;link.click();setTimeout(()=>URL.revokeObjectURL(url),1000)}}>Download raw trace</button>
    <button type="button" onClick={()=>{runtime.trace.stop();void fetch('/__flight-review/trace',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...runtime.traceEvidence(),...captureBrowserMetadata()})}).then(async response=>{setSavedTrace(response.ok?`Saved locally: ${await response.text()}`:`Save failed: ${response.status}`)}).catch(()=>setSavedTrace('Local save unavailable'))}}>Save trace locally</button>
    {savedTrace&&<p role="status">{savedTrace}</p>}
    <button type="button" onClick={()=>runtime.turnReview(90)}>Turn 90°</button>
    <label>Review pitch<select aria-label="Review pitch" defaultValue="0" onChange={e=>runtime.pitchReview(Number(e.target.value))}><option value="0">Forward</option><option value=".75">Sky</option><option value="-.45">Down</option></select></label>
    <label>World seed<select aria-label="World seed" value={runtime.world.config.seed} onChange={e=>{const url=new URL(location.href);url.searchParams.set('flightSeed',e.target.value);location.assign(url.href)}}>{[193706,193707,193708].map(seed=><option key={seed}>{seed}</option>)}</select></label>
    <label>Fixed daylight<select aria-label="Fixed daylight" value={runtime.scenery.preset} onChange={e=>{runtime.setReviewPreset(e.target.value as SolarPreset);render(n=>n+1)}}>{['morning','noon','afternoon','evening'].map(p=><option key={p}>{p}</option>)}</select></label>
    {(['legacy', 'detail', 'bands', 'gray', 'freezeLod', 'normals', 'patchGrid', 'wireframe'] as const).map(key => <label key={key}><input type="checkbox" checked={runtime.terrain.review[key]} onChange={e => { runtime.terrain.review[key] = e.target.checked; runtime.refreshReview(); render(n => n + 1) }}/>{key}</label>)}
    {(['hideProps', 'flatWater', 'freezeWater', 'oceanEdges', 'skyColors', 'shadows', 'highlight', 'freezeBathymetry', 'ownerColors', 'depthColors'] as const).map(key => <label key={key}><input type="checkbox" checked={runtime.scenery.review[key]} onChange={e => { runtime.scenery.review[key] = e.target.checked; runtime.refreshReview(); render(n => n + 1) }}/>{key}</label>)}
    <button type="button" onClick={()=>setCapture(JSON.stringify({...runtime.diagnostics(),...captureBrowserMetadata()},null,2))}>Capture metadata</button>
    <button type="button" onClick={()=>{runtime.pause('user');reviewContextRecovery()}}>Test graphics recovery</button>
    {capture && <textarea aria-label="Capture metadata JSON" readOnly value={capture}/>}
  </details>
}
