import { useState } from 'react'
import { useAuth } from '../context'
import { CardsSection } from './cards/CardsSection'
import { StaffSection } from './staff/StaffSection'
import { AuditSection } from './audit/AuditSection'
import { SystemHealthSection } from './system/SystemHealthSection'
import { StorageSection } from './system/StorageSection'

export function Dashboard() {
  const { user, logout } = useAuth()
  const [isLoggingOut, setIsLoggingOut] = useState(false)
  const [activeSection, setActiveSection] = useState('cards')

  const handleLogout = async () => {
    setIsLoggingOut(true)
    await logout()
  }

  const isMainAdmin = user?.role === 'main_admin'
  const roleLabel = isMainAdmin ? 'Main Administrator' : 'Staff Member'
  const effectiveSection = isMainAdmin ? activeSection : 'cards'

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

          {/* Dashboard Section Navigation Tabs */}
          <nav className="dashboard-tabs-bar" aria-label="Dashboard sections">
            <button
              type="button"
              className={`dashboard-tab-btn ${effectiveSection === 'cards' ? 'active' : ''}`}
              onClick={() => setActiveSection('cards')}
            >
              <svg className="tab-icon" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
                <path d="M4 4a2 2 0 00-2 2v1h16V6a2 2 0 00-2-2H4z" />
                <path
                  fillRule="evenodd"
                  d="M18 9H2v5a2 2 0 002 2h12a2 2 0 002-2V9zM4 13a1 1 0 011-1h1a1 1 0 110 2H5a1 1 0 01-1-1zm5-1a1 1 0 100 2h1a1 1 0 100-2H9z"
                  clipRule="evenodd"
                />
              </svg>
              <span>Cards</span>
            </button>

            {isMainAdmin && (
              <button
                type="button"
                className={`dashboard-tab-btn ${effectiveSection === 'staff' ? 'active' : ''}`}
                onClick={() => setActiveSection('staff')}
              >
                <svg className="tab-icon" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
                  <path d="M9 6a3 3 0 11-6 0 3 3 0 016 0zM17 6a3 3 0 11-6 0 3 3 0 016 0zM12.93 17c.046-.327.07-.66.07-1a6.97 6.97 0 00-1.5-4.33A5 5 0 0119 16v1h-6.07zM6 11a5 5 0 015 5v1H1v-1a5 5 0 015-5z" />
                </svg>
                <span>Staff Management</span>
              </button>
            )}

            {isMainAdmin && (
              <button
                type="button"
                className={`dashboard-tab-btn ${effectiveSection === 'audit' ? 'active' : ''}`}
                onClick={() => setActiveSection('audit')}
              >
                <svg className="tab-icon" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
                  <path
                    fillRule="evenodd"
                    d="M4 4a2 2 0 012-2h4.586A2 2 0 0112 2.586L15.414 6A2 2 0 0116 7.414V16a2 2 0 01-2 2H6a2 2 0 01-2-2V4zm2 6a1 1 0 011-1h6a1 1 0 110 2H7a1 1 0 01-1-1zm1 3a1 1 0 100 2h6a1 1 0 100-2H7z"
                    clipRule="evenodd"
                  />
                </svg>
                <span>Audit Logs</span>
              </button>
            )}

            {isMainAdmin && (
              <button
                type="button"
                className={`dashboard-tab-btn ${effectiveSection === 'health' ? 'active' : ''}`}
                onClick={() => setActiveSection('health')}
              >
                <svg className="tab-icon" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
                  <path fillRule="evenodd" d="M11.3 1.046A1 1 0 0112 2v5h4a1 1 0 01.82 1.573l-7 10A1 1 0 018 18v-5H4a1 1 0 01-.82-1.573l7-10a1 1 0 011.12-.38z" clipRule="evenodd" />
                </svg>
                <span>System Health</span>
              </button>
            )}

            {isMainAdmin && (
              <button
                type="button"
                className={`dashboard-tab-btn ${effectiveSection === 'storage' ? 'active' : ''}`}
                onClick={() => setActiveSection('storage')}
              >
                <svg className="tab-icon" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
                  <path d="M3 12v3c0 1.657 3.134 3 7 3s7-1.343 7-3v-3c0 1.657-3.134 3-7 3s-7-1.343-7-3z" />
                  <path d="M3 7v3c0 1.657 3.134 3 7 3s7-1.343 7-3V7c0 1.657-3.134 3-7 3S3 8.657 3 7z" />
                  <path d="M17 4c0 1.657-3.134 3-7 3S3 5.657 3 4s3.134-3 7-3 7 1.343 7 3z" />
                </svg>
                <span>Storage & Retention</span>
              </button>
            )}
          </nav>

          {/* Active Section Content */}
          {effectiveSection === 'cards' && <CardsSection />}

          {effectiveSection === 'staff' && isMainAdmin && <StaffSection />}

          {effectiveSection === 'audit' && isMainAdmin && <AuditSection />}

          {effectiveSection === 'health' && isMainAdmin && <SystemHealthSection />}

          {effectiveSection === 'storage' && isMainAdmin && <StorageSection />}

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
