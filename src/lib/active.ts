/** Marks master data records Active or Inactive (the Status filter and the Inactive badge have always read
 *  `is_active`; this is the control that sets it). Nothing is deleted: inactive records stay in the list, keep
 *  their documents and history, and are no longer offered when choosing a business unit, location and so on. */

import { supabase } from './supabase'
import { errMessage } from './party'

/** Sets is_active on one record of each given table; returns a message when it failed, otherwise null. */
export async function setActive(targets: { table: string; id: string }[], active: boolean): Promise<string | null> {
  for (const t of targets) {
    const { data, error } = await supabase.from(t.table).update({ is_active: active }).eq('id', t.id).select('id')
    if (error) return errMessage(error, 'Could not change the status')
    if (!data || data.length === 0) return 'Your account cannot change this record.'
  }
  return null
}
