import { act, fireEvent, render, screen } from '@testing-library/react'
import { expect, it, vi } from 'vitest'
import { FlightModule } from '../../src/flight-experience/FlightModuleBoundary'
import type { FlightExperience } from '../../src/flight-experience/FlightExperience'
it('shows the prepared scene when retry succeeds after a module load failure',async()=>{
 const error=vi.spyOn(console,'error').mockImplementation(()=>{})
 try {
  const loader=vi.fn().mockRejectedValueOnce(new Error('network')).mockResolvedValueOnce({FlightExperience:()=> <p>Prepared scene</p>})
  const onClose=vi.fn()
  await act(async()=>{await Promise.resolve();render(<FlightModule loader={loader} locale="en" onClose={onClose} experienceProps={{} as Parameters<typeof FlightExperience>[0]}/>)})
  expect(screen.getByText(/Flight could not load/)).toBeVisible()
  await act(async()=>{await Promise.resolve();fireEvent.click(screen.getByRole('button',{name:'Try again'}))})
  expect(screen.getByText('Prepared scene')).toBeVisible()
 }finally{error.mockRestore()}
})
