import {
  parseScaleEncounterProfile,
  readScaleEncounterProfile,
  SCALE_ENCOUNTER_PROFILE_STORAGE_KEY,
  writeScaleEncounterProfile,
} from '../src/scale-encounter/profile-storage'

describe('scale encounter profile storage', () => {
  beforeEach(() => {
    window.localStorage.clear()
    window.sessionStorage.clear()
  })

  it('round-trips the explorer profile across refreshes in local storage', () => {
    const profile = {
      approach: 'close' as const,
      gender: 'girl' as const,
      heightCm: 115,
    }

    writeScaleEncounterProfile(profile)

    expect(readScaleEncounterProfile()).toEqual(profile)
    expect(window.localStorage.getItem(SCALE_ENCOUNTER_PROFILE_STORAGE_KEY))
      .toContain('"version":1')
  })

  it('removes a stored profile when the explorer is reset', () => {
    writeScaleEncounterProfile({ gender: 'boy', heightCm: 110 })
    writeScaleEncounterProfile(null)

    expect(readScaleEncounterProfile()).toBeNull()
    expect(
      window.localStorage.getItem(SCALE_ENCOUNTER_PROFILE_STORAGE_KEY),
    ).toBeNull()
  })

  it('migrates a legacy profile from session storage into local storage', () => {
    const profile = {
      gender: 'girl' as const,
      heightCm: 105,
    }
    window.sessionStorage.setItem(
      SCALE_ENCOUNTER_PROFILE_STORAGE_KEY,
      JSON.stringify({ profile, version: 1 }),
    )

    expect(readScaleEncounterProfile()).toEqual(profile)
    expect(
      window.localStorage.getItem(SCALE_ENCOUNTER_PROFILE_STORAGE_KEY),
    ).toContain('"version":1')
  })

  it('cleans up legacy session storage when resetting profile', () => {
    window.sessionStorage.setItem(
      SCALE_ENCOUNTER_PROFILE_STORAGE_KEY,
      JSON.stringify({ profile: { gender: 'boy', heightCm: 100 }, version: 1 }),
    )
    writeScaleEncounterProfile(null)

    expect(
      window.sessionStorage.getItem(SCALE_ENCOUNTER_PROFILE_STORAGE_KEY),
    ).toBeNull()
    expect(
      window.localStorage.getItem(SCALE_ENCOUNTER_PROFILE_STORAGE_KEY),
    ).toBeNull()
  })

  it('ignores malformed or out-of-range data', () => {
    expect(parseScaleEncounterProfile('{not-json')).toBeNull()
    expect(
      parseScaleEncounterProfile(
        JSON.stringify({
          profile: { gender: 'girl', heightCm: 300 },
          version: 1,
        }),
      ),
    ).toBeNull()
    expect(
      parseScaleEncounterProfile(
        JSON.stringify({
          profile: { gender: 'girl', heightCm: 112 },
          version: 1,
        }),
      ),
    ).toBeNull()
  })
})
