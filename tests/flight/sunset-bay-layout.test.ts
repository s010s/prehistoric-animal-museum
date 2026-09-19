import { describe, expect, it } from 'vitest'
import { PerspectiveCamera, Vector3 } from 'three'
import { VIEWPOINTS, viewpointTarget } from '../../src/flight-experience/viewpoints/viewpoint-catalog'
import { CAPTURE_ANCHORS } from '../../src/flight-experience/review-anchors'
import { sampleEnvironment } from '../../src/flight-experience/environment/environment-state'
import { createWorldSampler, SEA_LEVEL } from '../../src/flight-experience/world'
import { coastValleyLandmarks, createLandscapeSurface } from '../../src/flight-experience/world-presets/coast-valley'

describe('E1 G0 composition candidates (not visual approval)', () => {
  it('keeps exact cameras clear of existing terrain and props at water-relative heights', () => {
    const world = createWorldSampler(), surface = createLandscapeSurface(world, coastValleyLandmarks(world))
    const candidates = CAPTURE_ANCHORS.filter(a => a.id.startsWith('e1-'))
    expect(candidates).toHaveLength(2)
    for (const anchor of candidates) {
      const p = anchor.camera!.position
      expect(p.y - SEA_LEVEL).toBeCloseTo(anchor.id === 'e1-seaward' ? 120 : 210)
      expect(p.y - surface(p.x, p.z)).toBeGreaterThan(50)
    }
  })
  it('places the sunset mirror point in open water and inside the seaward view', () => {
    const world = createWorldSampler(), anchor = CAPTURE_ANCHORS.find(a => a.id === 'e1-seaward')!
    const position = anchor.camera!.position
    const p = new Vector3(position.x,position.y,position.z)
    const target = anchor.camera!.target, view = new Vector3(target.x,target.y,target.z).sub(p).normalize()
    const sun = new Vector3(...sampleEnvironment('evening', 0, 'sunset-bay').sunDirectionWorld)
    const distance = (p.y - SEA_LEVEL) / Math.tan(Math.asin(sun.y))
    const horizontal = new Vector3(sun.x,0,sun.z).normalize()
    const mirror = p.clone().addScaledVector(horizontal,distance); mirror.y = SEA_LEVEL
    expect(distance).toBeCloseTo(120/Math.tan(3.2*Math.PI/180), 2)
    expect(world.terrainAt(mirror.x,mirror.z).height).toBeLessThan(SEA_LEVEL)
    expect(view.angleTo(mirror.clone().sub(p).normalize())).toBeLessThan(20 * Math.PI / 180)
    expect(view.angleTo(sun)).toBeLessThan(27.5 * Math.PI / 180)
    for (let t=0;t<=1;t+=.02) {
      const point=p.clone().lerp(mirror,t)
      expect(point.y-world.terrainAt(point.x,point.z).height).toBeGreaterThan(0)
    }
  })
  it('keeps the small sunset at the left third on desktop and portrait without rotating it', () => {
    for(const aspect of [16/9,390/844])for(const id of ['seaward','waterline']) {
      const view=VIEWPOINTS.find(v=>v.id===id)!, camera=new PerspectiveCamera(55,aspect,.5,4500)
      camera.position.set(view.position.x,view.position.y,view.position.z)
      const target=viewpointTarget(view,aspect,55);camera.lookAt(target.x,target.y,target.z);camera.updateMatrixWorld()
      const sun=new Vector3(...sampleEnvironment('evening',0,'sunset-bay').sunDirectionWorld).multiplyScalar(100000).add(camera.position).project(camera)
      expect((sun.x+1)/2).toBeGreaterThan(.31);expect((sun.x+1)/2).toBeLessThan(.35)
      expect((1-sun.y)/2).toBeGreaterThan(.42);expect((1-sun.y)/2).toBeLessThan(.49)
    }
  })
  it('keeps the old afternoon fallback and gives every camera the same three study suns', () => {
    expect(sampleEnvironment('afternoon')).toEqual(sampleEnvironment('afternoon',0,'legacy'))
    for (const [preset,elevation] of [['morning',20],['afternoon',38],['evening',3.2]] as const) {
      const frame=sampleEnvironment(preset,0,'sunset-bay')
      expect(Math.hypot(...frame.sunDirectionWorld)).toBeCloseTo(1,12)
      expect(Math.asin(frame.sunDirectionWorld[1])*180/Math.PI).toBeCloseTo(elevation)
      expect(sampleEnvironment(preset,60,'sunset-bay').sunDirectionWorld).toEqual(frame.sunDirectionWorld)
    }
  })
})
