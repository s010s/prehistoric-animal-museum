import { useRef, type HTMLAttributes } from 'react'
import { useMovingHighlight } from '../components/useMovingHighlight'

export function FlightChoices({ selected, className = '', ...props }: HTMLAttributes<HTMLDivElement> & {
  selected: string | null | undefined
}) {
  const root = useRef<HTMLDivElement>(null)
  const keyboard = useRef(false)
  useMovingHighlight({ root, keyboard, selected: selected ?? null, attribute: 'data-flight-choice', variant: 'flight-choice' })
  return <div {...props} ref={root} className={`flight-choice-track ${className}`} onClickCapture={event => {
    keyboard.current = event.detail === 0
    props.onClickCapture?.(event)
  }}/>
}
