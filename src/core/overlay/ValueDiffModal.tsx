import { h } from 'preact'
import { useEffect } from 'preact/hooks'
import { useT } from './i18n'

interface ValueDiffModalProps {
  label: string
  prev: string
  next: string
  onClose: () => void
}

export function ValueDiffModal({ label, prev, next, onClose }: ValueDiffModalProps) {
  const { t } = useT()
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', handleKeyDown, true)
    return () => document.removeEventListener('keydown', handleKeyDown, true)
  }, [onClose])

  return (
    <div class="vdm-backdrop" onClick={onClose}>
      <div class="vdm-modal" onClick={(e) => e.stopPropagation()}>
        <div class="vdm-header">
          <span class="vdm-label">{label}</span>
          <button class="vdm-close" onClick={onClose}>×</button>
        </div>
        <div class="vdm-content">
          <div class="vdm-pane vdm-prev">
            <div class="vdm-pane-title">{t('detail.previous')}</div>
            <pre class="vdm-code">{prev}</pre>
          </div>
          <div class="vdm-pane vdm-next">
            <div class="vdm-pane-title">{t('detail.next')}</div>
            <pre class="vdm-code">{next}</pre>
          </div>
        </div>
      </div>
    </div>
  )
}
