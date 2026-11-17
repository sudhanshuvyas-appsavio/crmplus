/** Reads and writes the links between masters (the monday "relation"
 *  columns): the locations a buyer, supplier, transporter or delivery address
 *  uses, and the counts a party buys or supplies.
 *
 *  A record's links are saved after the record itself, because a new record has
 *  no id until it exists. `syncLinks` makes the stored links equal the wanted
 *  list: it adds what is missing and removes what is no longer wanted, and
 *  leaves the rest alone. */

import { supabase } from './supabase'
import type { LinkOwner } from '../api/types'

export type LinkKind = 'location' | 'count'

const CONFIG = {
  location: { table: 'location_links', typeCol: 'owner_type', idCol: 'owner_id', targetCol: 'location_id' },
  count: { table: 'party_counts', typeCol: 'party_type', idCol: 'party_id', targetCol: 'count_id' },
} as const

export async function loadLinkIds(kind: LinkKind, ownerType: LinkOwner, ownerId: string): Promise<string[]> {
  const c = CONFIG[kind]
  const { data, error } = await supabase.from(c.table).select(c.targetCol).eq(c.typeCol, ownerType).eq(c.idCol, ownerId)
  if (error) throw error
  return ((data ?? []) as unknown as Record<string, string>[]).map((r) => r[c.targetCol] as string)
}

export async function syncLinks(kind: LinkKind, ownerType: LinkOwner, ownerId: string, wanted: string[]): Promise<void> {
  const c = CONFIG[kind]
  const have = await loadLinkIds(kind, ownerType, ownerId)
  const want = [...new Set(wanted)]
  const add = want.filter((id) => !have.includes(id))
  const drop = have.filter((id) => !want.includes(id))

  if (drop.length > 0) {
    const { error } = await supabase
      .from(c.table)
      .delete()
      .eq(c.typeCol, ownerType)
      .eq(c.idCol, ownerId)
      .in(c.targetCol, drop)
    if (error) throw error
  }
  if (add.length > 0) {
    const rows = add.map((id) => ({ [c.typeCol]: ownerType, [c.idCol]: ownerId, [c.targetCol]: id }))
    const { error } = await supabase.from(c.table).insert(rows)
    if (error) throw error
  }
}
