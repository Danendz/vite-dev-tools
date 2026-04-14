import type { InspectorSection, InspectorItem } from '../../core/types'

/**
 * Check if a value is a Vue Ref.
 */
function isRef(value: any): boolean {
  return value !== null && typeof value === 'object' && value.__v_isRef === true
}

/**
 * Check if a value is a Vue Reactive object.
 */
function isReactive(value: any): boolean {
  return value !== null && typeof value === 'object' && value.__v_isReactive === true
}

/**
 * Check if a value is a computed ref (ref with effect/getter).
 */
function isComputed(value: any): boolean {
  return isRef(value) && (value.effect !== undefined || value.__v_isReadonly === true)
}

/**
 * Serialize a value for safe display.
 */
function serializeValue(value: unknown): unknown {
  if (typeof value === 'function') return 'fn()'
  if (value === null || value === undefined) return value
  if (typeof value !== 'object') return value
  try {
    return JSON.parse(JSON.stringify(value))
  } catch {
    return '[Object]'
  }
}

/**
 * Get the raw (unwrapped) setupState to inspect ref/reactive/computed types.
 */
function getRawSetupState(instance: any): Record<string, any> | null {
  const setupState = instance.setupState
  if (!setupState) return null
  // __v_raw gives us the underlying object before proxyRefs wrapping
  return setupState.__v_raw ?? setupState
}

/**
 * Extract inspector sections from a Vue component instance.
 */
export function extractSections(instance: any): InspectorSection[] {
  const sections: InspectorSection[] = []

  // Setup state (Composition API / <script setup>)
  const rawSetup = getRawSetupState(instance)
  if (rawSetup) {
    const setupItems: InspectorItem[] = []
    const computedItems: InspectorItem[] = []

    for (const key of Object.keys(rawSetup)) {
      // Skip internal Vue properties
      if (key.startsWith('__') || key.startsWith('$')) continue

      const rawValue = rawSetup[key]

      // Computed values — read-only, not editable
      if (isComputed(rawValue)) {
        computedItems.push({
          key,
          value: serializeValue(instance.setupState[key]),
          editable: false,
          persistable: false,
          badge: 'computed',
        })
        continue
      }

      // Ref values — editable and persistable
      if (isRef(rawValue)) {
        setupItems.push({
          key,
          value: serializeValue(rawValue.value),
          editable: true,
          persistable: true,
          editHint: { kind: 'vue-path', path: [key], stateType: 'setup' },
          badge: 'ref',
        })
        continue
      }

      // Reactive objects — editable but not persistable (complex)
      if (isReactive(rawValue)) {
        setupItems.push({
          key,
          value: serializeValue(rawValue),
          editable: false,
          persistable: false,
          badge: 'reactive',
        })
        continue
      }

      // Functions
      if (typeof rawValue === 'function') {
        setupItems.push({
          key,
          value: 'fn()',
          editable: false,
          persistable: false,
        })
        continue
      }

      // Plain values
      setupItems.push({
        key,
        value: serializeValue(rawValue),
        editable: false,
        persistable: false,
      })
    }

    if (setupItems.length > 0) {
      sections.push({ id: 'setup', label: 'Setup', items: setupItems })
    }
    if (computedItems.length > 0) {
      sections.push({ id: 'computed', label: 'Computed', items: computedItems })
    }
  }

  // Options API data
  if (instance.data && typeof instance.data === 'object') {
    const dataItems: InspectorItem[] = []
    for (const key of Object.keys(instance.data)) {
      if (key.startsWith('__') || key.startsWith('$')) continue
      dataItems.push({
        key,
        value: serializeValue(instance.data[key]),
        editable: true,
        persistable: false,
        editHint: { kind: 'vue-path', path: [key], stateType: 'data' },
      })
    }
    if (dataItems.length > 0) {
      sections.push({ id: 'data', label: 'Data', items: dataItems })
    }
  }

  // Provide
  if (instance.provides && typeof instance.provides === 'object') {
    const provideItems: InspectorItem[] = []
    // Only show provides that this component actually declared (not inherited)
    const parentProvides = instance.parent?.provides
    for (const key of Reflect.ownKeys(instance.provides)) {
      // Skip inherited provides
      if (parentProvides && instance.provides[key] === parentProvides[key]) continue
      provideItems.push({
        key: typeof key === 'symbol' ? key.description ?? 'Symbol()' : String(key),
        value: serializeValue(instance.provides[key]),
        editable: false,
        persistable: false,
      })
    }
    if (provideItems.length > 0) {
      sections.push({ id: 'provide', label: 'Provide', items: provideItems })
    }
  }

  // Inject
  const injectKeys = instance.type?.inject
  if (injectKeys) {
    const injectItems: InspectorItem[] = []
    const keys = Array.isArray(injectKeys)
      ? injectKeys
      : Object.keys(injectKeys)

    for (const key of keys) {
      const stringKey = String(key)
      // Read the injected value via the proxy
      const value = instance.proxy?.[stringKey]
      if (value !== undefined) {
        injectItems.push({
          key: stringKey,
          value: serializeValue(value),
          editable: false,
          persistable: false,
        })
      }
    }
    if (injectItems.length > 0) {
      sections.push({ id: 'inject', label: 'Inject', items: injectItems })
    }
  }

  return sections
}
