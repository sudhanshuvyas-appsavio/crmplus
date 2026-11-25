/** The Documents column of a monday.com Business Unit: files kept against the
 *  business unit (up to 10; the database enforces the limit). Stored in the
 *  private `company-documents` bucket under <company id>/<uuid>-<file name>.
 *  The list, upload, preview and delete are the shared DocumentList. */

import { DocumentList, DOCUMENT_LIMIT, type DocumentStore } from './documents/DocumentList'

export const COMPANY_DOC_LIMIT = DOCUMENT_LIMIT

export const companyDocStore = (companyId: string): DocumentStore => ({
  table: 'company_documents',
  bucket: 'company-documents',
  parentColumn: 'company_id',
  pathPrefix: companyId,
  noun: 'business unit',
})

export function CompanyDocuments({ companyId, canEdit, onChanged }: { companyId: string; canEdit: boolean; onChanged?: () => void }) {
  return (
    <>
      <h3 className="section-title">Documents</h3>
      <DocumentList store={companyDocStore(companyId)} parentId={companyId} canEdit={canEdit} onChanged={onChanged} />
    </>
  )
}
