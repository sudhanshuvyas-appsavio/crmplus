/** monday's Buyer Document / Supplier Document cells: one file icon per document (a red PDF icon for PDFs, a
 *  blue document icon for anything else); a click opens the file. */
import { supabase } from '../../lib/supabase'

export type ScDocLite = { id: string; sc_id: string; kind: 'buyer' | 'supplier'; file_name: string; storage_path: string; mime_type: string | null; uploaded_at: string }

const isPdf = (d: ScDocLite) => d.mime_type === 'application/pdf' || /\.pdf$/i.test(d.file_name)

async function openDoc(d: ScDocLite) {
  const { data } = await supabase.storage.from('sc-documents').createSignedUrl(d.storage_path, 60)
  if (data) window.open(data.signedUrl, '_blank', 'noopener')
}

export function ScDocIcons({ docs }: { docs: ScDocLite[] | undefined }) {
  if (!docs || docs.length === 0) return <span className="muted">—</span>
  return (
    <span className="doc-icons">
      {docs.map((d) => (
        <button key={d.id} type="button" className={`doc-icon${isPdf(d) ? ' pdf' : ''}`} title={`Open ${d.file_name}`} aria-label={`Open ${d.file_name}`}
          onClick={(e) => { e.stopPropagation(); void openDoc(d) }}>
          <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
            <path d="M6 2h8l5 5v13a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2Z" fill="currentColor" />
            {isPdf(d)
              ? <text x="12" y="17" textAnchor="middle" fontSize="6" fontWeight="700" fill="#fff" fontFamily="Arial, sans-serif">PDF</text>
              : <path d="M8 12h8M8 15h8M8 18h5" stroke="#fff" strokeWidth="1.4" strokeLinecap="round" />}
          </svg>
        </button>
      ))}
    </span>
  )
}
