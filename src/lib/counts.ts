/** The yarn recipe of a count, as on the monday.com Counts board.
 *
 *  A count is Yarn 1 with its percentage and, while Yarn 1 is below 100%, a
 *  Yarn 2 for the remaining percentage. Entering 45 for Yarn 1 opens Yarn 2 at
 *  55; entering 100 closes it. These functions hold that logic (and the name
 *  formula) so the form, the CSV import and the tests all use the same rules.
 *  The database trigger `count_master_set_display` builds the same name and key,
 *  and is the authority. */

export const YARNS = ['COTTON', 'POLYESTER', 'VISCOSE', 'LINEN', 'HEMP', 'LYCRA'] as const

/** What the form holds (text fields stay strings while someone is typing). */
export interface CountRecipe {
  count_no: string
  machine: string
  yarn_1: string
  yarn_1_pct: string
  yarn_2: string
  ply: string
  process: string
  certification: string
  yarn_type: string
}

export interface RecipeState {
  /** Yarn 1 % as a number, or null while it is blank or not a valid percentage. */
  pct1: number | null
  /** Yarn 2 may be chosen (Yarn 1 % is entered and below 100). */
  yarn2Enabled: boolean
  /** Why Yarn 2 is closed, shown beside it; null when it is open. */
  yarn2Reason: string | null
  /** The remaining percentage, 100 minus Yarn 1 %; null when Yarn 2 is closed. */
  remainder: number | null
  /** Yarn 2 % to save: the remainder once a Yarn 2 is chosen, else null. */
  pct2: number | null
  /** monday's "Overall Yarn Composition": the two percentages added up. */
  overallComposition: string
  /** monday's "Overall Yarn": Blended below 100%, else the Yarn 1 name. */
  overallYarn: string
}

const KEEP_UPPER = new Set(['OE', 'BCI', 'GOTS', 'NPOP', 'NOP', 'GRS', 'OEKO TEX'])

/** A word as monday's Summary shows it: Cotton, Karded Compact; acronyms stay upper case. */
export function countLabel(value: string): string {
  const v = value.trim()
  if (!v) return ''
  if (KEEP_UPPER.has(v.toUpperCase())) return v.toUpperCase()
  return v.toLowerCase().replace(/(^|\s)(\S)/g, (_m, sp: string, ch: string) => sp + ch.toUpperCase())
}

/** Two decimals at most, with no trailing zeros: 45, 33.33. */
export function fmtPct(value: number): string {
  return String(Math.round(value * 100) / 100)
}

export function parsePct(text: string): number | null {
  const t = text.trim()
  if (t === '') return null
  const n = Number(t)
  if (!Number.isFinite(n) || n <= 0 || n > 100) return null
  return Math.round(n * 100) / 100
}

export function recipeState(form: Pick<CountRecipe, 'yarn_1' | 'yarn_1_pct' | 'yarn_2'>): RecipeState {
  const pct1 = parsePct(form.yarn_1_pct)
  const yarn2Enabled = pct1 !== null && pct1 < 100
  const remainder = yarn2Enabled && pct1 !== null ? Math.round((100 - pct1) * 100) / 100 : null
  const pct2 = remainder !== null && form.yarn_2 !== '' ? remainder : null
  const yarn2Reason = yarn2Enabled
    ? null
    : pct1 === null
      ? 'Enter Yarn 1 % first'
      : 'Yarn 1 is 100%, so there is no second yarn'
  const total = (pct1 ?? 0) + (pct2 ?? 0)
  return {
    pct1,
    yarn2Enabled,
    yarn2Reason,
    remainder,
    pct2,
    overallComposition: `${fmtPct(total)}%`,
    overallYarn: pct1 !== null && pct1 < 100 ? 'Blended' : countLabel(form.yarn_1) || 'None',
  }
}

/** Applies the dependency rules after a field changed: 100% (or no percentage)
 *  closes Yarn 2, and Yarn 2 can never be the same yarn as Yarn 1. */
export function normaliseRecipe<T extends CountRecipe>(form: T): T {
  const state = recipeState(form)
  let yarn_2 = form.yarn_2
  if (!state.yarn2Enabled) yarn_2 = ''
  if (yarn_2 !== '' && yarn_2 === form.yarn_1) yarn_2 = ''
  return yarn_2 === form.yarn_2 ? form : { ...form, yarn_2 }
}

/** monday's Summary (Fx): `20S Vortex 40% Cotton 60% Polyester Blended Double Karded Compact BCI Cheese`. */
export function buildName(form: CountRecipe): string {
  const s = recipeState(form)
  const parts: string[] = []
  if (form.count_no.trim() !== '') parts.push(`${form.count_no.trim()}S`)
  if (form.machine) parts.push(countLabel(form.machine))
  if (s.pct1 !== null && form.yarn_1) parts.push(`${fmtPct(s.pct1)}% ${countLabel(form.yarn_1)}`)
  if (s.pct2 !== null && form.yarn_2) parts.push(`${fmtPct(s.pct2)}% ${countLabel(form.yarn_2)}`)
  if (s.pct1 !== null && s.pct1 < 100) parts.push('Blended')
  for (const v of [form.ply, form.process, form.certification, form.yarn_type]) if (v) parts.push(countLabel(v))
  return parts.join(' ')
}

/** The same recipe in any yarn order has the same key (matches the database). */
export function recipeKey(form: CountRecipe): string {
  const s = recipeState(form)
  const pairs: string[] = []
  if (s.pct1 !== null && form.yarn_1) pairs.push(`${form.yarn_1}:${fmtPct(s.pct1)}`)
  if (s.pct2 !== null && form.yarn_2) pairs.push(`${form.yarn_2}:${fmtPct(s.pct2)}`)
  pairs.sort()
  return [form.machine, form.count_no.trim(), pairs.join(','), form.ply, form.process, form.certification, form.yarn_type]
    .join('|')
    .toUpperCase()
}

/** What is still missing before the form can be saved, in the words the form uses. */
export function recipeProblems(form: CountRecipe): string[] {
  const out: string[] = []
  const n = Number(form.count_no)
  if (!form.count_no || !Number.isInteger(n) || n < 6 || n > 120) out.push('Count (a whole number from 6 to 120)')
  if (!form.machine) out.push('Machine')
  if (!form.yarn_1) out.push('Yarn 1')
  const s = recipeState(form)
  if (s.pct1 === null) out.push('Yarn 1 % (more than 0, up to 100)')
  else if (s.pct1 < 100 && form.yarn_2 === '') out.push(`Yarn 2 for the remaining ${fmtPct(100 - s.pct1)}%`)
  if (!form.yarn_type) out.push('Type (cheese or cone)')
  return out
}
