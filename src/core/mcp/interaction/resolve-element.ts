import type { NormalizedNode } from '../../types'
import { findNodeById } from '../tree-utils'
import { devtoolsState } from '../../overlay/state-store'

export interface ResolveParams {
  nodeId?: string
  selector?: string
  text?: string
}

export interface ResolveResult {
  elements: HTMLElement[]
  matchCount: number
  error?: string
}

/** Collect all DOM elements from a node and its descendants */
function collectDomElements(node: NormalizedNode): HTMLElement[] {
  const elements: HTMLElement[] = []
  if (node._domElements) {
    elements.push(...node._domElements)
  }
  for (const child of node.children) {
    elements.push(...collectDomElements(child))
  }
  return elements
}

/** Check if an element is inside the devtools overlay */
function isDevtoolsElement(el: Element): boolean {
  return !!el.closest('#danendz-devtools')
}

/** Find elements by visible text content within a root, preferring leaf elements */
function findByText(root: Element | Document, text: string): HTMLElement[] {
  const matches: HTMLElement[] = []
  const walker = document.createTreeWalker(
    root,
    NodeFilter.SHOW_ELEMENT,
    {
      acceptNode(node) {
        if (isDevtoolsElement(node as Element)) return NodeFilter.FILTER_REJECT
        return NodeFilter.FILTER_ACCEPT
      },
    },
  )

  let current = walker.nextNode() as HTMLElement | null
  while (current) {
    const trimmed = current.textContent?.trim()
    if (trimmed === text) {
      // Prefer leaf elements — only add if no child also matches
      const hasMatchingChild = Array.from(current.children).some(
        child => child.textContent?.trim() === text,
      )
      if (!hasMatchingChild) {
        matches.push(current)
      }
    }
    current = walker.nextNode() as HTMLElement | null
  }

  return matches
}

/**
 * Resolve targeting params to DOM elements.
 * At least one of nodeId, selector, or text must be provided.
 */
export function resolveElements(params: ResolveParams): ResolveResult {
  const { nodeId, selector, text } = params

  if (!nodeId && !selector && !text) {
    return { elements: [], matchCount: 0, error: 'At least one of nodeId, selector, or text must be provided' }
  }

  // Determine the scope (component DOM subtree or document)
  let scopeElements: HTMLElement[] | null = null

  if (nodeId) {
    const node = findNodeById(devtoolsState.tree, nodeId)
    if (!node) {
      return { elements: [], matchCount: 0, error: `Component not found: ${nodeId}` }
    }
    scopeElements = collectDomElements(node)
    if (scopeElements.length === 0) {
      return { elements: [], matchCount: 0, error: `Component has no DOM elements: ${nodeId}` }
    }
  }

  // If only nodeId (no selector or text), return the component's root DOM elements
  if (nodeId && !selector && !text) {
    const node = findNodeById(devtoolsState.tree, nodeId)!
    const rootElements = (node._domElements ?? []).filter(el => !isDevtoolsElement(el))
    return { elements: rootElements, matchCount: rootElements.length }
  }

  // Apply selector within scope
  if (selector) {
    const results: HTMLElement[] = []
    if (scopeElements) {
      for (const scopeEl of scopeElements) {
        // Check the scope element itself
        if (scopeEl.matches(selector)) results.push(scopeEl)
        // Query within it
        scopeEl.querySelectorAll<HTMLElement>(selector).forEach(el => {
          if (!isDevtoolsElement(el)) results.push(el)
        })
      }
    } else {
      document.querySelectorAll<HTMLElement>(selector).forEach(el => {
        if (!isDevtoolsElement(el)) results.push(el)
      })
    }
    return { elements: results, matchCount: results.length }
  }

  // Apply text matching within scope
  if (text) {
    const root = scopeElements
      ? (() => {
          // Search within each scope element
          const all: HTMLElement[] = []
          for (const el of scopeElements!) all.push(...findByText(el, text))
          return all
        })()
      : findByText(document, text)
    return { elements: root, matchCount: root.length }
  }

  return { elements: [], matchCount: 0 }
}
