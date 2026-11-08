import { useState } from 'react'
import { getPublicCardUrl, copyPublicCardUrl } from '../../utils/public-url'
import { CARD_TYPE_FILTER_OPTIONS, getCardTypeBadge } from '../../utils/card-workflow'

export function CardsTable({
  cards,
  totalCount,
  rawCount,
  currentPage,
  totalPages,
  loading,
  error,
  statusFilter,
  onStatusFilterChange,
  typeFilter,
  onTypeFilterChange,
  searchQuery,
  onSearchChange,
  sortBy,
  onSortChange,
  onPageChange,
  onViewCard,
  onEditCard,
  onLifecycleAction,
  onRefresh,
  onCreateCard,
  onScanCard,
  isMainAdmin,
}) {
  const [copiedToken, setCopiedToken] = useState(null)
  const [copyError, setCopyError] = useState(null)

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

  const handleCopyUrl = async (token) => {
    setCopyError(null)
    const result = await copyPublicCardUrl(token)
    if (result.success) {
      setCopiedToken(token)
      setTimeout(() => {
        setCopiedToken((prev) => (prev === token ? null : prev))
      }, 2000)
    } else {
      setCopyError(result.error || 'Failed to copy URL.')
      setTimeout(() => {
        setCopyError(null)
      }, 3500)
    }
  }

  // Main Admin sees Archived filter; Staff only sees standard active/inactive filters
  const filterOptions = [
    { label: 'All', value: '' },
    { label: 'Active', value: 'active' },
    { label: 'Inactive', value: 'inactive' },
    ...(isMainAdmin ? [{ label: 'Archived', value: 'archived' }] : []),
  ]

  const hasSearch = Boolean(searchQuery && searchQuery.trim())
  const hasFilter = Boolean(statusFilter)
  const hasTypeFilter = Boolean(typeFilter)
  const typeOption = CARD_TYPE_FILTER_OPTIONS.find((o) => o.value === typeFilter)
  const typeLabel = typeOption ? typeOption.label : 'Selected Type'

  return (
    <div className="cards-table-container">
      {/* Header Bar */}
      <div className="table-header-bar">
        <div className="table-title-group">
          <h2 className="table-title">Managed Cards</h2>
          <span className="table-count-badge">
            {totalCount ?? 0} {totalCount === 1 ? 'card' : 'cards'}
            {rawCount > 0 && totalCount !== rawCount && ` (filtered from ${rawCount})`}
          </span>
        </div>
        <div className="table-actions-group">
          <button
            type="button"
            className="action-btn action-btn-secondary"
            onClick={onRefresh}
            disabled={loading}
            title="Refresh card list"
            aria-label="Refresh card list"
          >
            <svg
              className={`btn-icon ${loading ? 'spin' : ''}`}
              viewBox="0 0 20 20"
              fill="currentColor"
              aria-hidden="true"
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
            aria-label="Scan card QR"
          >
            <svg
              className="btn-icon"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
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
            aria-label="Create new card"
          >
            <svg className="btn-icon" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
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

      {/* Copy Failure Toast/Alert */}
      {copyError && (
        <div className="table-copy-error-toast" role="alert">
          <span>{copyError}</span>
          <button
            type="button"
            className="modal-close-btn"
            onClick={() => setCopyError(null)}
            aria-label="Dismiss error"
          >
            ✕
          </button>
        </div>
      )}

      {/* Prominent Search & Sort Toolbar */}
      <div className="inventory-toolbar">
        {/* Search Field */}
        <div className="search-input-wrap">
          <svg className="search-icon" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
            <path
              fillRule="evenodd"
              d="M8 4a4 4 0 100 8 4 4 0 000-8zM2 8a6 6 0 1110.89 3.476l4.817 4.817a1 1 0 01-1.414 1.414l-4.816-4.816A6 6 0 012 8z"
              clipRule="evenodd"
            />
          </svg>
          <input
            type="text"
            className="search-input"
            placeholder="Search by business name, location, or card #..."
            value={searchQuery}
            onChange={(e) => onSearchChange(e.target.value)}
            aria-label="Search card inventory by business name, location, or card number"
          />
          {hasSearch && (
            <button
              type="button"
              className="search-clear-btn"
              onClick={() => onSearchChange('')}
              aria-label="Clear search query"
              title="Clear search"
            >
              ✕
            </button>
          )}
        </div>

        {/* Toolbar Controls Group: Card Type & Sort */}
        <div className="toolbar-controls-group">
          {/* Card Type Filter Select */}
          <div className="type-filter-select-wrap">
            <label htmlFor="inventory-type-select" className="filter-select-label">
              Type:
            </label>
            <select
              id="inventory-type-select"
              className="type-filter-select"
              value={typeFilter}
              onChange={(e) => onTypeFilterChange(e.target.value)}
              aria-label="Filter cards by card type"
            >
              {CARD_TYPE_FILTER_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </div>

          {/* Sort Select */}
          <div className="sort-select-wrap">
            <label htmlFor="inventory-sort-select" className="sort-label">
              Sort by:
            </label>
            <select
              id="inventory-sort-select"
              className="sort-select"
              value={sortBy}
              onChange={(e) => onSortChange(e.target.value)}
              aria-label="Sort inventory cards"
            >
              <option value="created_desc">Created Date (Newest first)</option>
              <option value="created_asc">Created Date (Oldest first)</option>
              <option value="name_asc">Business Name (A to Z)</option>
              <option value="name_desc">Business Name (Z to A)</option>
              <option value="number_asc">Card Number (Low to High)</option>
              <option value="number_desc">Card Number (High to Low)</option>
            </select>
          </div>
        </div>
      </div>

      {/* Filter Tabs Bar */}
      <div className="table-filter-bar">
        <span className="filter-label">Filter Status:</span>
        <div className="filter-tabs" role="tablist" aria-label="Card status filters">
          {filterOptions.map((opt) => (
            <button
              key={opt.value}
              type="button"
              role="tab"
              aria-selected={statusFilter === opt.value}
              className={`filter-tab-btn ${statusFilter === opt.value ? 'active' : ''}`}
              onClick={() => onStatusFilterChange(opt.value)}
              disabled={loading}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      {/* Error State */}
      {error && (
        <div className="table-error-banner" role="alert">
          <svg className="alert-icon" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
            <path
              fillRule="evenodd"
              d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7 4a1 1 0 11-2 0 1 1 0 012 0zm-1-9a1 1 0 00-1 1v4a1 1 0 102 0V6a1 1 0 00-1-1z"
              clipRule="evenodd"
            />
          </svg>
          <span>{error}</span>
          <button
            type="button"
            className="link-button ml-auto"
            onClick={onRefresh}
          >
            Try Again
          </button>
        </div>
      )}

      {/* Loading Skeleton / Spinner */}
      {loading && cards.length === 0 && (
        <div className="table-loading-container" role="status">
          <span className="spinner-icon" />
          <span className="table-loading-text">Loading managed cards...</span>
        </div>
      )}

      {/* Empty States */}
      {!loading && cards.length === 0 && (
        <div className="table-empty-container">
          {hasSearch || hasTypeFilter ? (
            <div className="empty-state-box">
              <div className="empty-icon-wrap" aria-hidden="true">
                <svg className="w-8 h-8 text-muted" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                  <circle cx="11" cy="11" r="8" />
                  <line x1="21" y1="21" x2="16.65" y2="16.65" />
                </svg>
              </div>
              <h3 className="empty-title">
                {hasSearch && hasTypeFilter
                  ? `No ${typeLabel} cards matching "${searchQuery}"`
                  : hasSearch
                  ? `No cards matching "${searchQuery}"`
                  : `No ${typeLabel} cards found`}
              </h3>
              <p className="empty-subtitle">
                No business cards match your current criteria. Try adjusting your search query or card type filter.
              </p>
              <div className="empty-actions-row">
                {hasSearch && (
                  <button
                    type="button"
                    className="action-btn action-btn-secondary"
                    onClick={() => onSearchChange('')}
                  >
                    Clear Search Filter
                  </button>
                )}
                {hasTypeFilter && (
                  <button
                    type="button"
                    className="action-btn action-btn-secondary"
                    onClick={() => onTypeFilterChange('')}
                  >
                    Clear Type Filter
                  </button>
                )}
              </div>
            </div>
          ) : hasFilter ? (
            <div className="empty-state-box">
              <h3 className="empty-title">No {statusFilter} cards found</h3>
              <p className="empty-subtitle">
                There are no cards matching the "{statusFilter}" status filter.
              </p>
              <button
                type="button"
                className="action-btn action-btn-secondary"
                onClick={() => onStatusFilterChange('')}
              >
                Show All Cards
              </button>
            </div>
          ) : (
            <div className="empty-state-box">
              <h3 className="empty-title">No business cards provisioned yet</h3>
              <p className="empty-subtitle">
                Get started by provisioning your first TapMe smart business card or by scanning a preprinted physical card.
              </p>
              <button
                type="button"
                className="action-btn action-btn-primary"
                onClick={onCreateCard}
              >
                + Create New Card
              </button>
            </div>
          )}
        </div>
      )}

      {/* Desktop Table Layout (>= 768px) */}
      {!loading && cards.length > 0 && (
        <div className="table-responsive-wrapper cards-desktop-view">
          <table className="cards-table">
            <thead>
              <tr>
                <th scope="col" style={{ width: '80px' }}>Card #</th>
                <th scope="col">Business Name</th>
                <th scope="col">Location</th>
                <th scope="col" style={{ minWidth: '220px' }}>Public Card URL</th>
                <th scope="col" style={{ width: '100px' }}>Created</th>
                <th scope="col" style={{ width: '90px' }}>Status</th>
                <th scope="col" style={{ width: '90px' }}>Scans</th>
                <th scope="col" className="text-right" style={{ minWidth: '180px' }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {cards.map((card) => {
                const isArchived = card.status === 'archived'
                const isActive = card.status === 'active'
                const isInactive = card.status === 'inactive'
                const publicUrl = getPublicCardUrl(card.public_token)
                const isCopied = copiedToken === card.public_token
                const typeBadge = getCardTypeBadge(card)

                return (
                  <tr key={card.card_number} className={isArchived ? 'row-archived' : ''}>
                    {/* Card Number */}
                    <td>
                      <span className="card-number-tag">
                        {card.formatted_card_number || `#${String(card.card_number).padStart(3, '0')}`}
                      </span>
                    </td>

                    {/* Business Name & Card Type Badge */}
                    <td className="business-name-cell">
                      <div className="business-name-group">
                        <button
                          type="button"
                          className="business-name-interactive"
                          onClick={() => onViewCard(card.card_number)}
                          title={`View details for ${card.business_name}`}
                          aria-label={`View details for ${card.business_name}`}
                        >
                          {card.business_name}
                        </button>
                        <span
                          className={`card-type-badge ${typeBadge.badgeClass}`}
                          title={`Card Type: ${typeBadge.label}`}
                        >
                          {typeBadge.label}
                        </span>
                      </div>
                    </td>

                    {/* Location (Truncated single line with tooltip) */}
                    <td className="location-cell">
                      {card.location ? (
                        <span
                          className="location-text"
                          title={card.location}
                        >
                          {card.location}
                        </span>
                      ) : (
                        <span
                          className="location-empty"
                          title="No location specified"
                        >
                          No location specified
                        </span>
                      )}
                    </td>

                    {/* Public Card URL & One-Tap Copy */}
                    <td className="public-url-cell">
                      <div className="url-copy-container">
                        <span className="url-text-display" title={publicUrl}>
                          {publicUrl.replace(/^https?:\/\//, '')}
                        </span>
                        <button
                          type="button"
                          className={`btn-copy-url ${isCopied ? 'copied' : ''}`}
                          onClick={() => handleCopyUrl(card.public_token)}
                          aria-label={`Copy public URL for ${card.business_name}`}
                          title={isCopied ? 'Copied to clipboard!' : 'Copy public redirect URL'}
                        >
                          {isCopied ? (
                            <>
                              <svg className="w-3.5 h-3.5 text-emerald" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
                                <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                              </svg>
                              <span className="copy-label">Copied!</span>
                            </>
                          ) : (
                            <>
                              <svg className="w-3.5 h-3.5" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
                                <path d="M8 3a1 1 0 011-1h2a1 1 0 110 2H9a1 1 0 01-1-1z" />
                                <path d="M6 3a2 2 0 00-2 2v11a2 2 0 002 2h8a2 2 0 002-2V5a2 2 0 00-2-2 3 3 0 01-3 2H9a3 3 0 01-3-2z" />
                              </svg>
                              <span className="copy-label">Copy</span>
                            </>
                          )}
                        </button>
                      </div>
                    </td>

                    {/* Created Date */}
                    <td>
                      <span className="text-muted text-sm">{formatDate(card.created_at)}</span>
                    </td>

                    {/* Status Pill */}
                    <td>
                      <span className={`status-pill status-${card.status}`}>
                        {card.status}
                      </span>
                    </td>

                    {/* Total Scans */}
                    <td>
                      <span className="scan-count-badge" title="Total customer scans">
                        {card.total_scans ?? 0}
                      </span>
                    </td>

                    {/* Actions */}
                    <td className="text-right">
                      <div className="row-actions">
                        <button
                          type="button"
                          className="btn-row btn-row-view"
                          onClick={() => onViewCard(card.card_number)}
                          title="View details"
                          aria-label={`View details for card #${card.card_number}`}
                        >
                          View
                        </button>

                        {!isArchived && (isMainAdmin || !card.is_configured) && (
                          <button
                            type="button"
                            className={`btn-row ${isMainAdmin ? 'btn-row-edit' : 'btn-row-configure'}`}
                            onClick={() => onEditCard(card.card_number)}
                            title={isMainAdmin ? 'Edit card' : 'Configure card'}
                            aria-label={`${isMainAdmin ? 'Edit' : 'Configure'} card #${card.card_number}`}
                          >
                            {isMainAdmin ? 'Edit' : 'Configure'}
                          </button>
                        )}

                        {isMainAdmin && (
                          <>
                            {isActive && (
                              <button
                                type="button"
                                className="btn-row btn-row-deactivate"
                                onClick={() => onLifecycleAction(card, 'deactivate')}
                                title="Deactivate card"
                                aria-label={`Deactivate card #${card.card_number}`}
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
                                aria-label={`Activate card #${card.card_number}`}
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
                                aria-label={`Archive card #${card.card_number}`}
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
                                aria-label={`Restore card #${card.card_number}`}
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
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Mobile Stacked Record Cards Layout (< 768px) */}
      {!loading && cards.length > 0 && (
        <div className="cards-mobile-list" role="list" aria-label="Card inventory mobile records">
          {cards.map((card) => {
            const isArchived = card.status === 'archived'
            const isActive = card.status === 'active'
            const isInactive = card.status === 'inactive'
            const publicUrl = getPublicCardUrl(card.public_token)
            const isCopied = copiedToken === card.public_token
            const typeBadge = getCardTypeBadge(card)

            return (
              <div
                key={card.card_number}
                className={`card-record-card ${isArchived ? 'record-archived' : ''}`}
                role="listitem"
              >
                {/* Header Row: Card #, Card Type Badge, Status, Scans */}
                <div className="card-record-header">
                  <div className="card-record-badges">
                    <span className="card-number-tag">
                      {card.formatted_card_number || `#${String(card.card_number).padStart(3, '0')}`}
                    </span>
                    <span
                      className={`card-type-badge ${typeBadge.badgeClass}`}
                      title={`Card Type: ${typeBadge.label}`}
                    >
                      {typeBadge.label}
                    </span>
                    <span className={`status-pill status-${card.status}`}>
                      {card.status}
                    </span>
                  </div>
                  <span className="scan-count-badge" title="Total Scans">
                    {card.total_scans ?? 0} scans
                  </span>
                </div>

                {/* Body: Business Name & Location - Clickable to Open Card Details */}
                <div className="card-record-body">
                  <button
                    type="button"
                    className="mobile-details-trigger-btn"
                    onClick={() => onViewCard(card.card_number)}
                    title={`View details for ${card.business_name}`}
                    aria-label={`View details for ${card.business_name}`}
                  >
                    <h3 className="card-record-name business-name-interactive">
                      {card.business_name}
                    </h3>
                    <div className="card-record-location-row">
                      <span
                        className={`card-record-location ${card.location ? '' : 'location-empty'}`}
                        title={card.location || 'No location specified'}
                      >
                        {card.location ? `📍 ${card.location}` : 'No location specified'}
                      </span>
                      <span className="card-record-date">
                        Created {formatDate(card.created_at)}
                      </span>
                    </div>
                  </button>

                  {/* Public URL One-Tap Copy Row */}
                  <div className="mobile-url-bar">
                    <div className="mobile-url-display" title={publicUrl}>
                      <span className="mobile-url-prefix">Redirect URL:</span>
                      <span className="mobile-url-text">{publicUrl.replace(/^https?:\/\//, '')}</span>
                    </div>
                    <button
                      type="button"
                      className={`btn-copy-url btn-copy-mobile ${isCopied ? 'copied' : ''}`}
                      onClick={() => handleCopyUrl(card.public_token)}
                      aria-label={`Copy public redirect URL for ${card.business_name}`}
                      title={isCopied ? 'Copied to clipboard!' : 'Copy public URL'}
                    >
                      {isCopied ? (
                        <>
                          <svg className="w-4 h-4 text-emerald" viewBox="0 0 20 20" fill="currentColor">
                            <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                          </svg>
                          <span>Copied!</span>
                        </>
                      ) : (
                        <>
                          <svg className="w-4 h-4" viewBox="0 0 20 20" fill="currentColor">
                            <path d="M8 3a1 1 0 011-1h2a1 1 0 110 2H9a1 1 0 01-1-1z" />
                            <path d="M6 3a2 2 0 00-2 2v11a2 2 0 002 2h8a2 2 0 002-2V5a2 2 0 00-2-2 3 3 0 01-3 2H9a3 3 0 01-3-2z" />
                          </svg>
                          <span>Copy URL</span>
                        </>
                      )}
                    </button>
                  </div>
                </div>

                {/* Footer Action Buttons */}
                <div className="card-record-actions">
                  <button
                    type="button"
                    className="btn-row btn-row-view"
                    onClick={() => onViewCard(card.card_number)}
                    aria-label={`View details for card #${card.card_number}`}
                  >
                    View
                  </button>

                  {!isArchived && (isMainAdmin || !card.is_configured) && (
                    <button
                      type="button"
                      className={`btn-row ${isMainAdmin ? 'btn-row-edit' : 'btn-row-configure'}`}
                      onClick={() => onEditCard(card.card_number)}
                      aria-label={`${isMainAdmin ? 'Edit' : 'Configure'} card #${card.card_number}`}
                    >
                      {isMainAdmin ? 'Edit' : 'Configure'}
                    </button>
                  )}

                  {isMainAdmin && (
                    <>
                      {isActive && (
                        <button
                          type="button"
                          className="btn-row btn-row-deactivate"
                          onClick={() => onLifecycleAction(card, 'deactivate')}
                          aria-label={`Deactivate card #${card.card_number}`}
                        >
                          Deactivate
                        </button>
                      )}

                      {isInactive && (
                        <button
                          type="button"
                          className="btn-row btn-row-activate"
                          onClick={() => onLifecycleAction(card, 'activate')}
                          aria-label={`Activate card #${card.card_number}`}
                        >
                          Activate
                        </button>
                      )}

                      {!isArchived && (
                        <button
                          type="button"
                          className="btn-row btn-row-archive"
                          onClick={() => onLifecycleAction(card, 'archive')}
                          aria-label={`Archive card #${card.card_number}`}
                        >
                          Archive
                        </button>
                      )}

                      {isArchived && (
                        <button
                          type="button"
                          className="btn-row btn-row-restore"
                          onClick={() => onLifecycleAction(card, 'restore')}
                          aria-label={`Restore card #${card.card_number}`}
                        >
                          Restore
                        </button>
                      )}
                    </>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* Pagination Footer */}
      {!loading && totalPages > 1 && (
        <div className="table-pagination">
          <div className="pagination-info">
            Showing page <strong>{currentPage}</strong> of <strong>{totalPages}</strong>{' '}
            ({totalCount} {totalCount === 1 ? 'record' : 'records'})
          </div>
          <div className="pagination-controls">
            <button
              type="button"
              className="action-btn action-btn-secondary btn-sm"
              onClick={() => onPageChange(currentPage - 1)}
              disabled={currentPage <= 1 || loading}
              aria-label="Previous page"
            >
              Previous
            </button>
            <button
              type="button"
              className="action-btn action-btn-secondary btn-sm"
              onClick={() => onPageChange(currentPage + 1)}
              disabled={currentPage >= totalPages || loading}
              aria-label="Next page"
            >
              Next
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
