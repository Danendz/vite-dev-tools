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
 * Check if a value is a Vue component definition (imported SFC in <script setup>).
 * These have __name/__file/__hmrId set by @vitejs/plugin-vue.
 */
function isComponentDefinition(value: any): boolean {
  if (value === null || typeof value !== 'object') return false
  // SFC components have __name + (__file or __hmrId or render function)
  if (value.__name && (value.__file || value.__hmrId || typeof value.setup === 'function' || typeof value.render === 'function')) return true
  // Functional components are just functions with __name
  if (typeof value === 'function' && value.__name) return true
  return false
}

/**
 * JSON.stringify replacer that handles Vue internal proxies.
 * Prevents "Avoid enumerating keys on a component instance" warnings
 * by catching component proxies (__v_skip) and unwrapping reactive proxies (__v_raw)
 * before JSON.stringify enumerates their keys.
 */
export function vueReplacer(_key: string, val: unknown): unknown {
  if (val !== null && typeof val === 'object') {
    if ((val as any).__v_skip === true) return '[ComponentInstance]'
    const raw = (val as any).__v_raw
    if (raw) return raw
  }
  if (typeof val === 'function') return undefined
  return val
}

/**
 * Serialize a value for safe display.
 */
function serializeValue(value: unknown): unknown {
  if (typeof value === 'function') return 'fn()'
  if (value === null || value === undefined) return value
  if (typeof value !== 'object') return value
  if ((value as any).__v_skip === true) return '[ComponentInstance]'
  try {
    return JSON.parse(JSON.stringify(value, vueReplacer))
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

      // Skip imported Vue component definitions (SFC imports in <script setup>)
      if (isComponentDefinition(rawValue)) continue

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

  // Look up composable metadata early — used by watchers, provides, and setup enrichment
  const meta = findComponentMeta(instance)

  // Provide
  if (instance.provides && typeof instance.provides === 'object') {
    const provideItems: InspectorItem[] = []
    // Only show provides that this component actually declared (not inherited)
    const parentProvides = instance.parent?.provides
    // Build provide line lookup from metadata
    const provideMeta: Array<{ key?: string; line: number }> = meta?.pv || []
    let provideIndex = 0

    for (const key of Reflect.ownKeys(instance.provides)) {
      // Skip inherited provides
      if (parentProvides && instance.provides[key] === parentProvides[key]) continue
      const displayKey = typeof key === 'symbol' ? key.description ?? 'Symbol()' : String(key)

      // Match by key (string keys) or by index order (symbol keys)
      let lineNumber: number | undefined
      const keyMatch = provideMeta.find(p => p.key === displayKey)
      if (keyMatch) {
        lineNumber = keyMatch.line
      } else if (provideIndex < provideMeta.length) {
        // Fallback: index-based match for symbol/variable keys
        const entry = provideMeta[provideIndex]
        if (!entry.key) lineNumber = entry.line
      }
      provideIndex++

      const item: InspectorItem = {
        key: displayKey,
        value: serializeValue(instance.provides[key]),
        editable: false,
        persistable: false,
      }
      if (lineNumber != null) item.lineNumber = lineNumber
      provideItems.push(item)
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
  const watcherItems = extractWatchers(instance, meta)
  if (watcherItems.length > 0) {
    sections.push({ id: 'watchers', label: 'Watchers', items: watcherItems })
  }

  // Wire line numbers and group setup items under composables if metadata available
  enrichSetupWithMetadata(sections, instance, meta)

  return sections
}

/**
 * Walk a Vue 3.4+ ReactiveEffect's deps linked list and extract property key names.
 * Returns deduplicated key names that this effect depends on.
 */
function extractWatcherDeps(effect: any): string[] {
  const keys = new Set<string>()
  let link = effect.deps
  while (link) {
    if (link.dep?.key != null) {
      keys.add(String(link.dep.key))
    }
    link = link.nextDep
  }
  return [...keys]
}

/**
 * Build a flat, sorted list of watcher call line numbers from metadata callLines.
 * Merges all watcher call types (watch, watchEffect, etc.) and sorts by line.
 */
function buildWatcherLineList(cl: Record<string, number[]>): number[] {
  const lines: number[] = []
  for (const [name, arr] of Object.entries(cl)) {
    if (name !== 'provide') lines.push(...arr)
  }
  return lines.sort((a, b) => a - b)
}

/**
 * Extract watchers from Vue 3's component scope effects.
 * In Vue 3.5+, effect.cb and effect.getter are closure variables inside doWatch(),
 * not properties on the effect. So we can't distinguish watch() from watchEffect().
 * We label all watcher effects as "watcher" and show their tracked dep keys.
 */
function extractWatchers(instance: any, meta: any): InspectorItem[] {
  const items: InspectorItem[] = []
  const scope = instance.scope
  if (!scope?.effects) return items

  // Build ordered watcher line numbers from metadata for index-based matching
  const watcherLines = meta?.cl ? buildWatcherLineList(meta.cl) : []

  let watcherIndex = 0
  for (const effect of scope.effects) {
    // Skip the component's own render effect (also has fn + scheduler)
    if (effect === instance.effect) continue
    if (typeof effect.fn === 'function' && typeof effect.scheduler === 'function') {
      const depNames = extractWatcherDeps(effect)

      // Show tracked dep keys if available, otherwise "[active]"
      const value = depNames.length > 0
        ? `tracking: ${depNames.join(', ')}`
        : '[active]'

      const item: InspectorItem = {
        key: `watcher #${watcherIndex}`,
        value,
        editable: false,
        persistable: false,
        badge: 'watcher',
        depNames: depNames.length > 0 ? depNames : undefined,
      }

      // Wire line number from metadata (index-based match)
      if (watcherIndex < watcherLines.length) {
        item.lineNumber = watcherLines[watcherIndex]
      }

      items.push(item)
      watcherIndex++
    }
  }

  return items
}

/**
 * Look up the __DEVTOOLS_COMPOSABLES__ metadata for a component instance.
 */
function findComponentMeta(instance: any): any | null {
  const filePath = instance.type?.__file
  if (!filePath) return null

  const composableMap = (globalThis as any).__DEVTOOLS_COMPOSABLES__
  if (!composableMap) return null

  for (const key of Object.keys(composableMap)) {
    if (filePath.endsWith(key) || key.endsWith(filePath.replace(/.*\//, ''))) {
      return composableMap[key]
    }
  }
  return null
}

/**
 * If __DEVTOOLS_COMPOSABLES__ metadata is available, wire line numbers to
 * setup items and re-group under their parent composable as nested InspectorItems.
 */
function enrichSetupWithMetadata(sections: InspectorSection[], instance: any, meta?: any): void {
  if (!meta) return

  const setupSection = sections.find(s => s.id === 'setup')
  const computedSection = sections.find(s => s.id === 'computed')

  // Build varLines lookup: variable name → line number
  // varLines includes ALL variables (ref, reactive, computed, plain const, etc.)
  const varLines: Record<string, number> = meta.varLines ?? {}
  // Merge locals for backward compat (older metadata without varLines)
  if (meta.locals) {
    for (const local of meta.locals) {
      if (local.n && local.l && !varLines[local.n]) varLines[local.n] = local.l
    }
  }

  // Wire line numbers to all setup and computed items
  if (setupSection) {
    for (const item of setupSection.items) {
      if (!item.lineNumber && varLines[item.key]) {
        item.lineNumber = varLines[item.key]
      }
    }
  }
  if (computedSection) {
    for (const item of computedSection.items) {
      if (!item.lineNumber && varLines[item.key]) {
        item.lineNumber = varLines[item.key]
      }
    }
  }

  // Group under composables if any exist
  if (!meta.composables?.length || !setupSection) return

  // Build inner hook metadata lookup per composable
  const composableGroups: Array<{
    name: string
    line: number
    sourceFile?: string
    depNames?: string[]
    innerNames: Set<string>
    innerMeta: any[]
    locals: any[]
  }> = []
  for (const comp of meta.composables) {
    const innerNames = new Set<string>()
    // Claim by inner hook variable names
    if (comp.i) {
      for (const inner of comp.i) {
        if (inner.n) innerNames.add(inner.n)
      }
    }
    // Also claim by destructured variable names from the call site
    if (comp.v) {
      for (const name of comp.v) {
        innerNames.add(name)
      }
    }
    composableGroups.push({
      name: comp.h,
      line: comp.l,
      sourceFile: comp.f || undefined,
      depNames: comp.d?.length ? comp.d : undefined,
      innerNames,
      innerMeta: comp.i || [],
      locals: comp.lc || [],
    })
  }

  // Build a map from inner variable name → its metadata for line numbers and deps
  const innerMetaMap = new Map<string, any>()
  for (const group of composableGroups) {
    for (const inner of group.innerMeta) {
      if (inner.n) innerMetaMap.set(inner.n, inner)
    }
  }

  // Read setup state for depValues resolution
  const rawSetup = getRawSetupState(instance)

  // Helper: enrich an item with composable metadata (line number, sourceFile)
  function enrichItem(item: InspectorItem, group: typeof composableGroups[0]): void {
    const innerInfo = innerMetaMap.get(item.key)
    if (innerInfo) {
      if (innerInfo.l) item.lineNumber = innerInfo.l
      if (innerInfo.d?.length) item.depNames = innerInfo.d
      if (group.sourceFile) item.sourceFile = group.sourceFile
    } else {
      const localInfo = group.locals.find((l: any) => l.n === item.key)
      if (localInfo?.l) item.lineNumber = localInfo.l
      if (group.sourceFile) item.sourceFile = group.sourceFile
    }
  }

  // Helper: build a composable group item for a section
  function buildGroupItem(group: typeof composableGroups[0], innerItems: InspectorItem[]): InspectorItem {
    let depValues: unknown[] | undefined
    if (group.depNames && rawSetup) {
      depValues = group.depNames.map(name => {
        const raw = rawSetup[name]
        if (raw === undefined) return undefined
        return serializeValue(isRef(raw) ? raw.value : raw)
      })
    }
    return {
      key: group.name,
      value: null,
      editable: false,
      persistable: false,
      badge: group.name,
      lineNumber: group.line,
      sourceFile: group.sourceFile,
      depNames: group.depNames,
      depValues,
      innerHooks: innerItems,
    }
  }

  // Group items per section: each section gets its own composable groups
  function groupSectionItems(section: InspectorSection): void {
    const claimed = new Set<string>()
    const groupItems: InspectorItem[] = []

    for (const group of composableGroups) {
      const innerItems: InspectorItem[] = []
      for (const item of section.items) {
        if (group.innerNames.has(item.key) && !claimed.has(item.key)) {
          enrichItem(item, group)
          innerItems.push(item)
          claimed.add(item.key)
        }
      }
      if (innerItems.length > 0) {
        groupItems.push(buildGroupItem(group, innerItems))
      }
    }

    if (groupItems.length > 0) {
      const unclaimed = section.items.filter(item => !claimed.has(item.key))
      section.items = [...groupItems, ...unclaimed]
    }
  }

  groupSectionItems(setupSection)
  if (computedSection) groupSectionItems(computedSection)
}
