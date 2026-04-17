/**
 * Vue render history — reuses the same RenderHistory interface and CommitRecord format
 * as the React adapter for UI compatibility.
 */
export { createRenderHistory, getRenderHistory } from '../react/render-history'
export type { RenderHistory, RenderHistoryOptions } from '../react/render-history'
