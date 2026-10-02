// SPDX-License-Identifier: AGPL-3.0-only
import * as THREE from 'three';
import { createRefractedCausticField, refractSun, flatIrradiance } from './caustic-atlas.mjs';
import { createWaveUniforms, WAVE_COMPONENTS } from './wave-field.mjs';
import { CLOUD_BANK_GLSL } from './cloud-bank.mjs';
import { createPhysicalWaterSurface } from './water-surface.mjs';
import { decorateSharedActorLighting, preserveBlueDepthPalette } from './subject-light.mjs';
import { MEDIUM, WAVE_FOOTPRINT, ACTOR_LIGHTING } from './config.mjs';
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
    const requestedPhotons = import.meta.env.MODE === 'review' ? Number(renderer.domElement.dataset.oceanReviewPhotonResolution) : NaN;
    const photonResolution = [96, 128, 192, 256].includes(requestedPhotons) ? requestedPhotons : 128;
    let field = supported ? createRefractedCausticField(THREE, renderer, { ...MEDIUM, captureRenderState: () => import.meta.env.MODE === 'review' && renderer.domElement.dataset.oceanReviewCaptureState === 'true', photonResolution, sliceResolution: 160, layers: 20, sunSamples: 4, meanY: 12.5, maxDepth: 40, waveFootprint: WAVE_FOOTPRINT, depthExponent: 1.2, bounds: [origin.x - 36, origin.z - 64, origin.x + 36, origin.z + 40] }) : analyticField();
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
    // Bound the expensive medium pass as well as the opaque scene. Rendering
    // only the scene at reduced resolution left the ray march at native Retina
    // resolution and needlessly triggered the loss of the refracted field.
    const composite = new THREE.WebGLRenderTarget(1, 1, { type: hdrSupported ? THREE.HalfFloatType : THREE.UnsignedByteType, depthBuffer: false });
    composite.texture.colorSpace = THREE.LinearSRGBColorSpace;
    const maxMediumPixels = 2_000_000;
    let qualityScale = 1;
    const volumeUniforms = { ...field.uniforms, uSceneColor: { value: target.texture }, uSceneDepth: { value: target.depthTexture }, uInverseProjection: { value: new THREE.Matrix4() }, uCameraWorld: { value: new THREE.Matrix4() }, uEye: { value: new THREE.Vector3() }, uSteps: { value: 96 }, uMaxPathMetres: { value: 72 }, uDebug: { value: 0 }, uReviewAtlas: { value: field.texture ?? candidate.radianceTexture } };
    function volumeMaterial() {
        return new THREE.ShaderMaterial({ uniforms: volumeUniforms, toneMapped: false, depthTest: false, depthWrite: false, vertexShader: 'varying vec2 vUv;void main(){vUv=uv;gl_Position=vec4(position.xy,0.,1.);}', fragmentShader: `precision highp float;varying vec2 vUv;uniform sampler2D uSceneColor,uSceneDepth,uReviewAtlas;uniform mat4 uInverseProjection,uCameraWorld;uniform vec3 uEye;uniform float uSteps,uMaxPathMetres;uniform int uDebug;${field.samplerGLSL}
 vec3 unproject(float depth){vec4 p=uInverseProjection*vec4(vUv*2.-1.,depth*2.-1.,1.);return (uCameraWorld*vec4(p.xyz/p.w,1.)).xyz;}
 void main(){float depth=texture2D(uSceneDepth,vUv).x;vec3 ray=normalize(unproject(.9999)-uEye);float path=min(depth<.999999?length(unproject(depth)-uEye):uMaxPathMetres,uMaxPathMetres);
 // Clip the path to water, including views above the wave surface. Scene depth
 // stops scattering at subjects; an opaque animal never receives light behind it.
 float start=0.;if(uEye.y>uCausticSeaLevel){if(ray.y>=0.)path=0.;else start=min(path,(uCausticSeaLevel-uEye.y)/ray.y);}else if(ray.y>0.)path=min(path,max(0.,(uCausticSeaLevel-uEye.y)/ray.y));
 float dt=max(0.,path-start)/uSteps;vec3 st=exp(-uCausticSigmaT*dt),weight=(vec3(1.)-st)/uCausticSigmaT,T=vec3(1.),S=vec3(0.);float g=${MEDIUM.anisotropy},mu=dot(ray,-uCausticMeanDirection),phase=(1.-g*g)/(12.56637*pow(max(.0001,1.+g*g-2.*g*mu),1.5));
 for(int i=0;i<96;i++){if(float(i)>=uSteps)break;vec3 p=uEye+ray*(start+(float(i)+.5)*dt);vec3 ambient=vec3(${MEDIUM.ambientIrradiance.join(',')})*exp(-uCausticSigmaT*max(0.,uCausticSeaLevel-p.y));S+=T*vec3(${MEDIUM.sigmaS.join(',')})*(sampleField(p)*phase+ambient/12.56637)*weight;T*=st;}
 vec3 color=texture2D(uSceneColor,vUv).rgb*T+S;if(uDebug==1)color=texture2D(uSceneColor,vUv).rgb;if(uDebug==2)color=S;if(uDebug==3)color=T;if(uDebug==4)color=vec3(min(1.,length(unproject(depth)-uEye)/72.));if(uDebug==5)color=texture2D(uSceneColor,vUv).rgb;if(uDebug==6)color=texture2D(uReviewAtlas,vUv).rgb*.15;if(uDebug==7)color=vec3(depth);gl_FragColor=vec4(color,1.);
 }` });
    }
    const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), volumeMaterial()), screen = new THREE.Scene();
    screen.add(quad);
    const finalMaterial = new THREE.ShaderMaterial({
        uniforms: { uComposite: { value: composite.texture } }, depthTest: false, depthWrite: false,
        vertexShader: 'varying vec2 vUv;void main(){vUv=uv;gl_Position=vec4(position.xy,0.,1.);}',
        fragmentShader: `varying vec2 vUv;uniform sampler2D uComposite;void main(){gl_FragColor=texture2D(uComposite,vUv);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
        }`
    });
    const finalScreen = new THREE.Scene();
    finalScreen.add(new THREE.Mesh(quad.geometry, finalMaterial));
    const screenCamera = new THREE.Camera();
    const materials = new Set(), leases = [];
    const reviewActorUniforms = import.meta.env.MODE === 'review' ? { uReviewActorMode: { value: 0 }, uReviewDiffuseGain: { value: 1 }, uReviewDirectGain: { value: 1 }, uReviewGradeOff: { value: 0 } } : null;
    let lastWave = -Infinity, elapsed = 0, reduced = false, disposed = false, slowFrames = 0, frames = 0;
    const drawSize = new THREE.Vector2();
    const gl = renderer.getContext(), timer = gl.getExtension('EXT_disjoint_timer_query_webgl2'), queries = [], cpuSamples = [], gpuSamples = [], frameSamples = [];
    let lastFrame = 0;
    const percentile = (values, q) => values.length ? [...values].sort((a, b) => a - b)[Math.floor((values.length - 1) * q)] : null;
    const diagnostics = { tier, reason: supported ? 'bounded real-time atlas and medium pixels' : 'missing float render/blend/filter extension', atlasBytes: field.diagnostics.atlasBytes, photonResolution: field.options?.photonResolution ?? 0, layers: field.options?.layers ?? 0, waveFootprint: WAVE_FOOTPRINT, volumeSteps: 96, renderScale: 1, maxMediumPixels, updates: 0, waveTime: 0, sideDiffuseFraction: ACTOR_LIGHTING.sideDiffuseFraction, diffuseGain: ACTOR_LIGHTING.diffuseGain, hdrScene: hdrSupported };
    function decorate(scene) { scene.traverse(o => { if (!o.isMesh)
        return; const list = Array.isArray(o.material) ? o.material : [o.material]; if (!list.some(m => m.isMeshStandardMaterial && !materials.has(m)))
        return; for (const m of list)
        materials.add(m); leases.push(decorateSharedActorLighting({ traverse: callback => callback(o) }, field, reviewActorUniforms)); }); }
    function downgrade() {
        if (!tier.startsWith('refracted'))
            return;
        if (tier === 'refracted-balanced') {
            tier = 'refracted-economy';
            qualityScale = .75;
            Object.assign(diagnostics, { tier, reason: 'sustained frame intervals above 28ms: reduced scene and medium resolution', volumeSteps: 64 });
            volumeUniforms.uSteps.value = 64;
            return;
        }
        if (tier === 'refracted-economy') {
            tier = 'refracted-low';
            qualityScale = .5;
            Object.assign(diagnostics, { tier, reason: 'slow after first reduction: retain caustics at lower medium resolution', volumeSteps: 48 });
            volumeUniforms.uSteps.value = 48;
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
        Object.assign(diagnostics, { tier, reason: 'slow after both scene and medium reductions: analytic illumination', atlasBytes: 0, photonResolution: 0, layers: 0, volumeSteps: 48 });
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
            if (import.meta.env.MODE === 'review') {
                const flags = renderer.domElement.dataset;
                // Paired remote-opening studies: no density, lighting or camera
                // change. Production and the unflagged review retain72 metres.
                const requestedPath = Number(flags.oceanReviewMaxPathMetres);
                volumeUniforms.uMaxPathMetres.value = [72, 96, 120].includes(requestedPath) ? requestedPath : 72;
                const surfaceNear = Number(flags.oceanReviewSurfaceNearMetres), surfaceFar = Number(flags.oceanReviewSurfaceFarMetres);
                const validSurface = [[35, 160], [80, 240]].some(([near, far]) => near === surfaceNear && far === surfaceFar);
                water.uniforms.uSurfaceFadeNear.value = validSurface ? surfaceNear : 35;
                water.uniforms.uSurfaceFadeFar.value = validSurface ? surfaceFar : 160;
                for (const [key, attribute, fallback] of [['uCloudBankEnabled', 'oceanReviewCloudEnabled', 1], ['uWaveScale', 'oceanReviewWaveScale', 1], ['uWaveFootprint', 'oceanReviewWaveFootprint', WAVE_FOOTPRINT]]) {
                    const requested = Number(flags[attribute]);
                    const value = Number.isFinite(requested) ? requested : fallback;
                    if (field.uniforms[key].value !== value) { field.uniforms[key].value = value; lastWave = -Infinity; }
                }
                for (const [key, attribute, fallback] of [['uReviewActorMode', 'oceanReviewActorMode', 0], ['uReviewDiffuseGain', 'oceanReviewDiffuseGain', 1], ['uReviewDirectGain', 'oceanReviewDirectGain', 1], ['uReviewGradeOff', 'oceanReviewGradeOff', 0]]) {
                    const value = Number(flags[attribute]); reviewActorUniforms[key].value = Number.isFinite(value) ? value : fallback;
                }
            }
            const waveTime = reduced ? 0 : Number.isFinite(requestedWave) ? requestedWave : Math.floor(elapsed * 12) / 12;
            if (waveTime !== lastWave) {
                field.update(waveTime);
                lastWave = waveTime;
                diagnostics.waveTime = waveTime;
                diagnostics.updates++;
            }
            renderer.getDrawingBufferSize(drawSize);
            diagnostics.renderScale = qualityScale * Math.min(1, Math.sqrt(maxMediumPixels / Math.max(1, drawSize.x * drawSize.y)));
            const width = Math.max(1, Math.floor(drawSize.x * diagnostics.renderScale)), height = Math.max(1, Math.floor(drawSize.y * diagnostics.renderScale));
            if (target.width !== width || target.height !== height) {
                target.setSize(width, height);
                composite.setSize(width, height);
            }
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
                    diagnostics.reviewField = { lightBounds: field.diagnostics.lightBounds, photonDomain: field.diagnostics.fixedSourceDomain, photonSpacingMetres: field.diagnostics.photonSpacingMetres, receiverTexelMetres: field.diagnostics.receiverTexelMetres, slopes: field.diagnostics.filteredSlopeBound, sliceDepths: field.diagnostics.sliceDepths, seaLevel: field.uniforms.uCausticSeaLevel.value, sunDirection: MEDIUM.sunDirection, refractedDirection: field.meanRefractedDirection.toArray(), fog: scene.fog?.type ?? null, exposure: renderer.toneMappingExposure, cloudBank: water.diagnostics.cloudBank, medium: MEDIUM, actorLighting: ACTOR_LIGHTING, waveComponents: WAVE_COMPONENTS };
                    diagnostics.reviewOptics = { maxPathMetres: volumeUniforms.uMaxPathMetres.value, surfaceFadeMetres: [water.uniforms.uSurfaceFadeNear.value, water.uniforms.uSurfaceFadeFar.value] };
                }
                renderer.setRenderTarget(composite);
                renderer.render(screen, screenCamera);
                if (import.meta.env.MODE === 'review' && renderer.domElement.dataset.oceanReviewCaptureState === 'true')
                    diagnostics.mediumRenderState = { viewport: Array.from(gl.getParameter(gl.VIEWPORT)), targetSize: [composite.width, composite.height] };
                renderer.toneMapping = prior.tone;
                renderer.setRenderTarget(prior.target);
                renderer.render(finalScreen, screenCamera);
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
            lease.restore(); water.mesh.removeFromParent(); water.dispose(); field.dispose(); target.dispose(); composite.dispose(); quad.geometry.dispose(); quad.material.dispose(); finalMaterial.dispose(); light.removeFromParent(); light.target.removeFromParent(); } };
}
