import { useState } from 'react'
import { formatChips, formatDateTime, formatFullDate, profitClass, signed } from '../../utils/format'
import type { UploadLogRow } from '../../utils/statsApi'

interface UploadLogProps {
  uploads: UploadLogRow[];
  selectedId: number | null;
  onSelect: (upload: UploadLogRow) => void;
  onDelete: (upload: UploadLogRow) => Promise<void>;
}

const formatPeriod = (upload: UploadLogRow) =>
  upload.periodStart === upload.periodEnd
    ? formatFullDate(upload.periodStart)
    : `${formatFullDate(upload.periodStart)} – ${formatFullDate(upload.periodEnd)}`

/** The uploaded files that make up the statistics. Click one to see its period, or delete it. */
function UploadLog({ uploads, selectedId, onSelect, onDelete }: UploadLogProps) {
  // The upload waiting for the delete to be confirmed, and the one being deleted
  const [confirmId, setConfirmId] = useState<number | null>(null)
  const [deletingId, setDeletingId] = useState<number | null>(null)

  const handleDelete = (upload: UploadLogRow) => {
    setDeletingId(upload.id)
    onDelete(upload).finally(() => {
      setDeletingId(null)
      setConfirmId(null)
    })
  }

  return (
    <section className="stats-card">
      <header className="stats-card-header">
        <h3>Upload log</h3>
        <span className="stats-card-subtitle">Click an upload to see the stats for its period</span>
      </header>
      <div className="stats-table-wrapper">
        <table className="stats-table">
          <thead>
            <tr>
              <th>File</th>
              <th>Period</th>
              <th>Uploaded</th>
              <th className="numeric">Players</th>
              <th className="numeric">Rake</th>
              <th className="numeric">Club net</th>
              <th aria-label="Delete" />
            </tr>
          </thead>
          <tbody>
            {uploads.map(upload => (
              <tr
                key={upload.id}
                className={upload.id === selectedId ? 'selected' : undefined}
                onClick={() => onSelect(upload)}
                tabIndex={0}
                onKeyDown={e => {
                  if (e.target === e.currentTarget && (e.key === 'Enter' || e.key === ' ')) {
                    e.preventDefault()
                    onSelect(upload)
                  }
                }}
              >
                <td className="upload-file">{upload.fileName || '–'}</td>
                <td>{formatPeriod(upload)}</td>
                <td>{formatDateTime(upload.uploadedAt)}</td>
                <td className="numeric">{upload.players}</td>
                <td className="numeric">{formatChips(upload.bruttoRake)}</td>
                <td className={`numeric ${profitClass(upload.clubNet)}`}>{signed(upload.clubNet)}</td>
                <td className="numeric upload-actions" onClick={e => e.stopPropagation()}>
                  {confirmId === upload.id ? (
                    <>
                      <button
                        type="button"
                        className="upload-delete confirm"
                        disabled={deletingId === upload.id}
                        onClick={() => handleDelete(upload)}
                      >
                        {deletingId === upload.id ? 'Deleting…' : 'Delete'}
                      </button>
                      <button type="button" className="upload-cancel" disabled={deletingId === upload.id} onClick={() => setConfirmId(null)}>
                        Cancel
                      </button>
                    </>
                  ) : (
                    <button
                      type="button"
                      className="upload-delete"
                      onClick={() => setConfirmId(upload.id)}
                      aria-label={`Delete upload ${upload.fileName || formatPeriod(upload)}`}
                    >
                      Delete
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  )
}

export default UploadLog
