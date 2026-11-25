import type { ReactNode } from 'react'
import type { Tone } from '../lib/tasks'

/** A rounded status label with a hairline ring, in one of six tones. */
export function StatusPill({ tone = 'neutral', title, children }: { tone?: Tone; title?: string; children: ReactNode }) {
  return (
    <span className={`sp sp-${tone}`} title={title}>
      {children}
    </span>
  )
}
