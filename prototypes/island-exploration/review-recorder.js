// Explicit review capture only. Arming allocates no stream or encoder; an actual
// completed scene frame starts capture. All asynchronous work belongs to one id.
export function makeReviewRecorder({canvas,Recorder=globalThis.MediaRecorder,now=()=>Date.now(),setTimer=setTimeout,clearTimer=clearTimeout,upload=null,publish=()=>{},onStop=()=>{}}){
  let session=null,sequence=0,paused=false;
  const pending=s=>Boolean(s&&['armed','recording','paused','stopping','saving'].includes(s.status));
  const snapshot=s=>s?{id:s.id,status:s.status,pending:pending(s),frames:s.frames,bytes:s.bytes,limitBytes:s.byteLimit,truncated:s.truncated,mime:s.mime,artifact:s.artifact,saveError:s.error,reason:s.reason,startedAt:s.startedAt,finishedAt:s.finishedAt,wallLimitMs:s.wallLimitMs,tracksReleased:s.released,trackStates:(s.stream?.getTracks()??[]).map(t=>t.readyState??null)}:{id:null,status:'idle',pending:false,frames:0,bytes:0,limitBytes:180000000,truncated:false,mime:null,artifact:null,saveError:null,reason:null};
  const clear=(s,key)=>{if(s[key]!=null){clearTimer(s[key]);s[key]=null;}};
  const release=s=>{if(s.released)return;s.released=true;for(const track of s.stream?.getTracks()??[])try{track.stop();}catch{}};
  const current=s=>session===s;
  async function finish(s){
    if(!current(s)||s.finalizing)return;
    s.finalizing=true;clear(s,'wallTimer');clear(s,'stopTimer');release(s);
    const blob=new Blob(s.chunks,{type:s.mime||'video/webm'});s.chunks=[];
    if(!s.frames||!blob.size||s.truncated||s.error){s.status=s.error?'failed':'empty';s.finishedAt=now();return;}
    s.bytes=blob.size;s.status='saving';
    try{
      publish(blob,snapshot(s));
      if(upload){
        const abort=new AbortController();s.abort=abort;
        const deadline=new Promise((_,reject)=>{s.uploadTimer=setTimer(()=>{abort.abort();reject(Error('capture upload timeout'));},10000);});
        const path=await Promise.race([upload(blob,abort.signal),deadline]);
        if(!current(s))return;s.artifact=path;
      }
      s.status=upload?'saved':'ready';
    }catch(error){if(current(s)){s.error=String(error);s.status='failed';}}
    finally{clear(s,'uploadTimer');if(current(s))s.finishedAt=now();}
  }
  function stop(reason='user stopped'){
    const s=session;if(!pending(s)||s.status==='stopping'||s.status==='saving')return false;
    s.reason=reason;clear(s,'wallTimer');
    if(!s.recorder){void finish(s);return true;}
    s.status='stopping';
    s.stopTimer=setTimer(()=>{if(!current(s)||s.finalizing)return;s.error='capture encoder stop timeout';void finish(s);},3000);
    try{if(s.recorder.state!=='inactive')s.recorder.stop();else void finish(s);}catch(error){s.error=String(error);void finish(s);}
    release(s);return true;
  }
  function interrupt(s,reason,error=null){
    if(!current(s)||!pending(s))return;
    if(error)s.error=String(error);stop(reason);onStop(reason);
  }
  function arm({wallLimitMs=20000,byteLimit=180000000}={}){
    if(pending(session))return false;
    const s=session={id:++sequence,status:'armed',frames:0,bytes:0,byteLimit:Math.max(1,Math.min(180000000,byteLimit)),wallLimitMs:Math.max(1,Math.min(500000,wallLimitMs)),truncated:false,mime:null,artifact:null,error:null,reason:null,chunks:[],stream:null,recorder:null,released:false,finalizing:false,startedAt:null,finishedAt:null};
    s.wallTimer=setTimer(()=>interrupt(s,'capture wall deadline'),s.wallLimitMs);return true;
  }
  function afterFrame(){
    const s=session;if(!s||paused||!['armed','recording'].includes(s.status))return;
    s.frames++;
    if(s.status==='recording')return;
    try{
      if(!Recorder)throw Error('MediaRecorder unavailable');
      s.stream=canvas.captureStream(24);
      const mime=['video/webm;codecs=vp9','video/webm','video/mp4'].find(type=>Recorder.isTypeSupported(type));
      if(!mime)throw Error('No supported capture MIME type');
      const recorder=s.recorder=new Recorder(s.stream,{mimeType:mime,videoBitsPerSecond:3000000});s.mime=recorder.mimeType||mime;
      recorder.ondataavailable=e=>{
        if(!current(s)||s.finalizing||s.truncated||!e.data?.size)return;
        s.bytes+=e.data.size;
        if(s.bytes>s.byteLimit){s.truncated=true;interrupt(s,'capture byte limit');return;}
        s.chunks.push(e.data);
      };
      recorder.onstop=()=>{if(current(s))void finish(s);};
      recorder.onerror=e=>interrupt(s,'capture recorder error',e.error??e.message??'MediaRecorder error');
      s.status='recording';s.startedAt=now();recorder.start(1000);
    }catch(error){interrupt(s,'capture recorder error',error);}
  }
  function setPaused(value){
    paused=Boolean(value);const s=session;if(!s?.recorder||!['recording','paused'].includes(s.status))return;
    try{if(paused&&s.recorder.state==='recording'){s.recorder.pause();s.status='paused';}else if(!paused&&s.recorder.state==='paused'){s.recorder.resume();s.status='recording';}}catch(error){interrupt(s,'capture recorder error',error);}
  }
  return {arm,afterFrame,stop,setPaused,get state(){return snapshot(session);},get pending(){return pending(session);},get recording(){return Boolean(session&&['recording','paused'].includes(session.status));}};
}
