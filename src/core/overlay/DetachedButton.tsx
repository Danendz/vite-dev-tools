import { h } from 'preact'
import { Tooltip } from './Tooltip'

interface DetachedButtonProps {
  onRefocus: () => void
}

export function DetachedButton({ onRefocus }: DetachedButtonProps) {
  return (
    <Tooltip text="Focus DevTools popup">
      <div class="floating-icon detached-icon" onClick={onRefocus}>
        {/* Wrench icon (same as FloatingIcon) */}
        <svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
          <path d="M22.7 19l-9.1-9.1c.9-2.3.4-5-1.5-6.9-2-2-5-2.4-7.4-1.3L9 6 6 9 1.6 4.7C.4 7.1.9 10.1 2.9 12.1c1.9 1.9 4.6 2.4 6.9 1.5l9.1 9.1c.4.4 1 .4 1.4 0l2.3-2.3c.5-.4.5-1.1.1-1.4z" />
        </svg>
        {/* External window badge */}
        <svg class="detached-badge" viewBox="0 0 12 12" fill="none" xmlns="http://www.w3.org/2000/svg">
          <rect x="1" y="3" width="8" height="7" rx="1" stroke="currentColor" stroke-width="1.5" fill="#18181b" />
          <path d="M7 1h4v4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" />
          <path d="M11 1L6 6" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" />
        </svg>
      </div>
    </Tooltip>
  )
}
