import { h } from 'preact'
import { useEffect, useRef } from 'preact/hooks'
import type { SourceLocation } from '../types'
import { openInEditor } from '../communication'

function formatPath(source: SourceLocation): string {
  return `${source.fileName.replace(/^.*\/src\//, 'src/')}:${source.lineNumber}`
}

interface ContextMenuProps {
  x: number
  y: number
  source: SourceLocation
  usageSource?: SourceLocation
  onClose: () => void
}

export function ContextMenu({
  x,
  y,
  source,
  usageSource,
  onClose,
}: ContextMenuProps) {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        onClose()
      }
    }
    // Listen on the shadow root so clicks inside the devtools panel are caught
    const root = ref.current?.getRootNode() as ShadowRoot | Document
    // Use setTimeout to avoid immediately closing from the same right-click
    const timer = setTimeout(() => {
      root.addEventListener('click', handleClickOutside as EventListener)
      root.addEventListener('contextmenu', handleClickOutside as EventListener)
    }, 0)
    return () => {
      clearTimeout(timer)
      root.removeEventListener('click', handleClickOutside as EventListener)
      root.removeEventListener('contextmenu', handleClickOutside as EventListener)
    }
  }, [onClose])

  return (
    <div class="context-menu" style={{ left: `${x}px`, top: `${y}px` }} ref={ref}>
      <button class="context-menu-item" onClick={() => { openInEditor(source); onClose() }}>
        Open source — {formatPath(source)}
      </button>
      {usageSource && (
        <button class="context-menu-item" onClick={() => { openInEditor(usageSource); onClose() }}>
          Open usage — {formatPath(usageSource)}
        </button>
      )}
    </div>
  )
}
