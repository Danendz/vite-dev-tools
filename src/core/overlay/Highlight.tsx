import { h } from 'preact'

interface HighlightProps {
  rect: DOMRect | null
  name: string | null
}

export function Highlight({ rect, name }: HighlightProps) {
  if (!rect) return null

  return (
    <div
      class="highlight-overlay"
      style={{
        top: `${rect.top}px`,
        left: `${rect.left}px`,
        width: `${rect.width}px`,
        height: `${rect.height}px`,
      }}
    >
      {name && <div class="highlight-label">{name}</div>}
    </div>
  )
}
