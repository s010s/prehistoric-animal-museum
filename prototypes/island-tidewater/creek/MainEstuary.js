// The large southern outlet belongs to the island watershed. The separate
// western fissure-to-sea sample is several kilometres beyond this footprint.
import {Noise2D} from '../vendor/tidewater/src/util/Noise.js';
import {smooth} from './ContinuousSample.js';
import {ShaderModule} from '../vendor/tidewater/src/engine/gpu/Shader.js';

// The tidal sediment apron is also the optical handover between the enclosed
// banks and open swell. Water, seabed lighting, sand and plants use one mask.
export const mainTidalShading=new ShaderModule({name:'mainTidalShading',code:`
fn museumMainTidalWeight(p:vec2f)->f32{
 return 1.0-smoothstep(.55,1.0,length((p-vec2f(-653.0,3690.0))/vec2f(572.0,419.0)));
}`});

const sea = -.7;
const grain = new Noise2D(13648);
const bell = value => Math.exp(-value * value);
const mix = (a, b, t) => a + (b - a) * t;

const bounds = {west:-1260, east:265, north:2940, south:4350};
export function insideMainEstuary(x, z) {
  return x > bounds.west && x < bounds.east && z > bounds.north && z < bounds.south;
}

// Redirect the last gentle bend before the strand. Update the sampled river
// registry itself so flow, aquatic habitats and ground use the same axis.
export function shapeMainTidalReach(layout, profile) {
  const rows = profile.length / 4;
  for (let i = 0; i < rows; i++) {
    const z = layout.riverStart + i * layout.riverStep;
    if (z <= 3020 || z >= 4000) continue;
    const k = i * 4, into = smooth(3020, 3210, z) * (1 - smooth(3870, 4000, z));
    const offset = -29*bell((z-3280)/100) + 38*bell((z-3445)/74) - 20*bell((z-3553)/53)
      + 17*bell((z-3710)/77);
    profile[k] += into * offset;
    profile[k+2] *= 1 + into * (-.18*bell((z-3340)/84) + .16*bell((z-3470)/76) + .25*bell((z-3637)/83));
  }
  for (let i = 1; i < rows-1; i++) {
    const z = layout.riverStart + i * layout.riverStep;
    if (z >= 3020 && z <= 4000) profile[i*4+3] = (profile[(i+1)*4] - profile[(i-1)*4]) / (2*layout.riverStep);
  }
}

export function mainEstuaryWeight(x, z) {
  if (!insideMainEstuary(x, z)) return 0;
  // A coastal lobe joins the local shelf and a narrower falling reach joins
  // the original river. Both supports fade before touching adjacent districts.
  const coastal = Math.hypot((x + 627)/488, (z - 3637)/526);
  const upstream = Math.hypot((x + 250 + (z-3420)*.72)/158, (z - 3430)/367);
  return 1 - smooth(.67, 1.29, Math.min(coastal, upstream));
}

function shoreAt(z) {
  return -489 + 37*bell((z-3485)/104) - 29*bell((z-3569)/45)
    + 55*bell((z-3685)/106) - 22*bell((z-3905)/106)
    + 9*grain.noise(z/92,21.1) + 2.2*grain.noise(z/36,7.2);
}

// No hard intersection between channel banks and marine beach slopes.
function lowerSurface(a, b, radius) {
  const t = Math.max(0, 1 - Math.abs(a-b)/radius);
  return Math.min(a, b) - radius*t*t*.25;
}

export function mainEstuaryHeight(x, z, original, river, weight) {
  if (!weight) return original;
  const d = x - shoreAt(z), off = Math.max(0,-d), inland = Math.max(0,d);
  const texture = grain.noise(x/48,z/58) + .35*grain.noise(x/18,z/23);
  // Fine sand at the waterline grades out toward the local shelf. Two
  // transverse lobes of river sediment leave a curved route to open water.
  const coast = .049*inland + .00105*Math.max(0,inland-22)**2
    - (.048*off/(1+off/56) + .0027*off + .000011*off*off);
  const northBar = .82*bell((x+556)/101)*bell((z-3549-(x+556)*.27)/32);
  const southBar = 1.03*bell((x+600)/135)*bell((z-3730+(x+600)*.21)/45);
  let relative = coast + (northBar+southBar)*smooth(0,62,off);
  if (river) {
    // Width is measured along X on the registry. A local left/right bias
    // gives the inner bank a depositional slip face and the other a scour.
    const across = x-river.x, wet = river.width * (.67+.05*bell((z-3570)/106));
    const u = across/wet, side = Math.tanh(u*2.1);
    const bend = .61*bell((z-3450)/86) - .74*bell((z-3560)/84) + .47*bell((z-3690)/83);
    const depth = 2.9 + .85*bell((z-3420)/66) + 1.35*bell((z-3556)/54);
    const slope = (2*depth/wet)*(1+bend*side*.57);
    const overbank = Math.max(0,Math.abs(across)-wet);
    let riverBed = Math.abs(u)<1
      ? -depth*(1-u*u)*(1+bend*u*.8)
      : slope*overbank + .00050*overbank*overbank;
    riverBed += river.level-sea;
    const mouth = lowerSurface(relative,riverBed, 1.9 + 1.7*bell((z-3620)/105));
    relative = mix(mouth,relative,smooth(48,193,off));
    // The faint ebb channel arcs across the mouth bar before dissipating.
    const ebbAxis = 3623 + 86*(1-Math.exp(-off/94)) - .14*off;
    const ebbWidth = 33+.18*off;
    relative -= 1.02*bell((z-ebbAxis)/ebbWidth)*smooth(4,86,off)*(1-smooth(165,405,off));
  }
  relative += texture*(.16+.21*smooth(9,90,inland)) + .32*grain.noise(x/107,z/144);
  // Preserve the enclosing hills. Only the low floodplain belongs to this
  // depositional surface, even where a broad blend overlaps a hillside.
  const oldRise=original-sea;
  const hillside=smooth(7,30,oldRise)*Math.max(smooth(1.4,13,relative),smooth(28,50,oldRise));
  return mix(original,sea+relative,weight*(1-hillside));
}

// Bake before native terrain normals, bounds and GPU upload. Every query,
// including footprints and wave breaking, uses these same changed samples.
export function finishMainEstuary(grid, field) {
  const {texel:step,res} = grid, x0 = grid.center[0]-grid.size/2+step/2, z0 = grid.center[1]-grid.size/2+step/2;
  const row0=Math.max(0,Math.ceil((bounds.north-z0)/step)), row1=Math.min(res-1,Math.floor((bounds.south-z0)/step));
  const col0=Math.max(0,Math.ceil((bounds.west-x0)/step)), col1=Math.min(res-1,Math.floor((bounds.east-x0)/step));
  for (let j=row0; j<=row1; j++) {
    const z=z0+j*step, river=field.riverAt(z);
    for (let i=col0; i<=col1; i++) {
      const x=x0+i*step, w=mainEstuaryWeight(x,z);
      if (!w) continue;
      const k=j*res+i, h=mainEstuaryHeight(x,z,grid.heights[k],river,w);
      grid.heights[k]=h;
      const deposit=w*(1-smooth(2,9,h-sea));
      grid.rock[k]*=1-deposit*.83;
      grid.sand[k]=Math.round(mix(grid.sand[k],197,deposit));
    }
  }
}
