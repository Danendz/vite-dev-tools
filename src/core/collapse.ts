import type { CollapseOverrides } from './types'
import { STORAGE_KEYS } from '../shared/constants'

function loadOverrides(): CollapseOverrides {
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.COLLAPSE_OVERRIDES)
    if (raw) return JSON.parse(raw)
  } catch {}
  return { alwaysShow: [], alwaysHide: [] }
}

function saveOverrides(overrides: CollapseOverrides) {
  localStorage.setItem(STORAGE_KEYS.COLLAPSE_OVERRIDES, JSON.stringify(overrides))
}

let overrides = loadOverrides()

export function shouldCollapse(name: string, isFromNodeModules: boolean): boolean {
  // Explicit overrides take priority
  if (overrides.alwaysShow.includes(name)) return false
  if (overrides.alwaysHide.includes(name)) return true

  // Default: collapse node_modules components
  return isFromNodeModules
}

export function addAlwaysShow(name: string) {
  overrides.alwaysHide = overrides.alwaysHide.filter((n) => n !== name)
  if (!overrides.alwaysShow.includes(name)) {
    overrides.alwaysShow.push(name)
  }
  saveOverrides(overrides)
}

export function addAlwaysHide(name: string) {
  overrides.alwaysShow = overrides.alwaysShow.filter((n) => n !== name)
  if (!overrides.alwaysHide.includes(name)) {
    overrides.alwaysHide.push(name)
  }
  saveOverrides(overrides)
}

export function removeOverride(name: string) {
  overrides.alwaysShow = overrides.alwaysShow.filter((n) => n !== name)
  overrides.alwaysHide = overrides.alwaysHide.filter((n) => n !== name)
  saveOverrides(overrides)
}

export function getOverrides(): CollapseOverrides {
  return { ...overrides }
}
