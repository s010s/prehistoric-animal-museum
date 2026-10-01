// SPDX-License-Identifier: AGPL-3.0-only
import * as THREE from 'three';
import { MEDIUM } from './config.mjs';
const smooth = (a, b, v) => { const t = Math.max(0, Math.min(1, (v - a) / (b - a))); return t * t * (3 - 2 * t); };
export function preserveBlueDepthPalette(texture, sunColor) {
    const { data, width, height } = texture.image, legacySun = new THREE.Vector3(-.25, .68, -.69).normalize();
    // Keep the accepted blue depth palette, remove the old baked solar lobe so
    // surface/volume/actor now have only the shared refracted sun, not two suns.
    for (let y = 0; y < height; y++) {
        const elevation = ((y + .5) / height - .5) * Math.PI, dy = Math.sin(elevation), h = Math.cos(elevation), gain = .76 + .31 * smooth(-.42, .24, dy);
        for (let x = 0; x < width; x++) {
            const az = ((x + .5) / width - .5) * Math.PI * 2, cosine = Math.max(0, Math.cos(az) * h * legacySun.x + dy * legacySun.y + Math.sin(az) * h * legacySun.z), oldSolar = (Math.pow(cosine, 15) * .2 + Math.pow(cosine, 190) * .68) * smooth(-.02, .66, dy);
            for (let c = 0; c < 3; c++) {
                const k = (y * width + x) * 4 + c, base = Math.max(0, THREE.DataUtils.fromHalfFloat(data[k]) - [sunColor.r, sunColor.g, sunColor.b][c] * oldSolar);
                data[k] = THREE.DataUtils.toHalfFloat(base * gain * [1.05, 1, .985][c]);
            }
        }
    }
    texture.needsUpdate = true;
}
export function decorateSharedActorLighting(root, field) {
    const mats = [];
    root.traverse(o => {
        if (!o.isMesh)
            return;
        for (const m of Array.isArray(o.material) ? o.material : [o.material]) {
            if (!m.isMeshStandardMaterial || mats.some(x => x.m === m))
                continue;
            const compile = m.onBeforeCompile, key = m.customProgramCacheKey, normal = m.normalScale?.clone();
            mats.push({ m, compile, key, normal });
            if (m.normalMap)
                m.normalScale.multiplyScalar(.7);
            m.onBeforeCompile = function (s, r) {
                compile.call(this, s, r);
                Object.assign(s.uniforms, field.uniforms, { uDownwellingIrradiance: { value: new THREE.Vector3(...MEDIUM.ambientIrradiance) } });
                s.vertexShader = s.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 underwaterWorld;').replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nunderwaterWorld=(modelMatrix*vec4(transformed,1.)).xyz;');
                s.fragmentShader = s.fragmentShader.replace('#include <common>', '#include <common>\nvarying vec3 underwaterWorld;\nuniform vec3 uDownwellingIrradiance;\n' + field.samplerGLSL);
                const direct = THREE.ShaderChunk.lights_fragment_begin.replace('getDirectionalLightInfo( directionalLight, directLight );', 'getDirectionalLightInfo( directionalLight, directLight );\n directLight.color = sampleField(underwaterWorld);');
                if (direct === THREE.ShaderChunk.lights_fragment_begin)
                    throw new Error('Pinned Three directional light integration changed');
                s.fragmentShader = s.fragmentShader.replace('#include <lights_fragment_begin>', direct).replace('#include <lights_fragment_end>', `#if defined(RE_IndirectDiffuse)
vec3 waterN=inverseTransformDirection(geometryNormal,viewMatrix);
vec3 diffuseWaterE=uDownwellingIrradiance*exp(-uCausticSigmaT*max(0.,uCausticSeaLevel-underwaterWorld.y));
irradiance+=diffuseWaterE*(.65+.35*max(waterN.y,0.));
#endif
#include <lights_fragment_end>`).replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor=.46+.52*clamp(roughnessFactor,0.,1.);');
            };
            m.customProgramCacheKey = () => key.call(m) + '|ocean-refracted-' + (field.diagnostics.revision ?? 'analytic-mean-v1');
            m.needsUpdate = true;
        }
    });
    return { materialCount: mats.length, restore() { for (const x of mats) {
            x.m.onBeforeCompile = x.compile;
            x.m.customProgramCacheKey = x.key;
            if (x.normal)
                x.m.normalScale.copy(x.normal);
            x.m.needsUpdate = true;
        } } };
}
