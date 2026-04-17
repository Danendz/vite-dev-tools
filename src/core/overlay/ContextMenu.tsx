import { h } from 'preact'
import { useEffect, useRef } from 'preact/hooks'

export interface ContextMenuItem {
  label: string
  onClick: () => void
}

interface ContextMenuProps {
  x: number
  y: number
  items: ContextMenuItem[]
  onClose: () => void
}

export function ContextMenu({
  x,
  y,
  items,
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

  if (items.length === 0) return null

  return (
    <div class="context-menu" style={{ left: `${x}px`, top: `${y}px` }} ref={ref}>
      {items.map((item, i) => (
        <button key={i} class="context-menu-item" onClick={() => { item.onClick(); onClose() }}>
          {item.label}
        </button>
      ))}
    </div>
  )
}
