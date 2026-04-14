/** Single-level in-memory undo store for source file writes. Cleared on server restart. */
export const undoStore = new Map<string, { previousContent: string; timestamp: number }>()
