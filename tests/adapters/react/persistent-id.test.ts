import { describe, it, expect, beforeEach } from 'vitest'
import { getPersistentId, resetPersistentIdCounter } from '@/adapters/react/persistent-id'

describe('getPersistentId', () => {
  beforeEach(() => {
    resetPersistentIdCounter()
  })

  it('stamps a new fiber with the next available id', () => {
    const a: any = {}
    const b: any = {}
    expect(getPersistentId(a)).toBe(1)
    expect(getPersistentId(b)).toBe(2)
  })

  it('returns the same id on repeated calls for the same fiber', () => {
    const f: any = {}
    const id = getPersistentId(f)
    expect(getPersistentId(f)).toBe(id)
  })

  it('mirrors id to alternate in both directions', () => {
    const current: any = {}
    const alternate: any = {}
    current.alternate = alternate
    alternate.alternate = current
    const id = getPersistentId(current)
    // alternate now carries the same id without a second allocation
    expect(getPersistentId(alternate)).toBe(id)
  })

  it('inherits id from alternate when alternate already has one', () => {
    const alternate: any = {}
    const first = getPersistentId(alternate)
    const current: any = { alternate }
    alternate.alternate = current
    expect(getPersistentId(current)).toBe(first)
  })

  it('allocates fresh ids for unrelated fibers even when one has an id', () => {
    const a: any = {}
    const b: any = {}
    const idA = getPersistentId(a)
    const idB = getPersistentId(b)
    expect(idB).not.toBe(idA)
  })
})
