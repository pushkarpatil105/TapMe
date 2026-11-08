import { useState, useEffect, useCallback, useMemo } from 'react'
import { useAuth } from '../../context'
import { CardsTable } from './CardsTable'
import { CreateCardModal } from './CreateCardModal'
import { CardDetailsModal } from './CardDetailsModal'
import { EditCardModal } from './EditCardModal'
import { ConfirmationModal } from './ConfirmationModal'
import { ScanCardModal } from './ScanCardModal'
import { filterCards, sortCards } from '../../utils/card-workflow'

const PAGE_SIZE = 10

export function CardsSection() {
  const { user, logout } = useAuth()
  const isMainAdmin = user?.role === 'main_admin'

  const [cards, setCards] = useState([])
  const [statusFilter, setStatusFilter] = useState('')
  const [typeFilter, setTypeFilter] = useState('')
  const [searchQuery, setSearchQuery] = useState('')
  const [sortBy, setSortBy] = useState('created_desc')
  const [currentPage, setCurrentPage] = useState(1)
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
    async (currentFilter = statusFilter) => {
      try {
        setLoading(true)
        setError(null)

        const filterQuery = currentFilter
          ? `&status=${encodeURIComponent(currentFilter)}`
          : ''
        // Fetch up to 100 cards from backend within worker safe limit for client-side search & sort
        const response = await fetch(
          `/api/cards?page=1&limit=100${filterQuery}`,
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

    fetch('/api/cards?page=1&limit=100', {
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
    setCurrentPage(1)
    fetchCards(newFilter)
  }

  const handleTypeFilterChange = (newType) => {
    setTypeFilter(newType)
    setCurrentPage(1)
  }

  const handleSearchChange = (newQuery) => {
    setSearchQuery(newQuery)
    setCurrentPage(1)
  }

  const handleSortChange = (newSort) => {
    setSortBy(newSort)
    setCurrentPage(1)
  }

  const handlePageChange = (newPage) => {
    setCurrentPage(newPage)
  }

  const handleRefresh = () => {
    fetchCards(statusFilter)
  }

  // Reactive filtering and non-mutating sorting
  const filteredCards = useMemo(() => {
    return filterCards(cards, searchQuery, typeFilter)
  }, [cards, searchQuery, typeFilter])

  const sortedCards = useMemo(() => {
    return sortCards(filteredCards, sortBy)
  }, [filteredCards, sortBy])

  const totalFilteredCount = sortedCards.length
  const totalPages = Math.max(1, Math.ceil(totalFilteredCount / PAGE_SIZE))
  const safePage = Math.min(currentPage, totalPages)

  const pagedCards = useMemo(() => {
    const start = (safePage - 1) * PAGE_SIZE
    return sortedCards.slice(start, start + PAGE_SIZE)
  }, [sortedCards, safePage])

  const handleCardCreated = (newCard) => {
    setSuccessBanner(
      `Card #${newCard.formatted_card_number || newCard.card_number} created for "${newCard.business_name}".`
    )
    fetchCards(statusFilter)
  }

  const handleCardUpdated = (updatedCard) => {
    setEditingCard(null)
    setViewingCardId(updatedCard.card_number)
    setSuccessBanner(
      `Card #${updatedCard.formatted_card_number || updatedCard.card_number} updated successfully.`
    )
    fetchCards(statusFilter)
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
        fetchCards(statusFilter)
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

      {/* 1. High-Priority Prominent Card Scanner Hero */}
      <div className="cards-scanner-hero" role="region" aria-label="Card Scanner Action">
        <div className="scanner-hero-body">
          <div className="scanner-hero-icon-pill" aria-hidden="true">
            <svg
              className="scanner-hero-icon"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <rect x="3" y="3" width="7" height="7" />
              <rect x="14" y="3" width="7" height="7" />
              <rect x="14" y="14" width="7" height="7" />
              <rect x="3" y="14" width="7" height="7" />
            </svg>
          </div>
          <div className="scanner-hero-text">
            <h3 className="scanner-hero-title">Smart Card &amp; QR Scanner</h3>
            <p className="scanner-hero-desc">
              Scan or look up any NFC smart business card or QR code to verify destination links, view scan analytics, or configure blank preprinted cards.
            </p>
          </div>
        </div>
        <button
          type="button"
          className="scanner-hero-btn"
          onClick={() => setIsScanning(true)}
          aria-label="Open Card Scanner"
        >
          <svg className="btn-icon" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
            <path
              fillRule="evenodd"
              d="M3 4a1 1 0 011-1h3a1 1 0 011 1v3a1 1 0 01-1 1H4a1 1 0 01-1-1V4zm2 2V5h1v1H5zM3 13a1 1 0 011-1h3a1 1 0 011 1v3a1 1 0 01-1 1H4a1 1 0 01-1-1v-3zm2 2v-1h1v1H5zM13 3a1 1 0 00-1 1v3a1 1 0 001 1h3a1 1 0 001-1V4a1 1 0 00-1-1h-3zm1 2v1h1V5h-1z"
              clipRule="evenodd"
            />
            <path d="M11 12a1 1 0 011-1h1a1 1 0 011 1v1a1 1 0 01-1 1h-1a1 1 0 01-1-1v-1zm4 0a1 1 0 011-1h1a1 1 0 011 1v1a1 1 0 01-1 1h-1a1 1 0 01-1-1v-1zm-4 4a1 1 0 011-1h1a1 1 0 011 1v1a1 1 0 01-1 1h-1a1 1 0 01-1-1v-1zm4 0a1 1 0 011-1h1a1 1 0 011 1v1a1 1 0 01-1 1h-1a1 1 0 01-1-1v-1z" />
          </svg>
          <span>Launch Scanner</span>
        </button>
      </div>

      {/* Main Table & Inventory Toolbar */}
      <CardsTable
        cards={pagedCards}
        totalCount={totalFilteredCount}
        rawCount={cards.length}
        currentPage={safePage}
        totalPages={totalPages}
        pageSize={PAGE_SIZE}
        loading={loading}
        error={error}
        statusFilter={statusFilter}
        onStatusFilterChange={handleStatusFilterChange}
        typeFilter={typeFilter}
        onTypeFilterChange={handleTypeFilterChange}
        searchQuery={searchQuery}
        onSearchChange={handleSearchChange}
        sortBy={sortBy}
        onSortChange={handleSortChange}
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
