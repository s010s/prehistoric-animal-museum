/** Development-only local video evidence; no audio and no remote destination. */
export async function recordFlightReview(seconds=12):Promise<string>{
 const canvas=document.querySelector<HTMLCanvasElement>('canvas[data-experience="flight"]')
 if(!canvas||!('MediaRecorder' in window))throw new Error('Local video recording unavailable')
 const stream=canvas.captureStream(30),chunks:BlobPart[]=[],type=MediaRecorder.isTypeSupported('video/webm;codecs=vp9')?'video/webm;codecs=vp9':'video/webm'
 const recorder=new MediaRecorder(stream,{mimeType:type,videoBitsPerSecond:5000000})
 return new Promise((resolve,reject)=>{
  recorder.ondataavailable=e=>{if(e.data.size)chunks.push(e.data)}
  recorder.onerror=()=>{stream.getTracks().forEach(t=>t.stop());reject(new Error('Local video recording failed'))}
  recorder.onstop=()=>{stream.getTracks().forEach(t=>t.stop());void fetch('/__flight-review/video',{method:'POST',headers:{'Content-Type':'video/webm'},body:new Blob(chunks,{type:'video/webm'})}).then(async r=>{if(!r.ok)throw new Error(`Local video save: ${r.status}`);resolve(await r.text())}).catch(reject)}
  recorder.start();setTimeout(()=>{if(recorder.state==='recording')recorder.stop()},seconds*1000)
 })
}
