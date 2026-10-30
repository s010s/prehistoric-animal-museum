const dustCount = 12
const leafCount = 4

/** Subtle drifting air without decorative light columns. */
export function ForestAtmosphere() {
  return (
    <div
      aria-hidden="true"
      className="scene-atmosphere forest-atmosphere"
    >
      <span className="forest-dust">
        {Array.from({ length: dustCount }, (_, index) => (
          <span
            className="forest-dust-particle"
            key={`forest-dust-${index + 1}`}
          />
        ))}
      </span>
      <span className="forest-leaves">
        {Array.from({ length: leafCount }, (_, index) => (
          <span
            className="forest-leaf"
            key={`forest-leaf-${index + 1}`}
          />
        ))}
      </span>
    </div>
  )
}
