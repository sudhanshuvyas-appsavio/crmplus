/** Small lookups the Tasks screens share: who a task can be assigned to, and the
 *  buyers, suppliers and orders it can point at. Loaded once per screen. */

import { useEffect, useState } from 'react'
import { supabase } from './supabase'
import { TASK_BUCKET } from './tasks'
import type { TaskTypeRow } from '../api/types'

export interface Option {
  id: string
  label: string
  inactive?: boolean
}

function useOptions(load: () => PromiseLike<Option[]>): Option[] {
  const [options, setOptions] = useState<Option[]>([])
  useEffect(() => {
    let live = true
    void Promise.resolve(load()).then((rows) => {
      if (live) setOptions(rows)
    })
    return () => {
      live = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  return options
}

/** Active users, by name. */
export function useProfileOptions(): Option[] {
  return useOptions(async () => {
    const { data } = await supabase.from('profiles').select('id,name,is_active').order('name')
    return ((data ?? []) as { id: string; name: string; is_active: boolean }[])
      .filter((p) => p.is_active)
      .map((p) => ({ id: p.id, label: p.name }))
  })
}

/** Every user, active or not, so a name can still be shown for someone who has left. */
export function useProfileNameMap(): Record<string, string> {
  const [names, setNames] = useState<Record<string, string>>({})
  useEffect(() => {
    let live = true
    void supabase
      .from('profiles')
      .select('id,name')
      .then(({ data }) => {
        if (live && data) setNames(Object.fromEntries((data as { id: string; name: string }[]).map((p) => [p.id, p.name])))
      })
    return () => {
      live = false
    }
  }, [])
  return names
}

export function useBuyerOptions(): Option[] {
  return useOptions(async () => {
    const { data } = await supabase.from('buyer_master').select('id,name,buyer_code,is_active').order('name')
    return ((data ?? []) as { id: string; name: string; buyer_code: string; is_active: boolean }[]).map((b) => ({
      id: b.id,
      label: `${b.name} (${b.buyer_code})`,
      inactive: !b.is_active,
    }))
  })
}

export function useSupplierOptions(): Option[] {
  return useOptions(async () => {
    const { data } = await supabase.from('supplier_master').select('id,name,supplier_code,is_active').order('name')
    return ((data ?? []) as { id: string; name: string; supplier_code: string; is_active: boolean }[]).map((s) => ({
      id: s.id,
      label: `${s.name} (${s.supplier_code})`,
      inactive: !s.is_active,
    }))
  })
}

export function useOrderOptions(): Option[] {
  return useOptions(async () => {
    const { data } = await supabase.from('orders').select('id,order_no,status').order('created_at', { ascending: false }).limit(500)
    return ((data ?? []) as { id: string; order_no: string | null; status: string }[]).map((o) => ({
      id: o.id,
      label: `${o.order_no ?? 'Order'} (${o.status.replace(/_/g, ' ')})`,
    }))
  })
}

export function useTaskTypes(): TaskTypeRow[] {
  const [types, setTypes] = useState<TaskTypeRow[]>([])
  useEffect(() => {
    let live = true
    void supabase
      .from('task_types')
      .select('*')
      .eq('is_active', true)
      .order('sort_order')
      .then(({ data }) => {
        if (live && data) setTypes(data as TaskTypeRow[])
      })
    return () => {
      live = false
    }
  }, [])
  return types
}

/** A short-lived link to a private proof file. */
export async function signedProofUrl(path: string, seconds = 300): Promise<string | null> {
  const { data, error } = await supabase.storage.from(TASK_BUCKET).createSignedUrl(path, seconds)
  return error || !data ? null : data.signedUrl
}
