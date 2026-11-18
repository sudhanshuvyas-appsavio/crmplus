import { useSyncExternalStore } from 'react'

type ToastKind = 'success' | 'error'
interface ToastItem {
  id: number
  kind: ToastKind
  message: string
}

let items: ToastItem[] = []
let nextId = 1
const listeners = new Set<() => void>()
const emit = () => listeners.forEach((l) => l())

/** Shows a short message. Success clears itself after 3 seconds, an error after 8. */
export function pushToast(kind: ToastKind, message: string): void {
  const id = nextId++
  items = [...items, { id, kind, message }]
  emit()
  window.setTimeout(() => dismissToast(id), kind === 'error' ? 8000 : 3000)
}

export function dismissToast(id: number): void {
  items = items.filter((t) => t.id !== id)
  emit()
}

function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

/** Mount once, near the root of the signed-in app. */
export function ToastHost() {
  const current = useSyncExternalStore(subscribe, () => items)
  if (current.length === 0) return null
  return (
    <div className="toast-host" aria-live="polite">
      {current.map((t) => (
        <div key={t.id} className={`toast ${t.kind}`} role={t.kind === 'error' ? 'alert' : 'status'}>
          <span>{t.message}</span>
          <button type="button" aria-label="Dismiss" onClick={() => dismissToast(t.id)}>
            ×
          </button>
        </div>
      ))}
    </div>
  )
}
