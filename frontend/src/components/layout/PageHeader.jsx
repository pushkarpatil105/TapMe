import { useTheme } from '../../context'

export function PageHeader({
  activeSection,
  user,
  onLogout,
  isLoggingOut,
  onOpenMobileMenu,
}) {
  const { resolvedTheme, setThemePreference } = useTheme()
  const isMainAdmin = user?.role === 'main_admin'
  const roleLabel = isMainAdmin ? 'Main Administrator' : 'Staff Member'

  const sectionHeaders = {
    cards: {
      title: 'Cards',
      subtitle: 'Manage smart NFC business cards, assign QR types, and track redirects.',
    },
    staff: {
      title: 'Team Management',
      subtitle: 'Manage administrative staff accounts, account statuses, and permissions.',
    },
    audit: {
      title: 'Audit Logs',
      subtitle: 'Inspect immutable records of card modifications, staff actions, and events.',
    },
    health: {
      title: 'System Health',
      subtitle: 'Edge API diagnostics, Cloudflare D1 status, and live operational metrics.',
    },
    storage: {
      title: 'Storage & Retention',
      subtitle: 'Inspect D1 storage metrics, export audit/scan data, and manage retention.',
    },
    settings: {
      title: 'Settings',
      subtitle: 'Customize appearance, interface theme preferences, and portal configurations.',
    },
  }

  const currentHeader = sectionHeaders[activeSection] || sectionHeaders.cards

  return (
    <header className="app-page-header">
      <div className="page-header-left">
        {/* Mobile menu trigger */}
        <button
          type="button"
          className="page-header-menu-btn"
          onClick={onOpenMobileMenu}
          aria-label="Open navigation drawer"
        >
          <svg
            className="page-header-menu-icon"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <line x1="3" y1="12" x2="21" y2="12" />
            <line x1="3" y1="6" x2="21" y2="6" />
            <line x1="3" y1="18" x2="21" y2="18" />
          </svg>
        </button>

        <div className="page-header-titles">
          <div className="page-header-title-row">
            <h1 className="page-header-title">{currentHeader.title}</h1>
            <span className="page-header-badge">Admin Portal</span>
          </div>
          <p className="page-header-subtitle">{currentHeader.subtitle}</p>
        </div>
      </div>

      <div className="page-header-right">
        {/* Quick Theme Toggle Button */}
        <button
          type="button"
          className="header-theme-toggle-btn"
          onClick={() => setThemePreference(resolvedTheme === 'dark' ? 'light' : 'dark')}
          title={`Switch to ${resolvedTheme === 'dark' ? 'Light' : 'Dark'} Mode`}
          aria-label={`Switch to ${resolvedTheme === 'dark' ? 'Light' : 'Dark'} Mode`}
        >
          {resolvedTheme === 'dark' ? (
            <svg className="header-theme-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <circle cx="12" cy="12" r="5" />
              <line x1="12" y1="1" x2="12" y2="3" />
              <line x1="12" y1="21" x2="12" y2="23" />
              <line x1="4.22" y1="4.22" x2="5.64" y2="5.64" />
              <line x1="18.36" y1="18.36" x2="19.78" y2="19.78" />
              <line x1="1" y1="12" x2="3" y2="12" />
              <line x1="21" y1="12" x2="23" y2="12" />
              <line x1="4.22" y1="19.78" x2="5.64" y2="18.36" />
              <line x1="18.36" y1="5.64" x2="19.78" y2="4.22" />
            </svg>
          ) : (
            <svg className="header-theme-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
            </svg>
          )}
        </button>

        {/* Session Status Indicator */}
        <div className="session-status-indicator" title="Authenticated session via secure HttpOnly cookie">
          <span className="session-status-dot" aria-hidden="true" />
          <span className="session-status-text">Live Session</span>
        </div>

        {/* User Pill */}
        <div className="header-user-pill">
          <div className="header-user-avatar" aria-hidden="true">
            {user?.username ? user.username.charAt(0).toUpperCase() : 'A'}
          </div>
          <div className="header-user-meta">
            <span className="header-user-name">{user?.username}</span>
            <span className="header-user-role">{roleLabel}</span>
          </div>
        </div>

        {/* Sign Out Button */}
        <button
          type="button"
          className="header-logout-btn"
          onClick={onLogout}
          disabled={isLoggingOut}
          aria-label="Sign out of current admin session"
        >
          <svg className="header-logout-icon" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
            <path
              fillRule="evenodd"
              d="M3 3a1 1 0 00-1 1v12a1 1 0 102 0V4a1 1 0 00-1-1zm10.293 9.293a1 1 0 001.414 1.414l3-3a1 1 0 000-1.414l-3-3a1 1 0 10-1.414 1.414L14.586 9H7a1 1 0 100 2h7.586l-1.293 1.293z"
              clipRule="evenodd"
            />
          </svg>
          <span className="header-logout-text">{isLoggingOut ? 'Signing out...' : 'Sign Out'}</span>
        </button>
      </div>
    </header>
  )
}
