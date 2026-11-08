import { useState, useEffect } from 'react'
import { QRCodeDisplay } from './QRCodeDisplay'
import { QR_TYPE_CONFIG } from '../../utils/card-workflow'

export function CardDetailsModal({
  cardId,
  onClose,
  onEdit,
  onLifecycleAction,
  isMainAdmin,
}) {
  const [card, setCard] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  useEffect(() => {
    let isMounted = true

    async function loadCardDetails() {
      try {
        setLoading(true)
        setError(null)

        const response = await fetch(`/api/cards/${cardId}`, {
          method: 'GET',
          credentials: 'include',
          headers: {
            Accept: 'application/json',
          },
        })

        const json = await response.json().catch(() => null)

        if (!isMounted) return

        if (response.ok && json?.success && json?.data) {
          setCard(json.data)
        } else {
          setError(json?.error || 'Failed to load card details.')
        }
      } catch (err) {
        if (!isMounted) return
        console.error('Failed to fetch card:', err)
        setError('Network error while fetching card details.')
      } finally {
        if (isMounted) {
          setLoading(false)
        }
      }
    }

    if (cardId) {
      loadCardDetails()
    }

    return () => {
      isMounted = false
    }
  }, [cardId])

  const formatDate = (dateStr) => {
    if (!dateStr) return '—'
    try {
      const d = new Date(dateStr)
      return d.toLocaleString(undefined, {
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

  const formatPlatform = (p) => {
    switch (p) {
      case 'google_reviews':
        return 'Google Reviews'
      case 'instagram':
        return 'Instagram'
      case 'whatsapp':
        return 'WhatsApp'
      default:
        return 'Website / Other'
    }
  }

  return (
    <div className="modal-backdrop">
      <div className="modal-container" role="dialog" aria-modal="true" aria-labelledby="details-title">
        <div className="modal-header">
          <div className="modal-header-info">
            <h2 id="details-title" className="modal-title">
              Card Details
            </h2>
            {card && (
              <span className="card-number-tag font-bold">
                {card.formatted_card_number || String(card.card_number).padStart(3, '0')}
              </span>
            )}
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
          {loading ? (
            <div className="loading-row p-6">
              <span className="spinner-icon" />
              <span>Loading card details...</span>
            </div>
          ) : error ? (
            <div className="table-error-banner" role="alert">
              <svg className="alert-icon" viewBox="0 0 20 20" fill="currentColor">
                <path
                  fillRule="evenodd"
                  d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7 4a1 1 0 11-2 0 1 1 0 012 0zm-1-9a1 1 0 00-1 1v4a1 1 0 102 0V6a1 1 0 00-1-1z"
                  clipRule="evenodd"
                />
              </svg>
              <span>{error}</span>
            </div>
          ) : card ? (
            <div className="card-details-content">
              {card.status === 'archived' && (
                <div className="info-banner mb-4">
                  <svg className="alert-icon text-muted" viewBox="0 0 20 20" fill="currentColor">
                    <path
                      fillRule="evenodd"
                      d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z"
                      clipRule="evenodd"
                    />
                  </svg>
                  <span>
                    This card is archived. It cannot be edited until restored.
                  </span>
                </div>
              )}

              {/* Primary Attributes */}
              <div className="details-grid">
                <div className="details-item">
                  <span className="details-label">Business Name</span>
                  <strong className="details-value text-lg text-main">{card.business_name}</strong>
                </div>
                <div className="details-item">
                  <span className="details-label">Location</span>
                  <span className="details-value text-muted">{card.location || '—'}</span>
                </div>
                <div className="details-item">
                  <span className="details-label">Status</span>
                  <span className={`status-pill status-${card.status}`}>{card.status}</span>
                </div>
                <div className="details-item">
                  <span className="details-label">Total Scans</span>
                  <span className="scan-count-badge">{card.total_scans ?? 0}</span>
                </div>
                <div className="details-item">
                  <span className="details-label">Permanent QR Type</span>
                  <span className="details-value font-medium text-main">
                    {QR_TYPE_CONFIG[card.qr_type]?.label || card.qr_type}
                  </span>
                </div>
              </div>

              {/* QR Code & Permanent Redirect */}
              <div className="details-section">
                <h3 className="section-subtitle">Card QR Code &amp; Redirect</h3>
                <QRCodeDisplay card={card} />
              </div>

              {/* Timestamps */}
              <div className="details-grid">
                <div className="details-item">
                  <span className="details-label">Created At</span>
                  <span className="text-muted text-sm">{formatDate(card.created_at)}</span>
                </div>
                <div className="details-item">
                  <span className="details-label">Updated At</span>
                  <span className="text-muted text-sm">{formatDate(card.updated_at)}</span>
                </div>
              </div>

              {/* Destination Links */}
              <div className="details-section">
                <h3 className="section-subtitle">
                  Destination Links ({card.links?.length || 0})
                </h3>
                {(!card.links || card.links.length === 0) ? (
                  <p className="text-muted text-sm italic">No destination links configured.</p>
                ) : (
                  <div className="details-links-list">
                    {card.links.map((link) => (
                      <div key={link.id} className="details-link-card">
                        <div className="details-link-header">
                          <span className="link-platform-tag">{formatPlatform(link.platform)}</span>
                          <span
                            className={`status-pill ${
                              link.is_enabled ? 'status-active' : 'status-inactive'
                            }`}
                          >
                            {link.is_enabled ? 'Enabled' : 'Disabled'}
                          </span>
                        </div>
                        <div className="details-link-body">
                          <span className="link-label-text">{link.label}</span>
                          <a
                            href={link.destination_url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="link-url-text"
                          >
                            {link.destination_url}
                          </a>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          ) : null}
        </div>

        <div className="modal-footer">
          {/* Main Admin lifecycle buttons */}
          {isMainAdmin && card && onLifecycleAction && (
            <>
              {card.status === 'active' && (
                <button
                  type="button"
                  className="action-btn action-btn-warning"
                  onClick={() => onLifecycleAction(card, 'deactivate')}
                >
                  Deactivate
                </button>
              )}
              {card.status === 'inactive' && (
                <button
                  type="button"
                  className="action-btn action-btn-primary"
                  onClick={() => onLifecycleAction(card, 'activate')}
                >
                  Activate
                </button>
              )}
              {card.status !== 'archived' && (
                <button
                  type="button"
                  className="action-btn action-btn-danger"
                  onClick={() => onLifecycleAction(card, 'archive')}
                >
                  Archive
                </button>
              )}
              {card.status === 'archived' && (
                <button
                  type="button"
                  className="action-btn action-btn-primary"
                  onClick={() => onLifecycleAction(card, 'restore')}
                >
                  Restore
                </button>
              )}
            </>
          )}

          {/* Edit / Configure Card allowed for Main Admin (or Staff for unconfigured cards) when not archived */}
          {card && card.status !== 'archived' && (isMainAdmin || !card.is_configured) && (
            <button
              type="button"
              className="action-btn action-btn-secondary"
              onClick={() => onEdit(card)}
            >
              {isMainAdmin ? 'Edit Card' : 'Configure Card'}
            </button>
          )}

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
