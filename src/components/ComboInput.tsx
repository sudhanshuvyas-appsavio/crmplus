/** A text box with a dropdown of suggestions, in the app's own style. It replaces the browser's <datalist>,
 *  which draws a small dark bubble of its own: here the list opens under the box, matches as you type,
 *  and works with the arrow keys, Enter and Escape. The value is still free text, as with a datalist. */

import { useEffect, useId, useMemo, useRef, useState, type CSSProperties } from 'react'

export function ComboInput({
  id,
  value,
  onChange,
  options,
  placeholder,
  disabled,
  ariaLabel,
  className,
  style,
  maxItems = 60,
}: {
  id?: string
  value: string
  onChange: (text: string) => void
  options: string[]
  placeholder?: string
  disabled?: boolean
  ariaLabel?: string
  className?: string
  style?: CSSProperties
  maxItems?: number
}) {
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(-1)
  const wrap = useRef<HTMLDivElement>(null)
  const listId = useId()

  // while the text equals an option, show them all (to change the choice); otherwise narrow by what is typed
  const shown = useMemo(() => {
    const q = value.trim().toLowerCase()
    const exact = options.some((o) => o.toLowerCase() === q)
    const list = q === '' || exact ? options : options.filter((o) => o.toLowerCase().includes(q))
    return list.slice(0, maxItems)
  }, [options, value, maxItems])

  useEffect(() => {
    if (!open) return undefined
    const onDown = (e: PointerEvent) => { if (!wrap.current?.contains(e.target as Node)) setOpen(false) }
    document.addEventListener('pointerdown', onDown)
    return () => document.removeEventListener('pointerdown', onDown)
  }, [open])

  function pick(text: string) {
    onChange(text)
    setOpen(false)
    setActive(-1)
  }

  return (
    <div className="combo" ref={wrap}>
      <input
        id={id}
        className={className}
        style={style}
        role="combobox"
        aria-expanded={open}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-label={ariaLabel}
        autoComplete="off"
        placeholder={placeholder}
        disabled={disabled}
        value={value}
        onFocus={() => setOpen(true)}
        onChange={(e) => { onChange(e.target.value); setOpen(true); setActive(-1) }}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') { e.preventDefault(); setOpen(true); setActive((i) => Math.min(shown.length - 1, i + 1)) }
          else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((i) => Math.max(0, i - 1)) }
          else if (e.key === 'Enter' && open && active >= 0 && shown[active] !== undefined) { e.preventDefault(); pick(shown[active]!) }
          else if (e.key === 'Escape' && open) { e.stopPropagation(); setOpen(false) }
        }}
      />
      {open && shown.length > 0 && !disabled && (
        <ul className="combo-menu" id={listId} role="listbox">
          {shown.map((o, i) => (
            <li
              key={o}
              role="option"
              aria-selected={i === active}
              className={i === active ? 'on' : undefined}
              onPointerDown={(e) => { e.preventDefault(); pick(o) }}
              onMouseEnter={() => setActive(i)}
            >
              {o}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
