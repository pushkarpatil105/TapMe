import {
  formatAuditDateTime,
  getActionBadge,
  extractAuditItemMetadata,
} from '../../utils/audit-workflow'

export function AuditTable({
  logs,
  loading,
  error,
  onViewDetails,
  onRetry,
}) {
  if (loading && (!logs || logs.length === 0)) {
    return (
      <div className="table-card">
        <div className="loading-row p-12">
          <span className="spinner-icon" />
          <span className="text-slate-300 font-medium ml-3">
            Loading audit history...
          </span>
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="table-card">
        <div className="table-error-banner p-6">
          <div className="flex items-center gap-3">
            <svg className="alert-icon" viewBox="0 0 20 20" fill="currentColor">
              <path
                fillRule="evenodd"
                d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7 4a1 1 0 11-2 0 1 1 0 012 0zm-1-9a1 1 0 00-1 1v4a1 1 0 102 0V6a1 1 0 00-1-1z"
                clipRule="evenodd"
              />
            </svg>
            <div>
              <p className="font-semibold text-rose-200">Failed to load audit logs</p>
              <p className="text-sm text-rose-300">{error}</p>
            </div>
            {onRetry && (
              <button
                type="button"
                className="action-btn action-btn-secondary ml-auto text-xs py-1 px-3"
                onClick={onRetry}
              >
                Retry
              </button>
            )}
          </div>
        </div>
      </div>
    )
  }

  if (!logs || logs.length === 0) {
    return (
      <div className="table-card">
        <div className="empty-state-wrap p-12 text-center">
          <div className="empty-state-icon mb-3">📋</div>
          <h3 className="empty-title text-base font-semibold text-slate-200">
            No audit records found
          </h3>
          <p className="empty-subtitle text-xs text-slate-400 mt-1 max-w-sm mx-auto">
            No actions match the selected filter criteria, or no audit activity has been recorded yet.
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="table-card">
      <div className="table-responsive">
        <table className="data-table audit-table">
          <thead>
            <tr>
              <th scope="col" className="w-44">Date & Time (IST)</th>
              <th scope="col" className="w-36">Action</th>
              <th scope="col" className="w-32">Actor</th>
              <th scope="col" className="w-28">Entity</th>
              <th scope="col" className="w-40">Business Name</th>
              <th scope="col">Activity Summary</th>
              <th scope="col" className="text-right w-20">Details</th>
            </tr>
          </thead>
          <tbody>
            {logs.map((log) => {
              const badge = getActionBadge(log.action)
              const meta = extractAuditItemMetadata(log)

              return (
                <tr key={log.id} className="audit-table-row">
                  {/* Timestamp in IST */}
                  <td className="text-xs font-mono text-slate-300 whitespace-nowrap">
                    {formatAuditDateTime(log.created_at)}
                  </td>

                  {/* Action Badge */}
                  <td>
                    <span className={`audit-badge ${badge.badgeClass}`}>
                      {badge.label}
                    </span>
                  </td>

                  {/* Actor */}
                  <td>
                    <div className="flex flex-col">
                      <span className="font-semibold text-slate-200 text-xs truncate max-w-[120px]">
                        {log.admin_username || 'System'}
                      </span>
                      {log.admin_id && (
                        <span className="text-[10px] text-slate-500 font-mono truncate max-w-[100px]">
                          {log.admin_id.slice(0, 8)}...
                        </span>
                      )}
                    </div>
                  </td>

                  {/* Entity (Card # or Staff) */}
                  <td>
                    {meta.formattedCardNumber ? (
                      <span className="font-bold text-sky-400 text-xs">
                        {meta.formattedCardNumber}
                      </span>
                    ) : (
                      <span className="text-slate-400 text-xs font-mono capitalize">
                        {log.entity_type}
                      </span>
                    )}
                  </td>

                  {/* Business Name (Where available; never fabricated) */}
                  <td>
                    {meta.businessName ? (
                      <span className="font-medium text-slate-200 text-xs truncate max-w-[140px] block">
                        {meta.businessName}
                      </span>
                    ) : (
                      <span className="text-slate-500 text-xs italic">—</span>
                    )}
                  </td>

                  {/* Activity Summary */}
                  <td className="text-xs text-slate-300">
                    <span className="line-clamp-2">{meta.summary}</span>
                  </td>

                  {/* View Details Action */}
                  <td className="text-right">
                    <button
                      type="button"
                      className="btn-row btn-row-view text-xs py-1 px-2.5"
                      onClick={() => onViewDetails(log)}
                      title="Inspect event details"
                    >
                      View
                    </button>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}

