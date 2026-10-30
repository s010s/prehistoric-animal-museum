import { render } from '@testing-library/react'
import { SceneAtmosphere } from '../src/components/SceneAtmosphere'

describe('SceneAtmosphere', () => {
  it('renders one decorative, non-interactive layer for every authored scene kind', () => {
    const { container, rerender } = render(
      <SceneAtmosphere kind="air" />,
    )

    expect(container.firstElementChild).toHaveAttribute(
      'aria-hidden',
      'true',
    )
    expect(container.querySelectorAll('.scene-atmosphere')).toHaveLength(1)
    expect(container.querySelectorAll('.air-cloud')).toHaveLength(2)
    expect(container.querySelectorAll('.air-streamline')).toHaveLength(3)
    expect(container.querySelectorAll('.air-silhouette')).toHaveLength(2)

    rerender(<SceneAtmosphere kind="ice" />)
    expect(container.querySelectorAll('.scene-atmosphere')).toHaveLength(1)
    expect(container.querySelectorAll('.ice-crystal')).toHaveLength(9)
    expect(container.querySelectorAll('.ice-ground-haze')).toHaveLength(2)

    rerender(<SceneAtmosphere kind="forest" />)
    expect(container.querySelectorAll('.scene-atmosphere')).toHaveLength(1)
    expect(container.querySelectorAll('.forest-sunbeam')).toHaveLength(0)
    expect(container.querySelectorAll('.forest-dust-particle')).toHaveLength(
      12,
    )
    expect(container.querySelectorAll('.forest-leaf')).toHaveLength(4)

    rerender(<SceneAtmosphere kind="plains" />)
    expect(container.querySelectorAll('.scene-atmosphere')).toHaveLength(1)
    expect(container.querySelectorAll('.plains-seed')).toHaveLength(10)
    expect(container.querySelectorAll('.plains-haze')).toHaveLength(2)

    rerender(<SceneAtmosphere kind="underwater" />)
    expect(container.querySelectorAll('.scene-atmosphere')).toHaveLength(1)
    expect(container.querySelectorAll('.underwater-bubble')).toHaveLength(12)
  })
})
