import {PerspectiveCamera,Vector3} from 'three'
import {describe,expect,it} from 'vitest'
import {advanceCompanionMotion,createCompanionMotion,planCompanionRoute,type CompanionRoute} from '../../src/flight-experience/living/companion-director'
import {WeatherController} from '../../src/flight-experience/environment/weather-controller'
import type {LivingContext} from '../../src/flight-experience/living/living-context'
const route=(patch:Partial<CompanionRoute>={}):CompanionRoute=>({id:1,near:true,start:{x:42,y:180,z:-60},heading:0,side:1,duration:88,speed:30,...patch})
describe('continuous companion guidance',()=>{
 it.each([1/60,.1])('clears a fast opposing approach at dt %s without a vertical jump',dt=>{
  const r=route({start:{x:0,y:180,z:-440},heading:Math.PI,speed:30}),state=createCompanionMotion(r)
  let minimum=Infinity
  for(let now=0;now<12;now+=dt){
   const player={x:0,y:180,z:-36*now}
   advanceCompanionMotion(state,{route:r,age:now,now,player,playerVelocity:{x:0,y:0,z:-36},departing:false},dt)
   minimum=Math.min(minimum,Math.hypot(state.position.x-player.x,state.position.y-player.y,state.position.z-player.z))
   expect(state.position.y).toBe(180)
  }
  expect(minimum).toBeGreaterThanOrEqual(25)
 })
 it('integrated default encounter reaches the visible parallel window without being driven out by its own comfort policy',()=>{
  const heading=.22,context:LivingContext={generation:0,active:true,delta:1/60,motionSeconds:0,camera:{x:0,y:195,z:11},player:{x:0,y:190,z:0},heading,quality:'low',gentle:false,weather:new WeatherController().serialize(),intent:{wind:false,companions:true}}
  const r=planCompanionRoute(89,true,context,()=>0,28)!,state=createCompanionMotion(r),camera=new PerspectiveCamera(55,1.8224666142969363,.5,24000)
  camera.quaternion.set(-.15514407565764407,-.1084327744878713,-.017135015365026984,.9817734160454936)
  let visibleSeconds=0,minimum=Infinity
  for(let i=0;i<50*60;i++){
   const now=i/60,player={x:Math.sin(heading)*28*now,y:190,z:-Math.cos(heading)*28*now},velocity={x:Math.sin(heading)*28,y:0,z:-Math.cos(heading)*28}
   advanceCompanionMotion(state,{route:r,age:now,now,player,playerVelocity:velocity,departing:false},1/60)
   minimum=Math.min(minimum,Math.hypot(state.position.x-player.x,state.position.y-player.y,state.position.z-player.z))
   camera.position.set(player.x-Math.sin(heading)*11,195,player.z+Math.cos(heading)*11);camera.updateMatrixWorld(true)
   const p=new Vector3(state.position.x,state.position.y,state.position.z).project(camera)
   if(now>28&&Math.abs(p.x)<.9&&Math.abs(p.y)<.8&&p.z<1)visibleSeconds+=1/60
  }
  expect(minimum).toBeGreaterThan(25);expect(visibleSeconds).toBeGreaterThan(10)
 })
})
