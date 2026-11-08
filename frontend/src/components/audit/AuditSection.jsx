import { useState, useEffect, useCallback } from 'react'
import { useAuth } from '../../context'
import { AuditTable } from './AuditTable'
import { AuditDetailsModal } from './AuditDetailsModal'
import { AUDIT_ACTIONS, buildAuditQueryString } from '../../utils/audit-workflow'

export function AuditSection() {
  const { logout } = useAuth()

  // Data state
  const [logs, setLogs] = useState([])
  const [pagination, setPagination] = useState({
    page: 1,
    limit: 20,
    total: 0,
    total_pages: 1,
  })
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  // Filters state
  const [searchInput, setSearchInput] = useState('')
  const [activeSearch, setActiveSearch] = useState('')
  const [selectedAction, setSelectedAction] = useState('')
  const [startDate, setStartDate] = useState('')
  const [endDate, setEndDate] = useState('')

  // Modal state
  const [selectedLog, setSelectedLog] = useState(null)

  const fetchAuditLogs = useCallback(
    async (pageToLoad = 1, filters = {}) => {
      try {
        setLoading(true)
        setError(null)

        const queryStr = buildAuditQueryString({
          page: pageToLoad,
          limit: 20,
          action: filters.action !== undefined ? filters.action : selectedAction,
          search: filters.search !== undefined ? filters.search : activeSearch,
          startDate: filters.startDate !== undefined ? filters.startDate : startDate,
          endDate: filters.endDate !== undefined ? filters.endDate : endDate,
        })

        const response = await fetch(`/api/audit-logs${queryStr}`, {
          method: 'GET',
          credentials: 'include',
          headers: {
            Accept: 'application/json',
          },
        })

        if (response.status === 401) {
          await logout()
          return
        }

        if (response.status === 403) {
          setError('Access denied. Audit logs require Main Administrator authorization.')
          setLogs([])
          return
        }

        const json = await response.json().catch(() => null)

        if (response.ok && json?.success && json?.data) {
          setLogs(json.data.logs || [])
          setPagination(
            json.data.pagination || {
              page: pageToLoad,
              limit: 20,
              total: 0,
              total_pages: 1,
            }
          )
        } else {
          setError(json?.error || 'Failed to retrieve audit logs.')
        }
      } catch (err) {
        console.error('Audit fetch error:', err)
        setError('Network error while retrieving audit logs. Please check your connection.')
      } finally {
        setLoading(false)
      }
    },
    [logout, selectedAction, activeSearch, startDate, endDate]
  )

  // Initial load
  useEffect(() => {
    let isMounted = true

    fetch('/api/audit-logs?page=1&limit=20', {
      method: 'GET',
      credentials: 'include',
      headers: {
        Accept: 'application/json',
      },
    })
      .then((res) => {
        if (res.status === 401) {
          logout()
          return null
        }
        if (res.status === 403) {
          if (isMounted) {
            setError('Access denied. Audit logs require Main Administrator authorization.')
            setLogs([])
          }
          return null
        }
        return res.ok ? res.json() : null
      })
      .then((json) => {
        if (!isMounted || !json) return
        if (json.success && json.data) {
          setLogs(json.data.logs || [])
          setPagination(
            json.data.pagination || {
              page: 1,
              limit: 20,
              total: 0,
              total_pages: 1,
            }
          )
        } else {
          setError(json?.error || 'Failed to retrieve audit logs.')
        }
      })
      .catch((err) => {
        if (isMounted) {
          console.error('Audit fetch error:', err)
          setError('Network error while retrieving audit logs. Please check your connection.')
        }
      })
      .finally(() => {
        if (isMounted) {
          setLoading(false)
        }
      })

    return () => {
      isMounted = false
    }
  }, [logout])

  // Handle Search Submission
  const handleSearchSubmit = (e) => {
    e.preventDefault()
    const trimmed = searchInput.trim()
    setActiveSearch(trimmed)
    fetchAuditLogs(1, { search: trimmed })
  }

  // Handle Action Filter Change
  const handleActionChange = (actionValue) => {
    setSelectedAction(actionValue)
    fetchAuditLogs(1, { action: actionValue })
  }

  // Handle Date Filter Change
  const handleApplyDates = () => {
    fetchAuditLogs(1)
  }

  // Handle Reset Filters
  const handleResetFilters = () => {
    setSearchInput('')
    setActiveSearch('')
    setSelectedAction('')
    setStartDate('')
    setEndDate('')
    fetchAuditLogs(1, {
      search: '',
      action: '',
      startDate: '',
      endDate: '',
    })
  }

  const isFilterActive = Boolean(
    activeSearch || selectedAction || startDate || endDate
  )

  return (
    <section className="audit-section" aria-label="Audit Logs Section">
      {/* Top Header & Overview */}
      <div className="section-header-row mb-4">
        <div>
          <h2 className="section-title text-xl font-bold flex items-center gap-2" style={{ color: 'var(--color-text-main)' }}>
            <span>Audit History</span>
            <span className="timezone-pill">Asia/Kolkata (IST)</span>
          </h2>
          <p className="section-subtitle text-xs mt-0.5" style={{ color: 'var(--color-text-muted)' }}>
            Append-only audit trail recording card creation, configuration, status lifecycle changes, and staff operations.
          </p>
        </div>

        <div className="section-actions flex items-center gap-2">
          <button
            type="button"
            className="action-btn action-btn-secondary text-xs"
            onClick={() => fetchAuditLogs(pagination.page)}
            disabled={loading}
            title="Refresh audit records"
          >
            <svg
              className={`btn-icon ${loading ? 'animate-spin' : ''}`}
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
        </div>
      </div>

      {/* Filter & Search Bar */}
      <div className="audit-filter-card mb-4">
        <form onSubmit={handleSearchSubmit} className="audit-filter-form">
          {/* Search Input */}
          <div className="filter-group filter-search-wrap">
            <label htmlFor="audit-search" className="filter-label">
              Search
            </label>
            <div className="relative flex items-center">
              <input
                id="audit-search"
                type="text"
                className="form-input filter-search-input"
                placeholder="Card #, business name, or actor..."
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
              />
              <button
                type="submit"
                className="search-submit-btn"
                title="Search audit records"
              >
                🔍
              </button>
            </div>
          </div>

          {/* Action Filter Dropdown */}
          <div className="filter-group filter-action-wrap">
            <label htmlFor="audit-action" className="filter-label">
              Action Type
            </label>
            <select
              id="audit-action"
              className="form-input form-select"
              value={selectedAction}
              onChange={(e) => handleActionChange(e.target.value)}
            >
              {AUDIT_ACTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </div>

          {/* Date Range: Start Date */}
          <div className="filter-group filter-date-wrap">
            <label htmlFor="audit-start-date" className="filter-label">
              From (Date)
            </label>
            <input
              id="audit-start-date"
              type="date"
              className="form-input"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
            />
          </div>

          {/* Date Range: End Date */}
          <div className="filter-group filter-date-wrap">
            <label htmlFor="audit-end-date" className="filter-label">
              To (Date)
            </label>
            <input
              id="audit-end-date"
              type="date"
              className="form-input"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
            />
          </div>

          {/* Filter Actions */}
          <div className="filter-buttons-wrap">
            <button
              type="button"
              className="action-btn action-btn-primary text-xs"
              onClick={handleApplyDates}
              disabled={loading}
            >
              Apply Filter
            </button>
            {isFilterActive && (
              <button
                type="button"
                className="action-btn action-btn-secondary text-xs"
                onClick={handleResetFilters}
                disabled={loading}
              >
                Reset
              </button>
            )}
          </div>
        </form>
      </div>

      {/* Main Audit Records Table */}
      <AuditTable
        logs={logs}
        loading={loading}
        error={error}
        onViewDetails={(log) => setSelectedLog(log)}
        onRetry={() => fetchAuditLogs(pagination.page)}
      />

      {/* Pagination Controls */}
      {!loading && !error && pagination.total > 0 && (
        <div className="pagination-bar mt-4">
          <div className="pagination-info text-xs" style={{ color: 'var(--color-text-muted)' }}>
            Showing{' '}
            <strong style={{ color: 'var(--color-text-main)' }}>
              {(pagination.page - 1) * pagination.limit + 1}
            </strong>{' '}
            to{' '}
            <strong style={{ color: 'var(--color-text-main)' }}>
              {Math.min(pagination.page * pagination.limit, pagination.total)}
            </strong>{' '}
            of <strong style={{ color: 'var(--color-text-main)' }}>{pagination.total}</strong> records
          </div>

          <div className="pagination-actions flex items-center gap-1.5">
            <button
              type="button"
              className="pagination-btn"
              disabled={pagination.page <= 1}
              onClick={() => fetchAuditLogs(pagination.page - 1)}
            >
              ← Previous
            </button>

            <span className="pagination-page-indicator text-xs font-mono px-2 text-slate-300">
              Page {pagination.page} of {pagination.total_pages}
            </span>

            <button
              type="button"
              className="pagination-btn"
              disabled={pagination.page >= pagination.total_pages}
              onClick={() => fetchAuditLogs(pagination.page + 1)}
            >
              Next →
            </button>
          </div>
        </div>
      )}

      {/* Detailed Event Inspection Modal */}
      {selectedLog && (
        <AuditDetailsModal
          log={selectedLog}
          onClose={() => setSelectedLog(null)}
        />
      )}
    </section>
  )
}

