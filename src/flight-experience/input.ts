import type { FlightInput } from './simulation'
export function isFlightShortcutTarget(target: EventTarget | null): boolean {
  return target instanceof HTMLElement && !!target.closest('button,input,select,textarea,a,[contenteditable="true"],[role="dialog"] input')
}
export class FlightInputState {
  private readonly keys = new Set<string>()
  private readonly pointers = new Map<number, FlightInput>()
  key(code: string, pressed: boolean) { if (pressed) this.keys.add(code); else this.keys.delete(code) }
  point(turn: number, climb: number, pointerId = -1) { if (turn === 0 && climb === 0) this.pointers.delete(pointerId); else this.pointers.set(pointerId, { turn, climb }) }
  release(pointerId: number) { this.pointers.delete(pointerId) }
  clear() { this.keys.clear(); this.pointers.clear() }
  read(): FlightInput {
    const pointer = [...this.pointers.values()].reduce((sum, p) => ({ turn: sum.turn + p.turn, climb: sum.climb + p.climb }), { turn: 0, climb: 0 })
    const has = (...keys: string[]) => keys.some(k => this.keys.has(k)) ? 1 : 0
    return {
      turn: Math.max(-1, Math.min(1, has('ArrowRight', 'KeyD') - has('ArrowLeft', 'KeyA') + pointer.turn)),
      climb: Math.max(-1, Math.min(1, has('ArrowUp', 'KeyW') - has('ArrowDown', 'KeyS') + pointer.climb)),
    }
  }
}
