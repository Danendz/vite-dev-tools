/**
 * Stable cross-commit identity for fibers.
 *
 * Backed by a WeakMap so we never mutate fiber objects (some fibers are
 * frozen / non-extensible in newer React/DevTools configurations).
 *
 * React swaps the current ↔ alternate fibers across commits, so we mirror
 * the id between both whenever we allocate one, keeping the id stable for
 * the fiber's lifetime. Unmount lets both fiber + alternate be garbage-
 * collected and the WeakMap entries drop out; a later remount gets a fresh
 * id — no fuzzy matching.
 *
 * Mirrors React DevTools' own strategy.
 */
const ids = new WeakMap<object, number>()

let nextId = 1

export function getPersistentId(fiber: any): number {
  if (!fiber || typeof fiber !== 'object') return 0

  const own = ids.get(fiber)
  if (typeof own === 'number') return own

  const alternate = fiber.alternate
  const fromAlt = alternate ? ids.get(alternate) : undefined
  if (typeof fromAlt === 'number') {
    ids.set(fiber, fromAlt)
    return fromAlt
  }

  const id = nextId++
  ids.set(fiber, id)
  if (alternate && typeof alternate === 'object') ids.set(alternate, id)
  return id
}

/**
 * Check if we've previously assigned a persistent ID to this fiber
 * (without allocating a new one). Used to distinguish true mounts from
 * React 19's alternate-detach behaviour where fiber.alternate is null
 * even though the component was previously mounted.
 */
export function isKnownFiber(fiber: any): boolean {
  if (!fiber || typeof fiber !== 'object') return false
  if (ids.has(fiber)) return true
  const alternate = fiber.alternate
  return !!(alternate && ids.has(alternate))
}

/** Test-only: reset the module-level counter for deterministic tests. */
export function resetPersistentIdCounter(): void {
  nextId = 1
}
