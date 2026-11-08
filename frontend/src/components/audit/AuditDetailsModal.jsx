import { formatAuditDateTime, getActionBadge } from '../../utils/audit-workflow'

export function AuditDetailsModal({ log, onClose }) {
  if (!log) return null

  const badge = getActionBadge(log.action)
  const details = typeof log.details === 'object' && log.details !== null ? log.details : null
  const changes = details?.changes && typeof details.changes === 'object' ? details.changes : null

  return (
    <div className="modal-backdrop">
      <div
        className="modal-container max-w-2xl"
        role="dialog"
        aria-modal="true"
        aria-labelledby="audit-modal-title"
      >
        <div className="modal-header">
          <div className="modal-header-info">
            <h2 id="audit-modal-title" className="modal-title">
              Audit Event Details
            </h2>
            <span className={`audit-badge ${badge.badgeClass}`}>
              {badge.label}
            </span>
          </div>
          <button
            type="button"
            className="modal-close-btn"
            onClick={onClose}
            aria-label="Close dialog"
          >
            ✕
          </button>
        </div>

        <div className="modal-body modal-scroll-body">
          {/* Metadata Grid */}
          <div className="details-grid mb-4">
            <div className="details-item">
              <span className="details-label">Timestamp (IST)</span>
              <strong className="details-value text-main font-mono text-sm">
                {formatAuditDateTime(log.created_at)}
              </strong>
            </div>

            <div className="details-item">
              <span className="details-label">Timestamp (UTC Raw)</span>
              <span className="details-value text-muted text-xs font-mono">
                {log.created_at || '—'}
              </span>
            </div>

            <div className="details-item">
              <span className="details-label">Actor Username</span>
              <strong className="details-value text-main font-semibold">
                {log.admin_username || 'System / Direct'}
              </strong>
            </div>

            <div className="details-item">
              <span className="details-label">Actor Admin ID</span>
              <code className="details-value text-muted text-xs truncate max-w-xs">
                {log.admin_id || '—'}
              </code>
            </div>

            <div className="details-item">
              <span className="details-label">Entity Type</span>
              <span className="details-value text-main uppercase font-bold text-xs tracking-wider">
                {log.entity_type}
              </span>
            </div>

            <div className="details-item">
              <span className="details-label">Entity ID</span>
              <code className="details-value text-sky-400 font-bold">
                {log.entity_type === 'card' && /^\d+$/.test(log.entity_id)
                  ? `#${String(log.entity_id).padStart(3, '0')}`
                  : log.entity_id || '—'}
              </code>
            </div>
          </div>

          {/* Before & After Changes Diff (when available) */}
          {changes && Object.keys(changes).length > 0 && (
            <div className="audit-diff-section mb-4">
              <h3 className="text-xs font-bold uppercase tracking-wider text-slate-400 mb-2">
                Modified Attributes (Before vs After)
              </h3>
              <div className="audit-diff-table-wrap">
                <table className="audit-diff-table">
                  <thead>
                    <tr>
                      <th>Field</th>
                      <th>Previous Value</th>
                      <th>New Value</th>
                    </tr>
                  </thead>
                  <tbody>
                    {Object.entries(changes).map(([field, diff]) => (
                      <tr key={field}>
                        <td className="font-semibold text-sky-300">{field}</td>
                        <td className="text-rose-300 font-mono text-xs">
                          {typeof diff.before === 'object'
                            ? JSON.stringify(diff.before, null, 2)
                            : String(diff.before ?? '—')}
                        </td>
                        <td className="text-emerald-300 font-mono text-xs">
                          {typeof diff.after === 'object'
                            ? JSON.stringify(diff.after, null, 2)
                            : String(diff.after ?? '—')}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Raw Structured Event Payload (Sanitized) */}
          <div className="audit-raw-section">
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-xs font-bold uppercase tracking-wider text-slate-400">
                Complete Event Payload (Sanitized)
              </h3>
              <span className="text-xs text-slate-500 font-mono">ID: {log.id}</span>
            </div>
            <pre className="audit-json-box">
              {JSON.stringify(details, null, 2)}
            </pre>
          </div>
        </div>

        <div className="modal-footer">
          <button
            type="button"
            className="action-btn action-btn-secondary"
            onClick={onClose}
          >
            Close
          </button>
        </div>
      </div>
    </div>
  )
}

