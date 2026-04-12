import { h } from 'preact'
import { useEffect, useRef } from 'preact/hooks'

interface ContextMenuProps {
  x: number
  y: number
  nodeName: string
  isFromNodeModules: boolean
  onAlwaysShow: () => void
  onAlwaysHide: () => void
  onResetOverride: () => void
  onClose: () => void
}

export function ContextMenu({
  x,
  y,
  nodeName,
  isFromNodeModules,
  onAlwaysShow,
  onAlwaysHide,
  onResetOverride,
  onClose,
}: ContextMenuProps) {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        onClose()
      }
    }
    // Use setTimeout to avoid immediately closing from the same right-click
    const timer = setTimeout(() => {
      document.addEventListener('click', handleClick)
    }, 0)
    return () => {
      clearTimeout(timer)
      document.removeEventListener('click', handleClick)
    }
  }, [onClose])

  return (
    <div class="context-menu" style={{ left: `${x}px`, top: `${y}px` }} ref={ref}>
      {isFromNodeModules ? (
        <button class="context-menu-item" onClick={onAlwaysShow}>
          Always show "{nodeName}"
        </button>
      ) : (
        <button class="context-menu-item" onClick={onAlwaysHide}>
          Always hide "{nodeName}"
        </button>
      )}
      <button class="context-menu-item" onClick={onResetOverride}>
        Reset override for "{nodeName}"
      </button>
    </div>
  )
}
