import { useState } from 'react'
import { QRCodeDisplay } from './QRCodeDisplay'
import {
  QR_TYPES,
  QR_TYPE_CONFIG,
  QR_TYPE_OPTIONS,
  PLATFORM_OPTIONS,
  validateCreateCardForm,
  formatCreateCardPayload,
} from '../../utils/card-workflow'

export function CreateCardModal({ onClose, onCardCreated }) {
  const [businessName, setBusinessName] = useState('')
  const [location, setLocation] = useState('')
  const [qrType, setQrType] = useState('all_in_one')
  const [links, setLinks] = useState([])
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [errorMessage, setErrorMessage] = useState('')
  const [createdResult, setCreatedResult] = useState(null)

  const activeQrConfig = QR_TYPE_CONFIG[qrType] || QR_TYPE_CONFIG.all_in_one
  const availablePlatforms = PLATFORM_OPTIONS.filter((p) =>
    activeQrConfig.allowedPlatforms.includes(p.value)
  )

  const handleQrTypeChange = (newQrType) => {
    if (!QR_TYPES.includes(newQrType)) return
    setQrType(newQrType)
    setErrorMessage('')

    const targetConfig = QR_TYPE_CONFIG[newQrType]
    if (links.length > 0) {
      // Keep only links allowed by the new QR type, truncated to maxLinks
      const compatibleLinks = links
        .filter((l) => targetConfig.allowedPlatforms.includes(l.platform))
        .slice(0, targetConfig.maxLinks)

      setLinks(compatibleLinks)
    }
  }

  const handleAddLink = () => {
    if (links.length >= activeQrConfig.maxLinks) {
      return
    }

    const usedPlatforms = new Set(links.map((l) => l.platform))
    const nextAvailable =
      availablePlatforms.find((p) => p.value !== 'other' && !usedPlatforms.has(p.value)) ||
      availablePlatforms[0]

    setLinks([
      ...links,
      {
        platform: nextAvailable.value,
        destination_url: '',
        label: nextAvailable.defaultLabel,
        is_enabled: true,
      },
    ])
  }

  const handleRemoveLink = (index) => {
    setLinks(links.filter((_, i) => i !== index))
  }

  const handleLinkChange = (index, field, value) => {
    const updated = [...links]
    if (field === 'platform') {
      const oldPlatformOpt = PLATFORM_OPTIONS.find((p) => p.value === updated[index].platform)
      const newPlatformOpt = PLATFORM_OPTIONS.find((p) => p.value === value)

      if (!updated[index].label || updated[index].label === oldPlatformOpt?.defaultLabel) {
        updated[index].label = newPlatformOpt?.defaultLabel || ''
      }
    }
    updated[index][field] = value
    setLinks(updated)
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    if (isSubmitting) return

    setErrorMessage('')
    const validationError = validateCreateCardForm({
      businessName,
      location,
      qrType,
      links,
    })

    if (validationError) {
      setErrorMessage(validationError)
      return
    }

    setIsSubmitting(true)

    try {
      const payload = formatCreateCardPayload({
        businessName,
        location,
        qrType,
        links,
      })

      const response = await fetch('/api/cards', {
        method: 'POST',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify(payload),
      })

      const data = await response.json().catch(() => null)

      if (response.ok && data?.success && data?.data) {
        setCreatedResult(data.data)
        onCardCreated(data.data)
      } else {
        setErrorMessage(data?.error || `Failed to create card (HTTP ${response.status}).`)
      }
    } catch (err) {
      console.error('Error creating card:', err)
      setErrorMessage('Network error while creating card. Please check your connection.')
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <div className="modal-backdrop">
      <div className="modal-container" role="dialog" aria-modal="true" aria-labelledby="modal-title">
        <div className="modal-header">
          <h2 id="modal-title" className="modal-title">
            {createdResult ? 'Card Successfully Created' : 'Create New TapMe Card'}
          </h2>
          <button
            type="button"
            className="modal-close-btn"
            onClick={onClose}
            aria-label="Close dialog"
          >
            ✕
          </button>
        </div>

        {/* Success confirmation view */}
        {createdResult ? (
          <div className="modal-body modal-scroll-body">
            <div className="success-banner" role="status">
              <svg className="alert-icon text-emerald" viewBox="0 0 20 20" fill="currentColor">
                <path
                  fillRule="evenodd"
                  d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z"
                  clipRule="evenodd"
                />
              </svg>
              <span>Card provisioned successfully!</span>
            </div>

            <div className="created-details-box">
              <div className="created-meta-row">
                <span className="created-meta-label">Card Number:</span>
                <span className="card-number-tag font-bold">
                  {createdResult.formatted_card_number || String(createdResult.card_number).padStart(3, '0')}
                </span>
              </div>
              <div className="created-meta-row">
                <span className="created-meta-label">Business Name:</span>
                <strong className="text-main">{createdResult.business_name}</strong>
              </div>
              <div className="created-meta-row">
                <span className="created-meta-label">Permanent QR Type:</span>
                <span className="font-bold text-main">
                  {QR_TYPE_CONFIG[createdResult.qr_type]?.label || createdResult.qr_type}
                </span>
              </div>
              {createdResult.location && (
                <div className="created-meta-row">
                  <span className="created-meta-label">Location:</span>
                  <span className="text-muted">{createdResult.location}</span>
                </div>
              )}
              <div className="created-meta-row">
                <span className="created-meta-label">Permanent Public Token:</span>
                <code className="public-token-code">{createdResult.public_token}</code>
              </div>
              <div className="created-meta-row">
                <span className="created-meta-label">Configured Links:</span>
                <span className="text-muted">
                  {createdResult.links?.length ?? 0} link(s)
                  {(!createdResult.links || createdResult.links.length === 0) && ' (Unconfigured Preprinted Card)'}
                </span>
              </div>
            </div>

            {/* Instant QR Preview & High-Res Exporters */}
            <div className="details-section mt-4">
              <h3 className="section-subtitle">Provisioned Card QR Code</h3>
              <QRCodeDisplay card={createdResult} />
            </div>

            <div className="modal-footer">
              <button
                type="button"
                className="action-btn action-btn-primary"
                onClick={onClose}
              >
                Done
              </button>
            </div>
          </div>
        ) : (
          /* Form view */
          <form onSubmit={handleSubmit} noValidate>
            <div className="modal-body modal-scroll-body">
              {errorMessage && (
                <div className="table-error-banner" role="alert">
                  <svg className="alert-icon" viewBox="0 0 20 20" fill="currentColor">
                    <path
                      fillRule="evenodd"
                      d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7 4a1 1 0 11-2 0 1 1 0 012 0zm-1-9a1 1 0 00-1 1v4a1 1 0 102 0V6a1 1 0 00-1-1z"
                      clipRule="evenodd"
                    />
                  </svg>
                  <span>{errorMessage}</span>
                </div>
              )}

              {/* Permanent QR Type Selector */}
              <div className="form-group">
                <label htmlFor="create_qr_type" className="form-label">
                  Permanent QR Type <span className="text-rose">*</span>
                </label>
                <select
                  id="create_qr_type"
                  className="form-select"
                  value={qrType}
                  onChange={(e) => handleQrTypeChange(e.target.value)}
                  disabled={isSubmitting}
                  required
                >
                  {QR_TYPE_OPTIONS.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </select>
                <span className="text-dim text-xs block mt-1">
                  🔒 {activeQrConfig.description}. This physical QR design is permanent and cannot be modified after card creation.
                </span>
              </div>

              {/* Business Name */}
              <div className="form-group">
                <label htmlFor="business_name" className="form-label">
                  Business Name <span className="text-rose">*</span>
                </label>
                <input
                  id="business_name"
                  type="text"
                  className="form-input"
                  placeholder="e.g. Acme Coffee & Bakery"
                  value={businessName}
                  onChange={(e) => setBusinessName(e.target.value)}
                  disabled={isSubmitting}
                  required
                  maxLength={200}
                  autoFocus
                />
              </div>

              {/* Location */}
              <div className="form-group">
                <label htmlFor="location" className="form-label">
                  Location <span className="text-dim text-sm">(optional)</span>
                </label>
                <input
                  id="location"
                  type="text"
                  className="form-input"
                  placeholder="e.g. Seattle, WA"
                  value={location}
                  onChange={(e) => setLocation(e.target.value)}
                  disabled={isSubmitting}
                  maxLength={200}
                />
              </div>

              {/* Destination Links Section */}
              <div className="form-section-header">
                <div>
                  <label className="form-label mb-0">Destination Links</label>
                  <span className="text-dim text-xs block">
                    {links.length}/{activeQrConfig.maxLinks} maximum for {activeQrConfig.label}
                  </span>
                </div>
                {links.length < activeQrConfig.maxLinks && (
                  <button
                    type="button"
                    className="action-btn action-btn-secondary btn-sm"
                    onClick={handleAddLink}
                    disabled={isSubmitting}
                  >
                    + Add Link
                  </button>
                )}
              </div>

              {links.length === 0 ? (
                <div className="info-banner mb-3">
                  <svg className="alert-icon text-muted" viewBox="0 0 20 20" fill="currentColor">
                    <path
                      fillRule="evenodd"
                      d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z"
                      clipRule="evenodd"
                    />
                  </svg>
                  <span>
                    No links added. This card will be provisioned as a preprinted, unconfigured card. You can immediately download and print its permanent QR code and configure destination URLs later.
                  </span>
                </div>
              ) : (
                <div className="links-editor-list">
                  {links.map((link, idx) => {
                    const currentPlatform = availablePlatforms.find((p) => p.value === link.platform)
                    return (
                      <div key={idx} className="link-editor-card">
                        <div className="link-editor-top">
                          <span className="link-index-badge">#{idx + 1}</span>
                          <select
                            className="form-select"
                            value={link.platform}
                            onChange={(e) => handleLinkChange(idx, 'platform', e.target.value)}
                            disabled={isSubmitting || availablePlatforms.length <= 1}
                          >
                            {availablePlatforms.map((opt) => (
                              <option key={opt.value} value={opt.value}>
                                {opt.label}
                              </option>
                            ))}
                          </select>
                          <label className="link-enabled-checkbox">
                            <input
                              type="checkbox"
                              checked={link.is_enabled}
                              onChange={(e) => handleLinkChange(idx, 'is_enabled', e.target.checked)}
                              disabled={isSubmitting}
                            />
                            <span>Enabled</span>
                          </label>
                          <button
                            type="button"
                            className="btn-remove-link"
                            onClick={() => handleRemoveLink(idx)}
                            disabled={isSubmitting}
                            title="Remove link"
                          >
                            ✕
                          </button>
                        </div>

                        <div className="link-editor-fields">
                          <input
                            type="url"
                            className="form-input"
                            placeholder={currentPlatform?.placeholder || 'https://...'}
                            value={link.destination_url}
                            onChange={(e) => handleLinkChange(idx, 'destination_url', e.target.value)}
                            disabled={isSubmitting}
                            required
                          />
                          <input
                            type="text"
                            className="form-input"
                            placeholder="Display Label"
                            value={link.label}
                            onChange={(e) => handleLinkChange(idx, 'label', e.target.value)}
                            disabled={isSubmitting}
                            maxLength={100}
                          />
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>

            <div className="modal-footer">
              <button
                type="button"
                className="action-btn action-btn-secondary"
                onClick={onClose}
                disabled={isSubmitting}
              >
                Cancel
              </button>
              <button
                type="submit"
                className="action-btn action-btn-primary"
                disabled={isSubmitting}
              >
                {isSubmitting ? 'Creating Card...' : 'Create Card'}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  )
}
