/** The signed-in user's notifications: the latest 30, an unread count, live
 *  updates over Supabase Realtime, and a slow poll as a backup. */

import { useCallback, useEffect, useRef, useState } from 'react'
import { useAuth } from '../auth/AuthProvider'
import { supabase } from './supabase'
import { errMessage } from './party'
import { pushToast } from '../components/Toast'
import type { AppNotification } from '../api/types'

const POLL_MS = 5 * 60 * 1000
const LIMIT = 30

export interface NotificationsState {
  items: AppNotification[]
  unread: number
  loading: boolean
  reload: () => Promise<void>
  markRead: (id: string) => Promise<void>
  markAllRead: () => Promise<void>
}

export function useNotifications(): NotificationsState {
  const { me } = useAuth()
  const userId = me?.id ?? null
  const [items, setItems] = useState<AppNotification[]>([])
  const [unread, setUnread] = useState(0)
  const [loading, setLoading] = useState(true)
  const live = useRef(true)
  // Mirrors of the state, so an optimistic change can be rolled back.
  const itemsRef = useRef<AppNotification[]>([])
  const unreadRef = useRef(0)

  const apply = useCallback((nextItems: AppNotification[], nextUnread: number) => {
    itemsRef.current = nextItems
    unreadRef.current = nextUnread
    setItems(nextItems)
    setUnread(nextUnread)
  }, [])

  const reload = useCallback(async () => {
    if (!userId) {
      apply([], 0)
      setLoading(false)
      return
    }
    const [list, count] = await Promise.all([
      supabase.from('notifications').select('*').eq('user_id', userId).order('created_at', { ascending: false }).limit(LIMIT),
      supabase.from('notifications').select('id', { count: 'exact', head: true }).eq('user_id', userId).is('read_at', null),
    ])
    if (!live.current) return
    if (!list.error && list.data) apply(list.data as AppNotification[], count.error ? unreadRef.current : (count.count ?? 0))
    setLoading(false)
  }, [userId, apply])

  useEffect(() => {
    live.current = true
    void reload()

    let channel: ReturnType<typeof supabase.channel> | null = null
    if (userId) {
      channel = supabase
        .channel(`notifications-${userId}-${Math.random().toString(36).slice(2, 8)}`)
        .on(
          'postgres_changes',
          { event: '*', schema: 'public', table: 'notifications', filter: `user_id=eq.${userId}` },
          () => void reload(),
        )
        .subscribe()
    }

    const timer = window.setInterval(() => void reload(), POLL_MS)
    const onVisible = () => {
      if (document.visibilityState === 'visible') void reload()
    }
    document.addEventListener('visibilitychange', onVisible)

    return () => {
      live.current = false
      window.clearInterval(timer)
      document.removeEventListener('visibilitychange', onVisible)
      if (channel) void supabase.removeChannel(channel)
    }
  }, [userId, reload])

  const markRead = useCallback(
    async (id: string) => {
      const target = itemsRef.current.find((n) => n.id === id)
      if (!target || target.read_at) return
      const prevItems = itemsRef.current
      const prevUnread = unreadRef.current
      const now = new Date().toISOString()
      apply(prevItems.map((n) => (n.id === id ? { ...n, read_at: now } : n)), Math.max(0, prevUnread - 1))
      const { error } = await supabase.from('notifications').update({ read_at: now }).eq('id', id).is('read_at', null)
      if (error) {
        apply(prevItems, prevUnread)
        pushToast('error', errMessage(error, 'Could not mark the notification as read'))
      }
    },
    [apply],
  )

  const markAllRead = useCallback(async () => {
    if (!userId || unreadRef.current === 0) return
    const prevItems = itemsRef.current
    const prevUnread = unreadRef.current
    const now = new Date().toISOString()
    apply(prevItems.map((n) => (n.read_at ? n : { ...n, read_at: now })), 0)
    const { error } = await supabase.from('notifications').update({ read_at: now }).eq('user_id', userId).is('read_at', null)
    if (error) {
      apply(prevItems, prevUnread)
      pushToast('error', errMessage(error, 'Could not mark all as read'))
    }
  }, [userId, apply])

  return { items, unread, loading, reload, markRead, markAllRead }
}
