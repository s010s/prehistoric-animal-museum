# Refracted comparison ocean

The product adapter uses one world-coordinate wave surface, sun direction and
absolute wave time for the visible surface, photon atlas, subject BRDF and
single-scattering medium. The cloud bank opens behind the comparison animal;
its local reflected-water brightness is an explicit art approximation.

Atlas tiles use RenderTarget-owned viewport/scissor rectangles in texture
pixels; Three.js renderer-level setters multiply logical pixels by DPR even
when an RTT is bound. Default-framebuffer rectangles are never changed during
atlas or readback rendering. DPR1/2 layer equality is a separate review gate.

The surface intersects view rays and writes fragment depth rather than exposing
a finite square mesh. Grazing rays continue into a smooth mean water surface.
The medium uses actual scene depth, Beer attenuation and bounded midpoint
quadrature; it cannot add sunlight behind an opaque visible animal.

Real-time budgets differ from the offline film: 96 photon grid, 128 tiles,
20 depth layers, four solar samples, 0.135 m shared base wave footprint, 16 broad sky
slope samples, 96 medium steps. The RGBA32F atlas occupies 5,408,000 bytes.
Interface normals additionally filter the same spectrum to each screen pixel;
unresolved slope variance is integrated into the sky and solar samples.
The field and surface share the same quantized 12 Hz wave time. Reduced motion
holds wave time at zero. Continuous solar integration retains a finite pixel
footprint rather than hit-or-miss sun samples. The real-time renderer makes no
bitwise reproducibility claim.

Missing float rendering, blending or filtering selects analytic mean underwater
illumination, retaining the distant opening and diffuse subject readability.
Sustained slow frame intervals first select the economy tier (64 medium steps
and a 0.75 render scale), then analytic illumination with 48 medium steps if
intervals remain slow. No full-screen blur or temporal shutter accumulation is
used. The capability tier and optional nonblocking GPU timings are visible in
`canvas.dataset.oceanRefracted`. These are diagnostics, not analytics.

Approximations: single scattering; scalar irradiance and mean direction for
phase/BRDF; no animal-cast volume shadows; broad downwelling diffuse fill; local
water LUT reflection rather than traced reflections; coarse real-time atlas and
bounded line integration. Sharp caustic-volume peaks may persist at some angles
and times. Low-end quality is a distinct analytic fallback.

The free comparison camera travels farther and looks more steeply upward than
fixed film shots. Clear-water coefficients are sigmaT=[.009,.0036,.0024] and
sigmaS=[.0008,.0011,.0014] per metre, shared by light and medium. Cloud solar
transmission remains .10 under the near bank while broad sky transmission is
.60, keeping the upward hemisphere readable. These are art-directed runtime
adaptations, not a claim of full physical cloud transport.

Software follows the project AGPL-3.0-only license. The ray-bundle area Jacobian
and depth-slice lookup reference ScottieFox/caustic-volume at commit
`d87351bff19831aa9d11c0679605fad6797b133f`:
https://github.com/ScottieFox/caustic-volume/tree/d87351bff19831aa9d11c0679605fad6797b133f
The complete MIT notice is in `LICENSE-ScottieFox.txt`. Models and other assets
retain their individual project credits and licenses; they are not all CC0.


## Local review

Run `npx playwright test --config playwright.ocean.config.ts` on macOS with
installed Chrome. It opens an independent headless Chrome/Metal context, uses
review mode at `http://127.0.0.1:4216`, and stores screenshots and 360-frame
measurements under ignored `.handoff/ocean-v12/`. It is deliberately excluded
from the cross-platform default E2E configuration. Reduced motion and animated
DPR2 touch contexts are desktop emulations, not physical-phone benchmarks.

The test matrix includes five marine species, overview/eyes/rear perspectives,
zoom and keyboard orbit, profile replacement, six azimuths by four wave times,
return/reentry resource release, three separately missing float extensions,
and controlled main-thread stress to verify both adaptive tier transitions.
Visual acceptance remains a human review; passing interaction checks does not
approve the adapted water appearance or eliminate every short bright peak.
