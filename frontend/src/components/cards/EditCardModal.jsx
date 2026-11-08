import { useState } from 'react'
import {
  QR_TYPE_CONFIG,
  PLATFORM_OPTIONS,
  validateEditCardForm,
  formatEditCardPayload,
} from '../../utils/card-workflow'

export function EditCardModal({ card, onClose, onCardUpdated, isMainAdmin }) {
  const [businessName, setBusinessName] = useState(card?.business_name || '')
  const [location, setLocation] = useState(card?.location || '')
  const [links, setLinks] = useState(
    card?.links?.map((l) => ({
      platform: l.platform,
      destination_url: l.destination_url,
      label: l.label,
      is_enabled: Boolean(l.is_enabled),
    })) || []
  )
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [errorMessage, setErrorMessage] = useState('')

  if (!isMainAdmin && card?.is_configured) {
    return null
  }

  const cardQrType = card?.qr_type || 'all_in_one'
  const activeQrConfig = QR_TYPE_CONFIG[cardQrType] || QR_TYPE_CONFIG.all_in_one
  const availablePlatforms = PLATFORM_OPTIONS.filter((p) =>
    activeQrConfig.allowedPlatforms.includes(p.value)
  )

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
    const validationError = validateEditCardForm({
      businessName,
      location,
      qrType: cardQrType,
      links,
      isMainAdmin,
      isConfigured: Boolean(card?.is_configured),
    })

    if (validationError) {
      setErrorMessage(validationError)
      return
    }

    setIsSubmitting(true)

    try {
      const payload = formatEditCardPayload({
        businessName,
        location,
        links,
      })

      const response = await fetch(`/api/cards/${card.card_number}`, {
        method: 'PATCH',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify(payload),
      })

      const data = await response.json().catch(() => null)

      if (response.ok && data?.success && data?.data) {
        onCardUpdated(data.data)
      } else {
        setErrorMessage(data?.error || `Failed to update card (HTTP ${response.status}).`)
      }
    } catch (err) {
      console.error('Error updating card:', err)
      setErrorMessage('Network error while updating card. Please check your connection.')
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <div className="modal-backdrop">
      <div className="modal-container" role="dialog" aria-modal="true" aria-labelledby="edit-modal-title">
        <div className="modal-header">
          <div className="modal-header-info">
            <h2 id="edit-modal-title" className="modal-title">
              {isMainAdmin ? 'Edit Card' : 'Configure Card'}
            </h2>
            <span className="card-number-tag font-bold">
              {card.formatted_card_number || String(card.card_number).padStart(3, '0')}
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

            {/* Read-Only Permanent Identifiers */}
            <div className="readonly-alert-box">
              <div className="readonly-meta-item">
                <span className="details-label">Permanent Card Number</span>
                <span className="card-number-tag font-bold">
                  {card.formatted_card_number || String(card.card_number).padStart(3, '0')}
                </span>
              </div>
              <div className="readonly-meta-item">
                <span className="details-label">Permanent Public Token</span>
                <code className="public-token-code">{card.public_token}</code>
              </div>
              <div className="readonly-meta-item">
                <span className="details-label">Permanent QR Type</span>
                <span className="font-bold text-main">
                  {activeQrConfig.label}
                </span>
              </div>
              <span className="text-dim text-xs block mt-1">
                🔒 Permanent identifiers and QR Type cannot be modified.
              </span>
            </div>

            {!isMainAdmin && (
              <div className="info-banner mb-4">
                <svg className="alert-icon text-muted" viewBox="0 0 20 20" fill="currentColor">
                  <path
                    fillRule="evenodd"
                    d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z"
                    clipRule="evenodd"
                  />
                </svg>
                <span>
                  Staff configuration is permanent. Once saved, future changes to this card will require a Main Admin.
                </span>
              </div>
            )}

            {/* Business Name */}
            <div className="form-group">
              <label htmlFor="edit_business_name" className="form-label">
                Business Name <span className="text-rose">*</span>
              </label>
              <input
                id="edit_business_name"
                type="text"
                className="form-input"
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
              <label htmlFor="edit_location" className="form-label">
                Location <span className="text-dim text-sm">(optional)</span>
              </label>
              <input
                id="edit_location"
                type="text"
                className="form-input"
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
              <p className="text-muted text-sm italic">
                {isMainAdmin
                  ? 'No destination links configured. (Main Admins may save cards without links).'
                  : 'At least one destination link is required to complete staff configuration.'}
              </p>
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
              {isSubmitting
                ? (isMainAdmin ? 'Saving Changes...' : 'Saving Configuration...')
                : (isMainAdmin ? 'Save Changes' : 'Save Configuration')}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
