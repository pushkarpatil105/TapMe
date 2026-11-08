import { useEffect, useRef } from 'react'

export function MobileNav({
  isOpen,
  setIsOpen,
  activeSection,
  setActiveSection,
  user,
  onLogout,
  isLoggingOut,
}) {
  const isMainAdmin = user?.role === 'main_admin'
  const drawerRef = useRef(null)

  // Close on Escape key press
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === 'Escape' && isOpen) {
        setIsOpen(false)
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [isOpen, setIsOpen])

  // Prevent background scroll when drawer is open
  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = 'hidden'
    } else {
      document.body.style.overflow = ''
    }
    return () => {
      document.body.style.overflow = ''
    }
  }, [isOpen])

  const navItems = [
    {
      id: 'cards',
      label: 'Cards',
      icon: (
        <svg className="nav-item-icon" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
          <path d="M4 4a2 2 0 00-2 2v1h16V6a2 2 0 00-2-2H4z" />
          <path
            fillRule="evenodd"
            d="M18 9H2v5a2 2 0 002 2h12a2 2 0 002-2V9zM4 13a1 1 0 011-1h1a1 1 0 110 2H5a1 1 0 01-1-1zm5-1a1 1 0 100 2h1a1 1 0 100-2H9z"
            clipRule="evenodd"
          />
        </svg>
      ),
      visible: true,
    },
    {
      id: 'staff',
      label: 'Team',
      icon: (
        <svg className="nav-item-icon" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
          <path d="M9 6a3 3 0 11-6 0 3 3 0 016 0zM17 6a3 3 0 11-6 0 3 3 0 016 0zM12.93 17c.046-.327.07-.66.07-1a6.97 6.97 0 00-1.5-4.33A5 5 0 0119 16v1h-6.07zM6 11a5 5 0 015 5v1H1v-1a5 5 0 015-5z" />
        </svg>
      ),
      visible: isMainAdmin,
    },
    {
      id: 'audit',
      label: 'Audit Logs',
      icon: (
        <svg className="nav-item-icon" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
          <path
            fillRule="evenodd"
            d="M4 4a2 2 0 012-2h4.586A2 2 0 0112 2.586L15.414 6A2 2 0 0116 7.414V16a2 2 0 01-2 2H6a2 2 0 01-2-2V4zm2 6a1 1 0 011-1h6a1 1 0 110 2H7a1 1 0 01-1-1zm1 3a1 1 0 100 2h6a1 1 0 100-2H7z"
            clipRule="evenodd"
          />
        </svg>
      ),
      visible: isMainAdmin,
    },
    {
      id: 'health',
      label: 'System Health',
      icon: (
        <svg className="nav-item-icon" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
          <path
            fillRule="evenodd"
            d="M11.3 1.046A1 1 0 0112 2v5h4a1 1 0 01.82 1.573l-7 10A1 1 0 018 18v-5H4a1 1 0 01-.82-1.573l7-10a1 1 0 011.12-.38z"
            clipRule="evenodd"
          />
        </svg>
      ),
      visible: isMainAdmin,
    },
    {
      id: 'storage',
      label: 'Storage & Retention',
      icon: (
        <svg className="nav-item-icon" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
          <path d="M3 12v3c0 1.657 3.134 3 7 3s7-1.343 7-3v-3c0 1.657-3.134 3-7 3s-7-1.343-7-3z" />
          <path d="M3 7v3c0 1.657 3.134 3 7 3s7-1.343 7-3V7c0 1.657-3.134 3-7 3S3 8.657 3 7z" />
          <path d="M17 4c0 1.657-3.134 3-7 3S3 5.657 3 4s3.134-3 7-3 7 1.343 7 3z" />
        </svg>
      ),
      visible: isMainAdmin,
    },
    {
      id: 'settings',
      label: 'Settings',
      icon: (
        <svg className="nav-item-icon" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
          <path
            fillRule="evenodd"
            d="M11.49 3.17c-.38-1.56-2.6-1.56-2.98 0a1.532 1.532 0 01-2.286.948c-1.372-.836-2.942.734-2.106 2.106.54.886.061 2.042-.947 2.287-1.561.379-1.561 2.6 0 2.978a1.532 1.532 0 01.947 2.287c-.836 1.372.734 2.942 2.106 2.106a1.532 1.532 0 012.287.947c.379 1.561 2.6 1.561 2.978 0a1.533 1.533 0 012.287-.947c1.372.836 2.942-.734 2.106-2.106a1.533 1.533 0 01.947-2.287c1.561-.379 1.561-2.6 0-2.978a1.532 1.532 0 01-.947-2.287c.836-1.372-.734-2.942-2.106-2.106a1.532 1.532 0 01-2.287-.947zM10 13a3 3 0 100-6 3 3 0 000 6z"
            clipRule="evenodd"
          />
        </svg>
      ),
      visible: true,
    },
  ]

  const handleItemSelect = (id) => {
    setActiveSection(id)
    setIsOpen(false)
  }

  if (!isOpen) return null

  return (
    <div className="mobile-drawer-overlay" onClick={() => setIsOpen(false)} aria-hidden="true">
          <div
            className="mobile-drawer-panel"
            ref={drawerRef}
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-label="Mobile Navigation Drawer"
          >
            {/* Drawer Header */}
            <div className="mobile-drawer-header">
              <div className="sidebar-brand">
                <div className="sidebar-brand-badge" aria-hidden="true">
                  <svg
                    className="sidebar-brand-icon"
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
                <div className="sidebar-brand-text">
                  <span className="sidebar-brand-name">TapMe</span>
                  <span className="sidebar-brand-badge-tag">Admin</span>
                </div>
              </div>

              <button
                type="button"
                className="mobile-drawer-close-btn"
                onClick={() => setIsOpen(false)}
                aria-label="Close navigation menu"
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-5 h-5">
                  <line x1="18" y1="6" x2="6" y2="18" />
                  <line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            </div>

            {/* Navigation List */}
            <nav className="mobile-drawer-nav">
              <div className="sidebar-nav-section-title">Navigation</div>
              <ul className="sidebar-nav-list" role="list">
                {navItems
                  .filter((item) => item.visible)
                  .map((item) => {
                    const isActive = activeSection === item.id
                    return (
                      <li key={item.id} className="sidebar-nav-item">
                        <button
                          type="button"
                          className={`sidebar-nav-link ${isActive ? 'active' : ''}`}
                          onClick={() => handleItemSelect(item.id)}
                          aria-current={isActive ? 'page' : undefined}
                        >
                          <span className="sidebar-nav-icon-wrap" aria-hidden="true">
                            {item.icon}
                          </span>
                          <span className="sidebar-nav-label">{item.label}</span>
                        </button>
                      </li>
                    )
                  })}
              </ul>
            </nav>

            {/* Drawer Footer */}
            <div className="sidebar-footer">
              <div className="sidebar-user-card">
                <div className="sidebar-user-avatar" aria-hidden="true">
                  {user?.username ? user.username.charAt(0).toUpperCase() : 'A'}
                </div>
                <div className="sidebar-user-details">
                  <span className="sidebar-user-name" title={user?.username}>
                    {user?.username}
                  </span>
                  <span className={`sidebar-role-pill ${isMainAdmin ? 'role-main' : 'role-staff'}`}>
                    {isMainAdmin ? 'Main Admin' : 'Staff'}
                  </span>
                </div>
              </div>

              <button
                type="button"
                className="sidebar-logout-btn"
                onClick={onLogout}
                disabled={isLoggingOut}
                aria-label="Sign out of administration session"
              >
                <svg className="sidebar-logout-icon" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
                  <path
                    fillRule="evenodd"
                    d="M3 3a1 1 0 00-1 1v12a1 1 0 102 0V4a1 1 0 00-1-1zm10.293 9.293a1 1 0 001.414 1.414l3-3a1 1 0 000-1.414l-3-3a1 1 0 10-1.414 1.414L14.586 9H7a1 1 0 100 2h7.586l-1.293 1.293z"
                    clipRule="evenodd"
                  />
                </svg>
                <span>{isLoggingOut ? 'Signing out...' : 'Sign Out'}</span>
              </button>
            </div>
          </div>
        </div>
      )
}

