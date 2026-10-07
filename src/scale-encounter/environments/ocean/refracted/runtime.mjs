// SPDX-License-Identifier: AGPL-3.0-only
import * as THREE from 'three';
import { createRefractedCausticField, refractSun, flatIrradiance } from './caustic-atlas.mjs';
import { createWaveUniforms } from './wave-field.mjs';
import { CLOUD_BANK_GLSL } from './cloud-bank.mjs';
import { createPhysicalWaterSurface } from './water-surface.mjs';
import { decorateSharedActorLighting, preserveBlueDepthPalette } from './subject-light.mjs';
import { MEDIUM, WAVE_FOOTPRINT } from './config.mjs';
function analyticField() {
    const direction = new THREE.Vector3(...refractSun(MEDIUM.sunDirection));
    const waveUniforms = createWaveUniforms({ meanY: 12.5, footprint: WAVE_FOOTPRINT });
    const uniforms = { ...waveUniforms, uCloudBankEnabled: { value: 1 }, uCloudOrigin: { value: new THREE.Vector2() }, uCausticSeaLevel: { value: 12.5 }, uCausticSigmaT: { value: new THREE.Vector3(...MEDIUM.sigmaT) }, uCausticMeanDirection: { value: direction }, uCausticFlatIrradiance: { value: new THREE.Vector3(...flatIrradiance(0, MEDIUM)) } };
    return { uniforms, waveUniforms, meanRefractedDirection: direction, samplerGLSL: `${CLOUD_BANK_GLSL}
uniform float uCausticSeaLevel;uniform vec3 uCausticSigmaT,uCausticMeanDirection,uCausticFlatIrradiance;
vec3 sampleField(vec3 p){float depth=max(0.,uCausticSeaLevel-p.y);vec2 entry=p.xz-uCausticMeanDirection.xz*depth/max(-uCausticMeanDirection.y,.001);return uCausticFlatIrradiance*exp(-uCausticSigmaT*depth/max(-uCausticMeanDirection.y,.001))*cloudSolarTransmission(entry);}`, update(t) { waveUniforms.uWaveTime.value = t; }, dispose() { }, diagnostics: { atlasBytes: 0 } };
}
export function createOceanRefractedRuntime(renderer, candidate, origin = new THREE.Vector3()) {
    const hdrSupported = renderer.extensions.has('EXT_color_buffer_float');
    const supported = ['EXT_color_buffer_float', 'EXT_float_blend', 'OES_texture_float_linear'].every(x => renderer.extensions.has(x));
    let field = supported ? createRefractedCausticField(THREE, renderer, { ...MEDIUM, captureRenderState: () => import.meta.env.MODE === 'review' && renderer.domElement.dataset.oceanReviewCaptureState === 'true', photonResolution: 96, sliceResolution: 128, layers: 20, sunSamples: 4, meanY: 12.5, maxDepth: 40, waveFootprint: WAVE_FOOTPRINT, depthExponent: 1.2, bounds: [origin.x - 48, origin.z - 72, origin.x + 48, origin.z + 48] }) : analyticField();
    field.uniforms.uCloudOrigin.value.set(origin.x, origin.z);
    let tier = supported ? 'refracted-balanced' : 'analytic-capability';
    const backdrop = candidate.root.getObjectByName('ocean-background-approved-exhibit-reference');
    preserveBlueDepthPalette(candidate.radianceTexture, backdrop.material.uniforms.uSunColour.value);
    backdrop.material.fragmentShader = backdrop.material.fragmentShader.replace('#include <tonemapping_fragment>', '').replace('#include <colorspace_fragment>', '');
    backdrop.material.toneMapped = false;
    backdrop.material.fragmentShader = `varying vec3 vViewDirection;uniform sampler2D uRadianceLut;void main(){vec3 d=normalize(vViewDirection);vec2 uv=vec2(atan(d.z,d.x)*.15915494309+.5,asin(clamp(d.y,-1.,1.))*.31830988618+.5);gl_FragColor=vec4(texture2D(uRadianceLut,uv).rgb,1.);}`;
    for (const child of candidate.root.children)
        child.visible = !!child.getObjectById(backdrop.id);
    const water = createPhysicalWaterSurface(field, candidate.radianceTexture);
    candidate.root.add(water.mesh);
    const light = new THREE.DirectionalLight(0xffffff, 1);
    light.position.copy(origin).addScaledVector(field.meanRefractedDirection, -50);
    light.target.position.copy(origin);
    candidate.root.add(light, light.target);
    const target = new THREE.WebGLRenderTarget(1, 1, { type: hdrSupported ? THREE.HalfFloatType : THREE.UnsignedByteType, depthBuffer: true });
    target.texture.colorSpace = THREE.LinearSRGBColorSpace;
    target.depthTexture = new THREE.DepthTexture(1, 1, THREE.UnsignedIntType);
    const volumeUniforms = { ...field.uniforms, uSceneColor: { value: target.texture }, uSceneDepth: { value: target.depthTexture }, uInverseProjection: { value: new THREE.Matrix4() }, uCameraWorld: { value: new THREE.Matrix4() }, uEye: { value: new THREE.Vector3() }, uSteps: { value: 96 }, uDebug: { value: 0 }, uReviewAtlas: { value: field.texture ?? candidate.radianceTexture } };
    function volumeMaterial() {
        return new THREE.ShaderMaterial({ uniforms: volumeUniforms, depthTest: false, depthWrite: false, vertexShader: 'varying vec2 vUv;void main(){vUv=uv;gl_Position=vec4(position.xy,0.,1.);}', fragmentShader: `precision highp float;varying vec2 vUv;uniform sampler2D uSceneColor,uSceneDepth,uReviewAtlas;uniform mat4 uInverseProjection,uCameraWorld;uniform vec3 uEye;uniform float uSteps;uniform int uDebug;${field.samplerGLSL}
 vec3 unproject(float depth){vec4 p=uInverseProjection*vec4(vUv*2.-1.,depth*2.-1.,1.);return (uCameraWorld*vec4(p.xyz/p.w,1.)).xyz;}
 void main(){float depth=texture2D(uSceneDepth,vUv).x;vec3 ray=normalize(unproject(.9999)-uEye);float path=min(depth<.999999?length(unproject(depth)-uEye):72.,72.);
 // Clip the path to water, including views above the wave surface. Scene depth
 // stops scattering at subjects; an opaque animal never receives light behind it.
 float start=0.;if(uEye.y>uCausticSeaLevel){if(ray.y>=0.)path=0.;else start=min(path,(uCausticSeaLevel-uEye.y)/ray.y);}else if(ray.y>0.)path=min(path,max(0.,(uCausticSeaLevel-uEye.y)/ray.y));
 float dt=max(0.,path-start)/uSteps;vec3 st=exp(-uCausticSigmaT*dt),weight=(vec3(1.)-st)/uCausticSigmaT,T=vec3(1.),S=vec3(0.);float g=.8,mu=dot(ray,-uCausticMeanDirection),phase=(1.-g*g)/(12.56637*pow(max(.0001,1.+g*g-2.*g*mu),1.5));
 for(int i=0;i<96;i++){if(float(i)>=uSteps)break;vec3 p=uEye+ray*(start+(float(i)+.5)*dt);vec3 ambient=vec3(${MEDIUM.ambientIrradiance.join(',')})*exp(-uCausticSigmaT*max(0.,uCausticSeaLevel-p.y));S+=T*vec3(${MEDIUM.sigmaS.join(',')})*(sampleField(p)*phase+ambient/12.56637)*weight;T*=st;}
 vec3 color=texture2D(uSceneColor,vUv).rgb*T+S;if(uDebug==1)color=texture2D(uSceneColor,vUv).rgb;if(uDebug==2)color=S;if(uDebug==3)color=T;if(uDebug==4)color=vec3(min(1.,length(unproject(depth)-uEye)/72.));if(uDebug==5)color=texture2D(uSceneColor,vUv).rgb;if(uDebug==6)color=texture2D(uReviewAtlas,vUv).rgb*.15;if(uDebug==7)color=vec3(depth);gl_FragColor=vec4(color,1.);
 #include <tonemapping_fragment>
 #include <colorspace_fragment>
 }` });
    }
    const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), volumeMaterial()), screen = new THREE.Scene();
    screen.add(quad);
    const screenCamera = new THREE.Camera();
    const materials = new Set(), leases = [];
    let lastWave = -Infinity, elapsed = 0, reduced = false, disposed = false, slowFrames = 0, frames = 0;
    const drawSize = new THREE.Vector2();
    const gl = renderer.getContext(), timer = gl.getExtension('EXT_disjoint_timer_query_webgl2'), queries = [], cpuSamples = [], gpuSamples = [], frameSamples = [];
    let lastFrame = 0;
    const percentile = (values, q) => values.length ? [...values].sort((a, b) => a - b)[Math.floor((values.length - 1) * q)] : null;
    const diagnostics = { tier, reason: supported ? 'bounded real-time atlas' : 'missing float render/blend/filter extension', atlasBytes: field.diagnostics.atlasBytes, photonResolution: 96, layers: 20, waveFootprint: WAVE_FOOTPRINT, volumeSteps: 96, renderScale: 1, updates: 0, waveTime: 0, sideDiffuseFraction: .65, hdrScene: hdrSupported };
    function decorate(scene) { scene.traverse(o => { if (!o.isMesh)
        return; const list = Array.isArray(o.material) ? o.material : [o.material]; if (!list.some(m => m.isMeshStandardMaterial && !materials.has(m)))
        return; for (const m of list)
        materials.add(m); leases.push(decorateSharedActorLighting({ traverse: callback => callback(o) }, field)); }); }
    function downgrade() {
        if (!tier.startsWith('refracted'))
            return;
        if (tier === 'refracted-balanced') {
            tier = 'refracted-economy';
            Object.assign(diagnostics, { tier, reason: 'sustained frame intervals above 28ms: reduced resolution first', volumeSteps: 64, renderScale: .75 });
            volumeUniforms.uSteps.value = 64;
            return;
        }
        for (const lease of leases)
            lease.restore();
        leases.length = 0;
        materials.clear();
        field.dispose();
        field = analyticField();
        field.uniforms.uCloudOrigin.value.set(origin.x, origin.z);
        Object.assign(volumeUniforms, field.uniforms);
        volumeUniforms.uReviewAtlas.value = field.texture ?? candidate.radianceTexture;
        delete diagnostics.atlasTiles;
        delete diagnostics.atlasRenderStates;
        Object.assign(water.uniforms, field.uniforms);
        quad.material.dispose();
        quad.material = volumeMaterial();
        tier = 'analytic-adaptive';
        lastWave = -Infinity;
        Object.assign(diagnostics, { tier, reason: 'slow after resolution reduction: analytic illumination', atlasBytes: 0, volumeSteps: 48, renderScale: .75 });
        volumeUniforms.uSteps.value = 48;
    }
    return { diagnostics, update(t, isReduced, camera) { elapsed = t; reduced = isReduced; backdrop.position.copy(camera.position); backdrop.material.uniforms.uTime.value = isReduced ? 0 : t; }, render(scene, camera) {
            if (disposed)
                return;
            const start = performance.now();
            const interval = start - lastFrame;
            lastFrame = start;
            if (interval > 0 && interval < 200 && !globalThis.document.hidden) {
                frameSamples.push(interval);
                if (frameSamples.length > 300)
                    frameSamples.shift();
            }
            for (let i = queries.length - 1; i >= 0; i--) {
                const q = queries[i];
                if (gl.getQueryParameter(q, gl.QUERY_RESULT_AVAILABLE)) {
                    if (!gl.getParameter(timer.GPU_DISJOINT_EXT)) {
                        gpuSamples.push(gl.getQueryParameter(q, gl.QUERY_RESULT) / 1e6);
                        if (gpuSamples.length > 60)
                            gpuSamples.shift();
                    }
                    gl.deleteQuery(q);
                    queries.splice(i, 1);
                }
            }
            const query = timer && queries.length < 4 && frames % 7 === 0 ? gl.createQuery() : null;
            if (query)
                gl.beginQuery(timer.TIME_ELAPSED_EXT, query);
            const priorAutoReset = renderer.info.autoReset;
            renderer.info.autoReset = false;
            renderer.info.reset();
            decorate(scene);
            const requestedWave = import.meta.env.MODE === 'review' || import.meta.env.MODE === 'e2e' ? Number(renderer.domElement.dataset.oceanReviewWaveTime) : NaN;
            const waveTime = reduced ? 0 : Number.isFinite(requestedWave) ? requestedWave : Math.floor(elapsed * 12) / 12;
            if (waveTime !== lastWave) {
                field.update(waveTime);
                lastWave = waveTime;
                diagnostics.waveTime = waveTime;
                diagnostics.updates++;
            }
            renderer.getDrawingBufferSize(drawSize);
            const width = Math.max(1, Math.round(drawSize.x * diagnostics.renderScale)), height = Math.max(1, Math.round(drawSize.y * diagnostics.renderScale));
            if (target.width !== width || target.height !== height)
                target.setSize(width, height);
            if (import.meta.env.MODE === 'review' && renderer.domElement.dataset.oceanReviewCameraPose) {
                try {
                    const pose = JSON.parse(renderer.domElement.dataset.oceanReviewCameraPose);
                    if ([pose.position, pose.target].every(v => Array.isArray(v) && v.length === 3 && v.every(Number.isFinite))) {
                        camera.position.fromArray(pose.position);
                        camera.up.set(0, 1, 0);
                        camera.lookAt(...pose.target);
                        if (Number.isFinite(pose.fov) && pose.fov >= 5 && pose.fov <= 120) camera.fov = pose.fov;
                        camera.updateProjectionMatrix();
                    }
                } catch { /* Malformed review-only camera input does not affect the scene. */ }
            }
            backdrop.position.copy(camera.position);
            camera.updateMatrixWorld();
            water.uniforms.uInverseProjection.value.copy(camera.projectionMatrixInverse);
            water.uniforms.uCameraWorld.value.copy(camera.matrixWorld);
            volumeUniforms.uInverseProjection.value.copy(camera.projectionMatrixInverse);
            volumeUniforms.uCameraWorld.value.copy(camera.matrixWorld);
            volumeUniforms.uEye.value.copy(camera.position);
            volumeUniforms.uDebug.value = import.meta.env.MODE === 'review' ? Number(renderer.domElement.dataset.oceanReviewDebug ?? 0) : 0;
            if (import.meta.env.MODE === 'review') water.uniforms.uReviewSurfaceDebug.value = Number(renderer.domElement.dataset.oceanReviewSurfaceDebug ?? 0);
            const prior = { target: renderer.getRenderTarget(), tone: renderer.toneMapping };
            try {
                renderer.toneMapping = THREE.NoToneMapping;
                renderer.setRenderTarget(target);
                renderer.clear();
                const hiddenForWater = [];
                if (volumeUniforms.uDebug.value === 5) scene.traverse(o => {
                    if (o.isMesh && (Array.isArray(o.material) ? o.material : [o.material]).some(m => m.isMeshStandardMaterial)) { hiddenForWater.push([o, o.visible]); o.visible = false; }
                });
                try { renderer.render(scene, camera); }
                finally { for (const [object, visible] of hiddenForWater) object.visible = visible; }
                if (import.meta.env.MODE === 'review' && renderer.domElement.dataset.oceanReviewCaptureState === 'true') {
                    diagnostics.sceneRenderState = { viewport: Array.from(gl.getParameter(gl.VIEWPORT)), scissor: Array.from(gl.getParameter(gl.SCISSOR_BOX)), scissorTest: gl.isEnabled(gl.SCISSOR_TEST), targetSize: [target.width, target.height], dpr: renderer.getPixelRatio(), cameraPosition: camera.position.toArray(), cameraQuaternion: camera.quaternion.toArray(), cloudOrigin: origin.toArray(), fov: camera.fov, near: camera.near, far: camera.far };
                    diagnostics.atlasRenderStates = field.diagnostics.tileRenderStates;
                }
                renderer.toneMapping = prior.tone;
                renderer.setRenderTarget(prior.target);
                renderer.render(screen, screenCamera);
                if (import.meta.env.MODE === 'review' && renderer.domElement.dataset.oceanReviewCaptureState === 'true') {
                    diagnostics.finalRenderState = { viewport: Array.from(gl.getParameter(gl.VIEWPORT)), scissor: Array.from(gl.getParameter(gl.SCISSOR_BOX)), scissorTest: gl.isEnabled(gl.SCISSOR_TEST), drawingBuffer: [gl.drawingBufferWidth, gl.drawingBufferHeight] };
                    if (renderer.domElement.dataset.oceanReviewReadAtlas === 'true' && field.target) {
                        delete renderer.domElement.dataset.oceanReviewReadAtlas;
                        const atlas = field.target, pixels = new Float32Array(atlas.width * atlas.height * 4);
                        renderer.readRenderTargetPixels(atlas, 0, 0, atlas.width, atlas.height, pixels);
                        diagnostics.atlasTiles = Array.from({ length: field.options.layers }, (_, layer) => {
                            const columns = Math.ceil(Math.sqrt(field.options.layers)), stride = field.options.sliceResolution + 2;
                            const left = layer % columns * stride + 1, top = Math.floor(layer / columns) * stride + 1, sum = [0, 0, 0];
                            let nonzero = 0, nonfinite = 0;
                            for (let y = top; y < top + field.options.sliceResolution; y++) for (let x = left; x < left + field.options.sliceResolution; x++) {
                                const offset = (y * atlas.width + x) * 4;
                                if (pixels[offset] + pixels[offset + 1] + pixels[offset + 2] > 0) nonzero++;
                                for (let c = 0; c < 3; c++) { const v = pixels[offset + c]; if (Number.isFinite(v)) sum[c] += v; else nonfinite++; }
                            }
                            const count = field.options.sliceResolution ** 2;
                            return { layer, mean: sum.map(v => v / count), nonzeroFraction: nonzero / count, nonfinite };
                        });
                    }
                }
            }
            finally {
                renderer.toneMapping = prior.tone;
                renderer.setRenderTarget(prior.target);
                renderer.info.autoReset = priorAutoReset;
            }
            if (query) {
                gl.endQuery(timer.TIME_ELAPSED_EXT);
                queries.push(query);
            }
            const cost = performance.now() - start;
            cpuSamples.push(cost);
            if (cpuSamples.length > 300)
                cpuSamples.shift();
            frames++;
            if (interval > 28 && interval < 200 && !globalThis.document.hidden)
                slowFrames++;
            if (frames === 120) {
                if (slowFrames > 80 && !(import.meta.env.MODE === 'review' && renderer.domElement.dataset.oceanReviewHoldQuality === 'true'))
                    downgrade();
                frames = 0;
                slowFrames = 0;
            }
            if (frames % 30 === 0) {
                Object.assign(diagnostics, { cpuP50Ms: percentile(cpuSamples, .5), cpuP95Ms: percentile(cpuSamples, .95), frameP50Ms: percentile(frameSamples, .5), frameP95Ms: percentile(frameSamples, .95), gpuP50Ms: percentile(gpuSamples, .5), gpuP95Ms: percentile(gpuSamples, .95), drawCalls: renderer.info.render.calls, triangles: renderer.info.render.triangles, drawingBuffer: [drawSize.x, drawSize.y], targetSize: [width, height], gpuTimerAvailable: !!timer, frameSamples: frameSamples.length });
                renderer.domElement.dataset.oceanRefracted = JSON.stringify(diagnostics);
            }
        }, dispose() { if (disposed)
            return; disposed = true; delete renderer.domElement.dataset.oceanRefracted; for (const query of queries)
            gl.deleteQuery(query); for (const lease of leases)
            lease.restore(); water.mesh.removeFromParent(); water.dispose(); field.dispose(); target.dispose(); quad.geometry.dispose(); quad.material.dispose(); light.removeFromParent(); light.target.removeFromParent(); } };
}
