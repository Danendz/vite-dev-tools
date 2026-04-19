import { describe, it, expect } from 'vitest'
import { createT, plural } from '@/core/overlay/i18n/t'
import en from '@/core/overlay/i18n/locales/en'
import zh from '@/core/overlay/i18n/locales/zh'
import ru from '@/core/overlay/i18n/locales/ru'

// ── t() function ────────────────────────────────────────────────────────────

describe('createT', () => {
  it('resolves a nested key', () => {
    const t = createT('en')
    expect(t('settings.title')).toBe('Settings')
    expect(t('settings.general.hideLibrary.label')).toBe('Hide library components')
  })

  it('interpolates {placeholder} params', () => {
    const t = createT('en')
    expect(t('detail.recentRenders', { count: 7 })).toBe('Recent renders (7)')
    expect(t('renders.commitHeader', { index: 3 })).toBe('Commit #3')
    expect(t('renders.commitTooltip', { index: 5, count: 12 })).toBe('Commit 5: 12 rerenders')
  })

  it('falls back to English when key missing in active locale', () => {
    // Temporarily wipe a key from zh to test fallback
    const original = zh.tabs.inspect
    ;(zh.tabs as any).inspect = undefined
    try {
      const t = createT('zh')
      // Should fall back to English
      expect(t('tabs.inspect')).toBe('Inspect')
    } finally {
      ;(zh.tabs as any).inspect = original
    }
  })

  it('returns raw key as last resort', () => {
    const t = createT('en')
    expect(t('totally.nonexistent.key')).toBe('totally.nonexistent.key')
  })

  it('preserves unmatched placeholders', () => {
    const t = createT('en')
    // Pass only one of two expected params
    expect(t('renders.commitTooltip', { index: 1 })).toBe('Commit 1: {count} rerenders')
  })

  it('resolves Chinese locale', () => {
    const t = createT('zh')
    expect(t('settings.title')).toBe('设置')
    expect(t('tabs.inspect')).toBe('检查')
  })

  it('resolves Russian locale', () => {
    const t = createT('ru')
    expect(t('settings.title')).toBe('Настройки')
    expect(t('tabs.inspect')).toBe('Инспектор')
  })
})

// ── plural() ────────────────────────────────────────────────────────────────

describe('plural', () => {
  it('English: 2 forms', () => {
    expect(plural('en', 1, ['error', 'errors'])).toBe('error')
    expect(plural('en', 0, ['error', 'errors'])).toBe('errors')
    expect(plural('en', 5, ['error', 'errors'])).toBe('errors')
  })

  it('Chinese: 1 form', () => {
    expect(plural('zh', 1, ['个错误'])).toBe('个错误')
    expect(plural('zh', 5, ['个错误'])).toBe('个错误')
  })

  it('Russian: 3 forms', () => {
    const forms = ['ошибка', 'ошибки', 'ошибок']
    expect(plural('ru', 1, forms)).toBe('ошибка')     // 1 = one
    expect(plural('ru', 2, forms)).toBe('ошибки')      // 2 = few
    expect(plural('ru', 3, forms)).toBe('ошибки')      // 3 = few
    expect(plural('ru', 4, forms)).toBe('ошибки')      // 4 = few
    expect(plural('ru', 5, forms)).toBe('ошибок')      // 5 = many
    expect(plural('ru', 10, forms)).toBe('ошибок')     // 10 = many
    expect(plural('ru', 11, forms)).toBe('ошибок')     // 11 = special (many)
    expect(plural('ru', 12, forms)).toBe('ошибок')     // 12 = special (many)
    expect(plural('ru', 14, forms)).toBe('ошибок')     // 14 = special (many)
    expect(plural('ru', 21, forms)).toBe('ошибка')     // 21 = one
    expect(plural('ru', 22, forms)).toBe('ошибки')     // 22 = few
    expect(plural('ru', 25, forms)).toBe('ошибок')     // 25 = many
    expect(plural('ru', 111, forms)).toBe('ошибок')    // 111 = many (special)
    expect(plural('ru', 121, forms)).toBe('ошибка')    // 121 = one
  })
})

// ── Structural completeness ─────────────────────────────────────────────────

function collectPaths(obj: unknown, prefix = ''): string[] {
  if (typeof obj !== 'object' || obj === null) return []
  return Object.entries(obj).flatMap(([k, v]) =>
    typeof v === 'string'
      ? [`${prefix}${k}`]
      : collectPaths(v, `${prefix}${k}.`),
  )
}

describe('locale completeness', () => {
  const enPaths = collectPaths(en)

  it('English has translation keys', () => {
    expect(enPaths.length).toBeGreaterThan(100)
  })

  it('Chinese has all keys from English', () => {
    const zhPaths = new Set(collectPaths(zh))
    const missing = enPaths.filter((p) => !zhPaths.has(p))
    expect(missing).toEqual([])
  })

  it('Russian has all keys from English', () => {
    const ruPaths = new Set(collectPaths(ru))
    const missing = enPaths.filter((p) => !ruPaths.has(p))
    expect(missing).toEqual([])
  })

  it('no empty strings in Chinese locale', () => {
    const zhPaths = collectPaths(zh)
    for (const path of zhPaths) {
      const parts = path.split('.')
      let val: any = zh
      for (const part of parts) val = val[part]
      expect(val, `zh.${path} is empty`).not.toBe('')
    }
  })

  it('no empty strings in Russian locale', () => {
    const ruPaths = collectPaths(ru)
    for (const path of ruPaths) {
      const parts = path.split('.')
      let val: any = ru
      for (const part of parts) val = val[part]
      expect(val, `ru.${path} is empty`).not.toBe('')
    }
  })
})
