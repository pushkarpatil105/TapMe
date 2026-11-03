import { useState } from 'react'
import { useAuth } from '../context'
import { CardsSection } from './cards/CardsSection'

export function Dashboard() {
  const { user, logout } = useAuth()
  const [isLoggingOut, setIsLoggingOut] = useState(false)

  const handleLogout = async () => {
    setIsLoggingOut(true)
    await logout()
  }

  const isMainAdmin = user?.role === 'main_admin'
  const roleLabel = isMainAdmin ? 'Main Administrator' : 'Staff Member'

  return (
    <div className="dashboard-viewport">
      {/* Top Navigation Bar */}
      <header className="dashboard-nav">
        <div className="nav-container">
          <div className="brand-group">
            <div className="nav-badge" aria-hidden="true">
              <svg
                className="nav-brand-icon"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M6 8.32a7.43 7.43 0 0 1 0 7.36" />
                <path d="M9.46 6.21a11.76 11.76 0 0 1 0 11.58" />
                <path d="M12.91 4.1a15.91 15.91 0 0 1 0 15.8" />
                <path d="M16.37 2a20.16 20.16 0 0 1 0 20" />
              </svg>
            </div>
            <span className="brand-name">TapMe</span>
            <span className="nav-portal-badge">Admin</span>
          </div>

          <div className="nav-user-actions">
            <div className="user-profile-snippet">
              <div className="user-avatar" aria-hidden="true">
                {user?.username ? user.username.charAt(0).toUpperCase() : 'A'}
              </div>
              <div className="user-info">
                <span className="user-name">{user?.username}</span>
                <span className={`role-badge ${isMainAdmin ? 'role-main' : 'role-staff'}`}>
                  {roleLabel}
                </span>
              </div>
            </div>

            <button
              type="button"
              className="logout-button"
              onClick={handleLogout}
              disabled={isLoggingOut}
              aria-label="Log out of admin session"
            >
              {isLoggingOut ? (
                <span>Signing out...</span>
              ) : (
                <>
                  <svg
                    className="logout-icon"
                    viewBox="0 0 20 20"
                    fill="currentColor"
                    aria-hidden="true"
                  >
                    <path
                      fillRule="evenodd"
                      d="M3 3a1 1 0 00-1 1v12a1 1 0 102 0V4a1 1 0 00-1-1zm10.293 9.293a1 1 0 001.414 1.414l3-3a1 1 0 000-1.414l-3-3a1 1 0 10-1.414 1.414L14.586 9H7a1 1 0 100 2h7.586l-1.293 1.293z"
                      clipRule="evenodd"
                    />
                  </svg>
                  <span>Sign Out</span>
                </>
              )}
            </button>
          </div>
        </div>
      </header>

      {/* Main Content Area */}
      <main className="dashboard-main">
        <div className="dashboard-container">
          {/* Welcome Banner Card */}
          <section className="welcome-card">
            <div className="welcome-content">
              <div className="welcome-tag">
                <span className="live-indicator" />
                Session Active (HttpOnly Cookie)
              </div>
              <h1 className="welcome-title">
                Welcome back, <span className="welcome-highlight">{user?.username}</span>!
              </h1>
              <p className="welcome-desc">
                You are currently signed in as{' '}
                <strong className={isMainAdmin ? 'text-primary' : 'text-secondary'}>
                  {roleLabel}
                </strong>
                . Phase 1 authentication is active.
              </p>
            </div>
            <div className="admin-meta-pills">
              <div className="meta-pill">
                <span className="meta-label">Admin ID</span>
                <code className="meta-value">{user?.id}</code>
              </div>
              <div className="meta-pill">
                <span className="meta-label">Access Level</span>
                <span className="meta-value role-text">{user?.role}</span>
              </div>
            </div>
          </section>

          {/* Card Management Section */}
          <CardsSection />

          {/* Upcoming Features Grid */}
          <section className="placeholder-grid">
            <div className="phase-card">
              <div className="phase-card-header">
                <div className="phase-icon-wrap phase-icon-purple">
                  <svg
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    className="phase-svg"
                  >
                    <rect x="2" y="5" width="20" height="14" rx="2" />
                    <line x1="2" y1="10" x2="22" y2="10" />
                  </svg>
                </div>
                <span className="phase-tag">Phase 2</span>
              </div>
              <h2 className="phase-title">Smart NFC Cards</h2>
              <p className="phase-desc">
                Provision new smart cards, configure destination links (Google Reviews,
                Instagram, WhatsApp), and manage status.
              </p>
            </div>

            <div className="phase-card">
              <div className="phase-card-header">
                <div className="phase-icon-wrap phase-icon-cyan">
                  <svg
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    className="phase-svg"
                  >
                    <line x1="18" y1="20" x2="18" y2="10" />
                    <line x1="12" y1="20" x2="12" y2="4" />
                    <line x1="6" y1="20" x2="6" y2="14" />
                  </svg>
                </div>
                <span className="phase-tag">Phase 3</span>
              </div>
              <h2 className="phase-title">Scan Analytics</h2>
              <p className="phase-desc">
                Track real-time card tap events, device user agents, customer referrer sources,
                and engagement trends.
              </p>
            </div>

            <div className="phase-card">
              <div className="phase-card-header">
                <div className="phase-icon-wrap phase-icon-emerald">
                  <svg
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    className="phase-svg"
                  >
                    <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
                    <circle cx="9" cy="7" r="4" />
                    <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
                    <path d="M16 3.13a4 4 0 0 1 0 7.75" />
                  </svg>
                </div>
                <span className="phase-tag">{isMainAdmin ? 'Phase 4' : 'Staff Mode'}</span>
              </div>
              <h2 className="phase-title">Team Administration</h2>
              <p className="phase-desc">
                {isMainAdmin
                  ? 'Invite and manage staff members, audit login events, and monitor access credentials.'
                  : 'Staff member mode: Card management and analytics operations.'}
              </p>
            </div>
          </section>
        </div>
      </main>
    </div>
  )
}
