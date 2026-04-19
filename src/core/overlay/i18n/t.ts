import type { Locale, LocaleMessages } from './types'
import en from './locales/en'
import zh from './locales/zh'
import ru from './locales/ru'

const locales: Record<Locale, LocaleMessages> = { en, zh, ru }

/** Walk a dot-separated path on a nested object */
function resolve(obj: Record<string, unknown>, path: string): string | undefined {
  const parts = path.split('.')
  let current: unknown = obj
  for (const part of parts) {
    if (current == null || typeof current !== 'object') return undefined
    current = (current as Record<string, unknown>)[part]
  }
  return typeof current === 'string' ? current : undefined
}

/** Replace {placeholder} tokens in a template string */
function interpolate(template: string, params?: Record<string, string | number>): string {
  if (!params) return template
  return template.replace(/\{(\w+)\}/g, (_, key) => {
    return key in params ? String(params[key]) : `{${key}}`
  })
}

/**
 * Create a translation function bound to a locale.
 * Resolution chain: active locale → English fallback → raw key.
 */
export function createT(locale: Locale) {
  const messages = locales[locale]
  const fallback = locales.en

  return function t(key: string, params?: Record<string, string | number>): string {
    const value = resolve(messages as unknown as Record<string, unknown>, key)
      ?? resolve(fallback as unknown as Record<string, unknown>, key)
      ?? key
    return interpolate(value, params)
  }
}

/**
 * Pluralization helper.
 * EN: 2 forms [singular, plural]
 * ZH: 1 form  [universal]
 * RU: 3 forms [one, few, many]
 */
export function plural(locale: Locale, count: number, forms: string[]): string {
  if (locale === 'zh') {
    return forms[0]
  }
  if (locale === 'ru') {
    const n100 = Math.abs(count) % 100
    const n10 = n100 % 10
    if (n10 === 1 && n100 !== 11) return forms[0]
    if (n10 >= 2 && n10 <= 4 && (n100 < 12 || n100 > 14)) return forms[1]
    return forms[2]
  }
  // English (and fallback)
  return count === 1 ? forms[0] : forms[1]
}
