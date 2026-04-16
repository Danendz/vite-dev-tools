import { describe, it, expect } from 'vitest'
import { findNodeById } from '@/core/mcp/tree-utils'
import { createTree, createNormalizedNode } from '@helpers/factories'

describe('findNodeById', () => {
  it('finds a node at root level', () => {
    const tree = createTree()
    const node = findNodeById(tree, 'app')
    expect(node).not.toBeNull()
    expect(node!.name).toBe('App')
  })

  it('finds a deeply nested node', () => {
    const tree = createTree()
    const node = findNodeById(tree, 'logo')
    expect(node).not.toBeNull()
    expect(node!.name).toBe('Logo')
  })

  it('returns null for non-existent ID', () => {
    const tree = createTree()
    expect(findNodeById(tree, 'nonexistent')).toBeNull()
  })

  it('returns null for empty tree', () => {
    expect(findNodeById([], 'any')).toBeNull()
  })

  it('finds a second-level child', () => {
    const tree = createTree()
    const node = findNodeById(tree, 'header')
    expect(node).not.toBeNull()
    expect(node!.name).toBe('Header')
  })
})
