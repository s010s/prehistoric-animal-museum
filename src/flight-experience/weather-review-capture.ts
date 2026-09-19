import type { FlightRuntime } from './FlightRuntime'
import { captureBrowserMetadata } from './review-browser'
/** Read pixels before the browser discards the drawing buffer, after the real PBR render. */
export function saveWeatherCapture(runtime:FlightRuntime):Promise<string>{
 return new Promise((resolve,reject)=>{
  const previous=runtime.scene.onAfterRender.bind(runtime.scene)
  const timer=setTimeout(()=>{runtime.scene.onAfterRender=previous;reject(new Error('No rendered frame available'))},10000)
  runtime.scene.onAfterRender=function(...args){
   const [renderer]=args
   runtime.scene.onAfterRender=previous;clearTimeout(timer);previous(...args)
   const metadata={...runtime.diagnostics(),...captureBrowserMetadata(),buffer:{width:renderer.domElement.width,height:renderer.domElement.height},exposure:renderer.toneMappingExposure,cameraMatrixWorld:runtime.camera.matrixWorld.toArray(),projectionMatrix:runtime.camera.projectionMatrix.toArray(),capturedAt:new Date().toISOString()}
   const image=renderer.domElement.toDataURL('image/png')
   void fetch('/__flight-review/capture',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({image,metadata})}).then(async r=>{if(!r.ok)throw new Error(`Capture save: ${r.status}`);resolve(await r.text())}).catch(reject)
  }
  runtime.refreshReview()
 })
}
