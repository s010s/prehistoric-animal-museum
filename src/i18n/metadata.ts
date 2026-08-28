import { buildLocaleUrl, localeFromPath, type Locale } from './locale'

export interface LocalizedMetadata {
  readonly locale: Locale
  readonly documentTitle: string
  readonly museumTitle: string
  readonly creatorBrand: string
  readonly description: string
  readonly socialImageAlt: string
  readonly animalDetail?: {
    readonly description: string
    readonly id: string
    readonly name: string
  }
}

function ensureMeta(
  attribute: 'name' | 'property',
  key: string,
  content: string,
): void {
  let element = document.querySelector<HTMLMetaElement>(
    `meta[${attribute}="${key}"]`,
  )
  if (!element) {
    element = document.createElement('meta')
    element.setAttribute(attribute, key)
    document.head.append(element)
  }
  element.content = content
}

type MetadataVariant = Locale | 'x-default'

function museumRootUrl(): URL {
  const candidates = [
    document.querySelector<HTMLLinkElement>(
      'link[rel="alternate"][hreflang="x-default"]',
    )?.href,
    document.querySelector<HTMLLinkElement>(
      'link[rel="alternate"][hreflang="zh-CN"]',
    )?.href,
    document.querySelector<HTMLLinkElement>(
      'link[rel="alternate"][hreflang="en"]',
    )?.href,
    window.location.href,
    document.querySelector<HTMLLinkElement>('link[rel="canonical"]')?.href,
  ]

  for (const candidate of candidates) {
    if (!candidate) {
      continue
    }
    const url = new URL(candidate, window.location.origin)
    const localizedSuffix = url.pathname.match(
      /^(.*\/)(?:zh-CN|en)(?:\/animals\/[a-z0-9]+(?:-[a-z0-9]+)*)?\/?$/,
    )
    if (localizedSuffix?.[1]) {
      url.pathname = localizedSuffix[1]
      url.search = ''
      url.hash = ''
      return url
    }

    if (
      document.querySelector<HTMLLinkElement>(
        'link[rel="alternate"][hreflang="x-default"]',
      )?.href === candidate
    ) {
      url.pathname = url.pathname.endsWith('/')
        ? url.pathname
        : `${url.pathname}/`
      url.search = ''
      url.hash = ''
      return url
    }
  }

  const fallback = new URL(window.location.href)
  fallback.pathname = buildLocaleUrl(fallback.href, 'system').split(/[?#]/u)[0] ?? '/'
  fallback.search = ''
  fallback.hash = ''
  return fallback
}

function localizedCanonical(
  root: URL,
  variant: MetadataVariant,
  animalId?: string,
): string {
  if (variant === 'x-default') {
    return root.href
  }
  return new URL(
    animalId ? `${variant}/animals/${animalId}/` : `${variant}/`,
    root,
  ).href
}

function ensureCanonical(href: string): void {
  let canonical = document.querySelector<HTMLLinkElement>(
    'link[rel="canonical"]',
  )
  if (!canonical) {
    canonical = document.createElement('link')
    canonical.rel = 'canonical'
    document.head.append(canonical)
  }
  canonical.href = href
}

function ensureAlternate(variant: MetadataVariant, href: string): void {
  let alternate = document.querySelector<HTMLLinkElement>(
    `link[rel="alternate"][hreflang="${variant}"]`,
  )
  if (!alternate) {
    alternate = document.createElement('link')
    alternate.rel = 'alternate'
    alternate.hreflang = variant
    document.head.append(alternate)
  }
  alternate.href = href
}

function ensureJsonLd(id: string, value: Record<string, unknown>): void {
  let script = document.querySelector<HTMLScriptElement>(
    `script#${id}[type="application/ld+json"]`,
  )
  if (!script) {
    script = document.createElement('script')
    script.id = id
    script.type = 'application/ld+json'
    document.head.append(script)
  }
  script.textContent = JSON.stringify(value)
}

function updateMuseumStructuredData({
  description,
  locale,
  museumCanonical,
  museumTitle,
  root,
}: {
  readonly description: string
  readonly locale: Locale
  readonly museumCanonical: string
  readonly museumTitle: string
  readonly root: URL
}): void {
  const personalSite = new URL('/', root).href
  ensureJsonLd('museum-structured-data', {
    '@context': 'https://schema.org',
    '@type': 'WebApplication',
    '@id': `${museumCanonical}#museum`,
    alternateName:
      locale === 'zh-CN' ? 'Prehistoric Animal Museum' : '史前动物博物馆',
    applicationCategory: 'EducationalApplication',
    brand: {
      '@type': 'Brand',
      '@id': `${personalSite}#leon-made-this`,
      alternateName: 'Leon Made This',
      name: 'Leon做了个',
      url: personalSite,
    },
    copyrightHolder: {
      '@type': 'Person',
      '@id': `${personalSite}#leon`,
      name: 'Leon',
      url: personalSite,
    },
    creator: {
      '@type': 'Person',
      '@id': `${personalSite}#leon`,
      name: 'Leon',
      url: personalSite,
    },
    description,
    inLanguage: locale,
    isAccessibleForFree: true,
    isPartOf: {
      '@type': 'WebSite',
      '@id': `${personalSite}#website`,
      name: 'Leon做了个',
      url: personalSite,
    },
    name: museumTitle,
    operatingSystem: 'Any',
    url: museumCanonical,
  })
}

function updateAnimalStructuredData({
  animalDetail,
  canonical,
  description,
  image,
  locale,
  museumCanonical,
  museumTitle,
}: {
  readonly animalDetail: NonNullable<LocalizedMetadata['animalDetail']> | undefined
  readonly canonical: string
  readonly description: string
  readonly image: string
  readonly locale: Locale
  readonly museumCanonical: string
  readonly museumTitle: string
}): void {
  let script = document.querySelector<HTMLScriptElement>(
    'script#animal-structured-data[type="application/ld+json"]',
  )
  if (!animalDetail) {
    script?.remove()
    return
  }
  if (!script) {
    script = document.createElement('script')
    script.id = 'animal-structured-data'
    script.type = 'application/ld+json'
    document.head.append(script)
  }
  const personalSite = new URL('/', museumCanonical).href
  script.textContent = JSON.stringify({
    '@context': 'https://schema.org',
    '@type': 'WebPage',
    breadcrumb: {
      '@type': 'BreadcrumbList',
      itemListElement: [
        {
          '@type': 'ListItem',
          position: 1,
          name: museumTitle,
          item: museumCanonical,
        },
        {
          '@type': 'ListItem',
          position: 2,
          name: animalDetail.name,
          item: canonical,
        },
      ],
    },
    copyrightHolder: {
      '@type': 'Person',
      '@id': `${personalSite}#leon`,
      name: 'Leon',
      url: personalSite,
    },
    creator: {
      '@type': 'Person',
      '@id': `${personalSite}#leon`,
      name: 'Leon',
      url: personalSite,
    },
    description,
    image,
    inLanguage: locale,
    isPartOf: {
      '@type': 'WebApplication',
      '@id': `${museumCanonical}#museum`,
      brand: {
        '@type': 'Brand',
        '@id': `${personalSite}#leon-made-this`,
        alternateName: 'Leon Made This',
        name: 'Leon做了个',
        url: personalSite,
      },
      name: museumTitle,
      url: museumCanonical,
    },
    name: animalDetail.name,
    url: canonical,
  })
}

export function updateLocalizedMetadata({
  locale,
  documentTitle,
  museumTitle,
  creatorBrand,
  description,
  socialImageAlt,
  animalDetail,
}: LocalizedMetadata): void {
  const variant = localeFromPath(window.location.pathname) ?? locale
  const root = museumRootUrl()
  const detailId = animalDetail?.id
  const canonical = localizedCanonical(root, variant, detailId)
  const localizedDescription = animalDetail?.description ?? description
  const ogLocale = locale === 'zh-CN' ? 'zh_CN' : 'en_GB'
  const alternateLocale = locale === 'zh-CN' ? 'en_GB' : 'zh_CN'
  const socialImage = animalDetail
    ? new URL(`animals/${animalDetail.id}/social.webp`, root).href
    : new URL(`social/museum.${variant}.png`, root).href
  const metadataTitle = animalDetail ? documentTitle : museumTitle
  const imageAlt = animalDetail?.name ?? socialImageAlt
  const museumCanonical = localizedCanonical(root, variant)

  document.title = documentTitle
  ensureCanonical(canonical)
  ensureAlternate(
    'zh-CN',
    localizedCanonical(root, 'zh-CN', detailId),
  )
  ensureAlternate('en', localizedCanonical(root, 'en', detailId))
  if (animalDetail) {
    document
      .querySelector<HTMLLinkElement>(
        'link[rel="alternate"][hreflang="x-default"]',
      )
      ?.remove()
  } else {
    ensureAlternate('x-default', localizedCanonical(root, 'x-default'))
  }
  ensureMeta('name', 'description', localizedDescription)
  ensureMeta('property', 'og:type', animalDetail ? 'article' : 'website')
  ensureMeta('property', 'og:site_name', creatorBrand)
  ensureMeta('property', 'og:locale', ogLocale)
  ensureMeta('property', 'og:locale:alternate', alternateLocale)
  ensureMeta('property', 'og:title', metadataTitle)
  ensureMeta('property', 'og:description', localizedDescription)
  ensureMeta('property', 'og:url', canonical)
  ensureMeta('property', 'og:image', socialImage)
  ensureMeta('property', 'og:image:type', animalDetail ? 'image/webp' : 'image/png')
  ensureMeta('property', 'og:image:width', '1200')
  ensureMeta('property', 'og:image:height', '630')
  ensureMeta('property', 'og:image:alt', imageAlt)
  ensureMeta('name', 'twitter:card', 'summary_large_image')
  ensureMeta('name', 'twitter:title', metadataTitle)
  ensureMeta('name', 'twitter:description', localizedDescription)
  ensureMeta('name', 'twitter:image', socialImage)
  ensureMeta('name', 'twitter:image:alt', imageAlt)
  updateMuseumStructuredData({
    description,
    locale,
    museumCanonical,
    museumTitle,
    root,
  })
  updateAnimalStructuredData({
    animalDetail,
    canonical,
    description: localizedDescription,
    image: socialImage,
    locale,
    museumCanonical,
    museumTitle,
  })
}
