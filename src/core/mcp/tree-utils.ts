import type { NormalizedNode } from '../types'

export function findNodeById(nodes: NormalizedNode[], id: string): NormalizedNode | null {
  for (const node of nodes) {
    if (node.id === id) return node
    const found = findNodeById(node.children, id)
    if (found) return found
  }
  return null
}
