import { StrictMode } from 'react'
import { createRoot, hydrateRoot } from 'react-dom/client'
import '@fontsource-variable/fredoka'
import '@fontsource-variable/noto-sans-sc'
import '@fontsource-variable/nunito'
import '@fontsource/zcool-kuaile'
import { App } from './App'
import { readInitialAppState } from './app-bootstrap'
import { readInitialLocaleState } from './i18n/browser-locale'
import './styles.css'
import './motion.css'

const initialState = readInitialAppState()
const initialLocale = initialState?.locale ?? readInitialLocaleState().locale
const useFixtureCsr =
  import.meta.env.MODE === 'e2e' &&
  new URLSearchParams(window.location.search).get('fixtures') === '1'
document.documentElement.lang = initialLocale
document.documentElement.dataset.locale = initialLocale

const root = document.getElementById('root')

if (!root) {
  throw new Error('应用挂载点不存在。')
}

const application = (
  <StrictMode>
    <App {...(initialState ? { initialState } : {})} />
  </StrictMode>
)

if (initialState && root.hasChildNodes() && !useFixtureCsr) {
  hydrateRoot(root, application, {
    onRecoverableError(error) {
      console.error('Museum hydration recovered from an error.', error)
    },
  })
} else {
  if (useFixtureCsr) {
    root.replaceChildren()
  }
  createRoot(root).render(application)
}
