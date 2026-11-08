import { useEffect, useRef, useState } from 'react'
import { getQRLogoForCard } from '../../assets/qr-logos'
import { getPublicCardUrl, isLocalDevelopmentUrl } from '../../utils/public-url'
import {
  generateHighResPngBlob,
  generateQrSvgString,
  getQRFilename,
  renderQrToCanvas,
  triggerFileDownload,
} from '../../utils/qr-generator'

/**
 * QR Code preview and high-resolution export component for TapMe smart business cards.
 *
 * Encodes the canonical public redirect route (/r/:public_token) using Error Correction H.
 * Embeds a tailored center logo (single-destination platform or TapMe multi-link branding)
 * with a dedicated white quiet zone to preserve scan reliability.
 *
 * @param {Object} props
 * @param {Object} props.card - The card model containing public_token, business_name, and links
 */
export function QRCodeDisplay({ card }) {
  const canvasRef = useRef(null)

  const [loading, setLoading] = useState(true)
  const [configError, setConfigError] = useState(null)
  const [downloadError, setDownloadError] = useState(null)
  const [downloadingPng, setDownloadingPng] = useState(false)
  const [downloadingSvg, setDownloadingSvg] = useState(false)

  // 1. Validate public token
  const publicToken = card?.public_token
  const hasValidToken = typeof publicToken === 'string' && publicToken.trim().length > 0

  // 2. Resolve the public redirect URL
  let publicUrl = ''
  let urlError = null

  if (hasValidToken) {
    try {
      publicUrl = getPublicCardUrl(publicToken)
    } catch (err) {
      urlError = err?.message || 'Failed to resolve public redirect URL.'
    }
  } else {
    urlError = 'Cannot generate QR code: Missing or invalid public token.'
  }

  // 3. Resolve center logo and status flags
  const logo = card ? getQRLogoForCard(card) : null
  const isDevUrl = publicUrl ? isLocalDevelopmentUrl(publicUrl) : false
  const cardStatus = card?.status || 'active'
  const isInactive = cardStatus === 'inactive'
  const isArchived = cardStatus === 'archived'

  // 4. Render preview canvas
  useEffect(() => {
    let isCancelled = false

    async function drawPreview() {
      if (!publicUrl || !canvasRef.current) {
        setLoading(false)
        return
      }

      try {
        setLoading(true)
        setConfigError(null)

        // Render at 520x520 for crisp Retina display on a ~260px container
        await renderQrToCanvas(canvasRef.current, publicUrl, logo, {
          size: 520,
          margin: 4,
          logoRatio: 0.19,
          bgRatio: 0.23,
        })
      } catch (err) {
        if (!isCancelled) {
          console.error('Failed to render preview QR canvas:', err)
          setConfigError(err?.message || 'Failed to render QR preview.')
        }
      } finally {
        if (!isCancelled) {
          setLoading(false)
        }
      }
    }

    drawPreview()

    return () => {
      isCancelled = true
    }
  }, [publicUrl, logo])

  // Handle PNG download (2048 x 2048)
  const handleDownloadPng = async () => {
    if (!publicUrl || downloadingPng) return

    try {
      setDownloadingPng(true)
      setDownloadError(null)

      const pngBlob = await generateHighResPngBlob(publicUrl, logo)
      const filename = getQRFilename(card, 'png')
      triggerFileDownload(pngBlob, filename, 'image/png')
    } catch (err) {
      console.error('PNG export failed:', err)
      setDownloadError(err?.message || 'Failed to export PNG. Please try again.')
    } finally {
      setDownloadingPng(false)
    }
  }

  // Handle SVG download (Genuine vector SVG)
  const handleDownloadSvg = async () => {
    if (!publicUrl || downloadingSvg) return

    try {
      setDownloadingSvg(true)
      setDownloadError(null)

      const svgString = await generateQrSvgString(publicUrl, logo, { size: 2048 })
      const filename = getQRFilename(card, 'svg')
      triggerFileDownload(svgString, filename, 'image/svg+xml;charset=utf-8')
    } catch (err) {
      console.error('SVG export failed:', err)
      setDownloadError(err?.message || 'Failed to export SVG. Please try again.')
    } finally {
      setDownloadingSvg(false)
    }
  }

  // Fatal configuration or token errors
  if (urlError || configError) {
    return (
      <div className="table-error-banner" role="alert">
        <svg className="alert-icon" viewBox="0 0 20 20" fill="currentColor">
          <path
            fillRule="evenodd"
            d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7 4a1 1 0 11-2 0 1 1 0 012 0zm-1-9a1 1 0 00-1 1v4a1 1 0 102 0V6a1 1 0 00-1-1z"
            clipRule="evenodd"
          />
        </svg>
        <span>{urlError || configError}</span>
      </div>
    )
  }

  return (
    <div className="qr-display-container">
      {/* Meta header bar */}
      <div className="qr-meta-header">
        <div className="qr-meta-title-group">
          <span className="card-number-tag font-bold">
            {card?.formatted_card_number || (card?.card_number != null ? String(card.card_number).padStart(3, '0') : 'CARD')}
          </span>
          <span className="font-semibold text-main">{card?.business_name || 'TapMe Card'}</span>
          <span className={`status-pill status-${cardStatus}`}>
            {cardStatus}
          </span>
        </div>
        {logo ? (
          <span
            className="link-platform-tag"
            style={{ borderColor: `${logo.color}55`, color: logo.color }}
            title={`Center logo: ${logo.label}`}
          >
            {logo.label}
          </span>
        ) : (
          <span
            className="link-platform-tag"
            style={{ borderColor: 'rgba(255, 255, 255, 0.2)', color: '#94a3b8' }}
            title="Clean Standard QR (No Center Logo)"
          >
            Standard QR
          </span>
        )}
      </div>

      {/* Status Warning Notices */}
      {isInactive && (
        <div className="qr-status-warning qr-warning-inactive" role="alert">
          <svg className="alert-icon text-amber-400" viewBox="0 0 20 20" fill="currentColor">
            <path
              fillRule="evenodd"
              d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z"
              clipRule="evenodd"
            />
          </svg>
          <span>
            This card is currently <strong>inactive</strong>. Visitors who scan this QR code will see an unavailable message and will not be redirected until the card is activated.
          </span>
        </div>
      )}

      {isArchived && (
        <div className="qr-status-warning qr-warning-archived" role="alert">
          <svg className="alert-icon text-rose" viewBox="0 0 20 20" fill="currentColor">
            <path
              fillRule="evenodd"
              d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7 4a1 1 0 11-2 0 1 1 0 012 0zm-1-9a1 1 0 00-1 1v4a1 1 0 102 0V6a1 1 0 00-1-1z"
              clipRule="evenodd"
            />
          </svg>
          <span>
            This card is <strong>archived and decommissioned</strong>. Scans will return an unavailable page (404). This QR code is provided for administrative reference only.
          </span>
        </div>
      )}

      {/* QR Canvas Preview Box */}
      <div className="qr-preview-card">
        {loading && (
          <div className="loading-row p-6">
            <span className="spinner-icon" />
            <span className="text-muted text-sm">Generating QR code...</span>
          </div>
        )}
        <canvas
          ref={canvasRef}
          className="qr-preview-canvas"
          style={{ display: loading ? 'none' : 'block' }}
          aria-label={`QR Code for ${card?.business_name || 'TapMe Card'}`}
        />
      </div>

      {/* Public URL row */}
      <div className="qr-url-row">
        <span className="created-meta-label">Encoded Public Redirect URL:</span>
        <code className="public-token-code">{publicUrl}</code>
      </div>

      {/* Development URL warning banner */}
      {isDevUrl && (
        <div className="qr-dev-warning" role="alert">
          <svg className="alert-icon text-amber-400" viewBox="0 0 20 20" fill="currentColor">
            <path
              fillRule="evenodd"
              d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z"
              clipRule="evenodd"
            />
          </svg>
          <span>
            Development URL — this QR code is only usable on this computer. Configure a network-accessible or production URL before printing.
          </span>
        </div>
      )}

      {/* Download error banner */}
      {downloadError && (
        <div className="table-error-banner" role="alert">
          <svg className="alert-icon" viewBox="0 0 20 20" fill="currentColor">
            <path
              fillRule="evenodd"
              d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7 4a1 1 0 11-2 0 1 1 0 012 0zm-1-9a1 1 0 00-1 1v4a1 1 0 102 0V6a1 1 0 00-1-1z"
              clipRule="evenodd"
            />
          </svg>
          <span>{downloadError}</span>
        </div>
      )}

      {/* Download Actions */}
      <div className="qr-actions-row">
        <button
          type="button"
          className="action-btn action-btn-secondary"
          onClick={handleDownloadPng}
          disabled={loading || downloadingPng || downloadingSvg}
          title="Download 2048 x 2048 PNG image"
        >
          <svg className="btn-icon" viewBox="0 0 20 20" fill="currentColor">
            <path
              fillRule="evenodd"
              d="M3 17a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1zm3.293-7.707a1 1 0 011.414 0L9 10.586V3a1 1 0 112 0v7.586l1.293-1.293a1 1 0 111.414 1.414l-3 3a1 1 0 01-1.414 0l-3-3a1 1 0 010-1.414z"
              clipRule="evenodd"
            />
          </svg>
          <span>{downloadingPng ? 'Generating PNG...' : 'Download PNG'}</span>
        </button>

        <button
          type="button"
          className="action-btn action-btn-primary"
          onClick={handleDownloadSvg}
          disabled={loading || downloadingPng || downloadingSvg}
          title="Download scalable vector SVG for print production"
        >
          <svg className="btn-icon" viewBox="0 0 20 20" fill="currentColor">
            <path
              fillRule="evenodd"
              d="M3 17a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1zm3.293-7.707a1 1 0 011.414 0L9 10.586V3a1 1 0 112 0v7.586l1.293-1.293a1 1 0 111.414 1.414l-3 3a1 1 0 01-1.414 0l-3-3a1 1 0 010-1.414z"
              clipRule="evenodd"
            />
          </svg>
          <span>{downloadingSvg ? 'Generating SVG...' : 'Download SVG'}</span>
        </button>
      </div>

      <span className="text-dim text-xs text-center">
        High-res PNG (2048 × 2048) &amp; Lossless Vector SVG for physical card manufacturing
      </span>
    </div>
  )
}
