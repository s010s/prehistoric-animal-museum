import type { Locale } from './i18n/locale'

export const PERSONAL_SITE_URL = 'https://leon-made-this.work/'
export const CREATOR_ID = `${PERSONAL_SITE_URL}#leon`
export const CREATOR_BRAND_ID = `${PERSONAL_SITE_URL}#leon-made-this`
export const MUSEUM_ROOT_URL = `${PERSONAL_SITE_URL}museum/`

export const MUSEUM_OFFICIAL_URLS = {
  'zh-CN': `${MUSEUM_ROOT_URL}zh-CN/`,
  en: `${MUSEUM_ROOT_URL}en/`,
} as const satisfies Record<Locale, string>

export function museumOfficialUrl(locale: Locale): string {
  return MUSEUM_OFFICIAL_URLS[locale]
}
