/** The "Documents" row action: a record's files in a dialog of their own, so
 *  they can be previewed, added or removed without opening the whole form. */

import { Modal } from '../Modal'
import { DocumentList, type DocumentStore } from './DocumentList'

export function DocumentsModal({
  title,
  store,
  parentId,
  canEdit,
  onClose,
  onChanged,
}: {
  title: string
  store: DocumentStore
  parentId: string
  canEdit: boolean
  onClose: () => void
  onChanged?: () => void
}) {
  return (
    <Modal
      title={`Documents · ${title}`}
      size="lg"
      onClose={onClose}
      footer={
        <button className="btn ghost" type="button" onClick={onClose}>
          Close
        </button>
      }
    >
      <DocumentList store={store} parentId={parentId} canEdit={canEdit} onChanged={onChanged} />
    </Modal>
  )
}
