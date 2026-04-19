import type { ConsoleEntry, NormalizedNode, CommitRecord, NormalizedNodeSnapshot, InspectorSection } from './types'
import { buildAncestorChain } from './error-attribution'

function formatSource(source: { fileName: string; lineNumber: number; columnNumber: number } | null | undefined): string {
  if (!source) return 'unknown'
  return `${source.fileName}:${source.lineNumber}:${source.columnNumber}`
}

function formatSections(sections: InspectorSection[]): string {
  const parts: string[] = []
  for (const section of sections) {
    if (section.items.length === 0) continue
    const items = section.items.map(item => {
      const badge = item.badge ? `[${item.badge}]` : ''
      const val = typeof item.value === 'function' ? 'fn()' : JSON.stringify(item.value)
      return `${item.key}${badge}: ${val}`
    }).join(', ')
    parts.push(`- ${section.label}: ${items}`)
  }
  return parts.join('\n')
}

function formatSnapshot(snapshot: NormalizedNodeSnapshot): string {
  const lines: string[] = []
  lines.push(`- Source: ${formatSource(snapshot.source)}`)

  // Props
  const propKeys = Object.keys(snapshot.props)
  if (propKeys.length > 0) {
    const propsStr = propKeys.map(k => {
      const v = snapshot.props[k]
      return `${k}: ${typeof v === 'function' ? 'fn()' : JSON.stringify(v)}`
    }).join(', ')
    lines.push(`- Props: { ${propsStr} }`)
  }

  // Sections (hooks/state/watchers)
  if (snapshot.sections.length > 0) {
    lines.push(formatSections(snapshot.sections))
  }

  // Locals
  if (snapshot.locals && snapshot.locals.length > 0) {
    lines.push(`- Locals: ${snapshot.locals.map(l => l.name).join(', ')}`)
  }

  // Dep warnings
  if (snapshot.depWarnings && snapshot.depWarnings.length > 0) {
    const warnings = snapshot.depWarnings
      .filter(w => w.kind !== 'memo-suggested')
      .map(w => `${w.hookName}[${w.hookIndex}]: ${w.kind}`)
    if (warnings.length > 0) {
      lines.push(`- Dep Warnings: ${warnings.join(', ')}`)
    }
  }

  return lines.join('\n')
}

function formatRenderHistory(history: CommitRecord[], componentName: string): string {
  const relevant = history
    .flatMap(c => c.components)
    .filter(c => c.name === componentName)
    .slice(-5) // last 5 renders

  if (relevant.length === 0) return ''

  const lines = relevant.map(c => {
    const parts: string[] = [c.cause]
    if (c.changedProps?.length) parts.push(`props: ${c.changedProps.join(', ')}`)
    if (c.changedHooks?.length) parts.push(`hooks: ${c.changedHooks.map(h => h.varName || `hook[${h.index}]`).join(', ')}`)
    if (c.changedContexts?.length) parts.push(`contexts: ${c.changedContexts.join(', ')}`)
    return `- ${parts.join(' | ')}`
  })

  return lines.join('\n')
}

export function formatEntryForCopy(
  entry: ConsoleEntry,
  tree?: NormalizedNode[],
  renderHistory?: CommitRecord[],
): string {
  // No attribution — use simple format
  if (!entry.ownedBy || !entry.snapshot) {
    const typeLabel = entry.type === 'error' ? 'Error' : 'Warning'
    let text = `--- Browser Console ${typeLabel} ---\n`
    text += entry.message + '\n'
    if (entry.stack) {
      text += '\n' + entry.stack + '\n'
    }
    text += `\nPage: ${window.location.href}\n`
    text += '---'
    return text
  }

  // Enriched format with component context
  const lines: string[] = []

  // Error section
  lines.push(`## Error`)
  lines.push(entry.message)

  // Stack section (user frames only)
  if (entry.frames && entry.frames.length > 0) {
    const userFrames = entry.frames.filter(f => !f.isLibrary)
    if (userFrames.length > 0) {
      lines.push('')
      lines.push(`## Stack`)
      for (const f of userFrames) {
        const fn = f.fn ? `at ${f.fn}` : 'at <anonymous>'
        lines.push(`  ${fn} (${f.file}:${f.line}:${f.col})`)
      }
    }
  }

  // Component section
  lines.push('')
  lines.push(`## Component: ${entry.ownedBy.name}`)
  lines.push(formatSnapshot(entry.snapshot))

  // Error boundary
  if (entry.caughtBy) {
    lines.push(`- Error Boundary: ${entry.caughtBy.componentName}`)
  }

  // Ancestors
  if (tree && tree.length > 0) {
    const ancestors = buildAncestorChain(entry.ownedBy.nodeId, tree)
    if (ancestors.length > 0) {
      lines.push('')
      lines.push(`## Ancestors`)
      lines.push(ancestors.map(a => `${a.name} (${formatSource(a.source)})`).join(' > '))
    }
  }

  // Render history (if recording active)
  if (renderHistory && renderHistory.length > 0) {
    const historyStr = formatRenderHistory(renderHistory, entry.ownedBy.name)
    if (historyStr) {
      lines.push('')
      lines.push(`## Recent Renders`)
      lines.push(historyStr)
    }
  }

  lines.push('')
  lines.push(`Page: ${window.location.href}`)

  return lines.join('\n')
}

export function formatAllEntriesForCopy(
  entries: ConsoleEntry[],
  tree?: NormalizedNode[],
  renderHistory?: CommitRecord[],
): string {
  return entries.map(e => formatEntryForCopy(e, tree, renderHistory)).join('\n\n')
}
