import { LAYERS } from '../vendor/tidewater/src/core/SceneRenderer.js';
import { RefractionPass } from '../vendor/tidewater/src/ocean/RefractionPass.js';

const transparentLayer = 1 << LAYERS.TRANSPARENT;

export class MuseumRefractionPass extends RefractionPass {
  constructor({ meshRenderer, ...options }) {
    // The underwater colour source uses its original opaque receivers plus
    // the museum's blended surfaces, all with the native refraction clip.
    super({ ...options, meshRenderer: {
      render(scene, pass) {
        if (!pass.layerMask) return meshRenderer.render(scene, pass);
        const opaqueLayer = pass.layerMask;
        return meshRenderer.render(scene, {
          ...pass,
          layerMask: opaqueLayer | transparentLayer,
          filter: object => ((object.layers.mask & opaqueLayer) !== 0 || object.userData.museumBlend === true)
            && pass.filter(object),
        });
      },
    } });
  }
}
