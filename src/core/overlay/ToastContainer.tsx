import { h } from 'preact'
import type { ToastItem } from '../types'
import type { DockPosition } from '../types'

interface ToastContainerProps {
  toasts: ToastItem[]
  dockPosition: DockPosition
  onDismiss: (id: string) => void
}

export function ToastContainer({ toasts, dockPosition, onDismiss }: ToastContainerProps) {
  return (
    <div class={`toast-container dock-${dockPosition}`}>
      {toasts.map((toast) => (
        <div
          key={toast.id}
          class={`toast ${toast.type}${toast.dismissedAt ? ' dismissing' : ''}`}
          onAnimationEnd={() => {
            if (toast.dismissedAt) onDismiss(toast.id)
          }}
        >
          {toast.type === 'error' ? (
            <svg class="toast-icon error" viewBox="0 0 16 16" fill="currentColor">
              <path d="M8 1a7 7 0 1 0 0 14A7 7 0 0 0 8 1zm-.75 3.5a.75.75 0 0 1 1.5 0v4a.75.75 0 0 1-1.5 0v-4zm.75 7.25a.75.75 0 1 1 0-1.5.75.75 0 0 1 0 1.5z" />
            </svg>
          ) : (
            <svg class="toast-icon warning" viewBox="0 0 16 16" fill="currentColor">
              <path d="M8.22 1.754a.25.25 0 0 0-.44 0L1.698 13.132a.25.25 0 0 0 .22.368h12.164a.25.25 0 0 0 .22-.368L8.22 1.754zm-.75 3.746a.75.75 0 0 1 1.5 0v3a.75.75 0 0 1-1.5 0v-3zm.75 6.25a.75.75 0 1 1 0-1.5.75.75 0 0 1 0 1.5z" />
            </svg>
          )}
          <span class="toast-message">{toast.message}</span>
          <button class="toast-dismiss" onClick={() => onDismiss(toast.id)}>
            <svg viewBox="0 0 12 12" width="10" height="10" fill="none" stroke="currentColor" stroke-width="1.5">
              <path d="M2 2l8 8M10 2l-8 8" />
            </svg>
          </button>
        </div>
      ))}
    </div>
  )
}
