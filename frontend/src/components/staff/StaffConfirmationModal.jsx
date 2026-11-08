export function StaffConfirmationModal({
  isOpen,
  staff,
  action,
  loading,
  onConfirm,
  onClose,
}) {
  if (!isOpen || !staff || !action) return null

  const actionConfig = {
    activate: {
      title: 'Activate Staff Account',
      message: `Are you sure you want to activate the account for "${staff.username}"? The staff member will be allowed to log in and manage cards.`,
      confirmText: 'Activate Account',
      btnClass: 'action-btn-primary',
      iconClass: 'text-emerald',
      icon: (
        <svg className="modal-alert-icon text-emerald" viewBox="0 0 20 20" fill="currentColor">
          <path
            fillRule="evenodd"
            d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z"
            clipRule="evenodd"
          />
        </svg>
      ),
    },
    deactivate: {
      title: 'Deactivate Staff Account',
      message: `Are you sure you want to deactivate the account for "${staff.username}"? All active login sessions will be revoked immediately and they will be prevented from logging in until reactivated.`,
      confirmText: 'Deactivate Account',
      btnClass: 'action-btn-warning',
      iconClass: 'text-amber',
      icon: (
        <svg className="modal-alert-icon text-amber" viewBox="0 0 20 20" fill="currentColor">
          <path
            fillRule="evenodd"
            d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z"
            clipRule="evenodd"
          />
        </svg>
      ),
    },
    remove: {
      title: 'Remove Staff Account',
      message: `Are you sure you want to permanently remove "${staff.username}"? The account will be soft-deleted and all active sessions will be revoked. Warning: Per security policy, removed accounts cannot be reactivated.`,
      confirmText: 'Remove Account',
      btnClass: 'action-btn-danger',
      iconClass: 'text-rose',
      icon: (
        <svg className="modal-alert-icon text-rose" viewBox="0 0 20 20" fill="currentColor">
          <path
            fillRule="evenodd"
            d="M4 3a2 2 0 100 4h12a2 2 0 100-4H4zm3 8a1 1 0 011-1h4a1 1 0 110 2H8a1 1 0 01-1-1z"
            clipRule="evenodd"
          />
          <path d="M3 8v8a2 2 0 002 2h10a2 2 0 002-2V8H3z" />
        </svg>
      ),
    },
  }

  const current = actionConfig[action] || {
    title: 'Confirm Action',
    message: 'Are you sure you want to proceed?',
    confirmText: 'Confirm',
    btnClass: 'action-btn-primary',
    icon: null,
  }

  return (
    <div className="modal-backdrop" onClick={loading ? undefined : onClose}>
      <div
        className="modal-container modal-sm"
        role="dialog"
        aria-modal="true"
        aria-labelledby="staff-confirm-title"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-header">
          <div className="modal-header-info">
            {current.icon}
            <h2 id="staff-confirm-title" className="modal-title">
              {current.title}
            </h2>
          </div>
          <button
            type="button"
            className="modal-close-btn"
            onClick={onClose}
            disabled={loading}
            aria-label="Close dialog"
          >
            ✕
          </button>
        </div>

        <div className="modal-body">
          <p className="modal-message">{current.message}</p>
        </div>

        <div className="modal-footer">
          <button
            type="button"
            className="action-btn action-btn-secondary"
            onClick={onClose}
            disabled={loading}
          >
            Cancel
          </button>
          <button
            type="button"
            className={`action-btn ${current.btnClass}`}
            onClick={onConfirm}
            disabled={loading}
          >
            {loading ? (
              <>
                <svg className="btn-icon spin" viewBox="0 0 20 20" fill="currentColor">
                  <path
                    fillRule="evenodd"
                    d="M4 2a1 1 0 011 1v2.101a7.002 7.002 0 0111.601 2.566 1 1 0 11-1.885.666A5.002 5.002 0 005.999 7H9a1 1 0 010 2H4a1 1 0 01-1-1V3a1 1 0 011-1zm.008 9.057a1 1 0 011.276.61A5.002 5.002 0 0014.001 13H11a1 1 0 110-2h5a1 1 0 011 1v5a1 1 0 11-2 0v-2.101a7.002 7.002 0 01-11.601-2.566 1 1 0 01.61-1.276z"
                    clipRule="evenodd"
                  />
                </svg>
                <span>Processing...</span>
              </>
            ) : (
              <span>{current.confirmText}</span>
            )}
          </button>
        </div>
      </div>
    </div>
  )
}

