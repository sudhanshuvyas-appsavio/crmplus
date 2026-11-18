import type { ReactNode } from 'react'
import { Modal } from './Modal'

/** A small "are you sure" dialog, used by the row Actions → Delete. */
export function ConfirmDialog({
  title,
  children,
  confirmLabel = 'Delete',
  busy = false,
  error,
  onConfirm,
  onClose,
}: {
  title: string
  children: ReactNode
  confirmLabel?: string
  busy?: boolean
  error?: string | null
  onConfirm: () => void
  onClose: () => void
}) {
  return (
    <Modal
      title={title}
      size="sm"
      onClose={onClose}
      footer={
        <>
          <button className="btn ghost" type="button" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button className="btn danger" type="button" onClick={onConfirm} disabled={busy}>
            {busy ? 'Working…' : confirmLabel}
          </button>
        </>
      }
    >
      {error && <div className="alert">{error}</div>}
      <div>{children}</div>
    </Modal>
  )
}
