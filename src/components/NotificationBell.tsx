import { useEffect, useRef, useState } from 'react'
import type { KeyboardEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { useNotifications } from '../lib/notifications'
import { relative } from '../lib/format'
import type { AppNotification } from '../api/types'
import '../styles/field.css'

/** The bell with an unread badge and a panel of the latest notifications. */
export default function NotificationBell() {
  const { items, unread, loading, markRead, markAllRead } = useNotifications()
  const navigate = useNavigate()
  const [open, setOpen] = useState(false)
  const wrap = useRef<HTMLDivElement>(null)
  const button = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent | TouchEvent) => {
      if (wrap.current && !wrap.current.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key === 'Escape') {
        setOpen(false)
        button.current?.focus()
      }
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('touchstart', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('touchstart', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  function openItem(n: AppNotification) {
    void markRead(n.id)
    setOpen(false)
    button.current?.focus()
    if (n.href) navigate(n.href)
  }

  function onItemKey(e: KeyboardEvent<HTMLLIElement>, n: AppNotification) {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      openItem(n)
    }
  }

  return (
    <div className="bell-wrap" ref={wrap}>
      <button
        ref={button}
        type="button"
        className="bell-btn"
        aria-label={`Notifications, ${unread} unread`}
        aria-haspopup="true"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" />
          <path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" />
        </svg>
        {unread > 0 && <span className="bell-badge" aria-hidden="true">{unread > 9 ? '9+' : unread}</span>}
      </button>

      {open && (
        <div className="bell-panel" role="dialog" aria-label="Notifications">
          <div className="bell-head">
            <span>Notifications</span>
            <button type="button" className="bell-link" disabled={unread === 0} onClick={() => void markAllRead()}>
              Mark all as read
            </button>
          </div>
          {items.length === 0 ? (
            <div className="bell-empty">{loading ? 'Loading…' : "You're all caught up."}</div>
          ) : (
            <ul className="bell-list">
              {items.map((n) => (
                <li
                  key={n.id}
                  className={`bell-item${n.read_at ? '' : ' unread'}${n.severity === 'critical' ? ' critical' : ''}`}
                  tabIndex={0}
                  role="button"
                  onClick={() => openItem(n)}
                  onKeyDown={(e) => onItemKey(e, n)}
                >
                  <span className="bell-dot" aria-hidden="true" />
                  <div>
                    <strong>{n.title}</strong>
                    {n.message && <span className="bell-msg">{n.message}</span>}
                    <span className="bell-time">{relative(n.created_at)}</span>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  )
}
