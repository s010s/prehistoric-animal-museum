/* eslint-disable @typescript-eslint/consistent-type-imports -- Ambient virtual module uses a relative type query. */
declare module 'virtual:flight-experience-entry' {
  const loadFlightExperience: (() => Promise<typeof import('./FlightExperience')>) | null
  export { loadFlightExperience }
}
