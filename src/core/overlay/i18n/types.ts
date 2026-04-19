export type Locale = 'en' | 'zh' | 'ru'

export const SUPPORTED_LOCALES: { id: Locale; label: string }[] = [
  { id: 'en', label: 'English' },
  { id: 'zh', label: '中文' },
  { id: 'ru', label: 'Русский' },
]

// Recursively widen string literal types to `string` while preserving structure
type Widen<T> = T extends string
  ? string
  : T extends Record<string, unknown>
    ? { [K in keyof T]: Widen<T[K]> }
    : T

// The English locale defines the canonical structure.
// Other locales must match the same nested key shape but can have any string values.
export type LocaleMessages = Widen<typeof import('./locales/en').default>
