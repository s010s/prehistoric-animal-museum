import { clamp, safeSurface, coastAt, valleyAt, type Position } from './world'
export interface FlightInput { turn: number; climb: number }
export interface RenderState { position: Position; heading: number; turnRate: number; climbRate: number; time: number }
export const ZERO_INPUT: FlightInput = Object.freeze({ turn: 0, climb: 0 })
export const FLIGHT_STEP = 1 / 60
export const angleDelta = (a: number, b: number) => Math.atan2(Math.sin(b - a), Math.cos(b - a))
export class FlightSimulation {
  readonly position: Position = { x: -160, y: 125, z: 350 }
  heading = .22
  turnRate = 0
  climbRate = 0
  speed = 18
  cruiseSpeed = 18
  time = 0
  droppedSeconds = 0
  gentle = false
  assisted = false
  safetyStop = false
  private scenicLeg = 0
  private readonly scenicRoute: {x:number;z:number}[]
  private readonly defaultRoute = [{ x: coastAt(-450) + 80, z: -450 }, { x: valleyAt(-1100), z: -1100 }, { x: valleyAt(-2200), z: -2200 }]
  avoidance: 'normal' | 'avoid' | 'recover' = 'normal'
  verticalAcceleration = 0
  readonly commands = { manualTurn: 0, manualClimb: 0, finalTurn: 0, targetClimb: 0, targetSpeed: 18, risk: 0, clearance: 0, jerk: 0, side: 0 }
  private safeSeconds = 0
  private sideHold = 0
  private accumulator = 0
  private previous: RenderState
  constructor(private readonly surface: (x: number, z: number) => number = safeSurface, route?: {x:number;z:number}[]) { this.scenicRoute = route ?? this.defaultRoute; this.previous = this.capture() }
  private capture(): RenderState { return { position: { ...this.position }, heading: this.heading, turnRate: this.turnRate, climbRate: this.climbRate, time: this.time } }
  clearAccumulator() { this.accumulator = 0; this.previous = this.capture() }
  get alpha() { return clamp(this.accumulator / FLIGHT_STEP, 0, 1) }
  renderState(): RenderState {
    const a = this.alpha, p = this.previous, mix = (x: number, y: number) => x + (y - x) * a
    return { position: { x: mix(p.position.x, this.position.x), y: mix(p.position.y, this.position.y), z: mix(p.position.z, this.position.z) },
      heading: p.heading + angleDelta(p.heading, this.heading) * a, turnRate: mix(p.turnRate, this.turnRate), climbRate: mix(p.climbRate, this.climbRate), time: mix(p.time, this.time) }
  }
  advance(delta: number, input: FlightInput): number {
    const finite = Number.isFinite(delta) ? Math.max(0, delta) : 0
    const accepted = Math.min(finite, FLIGHT_STEP * 4)
    this.droppedSeconds += finite - accepted; this.accumulator += accepted
    let steps = 0
    while (this.accumulator + 1e-10 >= FLIGHT_STEP && steps < 4 && !this.safetyStop) {
      this.previous = this.capture(); this.step(input)
      this.accumulator = Math.max(0, this.accumulator - FLIGHT_STEP); steps++
    }
    return steps * FLIGHT_STEP
  }
  private step(input: FlightInput) {
    const dt = FLIGHT_STEP, clearance = this.gentle ? 60 : 40
    const normalSpeed = this.gentle ? Math.min(14, this.cruiseSpeed) : this.cruiseSpeed, maxClimb = this.gentle ? 4 : 8
    if (Math.abs(input.turn) + Math.abs(input.climb) > .08) this.assisted = false
    let turn = clamp(input.turn, -1, 1), climb = clamp(input.climb, -1, 1)
    if (this.assisted) {
      let target = this.scenicRoute[this.scenicLeg]!
      if (Math.hypot(target.x - this.position.x, target.z - this.position.z) < 120 && this.scenicLeg < this.scenicRoute.length - 1) target = this.scenicRoute[++this.scenicLeg]!
      const desired = Math.atan2(target.x - this.position.x, this.position.z - target.z)
      turn = clamp(angleDelta(this.heading, desired) * 1.5, -.8, .8)
      climb = clamp((this.surface(this.position.x, this.position.z) + 115 - this.position.y) / 45, -.5, .8)
    }
    this.commands.manualTurn = turn; this.commands.manualClimb = climb
    // Plan at intended cruise speed, so slowing down cannot immediately remove the risk.
    const planningSpeed = Math.max(normalSpeed, this.speed)
    const angularLimit = this.gentle ? .22 : .4
    let required = -Infinity, minimumClearance = Infinity
    for (const seconds of [1, 2, 4, 6]) {
      const omega = this.turnRate + (turn * angularLimit - this.turnRate) * (1 - Math.exp(-seconds * 3))
      const halfAngle = this.heading + omega * seconds / 2
      const distance = Math.abs(omega) < 1e-5 ? planningSpeed * seconds : 2 * planningSpeed * Math.sin(omega * seconds / 2) / omega
      const heading = this.heading + omega * seconds
      for (const lateral of [-12, 0, 12]) {
        const x = this.position.x + Math.sin(halfAngle) * distance + Math.cos(heading) * lateral
        const z = this.position.z - Math.cos(halfAngle) * distance + Math.sin(heading) * lateral
        const gap = this.position.y - this.surface(x, z)
        minimumClearance = Math.min(minimumClearance, gap)
        required = Math.max(required, (clearance - gap) / seconds)
      }
    }
    const rawRisk = clamp(required / maxClimb, 0, 1)
    if (rawRisk > .55) { this.avoidance = 'avoid'; this.safeSeconds = 0 }
    else if (rawRisk < .3) {
      this.safeSeconds += dt
      if (this.safeSeconds > 2 && this.avoidance === 'avoid') this.avoidance = 'recover'
      if (this.safeSeconds > 4) this.avoidance = 'normal'
    } else this.safeSeconds = 0
    const riskTarget = this.avoidance === 'avoid' ? Math.max(.45, rawRisk) : rawRisk
    this.commands.risk += (riskTarget - this.commands.risk) * (1 - Math.exp(-dt * (riskTarget > this.commands.risk ? 4 : .65)))
    const targetSpeed = normalSpeed * (1 - .55 * this.commands.risk)
    this.sideHold = Math.max(0, this.sideHold - dt)
    if (required > maxClimb * 1.15) {
      if (this.sideHold === 0) {
        const left = this.surface(this.position.x + Math.sin(this.heading - .6) * 90, this.position.z - Math.cos(this.heading - .6) * 90)
        const right = this.surface(this.position.x + Math.sin(this.heading + .6) * 90, this.position.z - Math.cos(this.heading + .6) * 90)
        this.commands.side = left < right ? -1 : 1; this.sideHold = 3
      }
      turn = this.commands.side * .7
    }
    const targetClimb = clamp(Math.max(climb * (climb >= 0 ? 6 : 4), required), -4, maxClimb)
    const wantedAcceleration = clamp((targetClimb - this.climbRate) * 2, -3, 3)
    const oldAcceleration = this.verticalAcceleration
    this.verticalAcceleration += clamp(wantedAcceleration - this.verticalAcceleration, -6 * dt, 6 * dt)
    this.climbRate += this.verticalAcceleration * dt
    this.speed += clamp((targetSpeed - this.speed) * 1.5, -3, 2) * dt
    this.turnRate += (turn * angularLimit - this.turnRate) * (1 - Math.exp(-dt * 3))
    Object.assign(this.commands, { finalTurn: turn, targetClimb, targetSpeed, clearance: minimumClearance, jerk: (this.verticalAcceleration - oldAcceleration) / dt })
    const heading = this.heading + this.turnRate * dt
    const next = { x: this.position.x + Math.sin(heading) * this.speed * dt,
      y: clamp(this.position.y + this.climbRate * dt, 45, 1400), z: this.position.z - Math.cos(heading) * this.speed * dt }
    for (const lateral of [-12, 0, 12]) if (next.y < this.surface(next.x + Math.cos(heading) * lateral, next.z + Math.sin(heading) * lateral) + 25) { this.safetyStop = true; return }
    Object.assign(this.position, next); this.heading = Math.atan2(Math.sin(heading), Math.cos(heading)); this.time += dt
  }
}
