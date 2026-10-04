// Temporary investigation protection. Review UI and fixed time never lift it.
export function resolveWorkload(params) {
  const recovered=params.has('recoveryAttempt');
  const tier=recovered?null:({pace:[921600,1280],900:[1440000,1600],1080:[2073600,1920],clouds:[2073600,1920]})[params.get('desktopTier')];
  const desktopTier=tier?params.get('desktopTier'):null;
  const override=!tier&&params.get('highLoad')==='1'&&!recovered;
  const ceiling=tier?tier[0]:override?2400000:921600;
  const requested=Number(params.get('pixelBudget'));
  return Object.freeze({
    review:params.get('benchmark')==='1', fixed:params.get('fixedBenchmark')==='1',
    override,desktopTier, maxPixels:requested>0?Math.min(ceiling,Math.floor(requested)):ceiling,
    maxDimension:tier?tier[1]:override?2048:1280, targetFps:tier||override?60:30,
    deadlineSeconds:tier&&params.get('desktopTrial')==='1'?45:override?20:null,
    // These are temporary quality reductions, separately reported from optimization.
    cloud:{width:desktopTier==='clouds'?3072:1536,height:desktopTier==='clouds'?768:384,steps:desktopTier==='clouds'?240:120,raysPerFrame:12288},
  });
}

export function fitDrawingBuffer(policy,{width,height,dpr=1,fine=true,scale=1}) {
  width=Math.max(1,Number.isFinite(width)?Math.floor(width):1);
  height=Math.max(1,Number.isFinite(height)?Math.floor(height):1);
  dpr=Number.isFinite(dpr)&&dpr>0?dpr:1;
  scale=Number.isFinite(scale)?Math.max(.1,Math.min(1,scale)):1;
  const pixels=Math.min(policy.maxPixels,fine?policy.maxPixels:655360);
  const ratio=Math.min(dpr,fine?1.6:1,Math.sqrt(pixels/(width*height)),policy.maxDimension/Math.max(width,height))*scale;
  return {ratio,width:Math.max(1,Math.floor(width*ratio)),height:Math.max(1,Math.floor(height*ratio)),maxPixels:pixels};
}

// A pacing gate, not a fixed-step simulation. Missed slots are discarded.
export class FrameClock {
  constructor(fps,start=0) {
    this.interval=1000/fps;this.start=start;this.pauseStart=null;this.pausedTotal=0;
    this.nextDue=start;this.lastSubmission=null;this.submittedFrames=0;this.callbacks=0;
  }
  activeNow(now) {return Math.max(0,(this.pauseStart??now)-this.start-this.pausedTotal);}
  setPaused(paused,now) {
    if(paused && this.pauseStart===null)this.pauseStart=now;
    else if(!paused && this.pauseStart!==null){this.pausedTotal+=Math.max(0,now-this.pauseStart);this.pauseStart=null;this.resetCadence(now);}
  }
  resetCadence(now){this.nextDue=now;this.lastSubmission=null;}
  accept(now) {
    this.callbacks++;
    if(this.pauseStart!==null || now+.1<this.nextDue)return {submit:false};
    const raw=this.lastSubmission===null?this.interval:Math.max(.001,now-this.lastSubmission);
    this.nextDue+=Math.max(1,Math.floor((now-this.nextDue)/this.interval)+1)*this.interval;
    this.lastSubmission=now;this.submittedFrames++;
    return {submit:true,raw,deltaSeconds:Math.min(.1,raw/1000)};
  }
  snapshot(now) {return {targetFps:1000/this.interval,submittedFrames:this.submittedFrames,callbacks:this.callbacks,activeSeconds:this.activeNow(now)/1000,wallSeconds:(now-this.start)/1000,pausedSeconds:(this.pausedTotal+(this.pauseStart===null?0:now-this.pauseStart))/1000,paused:this.pauseStart!==null};}
}

const unsafe=['highLoad','desktopTier','desktopTrial','reflectionTerrain','diagnostics','workloadReview','reviewDpr','dry','graybox','skyState','contextRecovery','reflectionShadow','shadowBootstrap','linearComposite','timerTest','gpuPass','contractAudit','fixedBenchmark','pixelBudget'];
export function recoveryPlan(href,storedAttempts=0) {
  const url=new URL(href),attempts=Math.max(Number(url.searchParams.get('recoveryAttempt'))||0,Number(storedAttempts)||0);
  if(attempts>=1)return {allowed:false,attempts,url:null};
  unsafe.forEach(key=>url.searchParams.delete(key));
  url.searchParams.set('quality','mobile');url.searchParams.set('gpuScope','none');url.searchParams.set('recoveryAttempt',String(attempts+1));
  return {allowed:true,attempts:attempts+1,url:url.href};
}
