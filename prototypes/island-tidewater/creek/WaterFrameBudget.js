import {ComputeKernel, Readback, StorageBuffer} from '../vendor/tidewater/src/engine/webgpu.js';

const minimumScale = .75;
const standardWaterFloor = .8;

// Sample the visible water mask, after depth testing, on a 16 × 8 grid.
// This also catches inland water, and costs one workgroup and four bytes
// of asynchronous readback every half second. Looking at the sky on a
// beach or at the meadow beyond a lake can therefore return to full detail.
export class WaterFrameBudget {
  constructor(app) {
    this.app = app;
    this.automatic = true;
    this.scale = 1;
    this.viewMinimumScale = standardWaterFloor;
    this.seaLevel = app.creekData.island.seaLevel;
    this.shoreStations = app.creekData.hydrology.coasts.filter(site =>
      ['shell-beach', 'rocky-cove', 'tidal-estuary'].includes(site.kind));
    this.coverage = 0;
    this.lastProbe = -Infinity;
    this.lastChange = -Infinity;
    this.drySince = null;
    this.windowStart = null;
    this.blocked = 0;
    this.frames = 0;
    this.deficitWindows = 0;
    this.raiseAfter = 0;
    this.fullDetail = null;
    this.completionMs = 0;
    this.fastSince = null;
    this.result = new StorageBuffer({label:'Visible water fraction',count:1,type:'f32'});
    this.readback = new Readback({byteLength:4,ring:2,label:'Water cover'});
    this.readback.onData = bytes => { this.coverage = new Float32Array(bytes)[0]; };
    this.probe = new ComputeKernel({
      label:'Visible water fraction',
      bindings:{
        waterCoverMask:{texture:() => app.sceneRenderer.waterMaskTexture},
        waterCoverResult:{storage:this.result,access:'read_write'}
      },
      workgroupSize:[64,1,1],
      code:`
var<workgroup> votes:array<u32,64>;
@compute @workgroup_size(WG_X,WG_Y,WG_Z)
fn main(@builtin(local_invocation_index) i:u32) {
  let size=textureDimensions(waterCoverMask);
  let cell=vec2u(i%16u,i/16u);
  var sum=0u;
  for(var block=0u;block<2u;block++){
    let uv=(vec2f(cell+vec2u(0u,block*4u))+.5)/vec2f(16.0,8.0);
    let pixel=clamp(vec2i(uv*vec2f(size)),vec2i(0),vec2i(size)-1);
    sum+=select(0u,1u,textureLoad(waterCoverMask,pixel,0).g>.5);
  }
  votes[i]=sum;
  workgroupBarrier();
  if(i==0u){
    var count=0u;
    for(var j=0u;j<64u;j++){count+=votes[j];}
    waterCoverResult[0]=f32(count)/128.;
  }
}`
    });
  }

  sampleMask(now) {
    if (!this.automatic || now - this.lastProbe < 450) return;
    this.lastProbe = now;
    this.probe.dispatch(1);
    this.readback.request(this.result);
  }

  setQuality(value) {
    this.automatic = value === 'auto';
    this.drySince = null;
    this.viewMinimumScale = standardWaterFloor;
    this.coverage = 0;
    this.windowStart = null;
    this.deficitWindows = 0;
    this.apply(this.automatic ? 1 : Number(value), performance.now());
  }

  // Under-sampled wave edges need a wider spread of temporal samples. Store
  // the visitor's live settings so leaving the water recovers its original
  // grass/foliage response, including an explicitly adjusted sharpener.
  apply(scale, now) {
    const {taau, params} = this.app.post;
    const sharpen = params.sharpen;
    if (this.automatic && scale < 1) {
      if (!this.fullDetail) {
        this.fullDetail = {phases:taau.jitterPhaseOverride, jitter:taau.jitterMoving, sharpen:sharpen.value, refraction:this.app.refraction.scale};
        taau.jitterPhaseOverride = 8;
        taau.jitterMoving = .72;
        if (Math.abs(sharpen.value - .45) < .001) sharpen.value = .6;
      }
      // Keep the displayed wave normals and foam at the chosen scene density.
      // The separately guarded view supplies the submerged colour behind them.
      this.app.refraction.scale = this.refractionDensity(scale);
    } else if (this.fullDetail) {
      taau.jitterPhaseOverride = this.fullDetail.phases;
      taau.jitterMoving = this.fullDetail.jitter;
      if (Math.abs(sharpen.value - .6) < .001) sharpen.value = this.fullDetail.sharpen;
      this.app.refraction.scale = this.fullDetail.refraction;
      this.fullDetail = null;
    }
    this.scale = scale;
    this.lastChange = now;
    this.fastSince = null;
    this.completionMs = 0;
    this.app.setRenderScale(scale);
  }

  completed(milliseconds) {
    if (!this.automatic || milliseconds <= 0 || milliseconds >= 80) return;
    this.completionMs = this.completionMs ? this.completionMs * .9 + milliseconds * .1 : milliseconds;
  }

  refractionDensity(scale) {
    if (scale > standardWaterFloor) return .35;
    const {camera, cameraWaterHeight, coastalActive} = this.app;
    const height = camera.position.y - this.seaLevel;
    // From a low aerial view the surface reveals small variations in the bed.
    // Give that separate image more samples without resizing the entire scene.
    const looksIntoSea = coastalActive && Math.abs(cameraWaterHeight - this.seaLevel) < 2.5 &&
      height >= 45 && height <= 270 && camera.matrixWorld.elements[9] >= .18;
    return scale === standardWaterFloor && looksIntoSea ? .45 : .30;
  }

  // Small breakers close to a sandy strand need more pixels than open water.
  // The exposed boulders can use a cheaper tier when a mixed view is GPU-bound.
  // Use the authored shore types and the real water mask as the visitor moves.
  waterFloor() {
    const {x, y, z} = this.app.camera.position;
    const height = y - this.seaLevel;
    if (!this.app.coastalActive || height < -.4 || height > 18) return standardWaterFloor;
    for (const site of this.shoreStations) {
      if ((x - site.x) ** 2 + (z - site.z) ** 2 > 96 ** 2) continue;
      if (site.kind === 'rocky-cove' && height > 2 && this.coverage <= .5) return minimumScale;
      return .85;
    }
    return standardWaterFloor;
  }

  // A late browser callback alone does not establish GPU pressure. Count
  // opportunities lost to the actual two-submission queue, at any refresh rate.
  observe(now, queueFull) {
    if (!this.automatic) return;
    if (this.windowStart === null || now - this.windowStart > 1500) {
      this.windowStart = now;
      this.frames = 0;
      this.blocked = 0;
    }
    if (queueFull) this.blocked++;
    else this.frames++;
    const span = now - this.windowStart;
    if (span < 600) return;
    const fps = this.frames * 1000 / span, blocked = this.blocked;
    this.windowStart = now;
    this.frames = 0;
    this.blocked = 0;
    const wet = this.coverage >= .13 || this.app.camera.position.y < this.app.cameraWaterHeight - .08;
    if (!wet) {
      this.drySince ??= now;
      this.deficitWindows = 0;
      if (this.coverage < .055 && this.scale < 1 && now - this.drySince > 650) this.apply(1,now);
      return;
    }
    this.drySince = null;
    this.viewMinimumScale = this.waterFloor();
    if (this.fullDetail) this.app.refraction.scale = this.refractionDensity(this.scale);
    if (this.scale < this.viewMinimumScale) {
      this.apply(this.viewMinimumScale, now);
      return;
    }
    if (now - this.lastChange < 850) return;
    const deficit = fps < 59.5 && blocked > 0;
    this.deficitWindows = deficit ? this.deficitWindows + 1 : 0;
    if (this.scale > this.viewMinimumScale && deficit && (blocked >= 2 || this.deficitWindows >= 2 || this.completionMs > 23)) {
      const next = this.scale === 1 ? (fps < 53 ? .85 : .9) : this.scale - .05;
      this.apply(Math.max(this.viewMinimumScale, Math.round(next * 20) / 20), now);
      this.raiseAfter = now + 14000;
      this.deficitWindows = 0;
    } else if (this.scale < 1 && fps >= 59 && !blocked && this.completionMs > 0 && this.completionMs < 16.4 && now > this.raiseAfter) {
      this.fastSince ??= now;
      if (now - this.fastSince > 4500) this.apply(Math.min(1, Math.round((this.scale + .05) * 20) / 20), now);
    } else this.fastSince = null;
  }

  state() {
    return {automatic:this.automatic, scale:this.scale, minimumScale, viewMinimumScale:this.viewMinimumScale, refractionScale:this.app.refraction.scale, visibleWater:this.coverage, completionMs:this.completionMs};
  }
}
