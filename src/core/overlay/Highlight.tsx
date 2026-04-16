import { h } from 'preact'
import type { HighlightEntry } from '../types'

interface HighlightProps {
  highlights: HighlightEntry[]
  showAiActions: boolean
}

export function Highlight({ highlights, showAiActions }: HighlightProps) {
  if (highlights.length === 0) return null

  return (
    <>
      {highlights.map(entry => {
        const aiClass = showAiActions && entry.source === 'ai' ? ' ai-source' : ''
        return (
          <div
            key={entry.id}
            class={`highlight-overlay${aiClass}`}
            style={{
              top: `${entry.rect.top}px`,
              left: `${entry.rect.left}px`,
              width: `${entry.rect.width}px`,
              height: `${entry.rect.height}px`,
            }}
          >
            <div class={`highlight-label${aiClass}`}>
              {entry.source === 'ai' ? `AI \u2022 ${entry.name}` : entry.name}
            </div>
          </div>
        )
      })}
    </>
  )
}
