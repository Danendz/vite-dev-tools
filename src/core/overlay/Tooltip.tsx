import { h, type ComponentChildren } from 'preact'
import { useState, useRef, useEffect, useCallback } from 'preact/hooks'

interface TooltipProps {
  text: string
  shortcut?: string
  children: ComponentChildren
}

export function Tooltip({ text, shortcut, children }: TooltipProps) {
  const [visible, setVisible] = useState(false)
  const wrapperRef = useRef<HTMLSpanElement>(null)
  const tipRef = useRef<HTMLSpanElement>(null)
  const timerRef = useRef<number>(0)

  const show = useCallback(() => {
    timerRef.current = window.setTimeout(() => setVisible(true), 200)
  }, [])

  const hide = useCallback(() => {
    clearTimeout(timerRef.current)
    setVisible(false)
  }, [])

  useEffect(() => () => clearTimeout(timerRef.current), [])

  useEffect(() => {
    if (!visible) return
    const tip = tipRef.current
    const wrapper = wrapperRef.current
    if (!tip || !wrapper) return

    const tr = wrapper.getBoundingClientRect()
    const tt = tip.getBoundingClientRect()
    const gap = 24
    const pad = 8

    // Default: centered below
    let top = tr.bottom + gap
    let left = tr.left + tr.width / 2 - tt.width / 2

    // Flip above if too close to bottom
    if (top + tt.height > window.innerHeight - pad) {
      top = tr.top - tt.height - gap
    }

    // Shift horizontally if overflowing
    if (left < pad) left = pad
    if (left + tt.width > window.innerWidth - pad) {
      left = window.innerWidth - pad - tt.width
    }

    tip.style.top = `${top}px`
    tip.style.left = `${left}px`
  }, [visible])

  return (
    <span
      ref={wrapperRef}
      class="tooltip-wrapper"
      onMouseEnter={show}
      onMouseLeave={hide}
    >
      {children}
      {visible && (
        <span ref={tipRef} class="tooltip-chip">
          {text}
          {shortcut && <span class="tooltip-shortcut">{shortcut}</span>}
        </span>
      )}
    </span>
  )
}
