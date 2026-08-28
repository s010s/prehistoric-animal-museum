/** @vitest-environment node */

import { renderToString } from 'react-dom/server'

import { App } from '../src/App'
import { mainCollection } from '../src/content/collections/main'
import { renderMuseumApp } from '../src/entry-server'

describe('museum server rendering', () => {
  it('renders a deterministic English museum first frame without browser globals', () => {
    const html = renderToString(
      <App
        initialState={{
          animalId: 'stegosaurus',
          locale: 'en',
          pageKind: 'museum',
          preference: 'en',
        }}
      />,
    )

    expect(html).toContain('id="museum-experience"')
    expect(html).toContain('data-locale="en"')
    expect(html).toContain('data-requested-animal-id="stegosaurus"')
    expect(html).toContain('Prehistoric Animal Museum')
    expect(html).toContain('Stegosaurus')
    expect(html).toContain('Research notes about Stegosaurus')
    expect(html).toContain('Classification used here: Stegosaur dinosaur')
    expect(html).toContain('Fossil evidence and reconstruction limits')
    expect(html).toContain('https://leon-made-this.work/museum/en/')
    expect(html).toContain('https://leon-made-this.work/')
    expect(html.match(/data-animal-detail-link=""/g)).toHaveLength(
      mainCollection.animalIds.length,
    )
    for (const animalId of mainCollection.animalIds) {
      expect(html).toContain(`href="./animals/${animalId}/"`)
    }
    expect(html).not.toContain('seo-static-shell')
  })

  it('exposes the same deterministic markup through the build-time server entry', () => {
    const html = renderMuseumApp({
      animalId: 'stegosaurus',
      locale: 'zh-CN',
      pageKind: 'museum',
      preference: 'zh-CN',
    })

    expect(html).toContain('id="museum-experience"')
    expect(html).toContain('data-locale="zh-CN"')
    expect(html).toContain('data-requested-animal-id="stegosaurus"')
    expect(html).toContain('史前动物博物馆')
    expect(html).toContain('剑龙')
  })

  it('renders fallback links toward canonical localized detail pages', () => {
    const html = renderMuseumApp({
      animalId: 'stegosaurus',
      locale: 'zh-CN',
      pageKind: 'museum',
      preference: 'zh-CN',
      rootFallback: true,
    })

    for (const animalId of mainCollection.animalIds) {
      expect(html).toContain(`href="./zh-CN/animals/${animalId}/"`)
      expect(html).not.toContain(`href="./animals/${animalId}/"`)
    }
  })

  it('renders an animal deep link as the matching museum exhibit', () => {
    const html = renderMuseumApp({
      animalId: 'mosasaurus',
      locale: 'en',
      pageKind: 'animal-detail',
      preference: 'en',
    })

    expect(html).toContain('id="museum-experience"')
    expect(html).toContain('data-locale="en"')
    expect(html).toContain('data-page-kind="animal-detail"')
    expect(html).toContain('data-requested-animal-id="mosasaurus"')
    expect(html).toContain('Prehistoric Animal Museum')
    expect(html).toContain('<h1 class="animal-title">Mosasaurus</h1>')
    expect(html).toContain('Research notes about Mosasaurus')
    expect(html).toContain('Late Cretaceous')
    expect(html).toContain('Scientific sources')
    expect(html).toContain('Made by Leon Made This')
    expect(html).toContain(
      'Leon Made This compiled these research notes from public museum resources and scientific papers',
    )
    expect(html).toContain(
      'data-museum-return="" href="../../../en/?animal=mosasaurus"',
    )
    expect(html.match(/data-animal-detail-link=""/g)).toHaveLength(
      mainCollection.animalIds.length,
    )
    for (const animalId of mainCollection.animalIds) {
      expect(html).toContain(`href="../${animalId}/"`)
    }
    expect(html).not.toContain(
      'The content below uses the same reviewed data as the guide for grown-ups',
    )
    expect(html).not.toContain('seo-static-shell')
  })
})
