import { useState, useEffect, useCallback } from 'react'
import { useAuth } from '../../context'
import { StaffTable } from './StaffTable'
import { CreateStaffModal } from './CreateStaffModal'
import { StaffConfirmationModal } from './StaffConfirmationModal'

export function StaffSection() {
  const { user, logout } = useAuth()
  const isMainAdmin = user?.role === 'main_admin'

  const [staffList, setStaffList] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [successBanner, setSuccessBanner] = useState(null)

  // Modal states
  const [isCreating, setIsCreating] = useState(false)
  const [actionModal, setActionModal] = useState({
    isOpen: false,
    staff: null,
    action: null,
    loading: false,
  })

  const fetchStaff = useCallback(async () => {
    if (!isMainAdmin) return

    try {
      setLoading(true)
      setError(null)

      const response = await fetch('/api/staff', {
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
        setError('Main Administrator permissions are required to manage staff accounts.')
        setStaffList([])
        return
      }

      const json = await response.json().catch(() => null)

      if (response.ok && json?.success && Array.isArray(json?.data)) {
        setStaffList(json.data)
      } else {
        setError(json?.error || 'Failed to load staff accounts.')
      }
    } catch (err) {
      console.error('Error fetching staff accounts:', err)
      setError('Network error while loading staff accounts. Please check your connection.')
    } finally {
      setLoading(false)
    }
  }, [isMainAdmin, logout])

  useEffect(() => {
    if (!isMainAdmin) return

    let isMounted = true

    fetch('/api/staff', {
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
            setError('Main Administrator permissions are required to manage staff accounts.')
            setStaffList([])
          }
          return null
        }
        return res.ok ? res.json() : null
      })
      .then((json) => {
        if (!isMounted || !json) return
        if (json.success && Array.isArray(json.data)) {
          setStaffList(json.data)
        } else {
          setError(json?.error || 'Failed to load staff accounts.')
        }
      })
      .catch((err) => {
        if (!isMounted) return
        console.error('Error fetching staff accounts:', err)
        setError('Network error while loading staff accounts. Please check your connection.')
      })
      .finally(() => {
        if (isMounted) {
          setLoading(false)
        }
      })

    return () => {
      isMounted = false
    }
  }, [isMainAdmin, logout])

  const handleOpenAction = (staff, action) => {
    if (!isMainAdmin) return
    setActionModal({
      isOpen: true,
      staff,
      action,
      loading: false,
    })
  }

  const handleCloseAction = () => {
    setActionModal({
      isOpen: false,
      staff: null,
      action: null,
      loading: false,
    })
  }

  const handleConfirmAction = async () => {
    const { staff, action } = actionModal
    if (!staff || !action) return

    setActionModal((prev) => ({ ...prev, loading: true }))

    try {
      const response = await fetch(`/api/staff/${staff.id}/${action}`, {
        method: 'POST',
        credentials: 'include',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
        },
      })

      if (response.status === 401) {
        await logout()
        return
      }

      const json = await response.json().catch(() => null)

      if (response.ok && json?.success) {
        const actionLabels = {
          activate: 'activated',
          deactivate: 'deactivated',
          remove: 'permanently removed',
        }
        const label = actionLabels[action] || `${action}d`

        setSuccessBanner(`Staff account "@${staff.username}" successfully ${label}.`)
        handleCloseAction()
        fetchStaff()
      } else {
        alert(json?.error || `Failed to ${action} staff account.`)
        setActionModal((prev) => ({ ...prev, loading: false }))
      }
    } catch (err) {
      console.error(`Error during staff ${action}:`, err)
      alert(`Network error while performing ${action}. Please check your connection.`)
      setActionModal((prev) => ({ ...prev, loading: false }))
    }
  }

  const handleStaffCreated = (newStaff) => {
    setSuccessBanner(`Staff account "@${newStaff.username}" created successfully.`)
    fetchStaff()
  }

  if (!isMainAdmin) {
    return (
      <div className="table-error-banner" role="alert">
        <svg className="alert-icon text-rose" viewBox="0 0 20 20" fill="currentColor">
          <path
            fillRule="evenodd"
            d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7 4a1 1 0 11-2 0 1 1 0 012 0zm-1-9a1 1 0 00-1 1v4a1 1 0 102 0V6a1 1 0 00-1-1z"
            clipRule="evenodd"
          />
        </svg>
        <span>Access restricted. Only Main Administrators may access Staff Management.</span>
      </div>
    )
  }

  return (
    <div className="staff-section">
      {/* Success Notification Banner */}
      {successBanner && (
        <div className="success-banner" role="status">
          <svg className="alert-icon text-emerald" viewBox="0 0 20 20" fill="currentColor">
            <path
              fillRule="evenodd"
              d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z"
              clipRule="evenodd"
            />
          </svg>
          <span>{successBanner}</span>
          <button
            type="button"
            className="modal-close-btn"
            style={{ marginLeft: 'auto' }}
            onClick={() => setSuccessBanner(null)}
            aria-label="Dismiss banner"
          >
            ✕
          </button>
        </div>
      )}

      {/* Staff Table */}
      <StaffTable
        staffList={staffList}
        loading={loading}
        error={error}
        onRefresh={fetchStaff}
        onCreateStaff={() => setIsCreating(true)}
        onAction={handleOpenAction}
      />

      {/* Create Staff Modal */}
      <CreateStaffModal
        isOpen={isCreating}
        onClose={() => setIsCreating(false)}
        onStaffCreated={handleStaffCreated}
      />

      {/* Confirmation Dialog for Destructive Actions */}
      <StaffConfirmationModal
        isOpen={actionModal.isOpen}
        staff={actionModal.staff}
        action={actionModal.action}
        loading={actionModal.loading}
        onConfirm={handleConfirmAction}
        onClose={handleCloseAction}
      />
    </div>
  )
}
