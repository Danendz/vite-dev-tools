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
  // Vue component instances trigger "Avoid enumerating keys" warning when serialized
  if ((value as any).__v_skip === true) return '[ComponentInstance]'
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

      // Reactive objects — editable at runtime, persistable via vue-reactive-path
      if (isReactive(rawValue)) {
        setupItems.push({
          key,
          value: serializeValue(rawValue),
          editable: true,
          persistable: true,
          editHint: { kind: 'vue-reactive-path', varName: key, propertyPath: [] },
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

  // Watchers (Vue 3 scope effects)
  const watcherItems = extractWatchers(instance)
  if (watcherItems.length > 0) {
    sections.push({ id: 'watchers', label: 'Watchers', items: watcherItems })
  }

  // Group setup items under composables if metadata available
  groupSetupUnderComposables(sections, instance)

  return sections
}

/**
 * Extract watchers from Vue 3's component scope effects.
 * Watcher effects have specific shapes: watch() has a `cb` property,
 * watchEffect has an effect function with no `cb`.
 */
function extractWatchers(instance: any): InspectorItem[] {
  const items: InspectorItem[] = []
  const scope = instance.scope
  if (!scope?.effects) return items

  let watcherIndex = 0
  for (const effect of scope.effects) {
    // watch() effects have a `cb` property (the callback function)
    if (typeof effect.fn === 'function' && typeof effect.scheduler === 'function') {
      const isWatch = typeof (effect as any).cb === 'function'
      const label = isWatch ? 'watch' : 'watchEffect'

      // Try to get current value for watch() sources
      let value: unknown = '[active]'
      if (isWatch && effect.getter) {
        try { value = effect.getter() } catch { value = '[error]' }
      }

      items.push({
        key: `${label} #${watcherIndex}`,
        value: serializeValue(value),
        editable: false,
        persistable: false,
        badge: label,
      })
      watcherIndex++
    }
  }

  return items
}

/**
 * If __DEVTOOLS_COMPOSABLES__ metadata is available, re-group setup items
 * under their parent composable as nested InspectorItems.
 */
function groupSetupUnderComposables(sections: InspectorSection[], instance: any): void {
  const filePath = instance.type?.__file
  if (!filePath) return

  // Try to find composable metadata by matching file path suffix
  const composableMap = (globalThis as any).__DEVTOOLS_COMPOSABLES__
  if (!composableMap) return

  let meta: any = null
  for (const key of Object.keys(composableMap)) {
    if (filePath.endsWith(key) || key.endsWith(filePath.replace(/.*\//, ''))) {
      meta = composableMap[key]
      break
    }
  }
  if (!meta?.composables?.length) return

  const setupSection = sections.find(s => s.id === 'setup')
  if (!setupSection) return

  // Build a set of inner hook varNames for each composable
  const composableGroups: Array<{ name: string; line: number; innerNames: Set<string>; innerMeta: any[] }> = []
  for (const comp of meta.composables) {
    const innerNames = new Set<string>()
    if (comp.i) {
      for (const inner of comp.i) {
        if (inner.n) innerNames.add(inner.n)
      }
    }
    composableGroups.push({ name: comp.h, line: comp.l, innerNames, innerMeta: comp.i || [] })
  }

  // Match setup items to composables
  const claimed = new Set<string>()
  const composableItems: InspectorItem[] = []

  for (const group of composableGroups) {
    const innerItems: InspectorItem[] = []
    for (const item of setupSection.items) {
      if (group.innerNames.has(item.key) && !claimed.has(item.key)) {
        innerItems.push(item)
        claimed.add(item.key)
      }
    }

    if (innerItems.length > 0) {
      composableItems.push({
        key: group.name,
        value: null,
        editable: false,
        persistable: false,
        badge: group.name,
        lineNumber: group.line,
        innerHooks: innerItems,
      })
    }
  }

  if (composableItems.length === 0) return

  // Replace setup section items: composable groups first, then unclaimed items
  const unclaimed = setupSection.items.filter(item => !claimed.has(item.key))
  setupSection.items = [...composableItems, ...unclaimed]
}
