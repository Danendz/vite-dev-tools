/** Compute center coordinates of an element for event positioning */
function getCenter(el: HTMLElement): { clientX: number; clientY: number } {
  const rect = el.getBoundingClientRect()
  return {
    clientX: rect.left + rect.width / 2,
    clientY: rect.top + rect.height / 2,
  }
}

/** Map common key names to key codes */
function keyToCode(key: string): string {
  if (key.length === 1) {
    const upper = key.toUpperCase()
    if (upper >= 'A' && upper <= 'Z') return `Key${upper}`
    if (upper >= '0' && upper <= '9') return `Digit${upper}`
    return key
  }
  // Named keys map to themselves as codes
  const codeMap: Record<string, string> = {
    Enter: 'Enter',
    Escape: 'Escape',
    Tab: 'Tab',
    Backspace: 'Backspace',
    Delete: 'Delete',
    ArrowUp: 'ArrowUp',
    ArrowDown: 'ArrowDown',
    ArrowLeft: 'ArrowLeft',
    ArrowRight: 'ArrowRight',
    Space: 'Space',
    ' ': 'Space',
  }
  return codeMap[key] ?? key
}

/**
 * Dispatch a full click event sequence:
 * focus -> pointerdown -> mousedown -> pointerup -> mouseup -> click
 */
export function dispatchClick(el: HTMLElement): void {
  const { clientX, clientY } = getCenter(el)
  const shared = { bubbles: true, composed: true, clientX, clientY, button: 0 }

  if (typeof el.focus === 'function') el.focus()

  el.dispatchEvent(new PointerEvent('pointerdown', { ...shared, buttons: 1 }))
  el.dispatchEvent(new MouseEvent('mousedown', { ...shared, buttons: 1 }))
  el.dispatchEvent(new PointerEvent('pointerup', { ...shared, buttons: 0 }))
  el.dispatchEvent(new MouseEvent('mouseup', { ...shared, buttons: 0 }))
  el.dispatchEvent(new MouseEvent('click', { ...shared, buttons: 0 }))
}

/**
 * Type a value into an input/textarea element.
 * Uses nativeInputValueSetter to work with React controlled inputs and Vue v-model.
 */
export function dispatchType(el: HTMLElement, value: string, clear: boolean): void {
  if (typeof el.focus === 'function') el.focus()

  // Get the native value setter to bypass React's synthetic event system
  const nativeSetter =
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set ??
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set

  if (!nativeSetter) {
    // Fallback: set directly
    ;(el as HTMLInputElement).value = value
  } else {
    if (clear) {
      nativeSetter.call(el, '')
      el.dispatchEvent(new Event('input', { bubbles: true }))
    }
    nativeSetter.call(el, value)
  }

  el.dispatchEvent(new InputEvent('input', { bubbles: true, data: value, inputType: 'insertText' }))
  el.dispatchEvent(new Event('change', { bubbles: true }))
}

/**
 * Dispatch a keyboard event sequence: keydown -> keyup
 */
export function dispatchKeypress(el: HTMLElement, key: string): void {
  const shared = { key, code: keyToCode(key), bubbles: true, composed: true }

  if (typeof el.focus === 'function') el.focus()

  el.dispatchEvent(new KeyboardEvent('keydown', shared))
  el.dispatchEvent(new KeyboardEvent('keyup', shared))
}

/**
 * Select an option from a <select> element.
 * Sets value via native setter and dispatches input + change events.
 */
export function dispatchSelectOption(el: HTMLSelectElement, value: string): void {
  const nativeSetter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')?.set

  if (nativeSetter) {
    nativeSetter.call(el, value)
  } else {
    el.value = value
  }

  el.dispatchEvent(new Event('input', { bubbles: true }))
  el.dispatchEvent(new Event('change', { bubbles: true }))
}
