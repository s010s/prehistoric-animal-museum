import { BadgeCheck, ExternalLink, Home } from 'lucide-react'
import { useI18n } from '../i18n/I18nProvider'
import { museumOfficialUrl, PERSONAL_SITE_URL } from '../official-links'

interface OfficialLinksProps {
  readonly compact?: boolean
}

export function OfficialLinks({ compact = false }: OfficialLinksProps) {
  const { locale, messages } = useI18n()
  const museumUrl = museumOfficialUrl(locale)

  return (
    <section
      aria-label={messages.official.title}
      className={`official-links${compact ? ' official-links--compact' : ''}`}
    >
      <header className="official-links__header">
        <span aria-hidden="true" className="official-links__seal">
          <BadgeCheck size={18} strokeWidth={2.2} />
        </span>
        <div>
          <p>{messages.official.eyebrow}</p>
          <h3>{messages.official.title}</h3>
        </div>
      </header>
      <p className="official-links__byline">{messages.official.byline}</p>
      <div className="official-links__actions">
        <a href={museumUrl} rel="noreferrer" target="_blank">
          <BadgeCheck aria-hidden="true" size={18} strokeWidth={2.1} />
          <span>
            <strong>{messages.official.museum}</strong>
            <small>{museumUrl}</small>
          </span>
          <ExternalLink aria-hidden="true" size={15} strokeWidth={2} />
        </a>
        <a href={PERSONAL_SITE_URL} rel="noreferrer" target="_blank">
          <Home aria-hidden="true" size={18} strokeWidth={2.1} />
          <span>
            <strong>{messages.official.personalSite}</strong>
            <small>{PERSONAL_SITE_URL}</small>
          </span>
          <ExternalLink aria-hidden="true" size={15} strokeWidth={2} />
        </a>
      </div>
    </section>
  )
}
