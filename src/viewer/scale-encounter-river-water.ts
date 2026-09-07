import { BufferAttribute, BufferGeometry, Color, PerspectiveCamera, UniformsLib, UniformsUtils, type ShaderMaterial, type Vector3 } from 'three'
import { Reflector } from 'three/examples/jsm/objects/Reflector.js'
import { createRiverWaterInteraction, RIVER_RIPPLE_COUNT, type RiverVisitor } from './scale-encounter-water-interaction'

export type RiverWater = Reflector & {
  updateWater: (
    elapsedSeconds: number, reducedMotion: boolean,
    camera?: PerspectiveCamera | Vector3, visitor?: RiverVisitor | null,
  ) => void
}

/** A single shallow-water reflection pass. The shoreline is cut from the same
 * height function as the banks; only the reflection normals move, never the
 * waterline. No refraction pass or screen-depth pipeline is needed here.
 */
export function createRiverWater(
  heightAt: (x: number, z: number) => number,
  centreZ: (x: number) => number,
  level: number,
  halfLength = 240,
): RiverWater {
  const positions: number[] = []
  const depths: number[] = []
  const indices: number[] = []
  // Twenty-centimetre shore samples keep close bends smooth at child height.
  const rows = Math.ceil(halfLength * 10)
  const columns = 12
  for (let row = 0; row <= rows; row += 1) {
    const x = -halfLength + row / rows * halfLength * 2
    const centre = centreZ(x)
    const edgeAt = (side: number) => {
      if (heightAt(x, centre) >= level) return 0
      let wet = 0
      let dry = 18
      for (let step = 0; step < 16; step += 1) {
        const distance = (wet + dry) / 2
        if (heightAt(x, centre + side * distance) < level) wet = distance
        else dry = distance
      }
      return side * wet
    }
    const left = edgeAt(-1)
    const right = edgeAt(1)
    for (let column = 0; column <= columns; column += 1) {
      const z = centre + left + (right - left) * column / columns
      // Reflector's local normal is +Z; the object rotates into world XZ.
      positions.push(x, -z, 0)
      depths.push(Math.max(0, level - heightAt(x, z)))
      if (row < rows && column < columns) {
        const i = row * (columns + 1) + column
        indices.push(i, i + 1, i + columns + 1, i + 1, i + columns + 2, i + columns + 1)
      }
    }
  }
  const geometry = new BufferGeometry()
  geometry.setAttribute('position', new BufferAttribute(new Float32Array(positions), 3))
  geometry.setAttribute('waterDepth', new BufferAttribute(new Float32Array(depths), 1))
  geometry.setIndex(indices)
  geometry.computeVertexNormals()
  const interaction = createRiverWaterInteraction((x, z) =>
    Math.abs(x) <= halfLength && Math.abs(z - centreZ(x)) < 18
      ? Math.max(0, level - heightAt(x, z)) : 0,
  level)
  const water = new Reflector(geometry, {
    clipBias: 0.003,
    textureWidth: 1024,
    textureHeight: 1024,
    multisample: 0,
    color: new Color('#536b60'),
    shader: {
      uniforms: UniformsUtils.merge([UniformsLib.fog, {
        color: { value: new Color() },
        tDiffuse: { value: null },
        textureMatrix: { value: null },
        uTime: { value: 0 },
        uVisitorRipples: { value: interaction.ripples },
        uVisitorPush: { value: interaction.push },
        uVisitorFlow: { value: interaction.flow },
      }]),
      vertexShader: /* glsl */ `
        uniform mat4 textureMatrix;
        attribute float waterDepth;
        varying vec4 vReflection;
        varying vec3 vRiverWorld;
        varying float vWaterDepth;
        #include <common>
        #include <fog_pars_vertex>
        #include <logdepthbuf_pars_vertex>
        void main() {
          vWaterDepth = waterDepth;
          vReflection = textureMatrix * vec4(position, 1.0);
          vRiverWorld = (modelMatrix * vec4(position, 1.0)).xyz;
          vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
          gl_Position = projectionMatrix * mvPosition;
          #include <fog_vertex>
          #include <logdepthbuf_vertex>
        }
      `,
      fragmentShader: /* glsl */ `
        uniform sampler2D tDiffuse;
        uniform float uTime;
        uniform vec4 uVisitorRipples[${RIVER_RIPPLE_COUNT}];
        uniform vec4 uVisitorPush;
        uniform vec4 uVisitorFlow;
        varying vec4 vReflection;
        varying vec3 vRiverWorld;
        varying float vWaterDepth;
        #include <common>
        #include <fog_pars_fragment>
        #include <logdepthbuf_pars_fragment>
        void main() {
          #include <logdepthbuf_fragment>
          vec2 p = vRiverWorld.xz;
          vec2 ripple = vec2(
            sin(p.x * 2.17 - p.y * .31 + uTime * .72) + sin(p.x * .63 + p.y * 1.79 - uTime * .43) * .42,
            sin(p.x * .42 + p.y * 2.41 - uTime * .61) + cos(p.x * 1.83 - p.y * .77 + uTime * .39) * .34
          );
          float visitorCrest = 0.0;
          float bowCrest = 0.0;
          if (uVisitorPush.z > .001) {
            vec2 direction = uVisitorFlow.xy;
            vec2 sideDirection = vec2(-direction.y, direction.x);
            vec2 relative = p - uVisitorPush.xy;
            float forward = dot(relative, direction);
            float side = dot(relative, sideDirection);
            float bodyRadius = uVisitorPush.w;
            // Open horseshoe at the leading side, with two diverging flanks.
            // The pressure ridge travels with the legs, unlike the old rings.
            float radius = length(vec2(forward * .82, side));
            float ridge = radius - bodyRadius - .10;
            float width = .026 + uVisitorFlow.w * .035;
            float arc = smoothstep(-bodyRadius * .35, .08, forward);
            float bow = exp(-ridge * ridge / (width * width)) * arc;
            vec2 radial = (direction * forward * .6724 + sideDirection * side) / max(radius, .025);
            float bowSlope = ridge / width * bow;
            ripple += radial * bowSlope * uVisitorPush.z * 13.0;
            bowCrest = bow * bow * uVisitorPush.z;
            float behind = -forward;
            float flankDistance = abs(side) - (bodyRadius + .08 + behind * .48);
            float flank = exp(-flankDistance * flankDistance / .0036)
              * smoothstep(-.06, .16, behind) * exp(-max(behind, 0.0) * 1.8);
            vec2 flankNormal = normalize(sideDirection * sign(side) + direction * .48);
            ripple += flankNormal * flankDistance / .06 * flank * uVisitorPush.z * 7.0;
            bowCrest += flank * uVisitorPush.z * .3;
          }
          for (int i = 0; i < ${RIVER_RIPPLE_COUNT}; i++) {
            vec4 impact = uVisitorRipples[i];
            float age = uTime - impact.z;
            if (impact.w <= 0.0 || age < 0.0 || age >= 3.0) continue;
            vec2 offset = p - impact.xy;
            float radius = length(offset);
            float front = radius - (.09 + age * .85);
            float width = .08 + age * .025;
            float envelope = exp(-front * front / (width * width))
              * smoothstep(0.0, .1, age) * pow(1.0 - age / 3.0, 1.5);
            float wave = cos(front * 38.0) * envelope * impact.w;
            ripple += offset / max(radius, .02) * wave * 4.5;
            visitorCrest += max(0.0, wave);
          }
          float shore = smoothstep(.01, .12, vWaterDepth);
          vec2 reflectionUv = vReflection.xy / vReflection.w;
          reflectionUv += ripple * .00125 * shore;
          vec3 reflection = texture2D(tDiffuse, reflectionUv).rgb;
          vec3 normal = normalize(vec3(ripple.x * .022 * shore, 1.0, ripple.y * .022 * shore));
          vec3 viewDirection = normalize(cameraPosition - vRiverWorld);
          float fresnel = .02 + .98 * pow(1.0 - max(dot(normal, viewDirection), 0.0), 5.0);
          vec3 bed = mix(vec3(.16, .105, .061), vec3(.052, .083, .068), 1.0 - exp(-vWaterDepth * 1.8));
          vec3 waterColour = mix(bed, reflection, .22 + fresnel * .36);
          waterColour += vec3(.026, .032, .033) * visitorCrest * shore;
          // A narrow grazing highlight makes the water piled against the legs
          // readable while its darker outer slope retains reflected scenery.
          waterColour += vec3(.021, .027, .028) * bowCrest * shore;
          gl_FragColor = vec4(waterColour, shore * .94);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
          #include <fog_fragment>
        }
      `,
    },
  })
  water.name = 'scale-encounter-floodplain-seasonal-channel-water'
  water.rotation.x = -Math.PI / 2
  water.position.y = level
  water.add(interaction.root)
  const material = water.material as ShaderMaterial
  material.uniforms.uVisitorRipples!.value = interaction.ripples
  material.uniforms.uVisitorPush!.value = interaction.push
  material.uniforms.uVisitorFlow!.value = interaction.flow
  material.transparent = true
  material.depthWrite = false
  material.fog = true
  material.addEventListener('dispose', () => water.getRenderTarget().dispose())
  water.userData.shoreline = 'shared-terrain-height-fixed-elevation'
  return Object.assign(water, {
    updateWater(elapsedSeconds: number, reducedMotion: boolean, camera?: PerspectiveCamera | Vector3, visitor?: RiverVisitor | null) {
      material.uniforms.uTime!.value = reducedMotion ? 0 : elapsedSeconds
      interaction.update(elapsedSeconds, reducedMotion ? null : visitor ?? null,
        camera instanceof PerspectiveCamera ? camera.position : camera)
    },
  })
}
