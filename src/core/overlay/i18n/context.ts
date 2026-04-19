import { createContext } from 'preact'
import { useContext } from 'preact/hooks'
import type { Locale } from './types'
import { createT, plural } from './t'

export interface I18nContextValue {
  locale: Locale
  t: (key: string, params?: Record<string, string | number>) => string
  plural: (count: number, forms: string[]) => string
}

export const I18nContext = createContext<I18nContextValue>({
  locale: 'en',
  t: (key) => key,
  plural: (_, forms) => forms[0],
})

export function useT(): I18nContextValue {
  return useContext(I18nContext)
}

export function createI18nValue(locale: Locale): I18nContextValue {
  return {
    locale,
    t: createT(locale),
    plural: (count, forms) => plural(locale, count, forms),
  }
}
