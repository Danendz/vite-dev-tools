import { h } from 'preact'
import { useState, useEffect, useRef } from 'preact/hooks'
import { useT } from './i18n'
import type { Locale } from './i18n'
import { SUPPORTED_LOCALES } from './i18n'

interface SettingsPopoverProps {
  hideLibrary: boolean
  hideProviders: boolean
  showElements: boolean
  showPreview: boolean
  editor: string
  fontSize: number
  supportedSettings?: string[]
  locale: Locale
  onLocaleChange: (locale: Locale) => void
  onHideLibraryToggle: () => void
  onHideProvidersToggle: () => void
  onShowElementsToggle: () => void
  onShowPreviewToggle: () => void
  onEditorChange: (editor: string) => void
  onFontSizeChange: (size: number) => void
  onClose: () => void
}

const FONT_SIZES = [9, 10, 11, 12, 13, 14]

const EDITOR_OPTIONS = [
  { label: 'Auto-detect', value: '' },
  { label: 'VS Code', value: 'code' },
  { label: 'Cursor', value: 'cursor' },
  { label: 'PhpStorm', value: 'phpstorm' },
  { label: 'WebStorm', value: 'webstorm' },
  { label: 'IntelliJ IDEA', value: 'idea' },
  { label: 'Sublime Text', value: 'subl' },
  { label: 'Zed', value: 'zed' },
  { label: 'Antigravity', value: 'antigravity' },
]

export function SettingsPopover({
  hideLibrary,
  hideProviders,
  showElements,
  showPreview,
  editor,
  fontSize,
  supportedSettings,
  locale,
  onLocaleChange,
  onHideLibraryToggle,
  onHideProvidersToggle,
  onShowElementsToggle,
  onShowPreviewToggle,
  onEditorChange,
  onFontSizeChange,
  onClose,
}: SettingsPopoverProps) {
  const { t } = useT()
  const showHideProviders = !supportedSettings || supportedSettings.includes('hideProviders')
  const isKnown = EDITOR_OPTIONS.some((o) => o.value === editor)
  const [customMode, setCustomMode] = useState(!isKnown)
  const [customValue, setCustomValue] = useState(isKnown ? '' : editor)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      // Use composedPath to pierce Shadow DOM boundaries
      const path = e.composedPath()
      if (ref.current && path.includes(ref.current)) return
      onClose()
    }
    const timer = setTimeout(() => {
      document.addEventListener('click', handleClick, true)
    }, 0)
    return () => {
      clearTimeout(timer)
      document.removeEventListener('click', handleClick, true)
    }
  }, [onClose])

  return (
    <div class="settings-popover" ref={ref}>
      <label class="settings-item" onClick={onHideLibraryToggle}>
        <span class={`settings-checkbox${hideLibrary ? ' checked' : ''}`}>
          {hideLibrary ? '\u2713' : ''}
        </span>
        <span>{t('settings.general.hideLibrary.label')}</span>
      </label>
      {showHideProviders && (
        <label class="settings-item" onClick={onHideProvidersToggle}>
          <span class={`settings-checkbox${hideProviders ? ' checked' : ''}`}>
            {hideProviders ? '\u2713' : ''}
          </span>
          <span>{t('settings.general.hideProviders.label')}</span>
        </label>
      )}
      <label class="settings-item" onClick={onShowElementsToggle}>
        <span class={`settings-checkbox${showElements ? ' checked' : ''}`}>
          {showElements ? '\u2713' : ''}
        </span>
        <span>{t('settings.general.showElements.label')}</span>
      </label>
      <label class="settings-item" onClick={onShowPreviewToggle}>
        <span class={`settings-checkbox${showPreview ? ' checked' : ''}`}>
          {showPreview ? '\u2713' : ''}
        </span>
        <span>{t('settings.general.previewBeforeSave.label')}</span>
      </label>
      <div class="settings-item settings-editor">
        <span>{t('settings.language')}</span>
        <select
          class="settings-select"
          value={locale}
          onChange={(e) => onLocaleChange((e.target as HTMLSelectElement).value as Locale)}
        >
          {SUPPORTED_LOCALES.map((l) => (
            <option key={l.id} value={l.id}>{l.label}</option>
          ))}
        </select>
      </div>
      <div class="settings-item settings-font-size">
        <span>{t('settings.appearance.fontSize.label')}</span>
        <div class="settings-font-btns">
          {FONT_SIZES.map((size) => (
            <button
              key={size}
              class={`settings-font-btn${fontSize === size ? ' active' : ''}`}
              onClick={() => onFontSizeChange(size)}
            >
              {size}
            </button>
          ))}
        </div>
      </div>
      <div class="settings-divider" />
      <div class="settings-item settings-editor">
        <span>{t('settings.general.editor.label')}</span>
        <select
          class="settings-select"
          value={customMode ? '__custom__' : editor}
          onChange={(e) => {
            const val = (e.target as HTMLSelectElement).value
            if (val === '__custom__') {
              setCustomMode(true)
              onEditorChange(customValue)
            } else {
              setCustomMode(false)
              setCustomValue('')
              onEditorChange(val)
            }
          }}
        >
          {EDITOR_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.value === '' ? t('settings.general.editor.autoDetect') : opt.label}
            </option>
          ))}
          <option value="__custom__">{t('settings.general.editor.custom')}</option>
        </select>
      </div>
      {customMode && (
        <div class="settings-item">
          <input
            class="settings-custom-input"
            type="text"
            placeholder={t('settings.general.editor.placeholder')}
            value={customValue}
            onInput={(e) => {
              const val = (e.target as HTMLInputElement).value
              setCustomValue(val)
              onEditorChange(val)
            }}
          />
        </div>
      )}
      <div class="settings-editor-hint">
        <a href="https://github.com/yyx990803/launch-editor#supported-editors" target="_blank" rel="noopener">
          {t('settings.general.editor.supportedEditors')} &#8594;
        </a>
      </div>
    </div>
  )
}
