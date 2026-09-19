import { Component, type ReactNode } from 'react'
import type { Locale } from '../i18n/locale'
interface Props { children: ReactNode; locale: Locale; onClose: () => void }
/** Kept in the small app entry so a failed lazy download still has an exit. */
export class FlightModuleBoundary extends Component<Props, { failed: boolean }> {
  state = { failed: false }
  static getDerivedStateFromError() { return { failed: true } }
  render() {
    if (!this.state.failed) return this.props.children
    const zh = this.props.locale === 'zh-CN'
    return <section className="scale-encounter-module-loading" role="dialog" aria-modal="true" aria-label={zh ? '飞行暂时不可用' : 'Flight is unavailable'}>
      <p>{zh ? '飞行画面未能载入。可以回展馆，或重新载入页面。' : 'Flight could not load. Return to the museum or reload the page.'}</p>
      <button type="button" onClick={this.props.onClose}>{zh ? '返回展馆' : 'Back to museum'}</button>
      <button type="button" onClick={() => window.location.reload()}>{zh ? '重新载入' : 'Reload'}</button>
    </section>
  }
}
