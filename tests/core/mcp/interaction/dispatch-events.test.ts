// @vitest-environment happy-dom
import { describe, it, expect, vi } from 'vitest'
import { dispatchClick, dispatchType, dispatchKeypress, dispatchSelectOption } from '@/core/mcp/interaction/dispatch-events'

describe('dispatchClick', () => {
  it('calls focus on the element', () => {
    const el = document.createElement('button')
    const focusSpy = vi.spyOn(el, 'focus')
    dispatchClick(el)
    expect(focusSpy).toHaveBeenCalled()
  })

  it('dispatches events in correct order', () => {
    const el = document.createElement('button')
    const events: string[] = []
    for (const name of ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click']) {
      el.addEventListener(name, () => events.push(name))
    }
    dispatchClick(el)
    expect(events).toEqual(['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click'])
  })

  it('events have correct button and bubbles properties', () => {
    const el = document.createElement('button')
    let captured: MouseEvent | null = null
    el.addEventListener('click', (e) => { captured = e as MouseEvent })
    dispatchClick(el)
    expect(captured).not.toBeNull()
    expect(captured!.bubbles).toBe(true)
    expect(captured!.button).toBe(0)
  })
})

describe('dispatchType', () => {
  it('sets value on input element and dispatches input + change events', () => {
    const el = document.createElement('input')
    const events: string[] = []
    el.addEventListener('input', () => events.push('input'))
    el.addEventListener('change', () => events.push('change'))

    dispatchType(el, 'hello', false)
    expect(el.value).toBe('hello')
    expect(events).toContain('input')
    expect(events).toContain('change')
  })

  it('with clear=true dispatches an extra input event first', () => {
    const el = document.createElement('input')
    el.value = 'old'
    const events: string[] = []
    el.addEventListener('input', () => events.push('input'))

    dispatchType(el, 'new', true)
    // Two input events: one for clear, one for new value
    expect(events.filter(e => e === 'input').length).toBe(2)
  })

  it('dispatches InputEvent with correct inputType and data', () => {
    const el = document.createElement('input')
    let captured: InputEvent | null = null
    el.addEventListener('input', (e) => { captured = e as InputEvent })
    dispatchType(el, 'hello', false)
    expect(captured).not.toBeNull()
    expect(captured!.data).toBe('hello')
    expect(captured!.inputType).toBe('insertText')
  })
})

describe('dispatchKeypress', () => {
  it('dispatches keydown then keyup', () => {
    const el = document.createElement('input')
    const events: string[] = []
    el.addEventListener('keydown', () => events.push('keydown'))
    el.addEventListener('keyup', () => events.push('keyup'))

    dispatchKeypress(el, 'Enter')
    expect(events).toEqual(['keydown', 'keyup'])
  })

  it('maps single character to correct code', () => {
    const el = document.createElement('input')
    let captured: KeyboardEvent | null = null
    el.addEventListener('keydown', (e) => { captured = e as KeyboardEvent })

    dispatchKeypress(el, 'a')
    expect(captured!.key).toBe('a')
    expect(captured!.code).toBe('KeyA')
  })

  it('maps named key Enter correctly', () => {
    const el = document.createElement('input')
    let captured: KeyboardEvent | null = null
    el.addEventListener('keydown', (e) => { captured = e as KeyboardEvent })

    dispatchKeypress(el, 'Enter')
    expect(captured!.key).toBe('Enter')
    expect(captured!.code).toBe('Enter')
  })

  it('calls focus before dispatching', () => {
    const el = document.createElement('input')
    const focusSpy = vi.spyOn(el, 'focus')
    dispatchKeypress(el, 'a')
    expect(focusSpy).toHaveBeenCalled()
  })
})

describe('dispatchSelectOption', () => {
  it('sets select value and dispatches input + change events', () => {
    const el = document.createElement('select')
    const option = document.createElement('option')
    option.value = 'opt1'
    el.appendChild(option)

    const events: string[] = []
    el.addEventListener('input', () => events.push('input'))
    el.addEventListener('change', () => events.push('change'))

    dispatchSelectOption(el, 'opt1')
    expect(el.value).toBe('opt1')
    expect(events).toContain('input')
    expect(events).toContain('change')
  })
})
