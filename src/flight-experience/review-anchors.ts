import { WeatherController, type WeatherState } from './environment/weather-controller'
import { WORLD, type Position, type WorldConfig } from './world'
import type { FlightView } from './settings'
import type { SolarLayout, SolarPreset } from './environment/environment-state'
export interface CaptureAnchor {
  weather?: WeatherState
  id: string; world: WorldConfig; position: Position; heading: number
  camera?: { position: Position; target: Position }; solarLayout?: SolarLayout
  view: FlightView; pitch: number; presentationSeconds: number; preset: SolarPreset
}
const fairCapture=new WeatherController()
fairCapture.capture('fair')
const overcastCapture=new WeatherController()
overcastCapture.capture('overcast')
/** Approximate compositions, not recovered metadata from the user's three screenshots. */
export const CAPTURE_ANCHORS: readonly CaptureAnchor[] = [
  // E1 G0 candidates only. Exact cameras, no change to normal flight framing.
  { id: 'e1-seaward', world: WORLD, position: { x:160,y:119.3,z:500 }, heading:-.59, view:'standard', pitch:0, presentationSeconds:0, preset:'evening', solarLayout:'sunset-bay',
    camera:{position:{x:160,y:119.3,z:500},target:{x:-116,y:112,z:-461}} },
  { id: 'e1-cliff', world: WORLD, position: { x:-160,y:209.3,z:350 }, heading:.57, view:'standard', pitch:0, presentationSeconds:0, preset:'afternoon', solarLayout:'sunset-bay',
    camera:{position:{x:-160,y:209.3,z:350},target:{x:420,y:120,z:-550}} },
  { id: 'coast-oblique', world: WORLD, position: {x:-160,y:100,z:350}, heading:.22, view:'standard',pitch:0,presentationSeconds:0,preset:'afternoon' },
  { id: 'shore-overlook', world: WORLD, position: {x:100,y:350,z:350}, heading:Math.PI/2, view:'wide',pitch:-.18,presentationSeconds:0,preset:'afternoon' },
  { id: 'ocean-high', world: WORLD, position: {x:-300,y:1400,z:350}, heading:-Math.PI/2, view:'wide',pitch:0,presentationSeconds:0,preset:'afternoon' },
  { id: 'valley-side', world: WORLD, position: {x:270,y:160,z:-1450}, heading:.3, view:'near',pitch:-.12,presentationSeconds:0,preset:'afternoon' },
  { id: 'ridge-seam-check', world: WORLD, position: {x:745.23,y:540,z:-1032.93}, heading:-.09, view:'near',pitch:-.12,presentationSeconds:65,preset:'afternoon' },
  { id: 'river-mouth', world: WORLD, position: {x:240,y:85,z:490}, heading:0, view:'wide',pitch:-.18,presentationSeconds:0,preset:'afternoon' },
  { id: 'river-valley', world: WORLD, position: {x:145,y:90,z:-350}, heading:0, view:'wide',pitch:-.15,presentationSeconds:0,preset:'afternoon' },
  { id: 'm1-beach', world: WORLD, position: {x:315,y:100,z:600}, heading:0,view:'near',pitch:-.45,presentationSeconds:0,preset:'afternoon' },
  { id: 'm1-high-riverbank', world: WORLD, position: {x:-10,y:135,z:-2400}, heading:.4,view:'near',pitch:-.45,presentationSeconds:0,preset:'afternoon' },
  { id: 'm1-dry-slope', world: WORLD, position: {x:400,y:295,z:-900}, heading:.4,view:'near',pitch:-.45,presentationSeconds:0,preset:'afternoon' },
  { id: 'm1-woodland', world: WORLD, position: {x:700,y:440,z:-900}, heading:.4,view:'near',pitch:-.45,presentationSeconds:0,preset:'afternoon' },
  { id: 'm1-rock', world: WORLD, position: {x:300,y:350,z:-2200}, heading:.4,view:'wide',pitch:-.35,presentationSeconds:0,preset:'afternoon' },
  { id: 'm1-groundcover', world: WORLD, position: {x:1200,y:425,z:-700}, heading:.4,view:'near',pitch:-.45,presentationSeconds:0,preset:'afternoon' },
  { id: 'm1-forest-runoff', world: WORLD, position: {x:1100,y:475,z:-220}, heading:0,view:'near',pitch:-.35,presentationSeconds:0,preset:'afternoon' },
  // Altitude comparisons share the existing world and sunset; no recovered video coordinates.
  ...[ {id:'altitude-low',y:1.6,x:160,z:500,tx:-116,ty:-6,tz:-461},
    {id:'altitude-mid',y:210,x:-160,z:350,tx:420,ty:120,tz:-550},
    {id:'altitude-flight',y:350,x:100,z:350,tx:-100,ty:220,tz:-1400},
    {id:'altitude-high',y:900,x:-450,z:950,tx:1000,ty:120,tz:-4000},
    {id:'altitude-top',y:1400,x:-600,z:1100,tx:1500,ty:100,tz:-4500},
  ].map(v=>({id:v.id,world:WORLD,position:{x:v.x,y:v.y,z:v.z},heading:0,view:'standard' as const,pitch:0,presentationSeconds:0,preset:'evening' as const,solarLayout:'sunset-bay' as const,camera:{position:{x:v.x,y:v.y,z:v.z},target:{x:v.tx,y:v.ty,z:v.tz}}})),
  // Coastal flight regression: same 205m camera for clear haze and sunset glitter.
  ...(['afternoon','evening'] as const).map(preset=>({id:`coast-flight-${preset}`,world:WORLD,position:{x:-184.77525955,y:200.41138889,z:-323.23024902},heading:0,view:'standard' as const,pitch:0,presentationSeconds:24.1346,preset,solarLayout:'sunset-bay' as const,camera:{position:{x:-184.09599322,y:205.41138889,z:-311.92273206},target:{x:-241.22034060,y:-98.67663086,z:-1262.85242724}}})),
  ...(['afternoon','evening'] as const).map(preset=>({id:`fair-seaward-${preset}`,world:WORLD,position:{x:160,y:119.3,z:500},heading:-.59,view:'standard' as const,pitch:0,presentationSeconds:0,preset,solarLayout:'sunset-bay' as const,weather:fairCapture.serialize(),camera:{position:{x:160,y:119.3,z:500},target:{x:-116,y:112,z:-461}}})),
  {id:'overcast-high-evening',world:WORLD,position:{x:-450,y:900,z:950},heading:0,view:'standard',pitch:0,presentationSeconds:0,preset:'evening',solarLayout:'sunset-bay',weather:overcastCapture.serialize(),camera:{position:{x:-450,y:900,z:950},target:{x:1000,y:120,z:-4000}}},
  {id:'overcast-seaward-evening',world:WORLD,position:{x:160,y:119.3,z:500},heading:-.59,view:'standard',pitch:0,presentationSeconds:0,preset:'evening',solarLayout:'sunset-bay',weather:overcastCapture.serialize(),camera:{position:{x:160,y:119.3,z:500},target:{x:-116,y:112,z:-461}}},
  {id:'coast-stream-crossing',world:WORLD,position:{x:100,y:900,z:64},heading:0,view:'standard',pitch:0,presentationSeconds:0,preset:'evening',solarLayout:'sunset-bay',weather:overcastCapture.serialize()},
]

/** Approximate feedback routes, never claimed to recover the user's screenshot coordinates. */
export const REVIEW_ROUTES = [
  { id:'A-shoreline', anchor:{...CAPTURE_ANCHORS[0]!,id:'A-shoreline'}, turnAt:45,turn:0 },
  { id:'B-cliff', anchor:{...CAPTURE_ANCHORS[3]!,id:'B-cliff',position:{x:290,y:185,z:-1250},heading:0},turnAt:40,turn:.18 },
  { id:'C-tree-return',anchor:{...CAPTURE_ANCHORS[3]!,id:'C-tree-return',position:{x:150,y:140,z:-1050},heading:Math.PI},turnAt:25,turn:.65 },
  { id:'E-river-mouth',anchor:{...CAPTURE_ANCHORS[5]!,id:'E-river-mouth'},turnAt:28,turn:.65 },
  { id:'F-350-coast',anchor:{...CAPTURE_ANCHORS[2]!,id:'F-350-coast',preset:'evening',solarLayout:'sunset-bay',position:{x:100,y:350,z:350},heading:-.12},turnAt:45,turn:0 },
  { id:'D-ridge',anchor:{...CAPTURE_ANCHORS[3]!,id:'D-ridge',position:{x:1770,y:540,z:-760},heading:-Math.PI/2},turnAt:40,turn:.15 },
] as const
