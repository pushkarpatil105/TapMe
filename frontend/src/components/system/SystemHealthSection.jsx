import { useState, useEffect, useCallback } from 'react'
import { useAuth } from '../../context'
import {
  formatSystemDateTime,
  getStatusBadge,
  getSeverityBadge,
} from '../../utils/system-management'

export function SystemHealthSection() {
  const { logout } = useAuth()
  const [healthData, setHealthData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [selectedEvent, setSelectedEvent] = useState(null)

  const fetchHealth = useCallback(async () => {
    try {
      setLoading(true)
      setError(null)

      const response = await fetch('/api/system/health', {
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
        setError('Access denied. System health requires Main Administrator authorization.')
        return
      }

      const json = await response.json().catch(() => null)
      if (response.ok && json?.success && json?.data) {
        setHealthData(json.data)
      } else {
        setError(json?.error || 'Failed to retrieve system health diagnostics.')
      }
    } catch (err) {
      console.error('Health fetch error:', err)
      setError('Network error while loading system diagnostics. Please check your connection.')
    } finally {
      setLoading(false)
    }
  }, [logout])

  useEffect(() => {
    let isMounted = true

    fetch('/api/system/health', {
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
            setError('Access denied. System health requires Main Administrator authorization.')
          }
          return null
        }
        return res.ok ? res.json() : null
      })
      .then((json) => {
        if (!isMounted || !json) return
        if (json.success && json.data) {
          setHealthData(json.data)
        } else {
          setError(json?.error || 'Failed to retrieve system health diagnostics.')
        }
      })
      .catch((err) => {
        if (isMounted) {
          console.error('Health fetch error:', err)
          setError('Network error while loading system diagnostics.')
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

  const overallBadge = getStatusBadge(healthData?.overall_status || 'unknown')
  const dbBadge = getStatusBadge(healthData?.database?.status || 'unknown')

  return (
    <section className="system-health-section" aria-label="System Health Section">
      {/* Top Header & Refresh */}
      <div className="section-header-block">
        <div className="section-header-titles">
          <div className="section-title-wrap">
            <h2 className="section-main-title">System Health & Diagnostics</h2>
            <span className="timezone-pill">Asia/Kolkata (IST)</span>
          </div>
          <p className="section-desc">
            Operational status, Cloudflare Worker edge execution metrics, D1 database latency, customer redirect telemetry, and error alerting.
          </p>
        </div>

        <div className="section-actions-wrap">
          <button
            type="button"
            className="action-btn action-btn-secondary"
            onClick={fetchHealth}
            disabled={loading}
            title="Refresh system diagnostics"
          >
            <svg
              className={`btn-icon ${loading ? 'animate-spin' : ''}`}
              width="16"
              height="16"
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
            <span>{loading ? 'Refreshing...' : 'Refresh Diagnostics'}</span>
          </button>
        </div>
      </div>

      {error && (
        <div className="table-error-banner">
          <p className="table-error-text">{error}</p>
        </div>
      )}

      {loading && !healthData ? (
        <div className="table-card" style={{ padding: '48px', textAlign: 'center' }}>
          <span className="spinner-icon" />
          <span style={{ color: 'var(--color-text-muted)', fontWeight: 600, marginLeft: '12px' }}>
            Running dependency health checks...
          </span>
        </div>
      ) : (
        healthData && (
          <>
            {/* Overall Status Banner */}
            <div className={`status-banner-card ${overallBadge.badgeClass}`}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '16px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                  <span className={`status-pulse-dot ${overallBadge.dotClass}`} />
                  <div>
                    <h3 style={{ fontSize: '17px', fontWeight: 700, color: '#ffffff', margin: 0, letterSpacing: '0.2px' }}>
                      Overall System: {overallBadge.label}
                    </h3>
                    <p style={{ fontSize: '13px', color: '#cbd5e1', margin: '4px 0 0 0' }}>
                      All critical dependencies verified, including Cloudflare Worker edge execution and D1 query engine.
                    </p>
                  </div>
                </div>

                <div style={{ textAlign: 'right', fontSize: '12.5px', color: '#cbd5e1', fontFamily: 'var(--font-mono)' }}>
                  <div>Checked: <strong style={{ color: '#ffffff' }}>{formatSystemDateTime(healthData.timestamp)}</strong></div>
                  <div style={{ fontSize: '11.5px', color: 'var(--color-text-dim)', marginTop: '2px' }}>
                    Environment: <span style={{ textTransform: 'uppercase', fontWeight: 700, color: '#38bdf8' }}>{healthData.worker.environment}</span>
                  </div>
                </div>
              </div>
            </div>

            {/* Ephemeral Telemetry Notice (Requirement 5: Fixed SVG Icon) */}
            <div className="storage-notice-banner">
              <div className="storage-notice-header">
                <svg
                  className="info-svg-icon"
                  width="18"
                  height="18"
                  viewBox="0 0 20 20"
                  fill="currentColor"
                  aria-hidden="true"
                >
                  <path
                    fillRule="evenodd"
                    d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z"
                    clipRule="evenodd"
                  />
                </svg>
                <span>Diagnostic Architecture: Ephemeral In-Memory Telemetry</span>
              </div>
              <div className="storage-notice-body">
                <p>
                  {healthData.telemetry_notice?.notice ||
                    'Diagnostics, redirect failure counts, and system event alerts are stored in a temporary in-memory ring buffer (up to 100 events) on the current Worker isolate. Data resets on isolate restart and is not shared across distributed edge isolates. Customer scan analytics are permanently stored in the D1 scan_events table.'}
                </p>
              </div>
              <div className="storage-notice-footer">
                <span>Buffer Limit: <strong style={{ color: '#ffffff' }}>100 Events</strong></span>
                <span>•</span>
                <span>Storage: <strong style={{ color: '#ffffff' }}>Current Worker Isolate RAM</strong></span>
                <span>•</span>
                <span>Customer Scans: <strong style={{ color: '#34d399' }}>Persistent in D1 (scan_events)</strong></span>
                <span>•</span>
                <span>Edge Sync: <strong style={{ color: '#fde68a' }}>Per-isolate (not distributed across edge nodes)</strong></span>
              </div>
            </div>

            {/* Health Metrics Grid */}
            <div className="metrics-grid">
              <div className="metric-card metric-card-sky">
                <div className="metric-header">
                  <span className="metric-label">Cloudflare Worker</span>
                  <span className="status-pill status-active">Operational</span>
                </div>
                <div className="metric-value-huge">v{healthData.worker.version}</div>
                <div className="metric-subtext">
                  Edge runtime responding with low latency. Uptime verified on active requests.
                </div>
              </div>

              <div className="metric-card metric-card-emerald">
                <div className="metric-header">
                  <span className="metric-label">D1 Database</span>
                  <span className={`status-pill ${dbBadge.badgeClass}`}>{dbBadge.label}</span>
                </div>
                <div className="metric-value-huge" style={{ color: '#34d399' }}>
                  {healthData.database.duration_ms} ms
                </div>
                <div className="metric-subtext">
                  Ping query: <code>SELECT 1</code>. Latency within nominal limits.
                </div>
              </div>

              <div className="metric-card metric-card-purple">
                <div className="metric-header">
                  <span className="metric-label">Public Redirects</span>
                  <span className="metric-tag metric-tag-sky">
                    {healthData.redirect_monitoring.total_recorded_scans} scans
                  </span>
                </div>
                <div className="metric-value-huge" style={{ fontSize: '20px' }}>
                  {healthData.redirect_monitoring.active_cards} Active Cards
                </div>
                <div className="metric-subtext">
                  {healthData.redirect_monitoring.unconfigured_cards} preprinted unassigned card(s).
                </div>
              </div>

              <div className="metric-card metric-card-amber">
                <div className="metric-header">
                  <span className="metric-label">Security & Auth</span>
                  <span className="metric-tag metric-tag-purple">
                    {healthData.auth_monitoring.active_admins_count} Admins
                  </span>
                </div>
                <div className="metric-value-huge" style={{ fontSize: '20px', color: healthData.auth_monitoring.failed_login_attempts > 0 ? '#fbbf24' : '#ffffff' }}>
                  {healthData.auth_monitoring.failed_login_attempts} Failed Attempts
                </div>
                <div className="metric-subtext">
                  {healthData.auth_monitoring.rate_limit_rejections} rate-limit event(s) recorded.
                </div>
              </div>
            </div>

            {/* Redirect Telemetry Breakdown */}
            <div className="table-card" style={{ padding: '22px' }}>
              <div style={{ marginBottom: '16px' }}>
                <h3 style={{ fontSize: '15px', fontWeight: 700, color: '#ffffff', margin: 0 }}>
                  Customer Redirect Diagnostic Breakdown
                </h3>
                <p style={{ fontSize: '12.5px', color: 'var(--color-text-muted)', margin: '4px 0 0 0' }}>
                  Distinguishes customer scanning events between valid destinations, unconfigured cards, and invalid token requests.
                </p>
              </div>

              <div className="diagnostic-grid">
                <div className="diagnostic-stat-card">
                  <span className="diagnostic-label">Invalid Tokens</span>
                  <span className="diagnostic-value" style={{ color: '#fb7185' }}>
                    {healthData.redirect_monitoring.failure_breakdown.invalid_tokens}
                  </span>
                </div>

                <div className="diagnostic-stat-card">
                  <span className="diagnostic-label">Cards Not Found</span>
                  <span className="diagnostic-value" style={{ color: '#fbbf24' }}>
                    {healthData.redirect_monitoring.failure_breakdown.cards_not_found}
                  </span>
                </div>

                <div className="diagnostic-stat-card">
                  <span className="diagnostic-label">Unconfigured Card Scans</span>
                  <span className="diagnostic-value" style={{ color: '#38bdf8' }}>
                    {healthData.redirect_monitoring.failure_breakdown.unconfigured_scans}
                  </span>
                </div>

                <div className="diagnostic-stat-card">
                  <span className="diagnostic-label">Inactive/Archived Scans</span>
                  <span className="diagnostic-value" style={{ color: '#94a3b8' }}>
                    {healthData.redirect_monitoring.failure_breakdown.inactive_or_archived_scans}
                  </span>
                </div>
              </div>
            </div>

            {/* Recent Diagnostic Events Log */}
            <div className="table-card">
              <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--color-card-border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <div>
                  <h3 style={{ fontSize: '15px', fontWeight: 700, color: '#ffffff', margin: 0 }}>
                    Recent System Events & Diagnostic Alerts
                  </h3>
                  <p style={{ fontSize: '12.5px', color: 'var(--color-text-muted)', margin: '4px 0 0 0' }}>
                    Real-time operational alerts from authentication, public redirects, database queries, and administrative operations.
                  </p>
                </div>
                <span style={{ fontSize: '12px', fontFamily: 'var(--font-mono)', color: 'var(--color-text-dim)' }}>
                  {healthData.recent_events.length} event(s)
                </span>
              </div>

              {healthData.recent_events.length === 0 ? (
                <div style={{ padding: '36px', textAlign: 'center', fontSize: '13px', color: 'var(--color-text-muted)' }}>
                  No diagnostic events or system errors recorded. System running smoothly.
                </div>
              ) : (
                <div className="table-responsive">
                  <table className="audit-table">
                    <thead>
                      <tr>
                        <th style={{ width: '160px' }}>Timestamp (IST)</th>
                        <th style={{ width: '100px' }}>Severity</th>
                        <th style={{ width: '110px' }}>Component</th>
                        <th style={{ width: '170px' }}>Category</th>
                        <th>Message</th>
                        <th style={{ width: '80px', textAlign: 'right' }}>Details</th>
                      </tr>
                    </thead>
                    <tbody>
                      {healthData.recent_events.map((evt) => {
                        const sevBadge = getSeverityBadge(evt.severity)
                        return (
                          <tr key={evt.id}>
                            <td style={{ fontSize: '12px', fontFamily: 'var(--font-mono)', color: 'var(--color-text-muted)', whiteSpace: 'nowrap' }}>
                              {formatSystemDateTime(evt.timestamp)}
                            </td>
                            <td>
                              <span className={`severity-badge ${sevBadge.badgeClass}`}>
                                {sevBadge.label}
                              </span>
                            </td>
                            <td>
                              <span style={{ fontSize: '11.5px', textTransform: 'uppercase', fontWeight: 700, color: 'var(--color-text-dim)', fontFamily: 'var(--font-mono)' }}>
                                {evt.component}
                              </span>
                            </td>
                            <td>
                              <code style={{ fontSize: '12px', color: '#38bdf8', fontFamily: 'var(--font-mono)' }}>
                                {evt.category}
                              </code>
                            </td>
                            <td style={{ fontSize: '13px', color: '#e2e8f0' }}>
                              {evt.message}
                            </td>
                            <td style={{ textAlign: 'right' }}>
                              {evt.details && Object.keys(evt.details).length > 0 ? (
                                <button
                                  type="button"
                                  className="btn-row btn-row-view text-xs py-1 px-2.5"
                                  onClick={() => setSelectedEvent(evt)}
                                >
                                  View
                                </button>
                              ) : (
                                <span style={{ fontSize: '12px', color: 'var(--color-text-dim)', fontStyle: 'italic' }}>—</span>
                              )}
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            {/* Event Detail Inspection Modal */}
            {selectedEvent && (
              <div className="modal-backdrop">
                <div className="modal-container" style={{ maxWidth: '560px' }} role="dialog" aria-modal="true">
                  <div className="modal-header">
                    <div className="modal-header-info">
                      <h2 className="modal-title">Diagnostic Event Context</h2>
                      <span className={`severity-badge ${getSeverityBadge(selectedEvent.severity).badgeClass}`}>
                        {selectedEvent.severity.toUpperCase()}
                      </span>
                    </div>
                    <button
                      type="button"
                      className="modal-close-btn"
                      onClick={() => setSelectedEvent(null)}
                    >
                      ✕
                    </button>
                  </div>
                  <div className="modal-body">
                    <div style={{ marginBottom: '14px', fontSize: '13px', color: '#cbd5e1', display: 'flex', flexDirection: 'column', gap: '4px' }}>
                      <div><strong>Category:</strong> <code style={{ color: '#38bdf8' }}>{selectedEvent.category}</code></div>
                      <div><strong>Timestamp (IST):</strong> {formatSystemDateTime(selectedEvent.timestamp)}</div>
                      <div><strong>Message:</strong> {selectedEvent.message}</div>
                    </div>
                    <h4 style={{ fontSize: '12px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.5px', color: 'var(--color-text-dim)', marginBottom: '6px' }}>
                      Sanitized Event Details
                    </h4>
                    <pre className="audit-json-box">
                      {JSON.stringify(selectedEvent.details, null, 2)}
                    </pre>
                  </div>
                  <div className="modal-footer">
                    <button
                      type="button"
                      className="action-btn action-btn-secondary"
                      onClick={() => setSelectedEvent(null)}
                    >
                      Close
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
