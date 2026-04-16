// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { waitForSettle } from '@/core/mcp/interaction/settle'

describe('waitForSettle', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('settles after quiet period with no mutations', async () => {
    const promise = waitForSettle()
    // Advance past the 100ms quiet period
    await vi.advanceTimersByTimeAsync(150)
    const result = await promise
    expect(result.settled).toBe(true)
  })

  it('hard cap at 2000ms returns unsettled', async () => {
    const promise = waitForSettle()

    // Keep triggering mutations to prevent quiet settling
    for (let i = 0; i < 25; i++) {
      const el = document.createElement('div')
      document.body.appendChild(el)
      await vi.advanceTimersByTimeAsync(90)
    }

    // Advance past max wait
    await vi.advanceTimersByTimeAsync(500)
    const result = await promise
    expect(result.settled).toBe(false)
  })
})
