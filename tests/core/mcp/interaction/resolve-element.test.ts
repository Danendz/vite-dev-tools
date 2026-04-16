// @vitest-environment happy-dom
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { createNormalizedNode } from '@helpers/factories'

// Mock state-store before importing the module under test
vi.mock('@/core/overlay/state-store', () => ({
  devtoolsState: {
    tree: [],
  },
}))

import { resolveElements } from '@/core/mcp/interaction/resolve-element'
import { devtoolsState } from '@/core/overlay/state-store'

describe('resolveElements', () => {
  beforeEach(() => {
    document.body.innerHTML = ''
    devtoolsState.tree = []
  })

  it('returns error when no params provided', () => {
    const result = resolveElements({})
    expect(result.error).toBeDefined()
    expect(result.elements).toEqual([])
  })

  it('returns error when nodeId not found in tree', () => {
    devtoolsState.tree = []
    const result = resolveElements({ nodeId: 'nonexistent' })
    expect(result.error).toContain('Component not found')
  })

  it('returns component root DOM elements when only nodeId given', () => {
    const el = document.createElement('div')
    el.id = 'comp-root'
    document.body.appendChild(el)

    devtoolsState.tree = [
      createNormalizedNode({
        id: 'comp1',
        name: 'MyComp',
        _domElements: [el],
      }),
    ]

    const result = resolveElements({ nodeId: 'comp1' })
    expect(result.elements.length).toBe(1)
    expect(result.elements[0].id).toBe('comp-root')
  })

  it('returns error when component has no DOM elements', () => {
    devtoolsState.tree = [
      createNormalizedNode({ id: 'comp1', _domElements: [] }),
    ]
    const result = resolveElements({ nodeId: 'comp1' })
    expect(result.error).toContain('no DOM elements')
  })

  it('queries by CSS selector within document', () => {
    const el = document.createElement('button')
    el.className = 'submit-btn'
    document.body.appendChild(el)

    const result = resolveElements({ selector: '.submit-btn' })
    expect(result.elements.length).toBe(1)
    expect(result.matchCount).toBe(1)
  })

  it('queries by CSS selector scoped to component subtree', () => {
    // Component element
    const compEl = document.createElement('div')
    const innerBtn = document.createElement('button')
    innerBtn.className = 'btn'
    compEl.appendChild(innerBtn)
    document.body.appendChild(compEl)

    // Outside element with same class
    const outsideBtn = document.createElement('button')
    outsideBtn.className = 'btn'
    document.body.appendChild(outsideBtn)

    devtoolsState.tree = [
      createNormalizedNode({
        id: 'comp1',
        _domElements: [compEl],
      }),
    ]

    const result = resolveElements({ nodeId: 'comp1', selector: '.btn' })
    // Should only find the button inside the component
    expect(result.elements.length).toBe(1)
    expect(result.elements[0]).toBe(innerBtn)
  })

  it('finds by text content', () => {
    const el = document.createElement('span')
    el.textContent = 'Click me'
    document.body.appendChild(el)

    const result = resolveElements({ text: 'Click me' })
    expect(result.elements.length).toBe(1)
  })

  it('excludes elements inside #danendz-devtools', () => {
    const devtools = document.createElement('div')
    devtools.id = 'danendz-devtools'
    const btn = document.createElement('button')
    btn.className = 'hidden-btn'
    devtools.appendChild(btn)
    document.body.appendChild(devtools)

    const result = resolveElements({ selector: '.hidden-btn' })
    expect(result.elements.length).toBe(0)
  })
})
