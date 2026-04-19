import { h } from 'preact'
import { useEffect, useRef } from 'preact/hooks'
import type { DiffData } from '../communication'
import { useT } from './i18n'

interface PreviewModalProps {
  diff: DiffData
  onConfirm: () => void
  onCancel: () => void
}

export function PreviewModal({ diff, onConfirm, onCancel }: PreviewModalProps) {
  const { t } = useT()
  const modalRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') onCancel()
      else if (e.key === 'Enter') onConfirm()
    }
    document.addEventListener('keydown', handleKeyDown, true)
    return () => document.removeEventListener('keydown', handleKeyDown, true)
  }, [onConfirm, onCancel])

  return (
    <div class="preview-modal-backdrop" onClick={onCancel}>
      <div class="preview-modal" ref={modalRef} onClick={(e) => e.stopPropagation()}>
        <div class="preview-modal-header">
          <span class="preview-modal-filename">{diff.fileName}</span>
          <span class="preview-modal-line">{t('detail.previewLine', { line: diff.lineNumber })}</span>
        </div>
        <div class="preview-diff">
          {diff.contextBefore.map((line, i) => (
            <div key={`ctx-before-${i}`} class="preview-diff-context">{line || '\u00A0'}</div>
          ))}
          {diff.removedLines.map((line, i) => (
            <div key={`rem-${i}`} class="preview-diff-removed">- {line}</div>
          ))}
          {diff.addedLines.map((line, i) => (
            <div key={`add-${i}`} class="preview-diff-added">+ {line}</div>
          ))}
          {diff.contextAfter.map((line, i) => (
            <div key={`ctx-after-${i}`} class="preview-diff-context">{line || '\u00A0'}</div>
          ))}
        </div>
        <div class="preview-modal-actions">
          <button class="preview-modal-btn confirm" onClick={onConfirm}>{t('detail.apply')}</button>
          <button class="preview-modal-btn cancel" onClick={onCancel}>{t('detail.cancel')}</button>
        </div>
      </div>
    </div>
  )
}
