import { useState, useEffect, useRef, useCallback } from 'react'
import jsQR from 'jsqr'
import {
  validateTapMeQrUrl,
  decodeQrFromImageFile,
  lookupCardByToken,
} from '../../utils/qr-scanner'
import { QR_TYPE_CONFIG } from '../../utils/card-workflow'

export function ScanCardModal({ onClose, onConfigureCard, onEditCard, isMainAdmin }) {
  // Scanner modes: 'scan' or 'result'
  const [scannerMode, setScannerMode] = useState('scan')
  // Active tab: 'camera', 'upload', 'manual'
  const [activeTab, setActiveTab] = useState('camera')

  // Live camera states
  const [cameraError, setCameraError] = useState(null)
  const [isCameraActive, setIsCameraActive] = useState(false)
  const [availableCameras, setAvailableCameras] = useState([])
  const [selectedCameraId, setSelectedCameraId] = useState('')
  const [facingMode, setFacingMode] = useState('environment')
  const [cameraRetryCount, setCameraRetryCount] = useState(0)

  // Upload & drag-and-drop states
  const [isDragging, setIsDragging] = useState(false)
  const [isProcessingImage, setIsProcessingImage] = useState(false)

  // Manual input state
  const [manualInput, setManualInput] = useState('')

  // General processing & error states
  const [isLookingUp, setIsLookingUp] = useState(false)
  const [scanError, setScanError] = useState(null)
  const [identifiedCard, setIdentifiedCard] = useState(null)

  // DOM Refs
  const videoRef = useRef(null)
  const canvasRef = useRef(null)
  const streamRef = useRef(null)
  const animFrameIdRef = useRef(null)
  const fileInputRef = useRef(null)
  const isLookingUpRef = useRef(false)

  // Keep ref in sync to prevent race conditions during animation frames
  useEffect(() => {
    isLookingUpRef.current = isLookingUp
  }, [isLookingUp])

  // Stop camera stream and animation loops safely
  const stopCameraStream = useCallback(() => {
    if (animFrameIdRef.current) {
      cancelAnimationFrame(animFrameIdRef.current)
      animFrameIdRef.current = null
    }

    if (streamRef.current) {
      try {
        streamRef.current.getTracks().forEach((track) => {
          track.stop()
        })
      } catch (err) {
        console.warn('Error stopping camera tracks:', err)
      }
      streamRef.current = null
    }

    if (videoRef.current) {
      videoRef.current.srcObject = null
    }

    setIsCameraActive(false)
  }, [])

  // Common pipeline for all input mechanisms (Camera, Upload, Drag & Drop, Manual)
  const processScannedContent = useCallback(
    async (rawContent) => {
      if (isLookingUpRef.current) return
      setIsLookingUp(true)
      setScanError(null)

      // 1. Validate URL & extract token
      const validation = validateTapMeQrUrl(rawContent)
      if (!validation.valid) {
        setScanError(validation.error)
        setIsLookingUp(false)
        return
      }

      // Stop camera once a valid card token is extracted
      stopCameraStream()

      // 2. Authenticated backend lookup
      const result = await lookupCardByToken(validation.token)

      if (!result.success) {
        setScanError(result.error)
        setIsLookingUp(false)
        return
      }

      // 3. Display identified card details
      setIdentifiedCard(result.card)
      setScannerMode('result')
      setIsLookingUp(false)
    },
    [stopCameraStream]
  )

  // Camera frame scanning loop using jsQR
  useEffect(() => {
    if (!isCameraActive || scannerMode !== 'scan' || activeTab !== 'camera') {
      return
    }

    const scanFrame = () => {
      const video = videoRef.current
      const canvas = canvasRef.current

      if (
        video &&
        canvas &&
        video.readyState === video.HAVE_ENOUGH_DATA &&
        !isLookingUpRef.current
      ) {
        const width = video.videoWidth
        const height = video.videoHeight

        if (width > 0 && height > 0) {
          canvas.width = width
          canvas.height = height
          const ctx = canvas.getContext('2d', { willReadFrequently: true })

          if (ctx) {
            ctx.drawImage(video, 0, 0, width, height)
            const imageData = ctx.getImageData(0, 0, width, height)

            const code = jsQR(imageData.data, width, height, {
              inversionAttempts: 'dontInvert',
            })

            if (code && code.data) {
              processScannedContent(code.data)
              return
            }
          }
        }
      }

      if (isCameraActive && !isLookingUpRef.current) {
        animFrameIdRef.current = requestAnimationFrame(scanFrame)
      }
    }

    animFrameIdRef.current = requestAnimationFrame(scanFrame)

    return () => {
      if (animFrameIdRef.current) {
        cancelAnimationFrame(animFrameIdRef.current)
        animFrameIdRef.current = null
      }
    }
  }, [isCameraActive, scannerMode, activeTab, processScannedContent])

  // Automatically request camera when user opens the Live Camera tab
  useEffect(() => {
    let isCancelled = false

    async function initCamera() {
      if (scannerMode !== 'scan' || activeTab !== 'camera') {
        stopCameraStream()
        return
      }

      if (!navigator?.mediaDevices?.getUserMedia) {
        setCameraError('Camera access is not supported by your browser or environment.')
        return
      }

      try {
        const constraints = {
          video: selectedCameraId
            ? { deviceId: { exact: selectedCameraId } }
            : { facingMode: { ideal: facingMode } },
          audio: false,
        }

        const stream = await navigator.mediaDevices.getUserMedia(constraints)
        if (isCancelled) {
          stream.getTracks().forEach((track) => track.stop())
          return
        }

        streamRef.current = stream

        if (videoRef.current) {
          videoRef.current.srcObject = stream
          videoRef.current.setAttribute('playsinline', 'true')
          await videoRef.current.play()
          setIsCameraActive(true)

          if (navigator.mediaDevices.enumerateDevices) {
            const devices = await navigator.mediaDevices.enumerateDevices()
            const videoDevices = devices.filter((d) => d.kind === 'videoinput')
            setAvailableCameras(videoDevices)
          }
        }
      } catch (err) {
        if (isCancelled) return
        console.error('Camera access error:', err)
        if (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError') {
          setCameraError(
            'Camera permission was denied. Please allow camera access in your browser address bar or use Image Upload / Manual Entry.'
          )
        } else if (err.name === 'NotFoundError' || err.name === 'DevicesNotFoundError') {
          setCameraError('No camera found on this device. Please use Image Upload or Manual Entry below.')
        } else if (err.name === 'NotReadableError' || err.name === 'TrackStartError') {
          setCameraError('Camera is currently in use by another application.')
        } else {
          setCameraError(`Camera initialization failed: ${err.message || 'unknown error'}`)
        }
        setIsCameraActive(false)
      }
    }

    initCamera()

    return () => {
      isCancelled = true
      stopCameraStream()
    }
  }, [scannerMode, activeTab, facingMode, selectedCameraId, cameraRetryCount, stopCameraStream])

  // Switch camera facing mode (environment <-> user)
  const toggleFacingMode = () => {
    setSelectedCameraId('')
    setFacingMode((prev) => (prev === 'environment' ? 'user' : 'environment'))
  }

  // Handle local image file decoding
  const handleImageFile = async (file) => {
    if (!file) return
    setIsProcessingImage(true)
    setScanError(null)

    try {
      const decoded = await decodeQrFromImageFile(file)
      if (!decoded.success) {
        setScanError(decoded.error)
        return
      }

      // Pass decoded content to common pipeline
      await processScannedContent(decoded.data)
    } finally {
      setIsProcessingImage(false)
      if (fileInputRef.current) {
        fileInputRef.current.value = ''
      }
    }
  }

  // Drag and drop handlers
  const handleDragOver = (e) => {
    e.preventDefault()
    e.stopPropagation()
    setIsDragging(true)
  }

  const handleDragLeave = (e) => {
    e.preventDefault()
    e.stopPropagation()
    setIsDragging(false)
  }

  const handleDrop = (e) => {
    e.preventDefault()
    e.stopPropagation()
    setIsDragging(false)

    const files = e.dataTransfer?.files
    if (files && files.length > 0) {
      handleImageFile(files[0])
    }
  }

  // Manual entry submission
  const handleManualSubmit = (e) => {
    e.preventDefault()
    if (!manualInput.trim()) return
    processScannedContent(manualInput)
  }

  // Reset to scanner mode to scan another card
  const handleScanAnother = () => {
    setIdentifiedCard(null)
    setScannerMode('scan')
    setScanError(null)
    setManualInput('')
    setActiveTab('camera')
  }

  const qrConfig = identifiedCard ? QR_TYPE_CONFIG[identifiedCard.qr_type] : null

  return (
    <div className="modal-backdrop">
      <div
        className="modal-container scan-modal-container"
        role="dialog"
        aria-modal="true"
        aria-labelledby="scanner-modal-title"
      >
        {/* Modal Header */}
        <div className="modal-header">
          <div className="modal-header-info">
            <h2 id="scanner-modal-title" className="modal-title">
              {scannerMode === 'scan' ? 'Scan Card QR' : 'Identified Card Details'}
            </h2>
            <p className="modal-subtitle">
              {scannerMode === 'scan'
                ? 'Identify physical preprinted cards by scanning their QR code'
                : `Permanent QR linked to card #${identifiedCard?.formatted_card_number || identifiedCard?.card_number}`}
            </p>
          </div>
          <button
            type="button"
            className="modal-close-btn"
            onClick={onClose}
            aria-label="Close scanner dialog"
          >
            ✕
          </button>
        </div>

        {/* Global Error Banner */}
        {scanError && (
          <div className="table-error-banner m-4" role="alert">
            <svg className="alert-icon" viewBox="0 0 20 20" fill="currentColor">
              <path
                fillRule="evenodd"
                d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z"
                clipRule="evenodd"
              />
            </svg>
            <div className="flex-1">
              <span>{scanError}</span>
            </div>
            <button
              type="button"
              className="text-slate-400 hover:text-white ml-2 text-sm"
              onClick={() => setScanError(null)}
              aria-label="Dismiss error"
            >
              ✕
            </button>
          </div>
        )}

        {/* Loading Overlay */}
        {isLookingUp && (
          <div className="scanner-loading-overlay">
            <div className="loading-spinner mb-3" />
            <p className="font-semibold text-sky-400">Looking up card in inventory...</p>
            <p className="text-xs text-slate-400 mt-1">Verifying permanent public token</p>
          </div>
        )}

        {/* MODE 1: SCANNING VIEW */}
        {scannerMode === 'scan' && (
          <div className="scanner-body">
            {/* Scanning Method Tabs */}
            <div className="scanner-tabs-bar">
              <button
                type="button"
                className={`scanner-tab-btn ${activeTab === 'camera' ? 'active' : ''}`}
                onClick={() => {
                  setScanError(null)
                  setActiveTab('camera')
                }}
              >
                <svg className="tab-icon" viewBox="0 0 20 20" fill="currentColor">
                  <path
                    fillRule="evenodd"
                    d="M4 5a2 2 0 00-2 2v8a2 2 0 002 2h12a2 2 0 002-2V7a2 2 0 00-2-2h-1.586a1 1 0 01-.707-.293l-1.121-1.121A2 2 0 0011.172 3H8.828a2 2 0 00-1.414.586L6.293 4.707A1 1 0 015.586 5H4zm6 9a3 3 0 100-6 3 3 0 000 6z"
                    clipRule="evenodd"
                  />
                </svg>
                <span>Live Camera</span>
              </button>

              <button
                type="button"
                className={`scanner-tab-btn ${activeTab === 'upload' ? 'active' : ''}`}
                onClick={() => {
                  setScanError(null)
                  setActiveTab('upload')
                }}
              >
                <svg className="tab-icon" viewBox="0 0 20 20" fill="currentColor">
                  <path
                    fillRule="evenodd"
                    d="M3 17a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1zM6.293 6.707a1 1 0 010-1.414l3-3a1 1 0 011.414 0l3 3a1 1 0 01-1.414 1.414L11 5.414V13a1 1 0 11-2 0V5.414L7.707 6.707a1 1 0 01-1.414 0z"
                    clipRule="evenodd"
                  />
                </svg>
                <span>Upload Image</span>
              </button>

              <button
                type="button"
                className={`scanner-tab-btn ${activeTab === 'manual' ? 'active' : ''}`}
                onClick={() => {
                  setScanError(null)
                  setActiveTab('manual')
                }}
              >
                <svg className="tab-icon" viewBox="0 0 20 20" fill="currentColor">
                  <path
                    fillRule="evenodd"
                    d="M12.586 4.586a2 2 0 112.828 2.828l-3 3a2 2 0 01-2.828 0 1 1 0 00-1.414 1.414 4 4 0 005.656 0l3-3a4 4 0 00-5.656-5.656l-1.5 1.5a1 1 0 101.414 1.414l1.5-1.5zm-5 5a2 2 0 012.828 0 1 1 0 101.414-1.414 4 4 0 00-5.656 0l-3 3a4 4 0 105.656 5.656l1.5-1.5a1 1 0 10-1.414-1.414l-1.5 1.5a2 2 0 11-2.828-2.828l3-3z"
                    clipRule="evenodd"
                  />
                </svg>
                <span>Manual Entry</span>
              </button>
            </div>

            {/* TAB 1: LIVE CAMERA */}
            {activeTab === 'camera' && (
              <div className="camera-view-container">
                {cameraError ? (
                  <div className="camera-error-box">
                    <svg className="camera-error-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                    </svg>
                    <p className="camera-error-text">{cameraError}</p>
                    <div className="camera-error-actions">
                      <button
                        type="button"
                        className="action-btn action-btn-secondary"
                        onClick={() => {
                          setCameraError(null)
                          setCameraRetryCount((c) => c + 1)
                        }}
                      >
                        Try Again
                      </button>
                      <button
                        type="button"
                        className="action-btn action-btn-primary"
                        onClick={() => setActiveTab('upload')}
                      >
                        Use Image Upload
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="camera-stream-wrapper">
                    <video
                      ref={videoRef}
                      className="camera-video-element"
                      playsInline
                      muted
                      autoPlay
                    />
                    <canvas ref={canvasRef} style={{ display: 'none' }} />

                    {/* Viewfinder Target Overlay */}
                    <div className="scanner-viewfinder">
                      <div className="viewfinder-laser" />
                      <div className="viewfinder-corner top-left" />
                      <div className="viewfinder-corner top-right" />
                      <div className="viewfinder-corner bottom-left" />
                      <div className="viewfinder-corner bottom-right" />
                    </div>

                    {/* Camera Control Overlay */}
                    <div className="camera-controls-overlay">
                      {availableCameras.length > 1 && (
                        <button
                          type="button"
                          className="camera-toggle-btn"
                          onClick={toggleFacingMode}
                          title="Switch Camera"
                        >
                          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-5 h-5">
                            <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                          </svg>
                          <span>Flip Camera</span>
                        </button>
                      )}
                      <span className="camera-hint-text">
                        Position the physical QR code inside the frame
                      </span>
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* TAB 2: UPLOAD IMAGE & DRAG-AND-DROP */}
            {activeTab === 'upload' && (
              <div
                className={`dropzone-container ${isDragging ? 'dragging' : ''}`}
                onDragOver={handleDragOver}
                onDragEnter={handleDragOver}
                onDragLeave={handleDragLeave}
                onDrop={handleDrop}
              >
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/png, image/jpeg, image/jpg, image/webp"
                  style={{ display: 'none' }}
                  onChange={(e) => {
                    if (e.target.files && e.target.files[0]) {
                      handleImageFile(e.target.files[0])
                    }
                  }}
                />

                <div className="dropzone-content">
                  <div className="dropzone-icon-wrap">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-10 h-10 text-sky-400">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                    </svg>
                  </div>

                  <h3 className="dropzone-title">
                    {isProcessingImage ? 'Decoding QR code from image...' : 'Drag and drop QR code image here'}
                  </h3>
                  <p className="dropzone-subtitle">
                    Supports PNG, JPG, JPEG, and WebP (up to 10MB). Image is processed 100% locally in your browser.
                  </p>

                  <button
                    type="button"
                    className="action-btn action-btn-primary mt-4"
                    disabled={isProcessingImage}
                    onClick={() => fileInputRef.current?.click()}
                  >
                    {isProcessingImage ? 'Processing...' : 'Browse QR Image'}
                  </button>
                </div>
              </div>
            )}

            {/* TAB 3: MANUAL ENTRY */}
            {activeTab === 'manual' && (
              <form onSubmit={handleManualSubmit} className="manual-entry-form">
                <div className="form-group mb-4">
                  <label htmlFor="manual-qr-input" className="form-label">
                    Public Redirect URL or Token
                  </label>
                  <input
                    id="manual-qr-input"
                    type="text"
                    className="form-input font-mono text-sm"
                    placeholder="https://tapme-ayd.pages.dev/r/<token> or raw token"
                    value={manualInput}
                    onChange={(e) => setManualInput(e.target.value)}
                    autoFocus
                  />
                  <p className="form-hint mt-1">
                    Paste the complete printed QR URL or the public token.
                  </p>
                </div>

                <div className="flex justify-end gap-3">
                  <button
                    type="button"
                    className="action-btn action-btn-secondary"
                    onClick={() => setManualInput('')}
                  >
                    Clear
                  </button>
                  <button
                    type="submit"
                    className="action-btn action-btn-primary"
                    disabled={!manualInput.trim()}
                  >
                    Look Up Card
                  </button>
                </div>
              </form>
            )}
          </div>
        )}

        {/* MODE 2: CARD RESULT SCREEN */}
        {scannerMode === 'result' && identifiedCard && (
          <div className="scanner-result-body">
            {/* Primary Details Summary Box */}
            <div className="result-summary-card">
              <div className="result-header-row">
                <div className="result-card-badge">
                  Card #{identifiedCard.formatted_card_number || identifiedCard.card_number}
                </div>

                {/* QR Type Badge */}
                <span
                  className="qr-type-badge text-sm font-semibold"
                  style={{
                    backgroundColor: qrConfig?.bg || '#1e293b',
                    color: qrConfig?.color || '#38bdf8',
                  }}
                >
                  {qrConfig?.label || identifiedCard.qr_type}
                </span>

                {/* Configuration Badge */}
                <span
                  className={`status-pill ${
                    identifiedCard.is_configured ? 'status-active' : 'status-unconfigured'
                  }`}
                >
                  {identifiedCard.is_configured ? 'Configured' : 'Unconfigured Preprinted'}
                </span>

                {/* Lifecycle Badge */}
                <span className={`status-pill status-${identifiedCard.status}`}>
                  {identifiedCard.status.charAt(0).toUpperCase() + identifiedCard.status.slice(1)}
                </span>
              </div>

              {/* Business Name & Location */}
              <div className="result-details-grid mt-4">
                <div className="detail-item">
                  <span className="detail-label">Business Name</span>
                  <span className="detail-value font-medium text-white">
                    {identifiedCard.business_name || '—'}
                  </span>
                </div>

                <div className="detail-item">
                  <span className="detail-label">Location</span>
                  <span className="detail-value text-slate-300">
                    {identifiedCard.location || '—'}
                  </span>
                </div>

                <div className="detail-item">
                  <span className="detail-label">Total Customer Scans</span>
                  <span className="detail-value font-bold text-sky-400">
                    {identifiedCard.total_scans ?? 0}
                  </span>
                </div>

                <div className="detail-item">
                  <span className="detail-label">Configured At</span>
                  <span className="detail-value text-slate-300 text-xs">
                    {identifiedCard.configured_at
                      ? new Date(identifiedCard.configured_at).toLocaleString()
                      : 'Never configured'}
                  </span>
                </div>
              </div>

              {/* Destination Links Summary */}
              <div className="result-links-section mt-4 pt-3 border-t border-slate-700/60">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs uppercase font-bold tracking-wider text-slate-400">
                    Configured Destination Links ({identifiedCard.links?.length || 0})
                  </span>
                </div>

                {identifiedCard.links && identifiedCard.links.length > 0 ? (
                  <div className="result-links-list">
                    {identifiedCard.links.map((link) => (
                      <div key={link.id} className="result-link-item">
                        <span className="result-link-platform font-semibold text-xs text-sky-300">
                          {link.platform}
                        </span>
                        <span className="result-link-label text-sm text-slate-200">
                          {link.label || 'Default Label'}
                        </span>
                        <span className="result-link-url text-xs text-slate-400 truncate max-w-xs">
                          {link.destination_url}
                        </span>
                        <span className={`text-xs ml-auto ${link.is_enabled ? 'text-emerald-400' : 'text-rose-400'}`}>
                          {link.is_enabled ? 'Enabled' : 'Disabled'}
                        </span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-xs text-slate-400 italic">
                    Zero destination links currently assigned. This preprinted card is ready to be configured.
                  </p>
                )}
              </div>
            </div>

            {/* Permission Warnings & Inactive Alerts */}
            {identifiedCard.is_configured && !isMainAdmin && (
              <div className="warning-box mt-3 text-sm">
                <svg className="w-5 h-5 text-amber-400 flex-shrink-0" viewBox="0 0 20 20" fill="currentColor">
                  <path
                    fillRule="evenodd"
                    d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z"
                    clipRule="evenodd"
                  />
                </svg>
                <span>
                  This card has already been configured. Editing already-configured cards requires Main Administrator access.
                </span>
              </div>
            )}

            {(identifiedCard.status === 'inactive' || identifiedCard.status === 'archived') && (
              <div className="info-box mt-3 text-sm">
                <span>
                  Card is currently <strong>{identifiedCard.status}</strong>. Lifecycle status changes require Main Administrator access.
                </span>
              </div>
            )}

            {/* Action Buttons */}
            <div className="result-actions-bar mt-6">
              <button
                type="button"
                className="action-btn action-btn-secondary"
                onClick={handleScanAnother}
              >
                Scan Another Card
              </button>

              {/* Action 1: Unconfigured card (Both Main Admin & Staff can configure) */}
              {!identifiedCard.is_configured && (
                <button
                  type="button"
                  className="action-btn action-btn-primary"
                  onClick={() => {
                    onClose()
                    onConfigureCard(identifiedCard)
                  }}
                >
                  Configure Card
                </button>
              )}

              {/* Action 2: Configured card (Main Admin only can edit) */}
              {identifiedCard.is_configured && isMainAdmin && (
                <button
                  type="button"
                  className="action-btn action-btn-primary"
                  onClick={() => {
                    onClose()
                    onEditCard(identifiedCard)
                  }}
                >
                  Edit Card
                </button>
              )}

              <button
                type="button"
                className="action-btn action-btn-secondary ml-auto"
                onClick={onClose}
              >
                Close
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
