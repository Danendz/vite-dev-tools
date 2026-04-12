import { h } from 'preact'
import { useEffect, useRef } from 'preact/hooks'

interface SettingsPopoverProps {
  hideLibrary: boolean
  fontSize: number
  onHideLibraryToggle: () => void
  onFontSizeChange: (size: number) => void
  onClose: () => void
}

const FONT_SIZES = [9, 10, 11, 12, 13, 14]

export function SettingsPopover({
  hideLibrary,
  fontSize,
  onHideLibraryToggle,
  onFontSizeChange,
  onClose,
}: SettingsPopoverProps) {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        onClose()
      }
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
        <span>Hide library components</span>
      </label>
      <div class="settings-item settings-font-size">
        <span>Font size</span>
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
    </div>
  )
}
