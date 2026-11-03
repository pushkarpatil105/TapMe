import { useState } from 'react'
import { QRCodeDisplay } from './QRCodeDisplay'

const PLATFORM_OPTIONS = [
  { value: 'google_reviews', label: 'Google Reviews', defaultLabel: 'Review Us on Google', placeholder: 'https://g.page/r/...' },
  { value: 'instagram', label: 'Instagram', defaultLabel: 'Follow Us on Instagram', placeholder: 'https://instagram.com/username' },
  { value: 'whatsapp', label: 'WhatsApp', defaultLabel: 'Message on WhatsApp', placeholder: 'https://wa.me/1234567890' },
  { value: 'other', label: 'Other / Website', defaultLabel: 'Visit Our Website', placeholder: 'https://example.com' },
]

export function CreateCardModal({ onClose, onCardCreated }) {
  const [businessName, setBusinessName] = useState('')
  const [location, setLocation] = useState('')
  const [links, setLinks] = useState([
    {
      platform: 'google_reviews',
      destination_url: '',
      label: 'Review Us on Google',
      is_enabled: true,
    },
  ])
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [errorMessage, setErrorMessage] = useState('')
  const [createdResult, setCreatedResult] = useState(null)

  const handleAddLink = () => {
    // Determine a sensible default platform not yet added, or fallback to 'other'
    const usedPlatforms = new Set(links.map((l) => l.platform))
    const nextAvailable = PLATFORM_OPTIONS.find(
      (p) => p.value !== 'other' && !usedPlatforms.has(p.value)
    ) || PLATFORM_OPTIONS[3] // 'other'

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

      // If user hasn't customized the label or it matches the old default, update to new default
      if (!updated[index].label || updated[index].label === oldPlatformOpt?.defaultLabel) {
        updated[index].label = newPlatformOpt?.defaultLabel || ''
      }
    }
    updated[index][field] = value
    setLinks(updated)
  }

  const validateForm = () => {
    if (!businessName.trim()) {
      return 'Business name is required.'
    }
    if (businessName.trim().length > 200) {
      return 'Business name cannot exceed 200 characters.'
    }
    if (location.trim().length > 200) {
      return 'Location cannot exceed 200 characters.'
    }

    const seenUrls = new Set()
    const seenPlatforms = new Set()

    for (let i = 0; i < links.length; i++) {
      const l = links[i]
      const url = l.destination_url.trim()

      if (!url) {
        return `Link #${i + 1} (${l.platform}) requires a destination URL.`
      }

      try {
        const parsed = new URL(url)
        if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
          return `Link #${i + 1} URL must start with http:// or https://.`
        }
      } catch {
        return `Link #${i + 1} has an invalid URL format.`
      }

      const lowerUrl = url.toLowerCase()
      if (seenUrls.has(lowerUrl)) {
        return `Duplicate destination URL found: "${url}". Each link must have a unique URL.`
      }
      seenUrls.add(lowerUrl)

      if (l.platform !== 'other') {
        if (seenPlatforms.has(l.platform)) {
          return `Only one "${l.platform.replace('_', ' ')}" link is permitted per card.`
        }
        seenPlatforms.add(l.platform)
      }
    }

    return null
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    if (isSubmitting) return

    setErrorMessage('')
    const validationError = validateForm()
    if (validationError) {
      setErrorMessage(validationError)
      return
    }

    setIsSubmitting(true)

    try {
      const payload = {
        business_name: businessName.trim(),
        location: location.trim() || null,
        links: links.map((l, idx) => ({
          platform: l.platform,
          destination_url: l.destination_url.trim(),
          label: l.label?.trim() || undefined,
          is_enabled: Boolean(l.is_enabled),
          display_order: idx,
        })),
      }

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
                <span className="text-muted">{createdResult.links?.length ?? 0} link(s)</span>
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
                <label className="form-label">Destination Links</label>
                <button
                  type="button"
                  className="action-btn action-btn-secondary btn-sm"
                  onClick={handleAddLink}
                  disabled={isSubmitting || links.length >= 20}
                >
                  + Add Link
                </button>
              </div>

              {links.length === 0 ? (
                <p className="text-muted text-sm italic">
                  No links added yet. You can add links now or later.
                </p>
              ) : (
                <div className="links-editor-list">
                  {links.map((link, idx) => {
                    const currentPlatform = PLATFORM_OPTIONS.find((p) => p.value === link.platform)
                    return (
                      <div key={idx} className="link-editor-card">
                        <div className="link-editor-top">
                          <span className="link-index-badge">#{idx + 1}</span>
                          <select
                            className="form-select"
                            value={link.platform}
                            onChange={(e) => handleLinkChange(idx, 'platform', e.target.value)}
                            disabled={isSubmitting}
                          >
                            {PLATFORM_OPTIONS.map((opt) => (
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
                            placeholder="Display Label (e.g. Review Us on Google)"
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
