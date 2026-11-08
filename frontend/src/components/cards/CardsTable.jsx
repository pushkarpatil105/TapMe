export function CardsTable({
  cards,
  pagination,
  loading,
  error,
  statusFilter,
  onStatusFilterChange,
  onPageChange,
  onViewCard,
  onEditCard,
  onLifecycleAction,
  onRefresh,
  onCreateCard,
  onScanCard,
  isMainAdmin,
}) {
  const formatDate = (dateStr) => {
    if (!dateStr) return '—'
    try {
      const d = new Date(dateStr)
      return d.toLocaleDateString(undefined, {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
      })
    } catch {
      return dateStr
    }
  }

  // Main Admin sees Archived filter; Staff only sees standard filters
  const filterOptions = [
    { label: 'All', value: '' },
    { label: 'Active', value: 'active' },
    { label: 'Inactive', value: 'inactive' },
    ...(isMainAdmin ? [{ label: 'Archived', value: 'archived' }] : []),
  ]

  return (
    <div className="cards-table-container">
      {/* Header Bar */}
      <div className="table-header-bar">
        <div className="table-title-group">
          <h2 className="table-title">Managed Cards</h2>
          <span className="table-count-badge">
            {pagination?.total ?? 0} {pagination?.total === 1 ? 'card' : 'cards'}
          </span>
        </div>
        <div className="table-actions-group">
          <button
            type="button"
            className="action-btn action-btn-secondary"
            onClick={onRefresh}
            disabled={loading}
            title="Refresh card list"
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
            className="action-btn action-btn-secondary"
            onClick={onScanCard}
            title="Scan QR card from camera, image, or manual entry"
          >
            <svg
              className="btn-icon"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <rect x="3" y="3" width="7" height="7" />
              <rect x="14" y="3" width="7" height="7" />
              <rect x="14" y="14" width="7" height="7" />
              <rect x="3" y="14" width="7" height="7" />
            </svg>
            <span>Scan Card</span>
          </button>
          <button
            type="button"
            className="action-btn action-btn-primary"
            onClick={onCreateCard}
          >
            <svg className="btn-icon" viewBox="0 0 20 20" fill="currentColor">
              <path
                fillRule="evenodd"
                d="M10 3a1 1 0 011 1v5h5a1 1 0 110 2h-5v5a1 1 0 11-2 0v-5H4a1 1 0 110-2h5V4a1 1 0 011-1z"
                clipRule="evenodd"
              />
            </svg>
            <span>Create New Card</span>
          </button>
        </div>
      </div>

      {/* Filter Tabs Bar */}
      <div className="table-filter-bar">
        <span className="filter-label">Filter:</span>
        <div className="filter-tabs">
          {filterOptions.map((opt) => (
            <button
              key={opt.value}
              type="button"
              className={`filter-tab-btn ${statusFilter === opt.value ? 'active' : ''}`}
              onClick={() => onStatusFilterChange(opt.value)}
              disabled={loading}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      {/* Error state */}
      {error && (
        <div className="table-error-banner" role="alert">
          <svg className="alert-icon" viewBox="0 0 20 20" fill="currentColor">
            <path
              fillRule="evenodd"
              d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7 4a1 1 0 11-2 0 1 1 0 012 0zm-1-9a1 1 0 00-1 1v4a1 1 0 102 0V6a1 1 0 00-1-1z"
              clipRule="evenodd"
            />
          </svg>
          <span>{error}</span>
          <button
            type="button"
            className="link-button"
            onClick={onRefresh}
            style={{ marginLeft: 'auto' }}
          >
            Try Again
          </button>
        </div>
      )}

      {/* Table Content */}
      <div className="table-responsive-wrapper">
        <table className="cards-table">
          <thead>
            <tr>
              <th scope="col">Card #</th>
              <th scope="col">Business Name</th>
              <th scope="col">Location</th>
              <th scope="col">Total Scans</th>
              <th scope="col">Created Date</th>
              <th scope="col">Status</th>
              <th scope="col" className="text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {loading && cards.length === 0 ? (
              <tr>
                <td colSpan="7" className="table-empty-cell">
                  <div className="loading-row">
                    <span className="spinner-icon" />
                    <span>Loading cards...</span>
                  </div>
                </td>
              </tr>
            ) : cards.length === 0 ? (
              <tr>
                <td colSpan="7" className="table-empty-cell">
                  <div className="empty-state-box">
                    <p className="empty-title">
                      {statusFilter ? `No ${statusFilter} cards found` : 'No cards found'}
                    </p>
                    <p className="empty-subtitle">
                      {statusFilter
                        ? 'Try changing the status filter above.'
                        : 'Provision your first TapMe smart business card above.'}
                    </p>
                  </div>
                </td>
              </tr>
            ) : (
              cards.map((card) => {
                const isArchived = card.status === 'archived'
                const isActive = card.status === 'active'
                const isInactive = card.status === 'inactive'

                return (
                  <tr key={card.card_number} className={isArchived ? 'row-archived' : ''}>
                    <td>
                      <span className="card-number-tag">
                        {card.formatted_card_number || String(card.card_number).padStart(3, '0')}
                      </span>
                    </td>
                    <td className="font-semibold text-main">{card.business_name}</td>
                    <td className="text-muted">{card.location || '—'}</td>
                    <td>
                      <span className="scan-count-badge">
                        {card.total_scans ?? 0}
                      </span>
                    </td>
                    <td className="text-muted text-sm">{formatDate(card.created_at)}</td>
                    <td>
                      <span className={`status-pill status-${card.status}`}>
                        {card.status}
                      </span>
                    </td>
                    <td className="text-right">
                      <div className="row-actions">
                        <button
                          type="button"
                          className="btn-row btn-row-view"
                          onClick={() => onViewCard(card.card_number)}
                          title="View details"
                        >
                          View
                        </button>

                        {/* Edit for Main Admin on non-archived cards; Configure for Staff on unconfigured cards */}
                        {!isArchived && (isMainAdmin || !card.is_configured) && (
                          <button
                            type="button"
                            className={`btn-row ${isMainAdmin ? 'btn-row-edit' : 'btn-row-configure'}`}
                            onClick={() => onEditCard(card.card_number)}
                            title={isMainAdmin ? 'Edit card' : 'Configure card'}
                          >
                            {isMainAdmin ? 'Edit' : 'Configure'}
                          </button>
                        )}

                        {/* Lifecycle controls: Main Admin only */}
                        {isMainAdmin && (
                          <>
                            {isActive && (
                              <button
                                type="button"
                                className="btn-row btn-row-deactivate"
                                onClick={() => onLifecycleAction(card, 'deactivate')}
                                title="Deactivate card"
                              >
                                Deactivate
                              </button>
                            )}

                            {isInactive && (
                              <button
                                type="button"
                                className="btn-row btn-row-activate"
                                onClick={() => onLifecycleAction(card, 'activate')}
                                title="Activate card"
                              >
                                Activate
                              </button>
                            )}

                            {!isArchived && (
                              <button
                                type="button"
                                className="btn-row btn-row-archive"
                                onClick={() => onLifecycleAction(card, 'archive')}
                                title="Archive card"
                              >
                                Archive
                              </button>
                            )}

                            {isArchived && (
                              <button
                                type="button"
                                className="btn-row btn-row-restore"
                                onClick={() => onLifecycleAction(card, 'restore')}
                                title="Restore card"
                              >
                                Restore
                              </button>
                            )}
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                )
              })
            )}
          </tbody>
        </table>
      </div>

      {/* Pagination Footer */}
      {pagination && pagination.total_pages > 1 && (
        <div className="table-pagination">
          <div className="pagination-info">
            Showing page <strong>{pagination.page}</strong> of{' '}
            <strong>{pagination.total_pages}</strong> ({pagination.total} total)
          </div>
          <div className="pagination-controls">
            <button
              type="button"
              className="action-btn action-btn-secondary btn-sm"
              onClick={() => onPageChange(pagination.page - 1)}
              disabled={pagination.page <= 1 || loading}
            >
              Previous
            </button>
            <button
              type="button"
              className="action-btn action-btn-secondary btn-sm"
              onClick={() => onPageChange(pagination.page + 1)}
              disabled={pagination.page >= pagination.total_pages || loading}
            >
              Next
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
