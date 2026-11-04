/** Helpers shared by the Count, Supplier, Buyer and Lead list screens for the
 *  same three things Companies already does: import from CSV, export to CSV,
 *  and delete several records at once. */

import { supabase } from './supabase'
import { parseCSV } from './csv'
import { errMessage } from './party'

export interface CsvRowResult {
  row: number
  name: string
  status: 'created' | 'error'
  detail?: string
}

export interface CsvRow {
  /** 1-indexed row number in the file, counting the header as row 1. */
  rowNum: number
  /** The trimmed cell under a header (case-insensitive); '' if absent. */
  get: (col: string) => string
}

export function parseBool(value: string, fallback: boolean): boolean {
  const v = value.trim().toLowerCase()
  if (v === '') return fallback
  if (['true', '1', 'yes', 'y'].includes(v)) return true
  if (['false', '0', 'no', 'n'].includes(v)) return false
  return fallback
}

/** Upper-cases a cell and checks it is one of the allowed values. Returns the
 *  value ('' when blank) or throws a sentence a person can act on. */
export function pickOne(label: string, raw: string, allowed: readonly string[], required = false): string {
  const value = raw.trim().toUpperCase()
  if (value === '') {
    if (required) throw new Error(`${label} is required`)
    return ''
  }
  if (!allowed.includes(value)) throw new Error(`${label} "${raw.trim()}" is not one of: ${allowed.join(', ')}`)
  return value
}

/** Reads a CSV file and inserts its rows one at a time, in order, so one bad
 *  row never blocks the others. `insert` throws to reject a row. */
export async function importCsvFile(
  file: File,
  label: (row: CsvRow) => string,
  insert: (row: CsvRow) => Promise<void>,
): Promise<{ results: CsvRowResult[] } | { error: string }> {
  let parsed: string[][]
  try {
    parsed = parseCSV(await file.text())
  } catch {
    return { error: 'Could not read that file.' }
  }
  if (parsed.length < 2) return { error: 'That file has no data rows below the header.' }

  const header = (parsed[0] ?? []).map((h) => h.replace(/^﻿/, '').trim().toLowerCase())
  const results: CsvRowResult[] = []
  for (let i = 1; i < parsed.length; i++) {
    const cells = parsed[i]
    if (!cells || cells.every((c) => c.trim() === '')) continue
    const row: CsvRow = {
      rowNum: i + 1,
      get: (col) => {
        const idx = header.indexOf(col.toLowerCase())
        return idx === -1 ? '' : (cells[idx] ?? '').trim()
      },
    }
    const name = label(row) || '(blank)'
    try {
      await insert(row)
      results.push({ row: row.rowNum, name, status: 'created' })
    } catch (caught) {
      results.push({ row: row.rowNum, name, status: 'error', detail: errMessage(caught, 'Could not create this row') })
    }
  }
  return { results }
}

export function importSummary(results: CsvRowResult[]): { kind: 'ok' | 'bad'; text: string } {
  const created = results.filter((r) => r.status === 'created').length
  const failed = results.length - created
  return {
    kind: failed === 0 ? 'ok' : 'bad',
    text: `Imported ${created} of ${results.length} row${results.length === 1 ? '' : 's'}.${
      failed ? ` ${failed} failed -- see the details below.` : ''
    }`,
  }
}

export interface BulkDeleteResult {
  deleted: string[]
  failed: { id: string; message: string }[]
}

/** Deletes records by id. Tries each batch in one statement; if the database
 *  refuses (a lead still points at a master record, say) it falls back to one
 *  at a time so the records that can go still go, and each refusal is reported.
 *  `.select('id')` is what makes a row that row-level security silently
 *  filtered out show up as "not deleted" instead of looking like success. */
export async function bulkDelete(table: string, ids: string[]): Promise<BulkDeleteResult> {
  const out: BulkDeleteResult = { deleted: [], failed: [] }
  const NOT_ALLOWED = 'Your account does not have permission to delete this.'

  for (let start = 0; start < ids.length; start += 100) {
    const batch = ids.slice(start, start + 100)
    const whole = await supabase.from(table).delete().in('id', batch).select('id')
    if (!whole.error) {
      const gone = new Set((whole.data ?? []).map((r) => (r as { id: string }).id))
      for (const id of batch) {
        if (gone.has(id)) out.deleted.push(id)
        else out.failed.push({ id, message: NOT_ALLOWED })
      }
      continue
    }
    for (const id of batch) {
      const one = await supabase.from(table).delete().eq('id', id).select('id')
      if (one.error) out.failed.push({ id, message: errMessage(one.error, 'Could not delete') })
      else if ((one.data ?? []).length === 0) out.failed.push({ id, message: NOT_ALLOWED })
      else out.deleted.push(id)
    }
  }
  return out
}

export function deleteSummary(
  noun: string,
  plural: string,
  result: BulkDeleteResult,
  nameOf: (id: string) => string,
): { kind: 'ok' | 'bad'; text: string } {
  const n = result.deleted.length
  const done = `${n} ${n === 1 ? noun : plural} deleted.`
  if (result.failed.length === 0) return { kind: 'ok', text: done }
  const names = result.failed.map((f) => nameOf(f.id)).join(', ')
  const reasons = [...new Set(result.failed.map((f) => f.message))].join(' ')
  return {
    kind: 'bad',
    text: `${n > 0 ? `${done} ` : ''}${result.failed.length} could not be deleted (${names}). ${reasons}`,
  }
}