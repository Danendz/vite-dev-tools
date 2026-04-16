// @vitest-environment happy-dom
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { createNormalizedNode } from '@helpers/factories'

// Mock state-store before importing the module under test
vi.mock('@/core/overlay/state-store', () => ({
  devtoolsState: {
    tree: [],
  },
}))

import { startErrorCapture, buildActionResponse } from '@/core/mcp/interaction/action-response'
import { devtoolsState } from '@/core/overlay/state-store'

describe('startErrorCapture', () => {
  it('captures console.error calls', () => {
    const stop = startErrorCapture()
    console.error('test error')
    const entries = stop()
    expect(entries.length).toBe(1)
    expect(entries[0].type).toBe('error')
    expect(entries[0].message).toContain('test error')
  })

  it('captures console.warn calls', () => {
    const stop = startErrorCapture()
    console.warn('test warning')
    const entries = stop()
    expect(entries.length).toBe(1)
    expect(entries[0].type).toBe('warning')
    expect(entries[0].message).toContain('test warning')
  })

  it('restores original console methods on stop', () => {
    const origError = console.error
    const origWarn = console.warn
    const stop = startErrorCapture()
    expect(console.error).not.toBe(origError)
    expect(console.warn).not.toBe(origWarn)
    stop()
    expect(console.error).toBe(origError)
    expect(console.warn).toBe(origWarn)
  })

  it('still calls original console methods', () => {
    const origError = vi.fn()
    console.error = origError
    const stop = startErrorCapture()
    console.error('forwarded')
    stop()
    expect(origError).toHaveBeenCalledWith('forwarded')
  })
})

describe('buildActionResponse', () => {
  beforeEach(() => {
    devtoolsState.tree = []
  })

  it('returns basic response without component state when no nodeId', () => {
    const response = buildActionResponse({
      success: true,
      settled: true,
      matchCount: 1,
      errors: [],
    })
    expect(response.success).toBe(true)
    expect(response.componentState).toBeUndefined()
  })

  it('includes component state when nodeId matches', () => {
    devtoolsState.tree = [
      createNormalizedNode({
        id: 'comp1',
        name: 'MyComp',
        props: { title: 'hi' },
      }),
    ]

    const response = buildActionResponse({
      success: true,
      settled: true,
      matchCount: 1,
      errors: [],
      nodeId: 'comp1',
    })
    expect(response.componentState).toBeDefined()
    expect(response.componentState!.name).toBe('MyComp')
    expect(response.componentState!.props.title).toBe('hi')
  })

  it('returns response without component state when nodeId does not match', () => {
    devtoolsState.tree = []
    const response = buildActionResponse({
      success: true,
      settled: true,
      matchCount: 0,
      errors: [],
      nodeId: 'nonexistent',
    })
    expect(response.componentState).toBeUndefined()
  })
})
