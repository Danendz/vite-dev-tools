import type { ConsoleEntry } from './types'

export function formatEntryForCopy(entry: ConsoleEntry): string {
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

export function formatAllEntriesForCopy(entries: ConsoleEntry[]): string {
  return entries.map(formatEntryForCopy).join('\n\n')
}
