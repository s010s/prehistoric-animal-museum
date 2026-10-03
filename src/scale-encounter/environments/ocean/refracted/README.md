# Refracted comparison ocean

The product adapter uses one world-coordinate wave surface, sun direction and
absolute wave time for the visible surface, photon atlas, subject BRDF and
single-scattering medium. The cloud bank opens behind the comparison animal;
its local reflected-water brightness is an explicit art approximation.

The atlas integrates each finite source triangle over its intersecting receiver
pixels. Point-sampling an area Jacobian could assign a subpixel folded bundle's
high density to a whole pixel, exceeding that bundle's total flux. Conservative
bounding quads and an analytic triangle/pixel area integral now partition its
energy. Actual overlapping bundles still produce caustics. Source-cell mean
Fresnel transfer, extinction path and source cloud transmission are explicit
piecewise-constant approximations; collapsed bundles use a line/point limit.
The same wave nodes and Snell/Fresnel directions are precomputed once per field
update and reused at every depth. No temporal shutter samples or artistic
irradiance clamp are involved.

Atlas tiles use RenderTarget-owned viewport/scissor rectangles in texture
pixels; Three.js renderer-level setters multiply logical pixels by DPR even
when an RTT is bound. Default-framebuffer rectangles are never changed during
atlas or readback rendering. DPR1/2 layer equality is a separate review gate.

The surface intersects view rays and writes fragment depth rather than exposing
a finite square mesh. Grazing rays continue into a smooth mean water surface.
The medium uses actual scene depth, Beer attenuation and bounded midpoint
quadrature; it cannot add sunlight behind an opaque visible animal.

Real-time budgets are bounded: a 128 photon grid, 160 pixels per
depth tile, 20 depth layers, four solar samples, a 0.25 m shared wave footprint,
16 broad sky slope samples and 96 medium steps. The RGBA32F atlas occupies
8,398,080 bytes. Shared wave-node and four-direction textures add 1,310,720 bytes
at the default 128 grid, for 9,708,800 bytes of field textures. The immutable
source-bundle geometry occupies about 0.74 MiB. All node/direction targets,
materials and geometry are released with the field, including adaptive fallback.
Scene color/depth and the linear medium composite share a
resolution capped at 2,000,000 pixels; a final native-resolution pass applies
tone mapping and the output color transform once.
Interface normals additionally filter the same spectrum to each screen pixel;
unresolved slope variance is integrated into the sky and solar samples.
The field and surface share the same quantized 12 Hz wave time. Reduced motion
holds wave time at zero. Continuous solar integration retains a finite pixel
footprint rather than hit-or-miss sun samples. The real-time renderer makes no
bitwise reproducibility claim.

Missing float rendering, blending or filtering selects analytic mean underwater
illumination, retaining the distant opening and diffuse subject readability.
Sustained slow frame intervals first select the economy tier (64 medium steps
and a 0.75 quality scale), then a lower refracted tier (48 steps and a 0.5 quality
scale). Both keep the shared photon field. Further sustained slow intervals
select analytic illumination. Quality scale multiplies the pixel-cap scale
for both the scene and medium, including Retina displays. No full-screen blur
or temporal shutter accumulation is used. The capability tier and optional
nonblocking GPU timings are visible in
`canvas.dataset.oceanRefracted`. These are diagnostics, not analytics.

Approximations: single scattering; scalar irradiance and mean direction for
phase/BRDF; no animal-cast volume shadows; broad downwelling diffuse fill; local
water LUT reflection rather than traced reflections; coarse real-time atlas and
bounded line integration. Genuine focused overlaps remain; source-cell transfer,
finite depth sampling and unreviewed angles/times still limit the reconstruction.
Low-end quality is a distinct analytic fallback.

Clear-water coefficients are sigmaT=[.009,.0036,.0024] and
sigmaS=[.0008,.0011,.0014] per metre, shared by light and medium. Cloud solar
transmission remains .10 under the near bank while broad sky transmission is
.45. Local reflected-water radiance scales from 1.30 under the bank to 1.83
at the opening, before terminal boundary calibration. Shared air solar
irradiance is [13,12.4,11.2], with a normalized HG phase parameter of .7.
Broad sky scattering follows the cloud above each world column, rather than
adding an equally bright isotropic contribution under the near cloud bank.
The actor's broad diffuse calibration has gain 1.45 and a .65
side/lower fraction. Each directional light retains its original color and
intensity before multiplication by the shared irradiance, so disabled exhibit
and camera lights remain zero. These are art-directed runtime adaptations,
not a claim of full physical cloud transport or final visual acceptance.

The transmitted daytime sky mixes toward cyan with coefficient .65 at fixed
linear luminance. Terminal sky, reflected-water and deep-background radiance
use a common .62 scale; subject irradiance and volume scattering are not
exposure-scaled with that boundary. The interface sun gain is .5, compensating
the stronger shared source so the old solar glint is not simply doubled.
These source calibrations are art approximations, not full cloud/reflection
transport. The ordinary ocean UI no longer applies the inherited land-coloured
screen vignette; controls retain their own backgrounds and text shadows.
Global exposure and the clear-water extinction coefficients are unchanged.

The calm-water spectrum weights every original wave amplitude by
`1.35 / sqrt(1 + (4 metres / wavelength)^4)`. Its 4 m ripple turnover reduces
short-wave surface breakup while retaining all 24 world-coordinate phases,
directions and gravity-dispersion frequencies. At the shared 0.25 m footprint,
resolved slope RMS changes from 0.10156 to 0.10235; sub-3 m waves contribute
4.1% rather than 31.0% of its variance. Unresolved slope RMS changes from
0.22650 to 0.03008. The height RMS is 0.191 m rather than 0.147 m. Both the
visible interface and photon field use this same art-directed spectrum; their
caustic structure changes with its source waves. No receiver-atlas filter is
added. These values describe the selected analytic sea, not measured weather.

Two authored body materials have ocean-only, reversible calibrations. The
ichthyosaur's low-chroma grey-green skin uses saturation 1.65 and albedo exponent
1.20. Its opaque non-metallic physical skin uses the material IOR relative to
water (1.5 / 1.333): normal-incidence dielectric F0 is 0.003475 before the
authored specular intensity, instead of the air-interface 0.04. This keeps the
pigment contribution distinct from the broad neutral reflection; it cannot
invent colour absent from the source texture. The mosasaur's dark blue body
uses albedo exponent 0.90 with saturation 1.18. The curve lifts its dark pigment
without an emissive floor; normals and the shared light field still shape the
body. Eyes, teeth, the avatar and other animals keep their prior calibrations.
Authored IOR, compile callbacks and cache keys are restored on lease release.
These skin adjustments and the calmer spectrum remain a visual candidate.

Review-only surface modes isolate air, reflected water,
Fresnel weight, cloud sky scale and unshadowed sky for matching-camera checks.
These modes are absent from the production water shader. Review-only paired
studies can choose a 72/96/120 m medium path cap and surface-fade ranges of
35–160 or 80–240 m. Unflagged and production values are 120 m and 35–160 m.
The longer cap admits the remote opening in the initial comparison camera;
actual opaque depth and the water interface still terminate every visible ray.
Combined, solar-only and sky-only scattering use debug modes 2, 8 and 9, after
the ordinary final display transform. Visual acceptance and the additional
march-length sampling/peak risks require actual camera and time review.

Software follows the project AGPL-3.0-only license. The ray-bundle area Jacobian
and depth-slice lookup reference ScottieFox/caustic-volume at commit
`d87351bff19831aa9d11c0679605fad6797b133f`:
https://github.com/ScottieFox/caustic-volume/tree/d87351bff19831aa9d11c0679605fad6797b133f
The complete MIT notice is in `LICENSE-ScottieFox.txt`. Models and other assets
retain their individual project credits and licenses; they are not all CC0.


## Local review

Run targeted checks with
`npx playwright test --config playwright.ocean.config.ts --headed --workers=1`
on macOS with installed Chrome. It opens an independent Chrome/Metal context, uses
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
