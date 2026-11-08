export function StaffTable({
  staffList,
  loading,
  error,
  onRefresh,
  onCreateStaff,
  onAction,
}) {
  const formatDate = (dateStr) => {
    if (!dateStr) return null
    try {
      const d = new Date(dateStr)
      if (isNaN(d.getTime())) return dateStr
      return d.toLocaleDateString(undefined, {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      })
    } catch {
      return dateStr
    }
  }

  const getStaffStatus = (member) => {
    if (member.deleted_at) {
      return 'removed'
    }
    return member.status || 'active'
  }

  return (
    <div className="cards-table-container">
      {/* Header Bar */}
      <div className="table-header-bar">
        <div className="table-title-group">
          <h2 className="table-title">Staff Accounts</h2>
          <span className="table-count-badge">
            {staffList.length} {staffList.length === 1 ? 'member' : 'members'}
          </span>
        </div>
        <div className="table-actions-group">
          <button
            type="button"
            className="action-btn action-btn-secondary"
            onClick={onRefresh}
            disabled={loading}
            title="Refresh staff accounts list"
          >
            <svg
              className={`btn-icon ${loading ? 'spin' : ''}`}
              viewBox="0 0 20 20"
              fill="currentColor"
            >
              <path
                fillRule="evenodd"
                d="M4 2a1 1 0 011 1v2.101a7.002 7.002 0 0111.601 2.566 1 1 0 11-1.885.666A5.002 5.002 0 005.999 7H9a1 1 0 010 2H4a1 1 0 01-1-1V3a1 1 0 011-1zm.008 9.057a1 1 0 011.276.61A5.002 5.002 0 0014.001 13H11a1 1 0 110-2h5a1 1 0 011 1v5a1 1 0 11-2 0v-2.101a7.002 7.002 0 01-11.601-2.566 1 1 0 01.61-1.276z"
                clipRule="evenodd"
              />
            </svg>
            <span>Refresh</span>
          </button>
          <button
            type="button"
            className="action-btn action-btn-primary"
            onClick={onCreateStaff}
          >
            <svg className="btn-icon" viewBox="0 0 20 20" fill="currentColor">
              <path
                fillRule="evenodd"
                d="M10 3a1 1 0 011 1v5h5a1 1 0 110 2h-5v5a1 1 0 11-2 0v-5H4a1 1 0 110-2h5V4a1 1 0 011-1z"
                clipRule="evenodd"
              />
            </svg>
            <span>Add Staff Member</span>
          </button>
        </div>
      </div>

      {/* Error Alert inside container if present */}
      {error && (
        <div className="table-error-banner" role="alert" style={{ margin: '16px 20px 0' }}>
          <svg className="alert-icon text-rose" viewBox="0 0 20 20" fill="currentColor">
            <path
              fillRule="evenodd"
              d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7 4a1 1 0 11-2 0 1 1 0 012 0zm-1-9a1 1 0 00-1 1v4a1 1 0 102 0V6a1 1 0 00-1-1z"
              clipRule="evenodd"
            />
          </svg>
          <span>{error}</span>
        </div>
      )}

      {/* Responsive Table */}
      <div className="table-responsive-wrapper">
        <table className="cards-table" aria-label="Staff accounts list">
          <thead>
            <tr>
              <th scope="col">Username</th>
              <th scope="col">Account Status</th>
              <th scope="col">Created Date</th>
              <th scope="col">Last Login</th>
              <th scope="col" className="text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan="5" className="table-empty-cell">
                  <div className="loading-row">
                    <svg className="btn-icon spin" viewBox="0 0 20 20" fill="currentColor">
                      <path
                        fillRule="evenodd"
                        d="M4 2a1 1 0 011 1v2.101a7.002 7.002 0 0111.601 2.566 1 1 0 11-1.885.666A5.002 5.002 0 005.999 7H9a1 1 0 010 2H4a1 1 0 01-1-1V3a1 1 0 011-1zm.008 9.057a1 1 0 011.276.61A5.002 5.002 0 0014.001 13H11a1 1 0 110-2h5a1 1 0 011 1v5a1 1 0 11-2 0v-2.101a7.002 7.002 0 01-11.601-2.566 1 1 0 01.61-1.276z"
                        clipRule="evenodd"
                      />
                    </svg>
                    <span>Loading staff accounts...</span>
                  </div>
                </td>
              </tr>
            ) : staffList.length === 0 ? (
              <tr>
                <td colSpan="5" className="table-empty-cell">
                  <div className="empty-state-box">
                    <p className="empty-title">No staff accounts found</p>
                    <p className="empty-subtitle">
                      Create staff accounts to grant team members access to provision and manage smart cards.
                    </p>
                    <button
                      type="button"
                      className="action-btn action-btn-primary"
                      onClick={onCreateStaff}
                      style={{ marginTop: '12px' }}
                    >
                      <svg className="btn-icon" viewBox="0 0 20 20" fill="currentColor">
                        <path
                          fillRule="evenodd"
                          d="M10 3a1 1 0 011 1v5h5a1 1 0 110 2h-5v5a1 1 0 11-2 0v-5H4a1 1 0 110-2h5V4a1 1 0 011-1z"
                          clipRule="evenodd"
                        />
                      </svg>
                      <span>Create First Staff Account</span>
                    </button>
                  </div>
                </td>
              </tr>
            ) : (
              staffList.map((member) => {
                const effectiveStatus = getStaffStatus(member)
                const isRemoved = effectiveStatus === 'removed'
                const isActive = effectiveStatus === 'active'
                const formattedLastLogin = formatDate(member.last_login_at)

                return (
                  <tr key={member.id}>
                    <td>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <span className="card-number-tag" style={{ color: 'var(--color-text-main)' }}>
                          @{member.username}
                        </span>
                      </div>
                    </td>
                    <td>
                      {isRemoved ? (
                        <span className="status-pill status-removed">Removed</span>
                      ) : isActive ? (
                        <span className="status-pill status-active">Active</span>
                      ) : (
                        <span className="status-pill status-disabled">Disabled</span>
                      )}
                    </td>
                    <td>
                      <span className="text-dim" style={{ fontSize: '13px' }}>
                        {formatDate(member.created_at) || '—'}
                      </span>
                    </td>
                    <td>
                      {formattedLastLogin ? (
                        <span style={{ fontSize: '13px' }}>{formattedLastLogin}</span>
                      ) : (
                        <span className="text-dim" style={{ fontSize: '13px' }}>
                          Never logged in
                        </span>
                      )}
                    </td>
                    <td className="text-right">
                      {isRemoved ? (
                        <span className="text-dim" style={{ fontSize: '12.5px', fontStyle: 'italic' }}>
                          Permanently removed
                        </span>
                      ) : (
                        <div className="row-actions">
                          {isActive ? (
                            <button
                              type="button"
                              className="btn-row btn-row-deactivate"
                              onClick={() => onAction(member, 'deactivate')}
                              title="Deactivate staff account"
                            >
                              Deactivate
                            </button>
                          ) : (
                            <>
                              <button
                                type="button"
                                className="btn-row btn-row-activate"
                                onClick={() => onAction(member, 'activate')}
                                title="Activate staff account"
                              >
                                Activate
                              </button>
                              <button
                                type="button"
                                className="btn-row btn-row-remove"
                                onClick={() => onAction(member, 'remove')}
                                title="Permanently remove staff account"
                              >
                                Remove
                              </button>
                            </>
                          )}
                        </div>
                      )}
                    </td>
                  </tr>
                )
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}

