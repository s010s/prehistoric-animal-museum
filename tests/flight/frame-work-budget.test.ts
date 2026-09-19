import { describe, expect, it } from 'vitest'
import { FrameWorkBudget, FrameWorkQueue } from '../../src/flight-experience/frame-work-budget'
describe('shared preparation budget', () => {
  it('shares time, bytes and objects across subsystems and reports atomic overruns', () => {
    let time = 0; const budget = new FrameWorkBudget(()=>time,100,2); budget.begin(1)
    budget.measure('terrain',()=>{time+=1},40,1)
    expect(budget.canStart(0,61)).toBe(false)
    budget.measure('props',()=>{time+=1.4},30,1)
    expect(budget.canStart()).toBe(false)
    expect(budget.metrics.overrunMs).toBeCloseTo(.4)
    budget.begin(2); expect(budget.remainingMs()).toBe(2)
  })
  it('resumes bounded tasks, cancels obsolete epochs and ages waiting tasks', () => {
    let time=0;const budget=new FrameWorkBudget(()=>time); const queue=new FrameWorkQueue(2)
    let cancelled=0,steps=0;queue.enqueue({id:'a',epoch:1,priority:0,step:()=>false,cancel:()=>cancelled++},0)
    queue.enqueue({id:'a',epoch:2,priority:0,step:b=>b.measure('step',()=>{time+=2;return ++steps===2})},0)
    queue.enqueue({id:'b',epoch:1,priority:1,step:()=>true},20)
    expect(queue.enqueue({id:'c',epoch:1,priority:0,step:()=>true},20)).toBe(false)
    budget.begin(20);queue.run(budget);expect(queue.size).toBe(2)
    budget.begin(21);queue.run(budget);expect(steps).toBe(2)
    budget.begin(22);queue.run(budget);expect(queue.size).toBe(0);expect(cancelled).toBe(1)
  })
})
