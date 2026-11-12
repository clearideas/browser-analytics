// Consent categories.
//
// "simple" mode (the default) asks one question: accept all or reject non-essential. It is
// stored as the same choice for every category. "categories" mode lets visitors choose per
// category. Everything the library does belongs to a category:
//   necessary    the consent mechanism itself; functional services (e.g. chat by default)
//   preferences  remembering choices and settings (e.g. chat history when configured so)
//   statistics   full first-party analytics, stored attribution, analytics tags (GA4)
//   marketing    advertising tags and conversions (Google Ads, Microsoft UET, OpenAI Ads)

export const OPTIONAL_CATEGORIES = ['preferences', 'statistics', 'marketing'] as const
export type OptionalCategory = (typeof OPTIONAL_CATEGORIES)[number]
export type ConsentCategory = 'necessary' | OptionalCategory

/** A visitor's choices (true = allowed). */
export type CategoryChoices = Record<OptionalCategory, boolean>
/** Choices for the current policy; null = not decided. */
export type CategoryState = Record<OptionalCategory, boolean | null>

export const UNDECIDED: CategoryState = { preferences: null, statistics: null, marketing: null }

export function allCategories(value: boolean): CategoryChoices {
  return { preferences: value, statistics: value, marketing: value }
}

export function isOptionalCategory(value: unknown): value is OptionalCategory {
  return OPTIONAL_CATEGORIES.includes(value as OptionalCategory)
}

/** The record decision for a set of choices. */
export function decisionOf(choices: CategoryChoices): 'granted' | 'denied' | 'partial' {
  const values = OPTIONAL_CATEGORIES.map(category => choices[category])
  if (values.every(Boolean)) return 'granted'
  if (values.every(value => !value)) return 'denied'
  return 'partial'
}

/** Complete partial choices; categories not mentioned are not allowed. */
export function completeChoices(choices: Partial<CategoryChoices>): CategoryChoices {
  return {
    preferences: choices.preferences === true,
    statistics: choices.statistics === true,
    marketing: choices.marketing === true,
  }
}
