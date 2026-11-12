import { useLayoutEffect, useRef } from 'react'
import type { FlightSnapshot } from '../FlightRuntime'
import { playMotion, reducedMotion } from '../../motion'
export function ViewPreparation({ snapshot, zh }: { snapshot: FlightSnapshot; zh: boolean }) {
  const host = useRef<HTMLDivElement>(null), canvas = snapshot.viewTransition?.canvas
  const reveal = useRef<{ canvas: HTMLCanvasElement; animation: Animation | null } | null>(null)
  const returning = snapshot.observation === 'returning', failed = snapshot.observation === 'failed'
  const settled=!snapshot.viewTransition?.waiting&&['active','inactive'].includes(snapshot.observation??'inactive')
  useLayoutEffect(() => {
    if (!canvas || !host.current) return
    host.current.appendChild(canvas)
    return () => {
      if (reveal.current?.canvas === canvas) {
        reveal.current.animation?.cancel()
        reveal.current = null
      }
      canvas.remove()
    }
  }, [canvas])
  useLayoutEffect(() => {
    // When another view is chosen during the fade, keep the old still at its
    // current opacity until the newly completed frame replaces it.
    if (!settled || !canvas || reveal.current?.canvas === canvas) return
    reveal.current = { canvas, animation: playMotion(canvas, [{ opacity: 1 }, { opacity: 0 }], {
      duration: reducedMotion() ? 150 : 300, easing: 'ease-out', holdEnd: true,
    }) }
  }, [canvas, settled])
  return <div className="flight-view-preparing" data-settled={settled}>
    <div ref={host} className="flight-view-still" aria-hidden="true" />
    {!settled&&<div className="flight-view-loading" role="status"><span className="flight-view-loading__line" aria-hidden="true"/>
      <strong>{failed ? (zh ? '这个角度暂时没准备好' : 'This view is taking longer') : returning ? (zh ? '回到刚才的飞行位置' : 'Returning to your flight position') : (zh ? '正在走近这片风景' : 'Getting your view ready')}</strong>
      <p>{failed ? (zh ? '可以换一个角度，或返回飞行位置。' : 'Choose another view, or return to flight.') : (zh ? '先留住眼前这一刻。准备好后，新的视野会在这里出现。' : 'Keeping this moment while the next view gets ready.')}</p>
    </div>}
  </div>
}
