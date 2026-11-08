import { useState, useEffect, useCallback } from 'react'
import { useAuth } from '../../context'
import { CardsTable } from './CardsTable'
import { CreateCardModal } from './CreateCardModal'
import { CardDetailsModal } from './CardDetailsModal'
import { EditCardModal } from './EditCardModal'
import { ConfirmationModal } from './ConfirmationModal'
import { ScanCardModal } from './ScanCardModal'

export function CardsSection() {
  const { user, logout } = useAuth()
  const isMainAdmin = user?.role === 'main_admin'

  const [cards, setCards] = useState([])
  const [statusFilter, setStatusFilter] = useState('')
  const [pagination, setPagination] = useState({
    page: 1,
    limit: 10,
    total: 0,
    total_pages: 1,
  })
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [successBanner, setSuccessBanner] = useState(null)

  // Modal states
  const [isCreating, setIsCreating] = useState(false)
  const [isScanning, setIsScanning] = useState(false)
  const [viewingCardId, setViewingCardId] = useState(null)
  const [editingCard, setEditingCard] = useState(null)

  // Lifecycle confirmation modal state
  const [lifecycleModal, setLifecycleModal] = useState({
    isOpen: false,
    card: null,
    action: null,
    loading: false,
  })

  const fetchCards = useCallback(
    async (pageToLoad = 1, currentFilter = statusFilter) => {
      try {
        setLoading(true)
        setError(null)

        const filterQuery = currentFilter
          ? `&status=${encodeURIComponent(currentFilter)}`
          : ''
        const response = await fetch(
          `/api/cards?page=${pageToLoad}&limit=10${filterQuery}`,
          {
            method: 'GET',
            credentials: 'include',
            headers: {
              Accept: 'application/json',
            },
          }
        )

        if (response.status === 401) {
          await logout()
          return
        }

        const json = await response.json().catch(() => null)

        if (response.ok && json?.success && json?.data) {
          setCards(json.data.cards || [])
          setPagination(
            json.data.pagination || {
              page: pageToLoad,
              limit: 10,
              total: 0,
              total_pages: 1,
            }
          )
        } else {
          setError(json?.error || 'Failed to load cards.')
        }
      } catch (err) {
        console.error('Error fetching cards:', err)
        setError('Network error while loading cards. Please check your connection.')
      } finally {
        setLoading(false)
      }
    },
    [logout, statusFilter]
  )

  useEffect(() => {
    let isMounted = true

    fetch('/api/cards?page=1&limit=10', {
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
        return res.ok ? res.json() : null
      })
      .then((json) => {
        if (!isMounted || !json) return
        if (json.success && json.data) {
          setCards(json.data.cards || [])
          setPagination(
            json.data.pagination || {
              page: 1,
              limit: 10,
              total: 0,
              total_pages: 1,
            }
          )
        } else {
          setError(json?.error || 'Failed to load cards.')
        }
      })
      .catch((err) => {
        if (!isMounted) return
        console.error('Error fetching cards:', err)
        setError('Network error while loading cards. Please check your connection.')
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

  const handleStatusFilterChange = (newFilter) => {
    setStatusFilter(newFilter)
    fetchCards(1, newFilter)
  }

  const handlePageChange = (newPage) => {
    fetchCards(newPage, statusFilter)
  }

  const handleRefresh = () => {
    fetchCards(pagination.page, statusFilter)
  }

  const handleCardCreated = (newCard) => {
    setSuccessBanner(
      `Card #${newCard.formatted_card_number || newCard.card_number} created for "${newCard.business_name}".`
    )
    fetchCards(1, statusFilter)
  }

  const handleCardUpdated = (updatedCard) => {
    setEditingCard(null)
    setViewingCardId(updatedCard.card_number)
    setSuccessBanner(
      `Card #${updatedCard.formatted_card_number || updatedCard.card_number} updated successfully.`
    )
    fetchCards(pagination.page, statusFilter)
  }

  const handleOpenEdit = async (cardNumber) => {
    try {
      const response = await fetch(`/api/cards/${cardNumber}`, {
        method: 'GET',
        credentials: 'include',
        headers: { Accept: 'application/json' },
      })
      const json = await response.json().catch(() => null)
      if (response.ok && json?.success && json?.data) {
        if (json.data.status === 'archived') {
          alert('Archived cards cannot be edited. Please restore the card first.')
          return
        }
        if (!isMainAdmin && json.data.is_configured) {
          alert('Staff members are not permitted to edit already-configured cards.')
          return
        }
        setViewingCardId(null)
        setEditingCard(json.data)
      } else {
        alert(json?.error || 'Failed to load card for editing.')
      }
    } catch (err) {
      console.error('Failed to load card for editing:', err)
      alert('Network error while opening edit mode.')
    }
  }

  const handleOpenLifecycle = (card, action) => {
    if (!isMainAdmin) return
    setLifecycleModal({
      isOpen: true,
      card,
      action,
      loading: false,
    })
  }

  const handleCloseLifecycle = () => {
    setLifecycleModal({
      isOpen: false,
      card: null,
      action: null,
      loading: false,
    })
  }

  const handleConfirmLifecycle = async () => {
    const { card, action } = lifecycleModal
    if (!card || !action) return

    setLifecycleModal((prev) => ({ ...prev, loading: true }))

    try {
      const response = await fetch(`/api/cards/${card.card_number}/${action}`, {
        method: 'POST',
        credentials: 'include',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
        },
      })

      const json = await response.json().catch(() => null)

      if (response.ok && json?.success) {
        const cardNum =
          json.data.formatted_card_number ||
          String(json.data.card_number).padStart(3, '0')

        const actionTextMap = {
          activate: 'activated',
          deactivate: 'deactivated',
          archive: 'archived',
          restore: 'restored to inactive',
        }
        const actionLabel = actionTextMap[action] || `${action}d`

        setSuccessBanner(
          `Card #${cardNum} successfully ${actionLabel}.`
        )
        handleCloseLifecycle()
        // If details modal was open for this card, close or update
        setViewingCardId(null)
        // Refresh cards
        fetchCards(pagination.page, statusFilter)
      } else {
        alert(json?.error || `Failed to ${action} card.`)
        setLifecycleModal((prev) => ({ ...prev, loading: false }))
      }
    } catch (err) {
      console.error(`Error during card ${action}:`, err)
      alert(`Network error while performing ${action}.`)
      setLifecycleModal((prev) => ({ ...prev, loading: false }))
    }
  }

  return (
    <div className="cards-section">
      {/* Success Notification Banner */}
      {successBanner && (
        <div className="success-banner mb-4" role="status">
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
            className="modal-close-btn ml-auto"
            onClick={() => setSuccessBanner(null)}
            aria-label="Dismiss banner"
          >
            ✕
          </button>
        </div>
      )}

      {/* Main Table */}
      <CardsTable
        cards={cards}
        pagination={pagination}
        loading={loading}
        error={error}
        statusFilter={statusFilter}
        onStatusFilterChange={handleStatusFilterChange}
        onPageChange={handlePageChange}
        onViewCard={(cardNum) => setViewingCardId(cardNum)}
        onEditCard={(cardNum) => handleOpenEdit(cardNum)}
        onLifecycleAction={handleOpenLifecycle}
        onRefresh={handleRefresh}
        onCreateCard={() => setIsCreating(true)}
        onScanCard={() => setIsScanning(true)}
        isMainAdmin={isMainAdmin}
      />

      {/* QR Inventory Scanner Modal */}
      {isScanning && (
        <ScanCardModal
          onClose={() => setIsScanning(false)}
          onConfigureCard={(card) => {
            setIsScanning(false)
            setEditingCard(card)
          }}
          onEditCard={(card) => {
            setIsScanning(false)
            setEditingCard(card)
          }}
          isMainAdmin={isMainAdmin}
        />
      )}

      {/* Create Card Dialog */}
      {isCreating && (
        <CreateCardModal
          onClose={() => setIsCreating(false)}
          onCardCreated={handleCardCreated}
        />
      )}

      {/* View Card Details Dialog */}
      {viewingCardId !== null && (
        <CardDetailsModal
          cardId={viewingCardId}
          onClose={() => setViewingCardId(null)}
          onEdit={(cardToEdit) => {
            setViewingCardId(null)
            setEditingCard(cardToEdit)
          }}
          onLifecycleAction={handleOpenLifecycle}
          isMainAdmin={isMainAdmin}
        />
      )}

      {/* Edit / Configure Card Dialog */}
      {editingCard !== null && (isMainAdmin || !editingCard.is_configured) && (
        <EditCardModal
          card={editingCard}
          onClose={() => setEditingCard(null)}
          onCardUpdated={handleCardUpdated}
          isMainAdmin={isMainAdmin}
        />
      )}

      {/* Confirmation Dialog for Lifecycle Actions */}
      <ConfirmationModal
        isOpen={lifecycleModal.isOpen}
        card={lifecycleModal.card}
        action={lifecycleModal.action}
        loading={lifecycleModal.loading}
        onConfirm={handleConfirmLifecycle}
        onClose={handleCloseLifecycle}
      />
    </div>
  )
}
