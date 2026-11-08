import { useState } from 'react'
import { validateStaffInput } from '../../utils/staff-management'

export function CreateStaffModal({ isOpen, onClose, onStaffCreated }) {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [showConfirmPassword, setShowConfirmPassword] = useState(false)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [errorMessage, setErrorMessage] = useState('')

  if (!isOpen) return null

  const resetForm = () => {
    setUsername('')
    setPassword('')
    setConfirmPassword('')
    setShowPassword(false)
    setShowConfirmPassword(false)
    setIsSubmitting(false)
    setErrorMessage('')
  }

  const handleClose = () => {
    if (isSubmitting) return
    resetForm()
    onClose()
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    setErrorMessage('')

    const validation = validateStaffInput({
      username,
      password,
      confirmPassword,
    })

    if (!validation.valid) {
      setErrorMessage(validation.error)
      return
    }

    try {
      setIsSubmitting(true)

      const response = await fetch('/api/staff', {
        method: 'POST',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify({
          username: username.trim(),
          password,
        }),
      })

      const json = await response.json().catch(() => null)

      if (response.ok && json?.success) {
        resetForm()
        onStaffCreated(json.data)
        onClose()
      } else {
        setErrorMessage(json?.error || 'Failed to create staff account.')
      }
    } catch (err) {
      console.error('Error creating staff account:', err)
      setErrorMessage('Network error while creating staff account. Please try again.')
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <div className="modal-backdrop" onClick={handleClose}>
      <div
        className="modal-container modal-sm"
        role="dialog"
        aria-modal="true"
        aria-labelledby="create-staff-title"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-header">
          <div className="modal-header-info">
            <svg
              className="modal-alert-icon text-primary"
              viewBox="0 0 20 20"
              fill="currentColor"
              aria-hidden="true"
            >
              <path d="M8 9a3 3 0 100-6 3 3 0 000 6zM8 11a6 6 0 016 6H2a6 6 0 016-6zM16 7a1 1 0 10-2 0v1h-1a1 1 0 100 2h1v1a1 1 0 102 0v-1h1a1 1 0 100-2h-1V7z" />
            </svg>
            <h2 id="create-staff-title" className="modal-title">
              Create Staff Account
            </h2>
          </div>
          <button
            type="button"
            className="modal-close-btn"
            onClick={handleClose}
            disabled={isSubmitting}
            aria-label="Close dialog"
          >
            ✕
          </button>
        </div>

        <form onSubmit={handleSubmit} noValidate>
          <div className="modal-body">
            {errorMessage && (
              <div className="table-error-banner" role="alert">
                <svg className="alert-icon text-rose" viewBox="0 0 20 20" fill="currentColor">
                  <path
                    fillRule="evenodd"
                    d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7 4a1 1 0 11-2 0 1 1 0 012 0zm-1-9a1 1 0 00-1 1v4a1 1 0 102 0V6a1 1 0 00-1-1z"
                    clipRule="evenodd"
                  />
                </svg>
                <span>{errorMessage}</span>
              </div>
            )}

            <div className="input-group">
              <label htmlFor="staff-username" className="form-label">
                Username
              </label>
              <div className="input-wrapper">
                <svg
                  className="input-icon"
                  viewBox="0 0 20 20"
                  fill="currentColor"
                  aria-hidden="true"
                >
                  <path
                    fillRule="evenodd"
                    d="M10 9a3 3 0 100-6 3 3 0 000 6zm-7 9a7 7 0 1114 0H3z"
                    clipRule="evenodd"
                  />
                </svg>
                <input
                  id="staff-username"
                  type="text"
                  className="form-input"
                  placeholder="e.g. staff_alex"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  disabled={isSubmitting}
                  autoComplete="off"
                  autoFocus
                />
              </div>
              <span className="form-help-text">
                3-50 characters. Letters, numbers, and . _ - @
              </span>
            </div>

            <div className="input-group">
              <label htmlFor="staff-password" className="form-label">
                Password
              </label>
              <div className="input-wrapper">
                <svg
                  className="input-icon"
                  viewBox="0 0 20 20"
                  fill="currentColor"
                  aria-hidden="true"
                >
                  <path
                    fillRule="evenodd"
                    d="M5 9V7a5 5 0 0110 0v2a2 2 0 012 2v5a2 2 0 01-2 2H5a2 2 0 01-2-2v-5a2 2 0 012-2zm8-2v2H7V7a3 3 0 016 0z"
                    clipRule="evenodd"
                  />
                </svg>
                <input
                  id="staff-password"
                  type={showPassword ? 'text' : 'password'}
                  className="form-input form-input-with-button"
                  placeholder="Minimum 12 characters"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  disabled={isSubmitting}
                  autoComplete="new-password"
                />
                <button
                  type="button"
                  className="password-toggle-btn"
                  onClick={() => setShowPassword(!showPassword)}
                  aria-label={showPassword ? 'Hide password' : 'Show password'}
                  tabIndex={-1}
                >
                  <svg className="toggle-icon" viewBox="0 0 20 20" fill="currentColor">
                    {showPassword ? (
                      <path
                        fillRule="evenodd"
                        d="M3.707 2.293a1 1 0 00-1.414 1.414l14 14a1 1 0 001.414-1.414l-1.473-1.473A10.014 10.014 0 0019.542 10C18.268 5.943 14.478 3 10 3a9.958 9.958 0 00-4.512 1.074l-1.78-1.781zm4.261 4.26l1.514 1.515a2.003 2.003 0 012.45 2.45l1.514 1.514a4 4 0 00-5.478-5.478z"
                        clipRule="evenodd"
                      />
                    ) : (
                      <path d="M10 12a2 2 0 100-4 2 2 0 000 4z" />
                    )}
                  </svg>
                </button>
              </div>
              <span className="form-help-text">Must be at least 12 characters</span>
            </div>

            <div className="input-group">
              <label htmlFor="staff-confirm-password" className="form-label">
                Confirm Password
              </label>
              <div className="input-wrapper">
                <svg
                  className="input-icon"
                  viewBox="0 0 20 20"
                  fill="currentColor"
                  aria-hidden="true"
                >
                  <path
                    fillRule="evenodd"
                    d="M2.166 4.999A11.954 11.954 0 0010 1.944 11.954 11.954 0 0017.834 5c.11.65.166 1.32.166 2.001 0 5.225-3.34 9.67-8 11.317C5.34 16.67 2 12.225 2 7c0-.682.057-1.35.166-2.001zm11.541 3.708a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z"
                    clipRule="evenodd"
                  />
                </svg>
                <input
                  id="staff-confirm-password"
                  type={showConfirmPassword ? 'text' : 'password'}
                  className="form-input form-input-with-button"
                  placeholder="Re-enter password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  disabled={isSubmitting}
                  autoComplete="new-password"
                />
                <button
                  type="button"
                  className="password-toggle-btn"
                  onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                  aria-label={showConfirmPassword ? 'Hide password' : 'Show password'}
                  tabIndex={-1}
                >
                  <svg className="toggle-icon" viewBox="0 0 20 20" fill="currentColor">
                    {showConfirmPassword ? (
                      <path
                        fillRule="evenodd"
                        d="M3.707 2.293a1 1 0 00-1.414 1.414l14 14a1 1 0 001.414-1.414l-1.473-1.473A10.014 10.014 0 0019.542 10C18.268 5.943 14.478 3 10 3a9.958 9.958 0 00-4.512 1.074l-1.78-1.781zm4.261 4.26l1.514 1.515a2.003 2.003 0 012.45 2.45l1.514 1.514a4 4 0 00-5.478-5.478z"
                        clipRule="evenodd"
                      />
                    ) : (
                      <path d="M10 12a2 2 0 100-4 2 2 0 000 4z" />
                    )}
                  </svg>
                </button>
              </div>
            </div>
          </div>

          <div className="modal-footer">
            <button
              type="button"
              className="action-btn action-btn-secondary"
              onClick={handleClose}
              disabled={isSubmitting}
            >
              Cancel
            </button>
            <button
              type="submit"
              className="action-btn action-btn-primary"
              disabled={isSubmitting}
            >
              {isSubmitting ? (
                <>
                  <svg className="btn-icon spin" viewBox="0 0 20 20" fill="currentColor">
                    <path
                      fillRule="evenodd"
                      d="M4 2a1 1 0 011 1v2.101a7.002 7.002 0 0111.601 2.566 1 1 0 11-1.885.666A5.002 5.002 0 005.999 7H9a1 1 0 010 2H4a1 1 0 01-1-1V3a1 1 0 011-1zm.008 9.057a1 1 0 011.276.61A5.002 5.002 0 0014.001 13H11a1 1 0 110-2h5a1 1 0 011 1v5a1 1 0 11-2 0v-2.101a7.002 7.002 0 01-11.601-2.566 1 1 0 01.61-1.276z"
                      clipRule="evenodd"
                    />
                  </svg>
                  <span>Creating Account...</span>
                </>
              ) : (
                <span>Create Staff Account</span>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
