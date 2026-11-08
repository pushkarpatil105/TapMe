import { useState, useEffect, useCallback } from 'react'
import { useAuth } from '../../context'
import {
  formatSystemDateTime,
  downloadFile,
  generateAuditPdfReport,
} from '../../utils/system-management'

const AUDIT_ACTION_OPTIONS = [
  { value: '', label: 'All Action Types' },
  { value: 'card.created', label: 'card.created — Card Created' },
  { value: 'card.configured', label: 'card.configured — Links Configured' },
  { value: 'card.updated', label: 'card.updated — Card Modified' },
  { value: 'card.activated', label: 'card.activated — Card Activated' },
  { value: 'card.deactivated', label: 'card.deactivated — Card Deactivated' },
  { value: 'card.archived', label: 'card.archived — Card Archived' },
  { value: 'card.restored', label: 'card.restored — Card Restored' },
  { value: 'staff.created', label: 'staff.created — Staff Created' },
  { value: 'staff.activated', label: 'staff.activated — Staff Activated' },
  { value: 'staff.deactivated', label: 'staff.deactivated — Staff Deactivated' },
  { value: 'staff.removed', label: 'staff.removed — Staff Removed' },
  { value: 'audit.cleanup', label: 'audit.cleanup — Audit Retention Executed' },
  { value: 'scan.cleanup', label: 'scan.cleanup — Scan Retention Executed' },
]

export function StorageSection() {
  const { user, logout } = useAuth()
  const [storageData, setStorageData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [successMessage, setSuccessMessage] = useState(null)

  // --- Audit Export State ---
  const [exportAuditScope, setExportAuditScope] = useState('all')
  const [exportAuditStartDate, setExportAuditStartDate] = useState('')
  const [exportAuditEndDate, setExportAuditEndDate] = useState('')
  const [exportAuditAction, setExportAuditAction] = useState('')
  const [isExportingAudit, setIsExportingAudit] = useState(false)

  // --- Scan Export State ---
  const [exportScanScope, setExportScanScope] = useState('all')
  const [exportScanStartDate, setExportScanStartDate] = useState('')
  const [exportScanEndDate, setExportScanEndDate] = useState('')
  const [isExportingScans, setIsExportingScans] = useState(false)

  // --- Audit Cleanup State ---
  const [auditCutoffOption, setAuditCutoffOption] = useState('30d')
  const [customAuditDate, setCustomAuditDate] = useState('')
  const [auditPreview, setAuditPreview] = useState(null)
  const [isPreviewingAudit, setIsPreviewingAudit] = useState(false)
  const [auditConfirmText, setAuditConfirmText] = useState('')
  const [isDeletingAudit, setIsDeletingAudit] = useState(false)

  // --- Scan Cleanup State ---
  const [scanCutoffOption, setScanCutoffOption] = useState('30d')
  const [customScanDate, setCustomScanDate] = useState('')
  const [scanPreview, setScanPreview] = useState(null)
  const [isPreviewingScan, setIsPreviewingScan] = useState(false)
  const [scanConfirmText, setScanConfirmText] = useState('')
  const [isDeletingScan, setIsDeletingScan] = useState(false)

  const fetchStorage = useCallback(async () => {
    try {
      setLoading(true)
      setError(null)

      const response = await fetch('/api/system/storage', {
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
        setError('Access denied. Storage management requires Main Administrator authorization.')
        return
      }

      const json = await response.json().catch(() => null)
      if (response.ok && json?.success && json?.data) {
        setStorageData(json.data)
      } else {
        setError(json?.error || 'Failed to retrieve database storage metrics.')
      }
    } catch (err) {
      console.error('Storage fetch error:', err)
      setError('Network error while retrieving storage metrics.')
    } finally {
      setLoading(false)
    }
  }, [logout])

  useEffect(() => {
    let isMounted = true

    fetch('/api/system/storage', {
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
            setError('Access denied. Storage management requires Main Administrator authorization.')
          }
          return null
        }
        return res.ok ? res.json() : null
      })
      .then((json) => {
        if (!isMounted || !json) return
        if (json.success && json.data) {
          setStorageData(json.data)
        } else {
          setError(json?.error || 'Failed to retrieve storage metrics.')
        }
      })
      .catch((err) => {
        if (isMounted) {
          console.error('Storage fetch error:', err)
          setError('Network error while loading storage metrics.')
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

  // Helper to calculate ISO cutoff for retention & exports
  const calculateCutoffIso = (option, customDate) => {
    if (option === 'custom' && customDate) {
      return new Date(customDate).toISOString()
    }
    const days = option === '1d' ? 1 : option === '7d' ? 7 : 30
    const d = new Date()
    d.setDate(d.getDate() - days)
    return d.toISOString()
  }

  // --- Audit Logs Export Handler ---
  const handleExportAudit = async (format) => {
    try {
      setIsExportingAudit(true)
      const params = new URLSearchParams()
      params.set('format', format)

      if (exportAuditScope === '1d' || exportAuditScope === '7d' || exportAuditScope === '30d') {
        params.set('cutoff', calculateCutoffIso(exportAuditScope))
      } else if (exportAuditScope === 'custom') {
        if (exportAuditStartDate) params.set('startDate', exportAuditStartDate)
        if (exportAuditEndDate) params.set('endDate', exportAuditEndDate)
      }

      if (exportAuditAction) {
        params.set('action', exportAuditAction)
      }

      const res = await fetch(`/api/system/export/audit-logs?${params.toString()}`, {
        credentials: 'include',
      })

      if (!res.ok) {
        const errJson = await res.json().catch(() => null)
        throw new Error(errJson?.error || 'Export failed')
      }

      const blob = await res.blob()
      const ext = format === 'csv' ? 'csv' : 'json'
      const mime = format === 'csv' ? 'text/csv' : 'application/json'
      downloadFile(blob, `tapme-audit-logs-${Date.now()}.${ext}`, mime)
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to generate audit export.')
    } finally {
      setIsExportingAudit(false)
    }
  }

  const handlePrintAuditPdf = async () => {
    try {
      setIsExportingAudit(true)
      const params = new URLSearchParams()
      params.set('format', 'json')

      if (exportAuditScope === '1d' || exportAuditScope === '7d' || exportAuditScope === '30d') {
        params.set('cutoff', calculateCutoffIso(exportAuditScope))
      } else if (exportAuditScope === 'custom') {
        if (exportAuditStartDate) params.set('startDate', exportAuditStartDate)
        if (exportAuditEndDate) params.set('endDate', exportAuditEndDate)
      }

      if (exportAuditAction) {
        params.set('action', exportAuditAction)
      }

      const res = await fetch(`/api/system/export/audit-logs?${params.toString()}`, {
        credentials: 'include',
      })

      if (!res.ok) throw new Error('PDF data fetch failed')
      const json = await res.json()
      if (json.logs) {
        generateAuditPdfReport(json.logs, {
          scope: exportAuditScope,
          action: exportAuditAction || 'all',
          startDate: exportAuditStartDate || null,
          endDate: exportAuditEndDate || null,
        })
      }
    } catch {
      alert('Failed to generate printable PDF report.')
    } finally {
      setIsExportingAudit(false)
    }
  }

  // --- Scan Events Export Handler ---
  const handleExportScans = async (format) => {
    try {
      setIsExportingScans(true)
      const params = new URLSearchParams()
      params.set('format', format)

      if (exportScanScope === '1d' || exportScanScope === '7d' || exportScanScope === '30d') {
        params.set('cutoff', calculateCutoffIso(exportScanScope))
      } else if (exportScanScope === 'custom') {
        if (exportScanStartDate) params.set('startDate', exportScanStartDate)
        if (exportScanEndDate) params.set('endDate', exportScanEndDate)
      }

      const res = await fetch(`/api/system/export/scans?${params.toString()}`, {
        credentials: 'include',
      })

      if (!res.ok) {
        const errJson = await res.json().catch(() => null)
        throw new Error(errJson?.error || 'Export failed')
      }

      const blob = await res.blob()
      const ext = format === 'csv' ? 'csv' : 'json'
      const mime = format === 'csv' ? 'text/csv' : 'application/json'
      downloadFile(blob, `tapme-scan-events-${Date.now()}.${ext}`, mime)
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to generate scan events export.')
    } finally {
      setIsExportingScans(false)
    }
  }

  // --- Audit Cleanup Preview & Execution ---
  const handlePreviewAuditCleanup = async () => {
    try {
      setIsPreviewingAudit(true)
      const cutoff = calculateCutoffIso(auditCutoffOption, customAuditDate)
      const res = await fetch(`/api/system/cleanup/audit/preview?cutoff=${encodeURIComponent(cutoff)}`, {
        credentials: 'include',
      })
      const json = await res.json()
      if (res.ok && json.success) {
        setAuditPreview(json.data)
        setAuditConfirmText('')
      } else {
        alert(json.error || 'Failed to preview audit cleanup.')
      }
    } catch {
      alert('Network error while previewing cleanup.')
    } finally {
      setIsPreviewingAudit(false)
    }
  }

  const handleExecuteAuditCleanup = async () => {
    if (!auditPreview) return
    if (auditConfirmText !== 'CONFIRM DELETE') {
      alert('Please type "CONFIRM DELETE" to confirm.')
      return
    }

    try {
      setIsDeletingAudit(true)
      const res = await fetch('/api/system/cleanup/audit', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          cutoff: auditPreview.cutoff,
          confirmed: true,
        }),
      })
      const json = await res.json()
      if (res.ok && json.success) {
        const actorName = user?.username || 'Main Admin'
        const timeNow = formatSystemDateTime(new Date().toISOString())
        setSuccessMessage(
          `Audit cleanup successful: Deleted ${json.data.deleted_count} records older than ${formatSystemDateTime(auditPreview.cutoff)} by ${actorName} at ${timeNow}. Remaining records: ${json.data.remaining_count}.`
        )
        setAuditPreview(null)
        await fetchStorage()
      } else {
        alert(json.error || 'Audit cleanup failed.')
      }
    } catch {
      alert('Network error during audit cleanup.')
    } finally {
      setIsDeletingAudit(false)
    }
  }

  // --- Scan Events Cleanup Preview & Execution ---
  const handlePreviewScanCleanup = async () => {
    try {
      setIsPreviewingScan(true)
      const cutoff = calculateCutoffIso(scanCutoffOption, customScanDate)
      const res = await fetch(`/api/system/cleanup/scans/preview?cutoff=${encodeURIComponent(cutoff)}`, {
        credentials: 'include',
      })
      const json = await res.json()
      if (res.ok && json.success) {
        setScanPreview(json.data)
        setScanConfirmText('')
      } else {
        alert(json.error || 'Failed to preview scan cleanup.')
      }
    } catch {
      alert('Network error while previewing scan cleanup.')
    } finally {
      setIsPreviewingScan(false)
    }
  }

  const handleExecuteScanCleanup = async () => {
    if (!scanPreview) return
    if (scanConfirmText !== 'CONFIRM DELETE') {
      alert('Please type "CONFIRM DELETE" to confirm.')
      return
    }

    try {
      setIsDeletingScan(true)
      const res = await fetch('/api/system/cleanup/scans', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          cutoff: scanPreview.cutoff,
          confirmed: true,
        }),
      })
      const json = await res.json()
      if (res.ok && json.success) {
        const actorName = user?.username || 'Main Admin'
        const timeNow = formatSystemDateTime(new Date().toISOString())
        setSuccessMessage(
          `Scan events cleanup successful: Deleted ${json.data.deleted_count} records older than ${formatSystemDateTime(scanPreview.cutoff)} by ${actorName} at ${timeNow}. Remaining scans: ${json.data.remaining_count}.`
        )
        setScanPreview(null)
        await fetchStorage()
      } else {
        alert(json.error || 'Scan cleanup failed.')
      }
    } catch {
      alert('Network error during scan cleanup.')
    } finally {
      setIsDeletingScan(false)
    }
  }

  return (
    <section className="storage-section" aria-label="Storage Management Section">
      {/* Header Block */}
      <div className="section-header-block">
        <div className="section-header-titles">
          <div className="section-title-wrap">
            <h2 className="section-main-title">Database Storage & Retention</h2>
            <span className="timezone-pill">Asia/Kolkata (IST)</span>
          </div>
          <p className="section-desc">
            D1 persistent database storage metrics, independent structured data exports (CSV, JSON, PDF), and controlled retention management.
          </p>
        </div>

        <div className="section-actions-wrap">
          <button
            type="button"
            className="action-btn action-btn-secondary"
            onClick={fetchStorage}
            disabled={loading}
          >
            {loading ? 'Refreshing...' : 'Refresh Storage'}
          </button>
        </div>
      </div>

      {error && (
        <div className="table-error-banner">
          <p className="table-error-text">{error}</p>
        </div>
      )}

      {successMessage && (
        <div className="operation-success-banner">
          <span>{successMessage}</span>
          <button
            type="button"
            className="banner-close-btn"
            onClick={() => setSuccessMessage(null)}
            aria-label="Dismiss banner"
          >
            ✕
          </button>
        </div>
      )}

      {loading && !storageData ? (
        <div className="table-card" style={{ padding: '48px', textAlign: 'center' }}>
          <span className="spinner-icon" />
          <span style={{ color: 'var(--color-text-muted)', fontWeight: 600, marginLeft: '12px' }}>
            Calculating database storage consumption...
          </span>
        </div>
      ) : (
        storageData && (
          <>
            {/* Storage Metric Cards (Requirement 4) */}
            <div className="metrics-grid">
              <div className="metric-card metric-card-purple">
                <div className="metric-header">
                  <span className="metric-label">Audit Logs</span>
                  <span className="metric-tag metric-tag-purple">
                    {storageData.formatted_payload_sizes.audit_logs}
                  </span>
                </div>
                <div className="metric-value-huge">
                  {storageData.counts.audit_logs.toLocaleString()} records
                </div>
                <div className="metric-subtext">
                  Append-only card creation, configuration, status changes, and staff operations.
                </div>
              </div>

              <div className="metric-card metric-card-sky">
                <div className="metric-header">
                  <span className="metric-label">Scan Events</span>
                  <span className="metric-tag metric-tag-sky">
                    {storageData.formatted_payload_sizes.scan_events}
                  </span>
                </div>
                <div className="metric-value-huge">
                  {storageData.counts.scan_events.toLocaleString()} records
                </div>
                <div className="metric-subtext">
                  Customer card visit timestamps, user agents, and referrers.
                </div>
              </div>

              <div className="metric-card metric-card-emerald">
                <div className="metric-header">
                  <span className="metric-label">Cards & Links</span>
                  <span className="metric-tag metric-tag-emerald">
                    {storageData.formatted_payload_sizes.cards}
                  </span>
                </div>
                <div className="metric-value-huge">
                  {storageData.counts.cards} cards / {storageData.counts.card_links} links
                </div>
                <div className="metric-subtext">
                  Smart cards, destination links, QR configurations, and assigned tokens. Permanent records.
                </div>
              </div>

              <div className="metric-card metric-card-amber">
                <div className="metric-header">
                  <span className="metric-label">Measured Payload</span>
                  <span className="metric-tag metric-tag-amber">Free Tier</span>
                </div>
                <div className="metric-value-huge" style={{ color: 'var(--color-amber)' }}>
                  {storageData.formatted_payload_sizes.total_measured}
                </div>
                <div className="metric-subtext">
                  Cloudflare D1 Free Tier Quota: <strong>500 MB</strong>.
                </div>
              </div>
            </div>

            {/* Storage Architecture & PRAGMA Notice (Requirement 4 & 5: Fixed Icon) */}
            <div className="storage-notice-banner">
              <div className="storage-notice-header">
                <svg
                  className="info-svg-icon"
                  width="18"
                  height="18"
                  viewBox="0 0 20 20"
                  fill="currentColor"
                  aria-hidden="true"
                  style={{ width: '18px', height: '18px', minWidth: '18px', minHeight: '18px', maxWidth: '18px', maxHeight: '18px', flexShrink: 0 }}
                >
                  <path
                    fillRule="evenodd"
                    d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z"
                    clipRule="evenodd"
                  />
                </svg>
                <span>Storage Architecture & Cloudflare D1 Measurement Rules</span>
              </div>
              <div className="storage-notice-body">
                <p>
                  <strong>Exact Measured Figures:</strong> Row counts are determined via <code>COUNT(*)</code> and raw payload byte sizes are computed by summing the string length of all table columns.
                </p>
                <p>
                  <strong>Unmeasurable Physical Storage:</strong> Cloudflare D1 strictly blocks SQLite <code>PRAGMA page_count</code> and <code>PRAGMA page_size</code> queries (returning <code>not authorized: SQLITE_AUTH</code>). Physical B-tree page allocation, fragmentation, and OS-level file storage are managed exclusively by Cloudflare infrastructure.
                </p>
                <p style={{ color: 'var(--color-amber)' }}>
                  <strong>Freelist Space vs Physical File Shrinkage:</strong> Deleting database rows moves SQLite pages to the database internal freelist for reuse by future row insertions; it does not automatically reduce physical file size on disk without an explicit <code>VACUUM</code> operation.
                </p>
                <p style={{ color: 'var(--color-text-muted)' }}>
                  <strong>Disk Storage vs Worker Ephemeral RAM:</strong> D1 persistent database storage and Cloudflare Worker ephemeral RAM (128 MB) are entirely separate resources. Cleanup operations free database capacity, but do not alter Worker RAM.
                </p>
              </div>
            </div>

            {/* =========================================================================
                SECTION 1: STRUCTURED DATA EXPORT (Requirement 2)
                Two Clearly Separated Cards: Audit Logs Export & Scan Events Export
                ========================================================================= */}
            <div className="export-section-container">
              {/* Card 1A: Audit Logs Export */}
              <div className="section-group-card">
                <div className="section-group-header">
                  <div className="section-group-titles">
                    <h3 className="section-group-title">
                      <span style={{ color: '#c084fc' }}>●</span>
                      <span>Audit Logs Export</span>
                    </h3>
                    <p className="section-group-desc">
                      Export administrative and operational audit trail records. Preserves original UTC timestamps, adds human-readable IST timestamps, actor details, formatted card numbers (#006), and business names.
                    </p>
                  </div>
                  <span className="format-badge-primary">Primary Format: CSV</span>
                </div>

                {/* Scope Selection Toolbar */}
                <div className="scope-selector-row">
                  <span className="scope-label">Scope:</span>
                  {[
                    { id: 'all', label: 'All Retained Records' },
                    { id: '1d', label: 'Older than 1 Day' },
                    { id: '7d', label: 'Older than 7 Days' },
                    { id: '30d', label: 'Older than 30 Days' },
                    { id: 'custom', label: 'Custom Date Range' },
                  ].map((scope) => (
                    <button
                      key={scope.id}
                      type="button"
                      className={`scope-pill-btn ${exportAuditScope === scope.id ? 'active-purple' : ''}`}
                      onClick={() => setExportAuditScope(scope.id)}
                    >
                      {scope.label}
                    </button>
                  ))}
                </div>

                {/* Custom Date Range & Action Filter */}
                <div className="filter-row-secondary">
                  {exportAuditScope === 'custom' && (
                    <>
                      <div className="filter-input-inline">
                        <label className="filter-input-label">From Date:</label>
                        <input
                          type="date"
                          className="form-input"
                          style={{ padding: '6px 10px', fontSize: '13px' }}
                          value={exportAuditStartDate}
                          onChange={(e) => setExportAuditStartDate(e.target.value)}
                        />
                      </div>
                      <div className="filter-input-inline">
                        <label className="filter-input-label">To Date:</label>
                        <input
                          type="date"
                          className="form-input"
                          style={{ padding: '6px 10px', fontSize: '13px' }}
                          value={exportAuditEndDate}
                          onChange={(e) => setExportAuditEndDate(e.target.value)}
                        />
                      </div>
                    </>
                  )}

                  <div className="filter-input-inline">
                    <label className="filter-input-label">Action Filter:</label>
                    <select
                      className="form-input"
                      style={{ padding: '6px 10px', fontSize: '13px' }}
                      value={exportAuditAction}
                      onChange={(e) => setExportAuditAction(e.target.value)}
                    >
                      {AUDIT_ACTION_OPTIONS.map((opt) => (
                        <option key={opt.value} value={opt.value}>
                          {opt.label}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                {/* Download Actions Area */}
                <div className="actions-download-area">
                  <button
                    type="button"
                    className="btn-download-primary"
                    onClick={() => handleExportAudit('csv')}
                    disabled={isExportingAudit}
                  >
                    <span>📊</span>
                    <span>{isExportingAudit ? 'Generating CSV...' : 'Download CSV (Excel / Sheets)'}</span>
                  </button>

                  <button
                    type="button"
                    className="btn-download-secondary"
                    onClick={() => handleExportAudit('json')}
                    disabled={isExportingAudit}
                  >
                    <span>📦</span>
                    <span>Download JSON</span>
                  </button>

                  <button
                    type="button"
                    className="btn-download-secondary"
                    onClick={handlePrintAuditPdf}
                    disabled={isExportingAudit}
                    title="Opens browser print preview for saving as PDF"
                  >
                    <span>📄</span>
                    <span>Print / Save as PDF</span>
                  </button>

                  <span className="download-format-notice">
                    CSV is the primary structured export for spreadsheets. PDF uses browser print/save.
                  </span>
                </div>
              </div>

              {/* Card 1B: Scan Events Export */}
              <div className="section-group-card">
                <div className="section-group-header">
                  <div className="section-group-titles">
                    <h3 className="section-group-title">
                      <span style={{ color: '#38bdf8' }}>●</span>
                      <span>Customer Scan Events Export</span>
                    </h3>
                    <p className="section-group-desc">
                      Export customer QR tap and NFC scan visits. Includes UTC and IST scan timestamps, formatted card numbers (#006), browser user-agents, and referrers.
                    </p>
                  </div>
                  <span className="format-badge-primary">Primary Format: CSV</span>
                </div>

                {/* Scope Selection Toolbar */}
                <div className="scope-selector-row">
                  <span className="scope-label">Scope:</span>
                  {[
                    { id: 'all', label: 'All Retained Records' },
                    { id: '1d', label: 'Older than 1 Day' },
                    { id: '7d', label: 'Older than 7 Days' },
                    { id: '30d', label: 'Older than 30 Days' },
                    { id: 'custom', label: 'Custom Date Range' },
                  ].map((scope) => (
                    <button
                      key={scope.id}
                      type="button"
                      className={`scope-pill-btn ${exportScanScope === scope.id ? 'active-sky' : ''}`}
                      onClick={() => setExportScanScope(scope.id)}
                    >
                      {scope.label}
                    </button>
                  ))}
                </div>

                {/* Custom Date Range */}
                {exportScanScope === 'custom' && (
                  <div className="filter-row-secondary">
                    <div className="filter-input-inline">
                      <label className="filter-input-label">From Date:</label>
                      <input
                        type="date"
                        className="form-input"
                        style={{ padding: '6px 10px', fontSize: '13px' }}
                        value={exportScanStartDate}
                        onChange={(e) => setExportScanStartDate(e.target.value)}
                      />
                    </div>
                    <div className="filter-input-inline">
                      <label className="filter-input-label">To Date:</label>
                      <input
                        type="date"
                        className="form-input"
                        style={{ padding: '6px 10px', fontSize: '13px' }}
                        value={exportScanEndDate}
                        onChange={(e) => setExportScanEndDate(e.target.value)}
                      />
                    </div>
                  </div>
                )}

                {/* Download Actions Area */}
                <div className="actions-download-area">
                  <button
                    type="button"
                    className="btn-download-primary"
                    onClick={() => handleExportScans('csv')}
                    disabled={isExportingScans}
                  >
                    <span>📊</span>
                    <span>{isExportingScans ? 'Generating CSV...' : 'Download CSV (Excel / Sheets)'}</span>
                  </button>

                  <button
                    type="button"
                    className="btn-download-secondary"
                    onClick={() => handleExportScans('json')}
                    disabled={isExportingScans}
                  >
                    <span>📦</span>
                    <span>Download JSON</span>
                  </button>

                  <span className="download-format-notice">
                    Formatted for Microsoft Excel and Google Sheets with RFC 4180 escaping.
                  </span>
                </div>
              </div>
            </div>

            {/* =========================================================================
                SECTION 2: CONTROLLED RETENTION & DELETION (Requirement 3)
                Visually Distinct with Warning Borders and Dedicated Sub-Panels
                ========================================================================= */}
            <div className="retention-section-container">
              <div className="retention-panel">
                <div className="retention-panel-header">
                  <div className="retention-panel-titles">
                    <h3 className="retention-panel-title">
                      <span>🛡️</span>
                      <span>Controlled Retention & Data Deletion</span>
                    </h3>
                    <p className="retention-panel-desc">
                      Safely prune historical logs or customer scan events older than a specified cutoff. Prior export is recommended but <strong>not mandatory</strong>. Physical smart cards, assigned tokens, destination links, staff accounts, and sessions are permanent and never deleted.
                    </p>
                  </div>
                  <span className="severity-badge severity-badge-error">MAIN ADMIN ONLY</span>
                </div>

                {/* Sub-Panel 2A: Audit Logs Retention */}
                <div style={{ background: 'var(--color-surface-secondary)', border: '1px solid var(--color-card-border)', borderRadius: 'var(--radius-sm)', padding: '16px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '8px' }}>
                    <h4 style={{ fontSize: '13px', fontWeight: 700, color: 'var(--color-text-main)', textTransform: 'uppercase', letterSpacing: '0.6px', margin: 0 }}>
                      Audit Logs Retention
                    </h4>
                    <span style={{ fontSize: '12px', color: 'var(--color-text-dim)' }}>
                      Deletion operations are atomically audited and preserved.
                    </span>
                  </div>

                  <div className="retention-controls-row">
                    <span className="scope-label">Cutoff:</span>
                    {['1d', '7d', '30d', 'custom'].map((opt) => (
                      <button
                        key={opt}
                        type="button"
                        className={`scope-pill-btn ${auditCutoffOption === opt ? 'active-purple' : ''}`}
                        onClick={() => setAuditCutoffOption(opt)}
                      >
                        {opt === '1d' ? 'Older than 1 Day' : opt === '7d' ? 'Older than 7 Days' : opt === '30d' ? 'Older than 30 Days' : 'Custom Cutoff'}
                      </button>
                    ))}

                    {auditCutoffOption === 'custom' && (
                      <input
                        type="date"
                        className="form-input"
                        style={{ padding: '6px 10px', fontSize: '13px' }}
                        value={customAuditDate}
                        onChange={(e) => setCustomAuditDate(e.target.value)}
                      />
                    )}

                    <button
                      type="button"
                      className="btn-preview-cleanup"
                      onClick={handlePreviewAuditCleanup}
                      disabled={isPreviewingAudit}
                    >
                      <span>🔍</span>
                      <span>{isPreviewingAudit ? 'Calculating...' : 'Preview Audit Cleanup'}</span>
                    </button>
                  </div>
                </div>

                {/* Sub-Panel 2B: Scan Events Retention */}
                <div style={{ background: 'var(--color-surface-secondary)', border: '1px solid var(--color-card-border)', borderRadius: 'var(--radius-sm)', padding: '16px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '8px' }}>
                    <h4 style={{ fontSize: '13px', fontWeight: 700, color: 'var(--color-text-main)', textTransform: 'uppercase', letterSpacing: '0.6px', margin: 0 }}>
                      Scan Events Retention
                    </h4>
                    <span style={{ fontSize: '12px', color: 'var(--color-text-dim)' }}>
                      Deletes visitor timestamps only. Card configurations and redirect URLs remain intact.
                    </span>
                  </div>

                  <div className="retention-controls-row">
                    <span className="scope-label">Cutoff:</span>
                    {['1d', '7d', '30d', 'custom'].map((opt) => (
                      <button
                        key={opt}
                        type="button"
                        className={`scope-pill-btn ${scanCutoffOption === opt ? 'active-sky' : ''}`}
                        onClick={() => setScanCutoffOption(opt)}
                      >
                        {opt === '1d' ? 'Older than 1 Day' : opt === '7d' ? 'Older than 7 Days' : opt === '30d' ? 'Older than 30 Days' : 'Custom Cutoff'}
                      </button>
                    ))}

                    {scanCutoffOption === 'custom' && (
                      <input
                        type="date"
                        className="form-input"
                        style={{ padding: '6px 10px', fontSize: '13px' }}
                        value={customScanDate}
                        onChange={(e) => setCustomScanDate(e.target.value)}
                      />
                    )}

                    <button
                      type="button"
                      className="btn-preview-cleanup btn-preview-cleanup-sky"
                      onClick={handlePreviewScanCleanup}
                      disabled={isPreviewingScan}
                    >
                      <span>🔍</span>
                      <span>{isPreviewingScan ? 'Calculating...' : 'Preview Scan Cleanup'}</span>
                    </button>
                  </div>
                </div>
              </div>
            </div>

            {/* Modal for Audit Deletion Confirmation (Requirement 3: Improved Layout) */}
            {auditPreview && (
              <div className="modal-backdrop">
                <div className="modal-container" style={{ maxWidth: '600px' }} role="dialog" aria-modal="true">
                  <div className="modal-header">
                    <div>
                      <h3 className="modal-title" style={{ color: 'var(--color-rose)' }}>
                        Confirm Audit Log Retention Cleanup
                      </h3>
                      <p style={{ fontSize: '12.5px', color: 'var(--color-text-muted)', margin: 0 }}>
                        Irreversible historical record deletion sequence.
                      </p>
                    </div>
                    <button
                      type="button"
                      className="modal-close-btn"
                      onClick={() => setAuditPreview(null)}
                    >
                      ✕
                    </button>
                  </div>

                  <div className="modal-body" style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                    <div style={{ padding: '12px 14px', background: 'var(--color-rose-bg)', border: '1px solid var(--color-rose-border)', borderRadius: 'var(--radius-sm)', fontSize: '12.5px', color: 'var(--color-rose)', lineHeight: 1.5 }}>
                      <strong>Warning:</strong> Deleting historical records cannot be undone. Cards, destination links, staff accounts, and sessions are permanent and completely safe from cleanup operations.
                    </div>

                    {/* Comparison Stats Box */}
                    <div className="preview-stats-container">
                      <div className="preview-stat-box preview-stat-danger">
                        <span className="preview-stat-label">Eligible for Deletion</span>
                        <span className="preview-stat-num">
                          {auditPreview.records_to_delete.toLocaleString()}
                        </span>
                      </div>
                      <div className="preview-stat-box preview-stat-safe">
                        <span className="preview-stat-label">Records That Will Remain</span>
                        <span className="preview-stat-num">
                          {auditPreview.records_to_retain.toLocaleString()}
                        </span>
                      </div>
                    </div>

                    <div className="details-grid-clean">
                      <div className="details-cell">
                        <span className="details-cell-label">Cutoff Timestamp (IST)</span>
                        <span className="details-cell-val">
                          {formatSystemDateTime(auditPreview.cutoff)}
                        </span>
                      </div>
                      <div className="details-cell">
                        <span className="details-cell-label">Date Range Affected</span>
                        <span className="details-cell-val" style={{ fontSize: '11.5px' }}>
                          {auditPreview.oldest_affected_record
                            ? `${formatSystemDateTime(auditPreview.oldest_affected_record)} → ${formatSystemDateTime(auditPreview.newest_affected_record)}`
                            : 'None'}
                        </span>
                      </div>
                    </div>

                    <div className="confirm-input-box">
                      <label style={{ fontSize: '12.5px', fontWeight: 600, color: 'var(--color-text-main)' }}>
                        To confirm deletion, type <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--color-rose)', fontWeight: 800 }}>CONFIRM DELETE</span> below:
                      </label>
                      <input
                        type="text"
                        className="form-input"
                        placeholder="Type CONFIRM DELETE"
                        value={auditConfirmText}
                        onChange={(e) => setAuditConfirmText(e.target.value)}
                      />
                      <p style={{ fontSize: '11.5px', color: 'var(--color-text-dim)', margin: 0 }}>
                        Cleanup actions are atomically logged in the audit trail and survive this deletion operation.
                      </p>
                    </div>
                  </div>

                  <div className="modal-footer" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <button
                      type="button"
                      className="action-btn action-btn-secondary"
                      onClick={() => setAuditPreview(null)}
                    >
                      Cancel
                    </button>
                    <button
                      type="button"
                      className="btn-danger-execute"
                      disabled={auditConfirmText !== 'CONFIRM DELETE' || isDeletingAudit}
                      onClick={handleExecuteAuditCleanup}
                    >
                      {isDeletingAudit ? 'Executing Deletion...' : 'Execute Audit Deletion'}
                    </button>
                  </div>
                </div>
              </div>
            )}

            {/* Modal for Scan Deletion Confirmation (Requirement 3: Improved Layout) */}
            {scanPreview && (
              <div className="modal-backdrop">
                <div className="modal-container" style={{ maxWidth: '600px' }} role="dialog" aria-modal="true">
                  <div className="modal-header">
                    <div>
                      <h3 className="modal-title" style={{ color: 'var(--color-rose)' }}>
                        Confirm Scan Events Retention Cleanup
                      </h3>
                      <p style={{ fontSize: '12.5px', color: 'var(--color-text-muted)', margin: 0 }}>
                        Irreversible customer scan record cleanup.
                      </p>
                    </div>
                    <button
                      type="button"
                      className="modal-close-btn"
                      onClick={() => setScanPreview(null)}
                    >
                      ✕
                    </button>
                  </div>

                  <div className="modal-body" style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                    <div style={{ padding: '12px 14px', background: 'var(--color-rose-bg)', border: '1px solid var(--color-rose-border)', borderRadius: 'var(--radius-sm)', fontSize: '12.5px', color: 'var(--color-rose)', lineHeight: 1.5 }}>
                      <strong>Notice:</strong> This deletes historical visitor scan timestamps. Physical smart card configurations, public tokens, and redirect destinations are permanent and will not be altered.
                    </div>

                    {/* Comparison Stats Box */}
                    <div className="preview-stats-container">
                      <div className="preview-stat-box preview-stat-danger">
                        <span className="preview-stat-label">Scans Eligible for Deletion</span>
                        <span className="preview-stat-num">
                          {scanPreview.records_to_delete.toLocaleString()}
                        </span>
                      </div>
                      <div className="preview-stat-box preview-stat-safe">
                        <span className="preview-stat-label">Scans That Will Remain</span>
                        <span className="preview-stat-num">
                          {scanPreview.records_to_retain.toLocaleString()}
                        </span>
                      </div>
                    </div>

                    <div className="details-grid-clean">
                      <div className="details-cell">
                        <span className="details-cell-label">Cutoff Timestamp (IST)</span>
                        <span className="details-cell-val">
                          {formatSystemDateTime(scanPreview.cutoff)}
                        </span>
                      </div>
                      <div className="details-cell">
                        <span className="details-cell-label">Date Range Affected</span>
                        <span className="details-cell-val" style={{ fontSize: '11.5px' }}>
                          {scanPreview.oldest_affected_record
                            ? `${formatSystemDateTime(scanPreview.oldest_affected_record)} → ${formatSystemDateTime(scanPreview.newest_affected_record)}`
                            : 'None'}
                        </span>
                      </div>
                    </div>

                    <div className="confirm-input-box">
                      <label style={{ fontSize: '12.5px', fontWeight: 600, color: 'var(--color-text-main)' }}>
                        To confirm deletion, type <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--color-rose)', fontWeight: 800 }}>CONFIRM DELETE</span> below:
                      </label>
                      <input
                        type="text"
                        className="form-input"
                        placeholder="Type CONFIRM DELETE"
                        value={scanConfirmText}
                        onChange={(e) => setScanConfirmText(e.target.value)}
                      />
                      <p style={{ fontSize: '11.5px', color: 'var(--color-text-dim)', margin: 0 }}>
                        Scan cleanup is atomically audited in the main audit log.
                      </p>
                    </div>
                  </div>

                  <div className="modal-footer" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <button
                      type="button"
                      className="action-btn action-btn-secondary"
                      onClick={() => setScanPreview(null)}
                    >
                      Cancel
                    </button>
                    <button
                      type="button"
                      className="btn-danger-execute"
                      disabled={scanConfirmText !== 'CONFIRM DELETE' || isDeletingScan}
                      onClick={handleExecuteScanCleanup}
                    >
                      {isDeletingScan ? 'Executing Deletion...' : 'Execute Scan Deletion'}
                    </button>
                  </div>
                </div>
              </div>
            )}
          </>
        )
      )}
    </section>
  )
}
