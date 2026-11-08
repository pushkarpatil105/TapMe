import { useState } from 'react'
import { Sidebar } from './Sidebar'
import { MobileNav } from './MobileNav'
import { PageHeader } from './PageHeader'

export function AppShell({
  activeSection,
  setActiveSection,
  user,
  onLogout,
  isLoggingOut,
  children,
}) {
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false)

  return (
    <div className="app-shell-root">
      {/* Mobile Navigation Header & Slide-out Drawer */}
      <MobileNav
        isOpen={isMobileMenuOpen}
        setIsOpen={setIsMobileMenuOpen}
        activeSection={activeSection}
        setActiveSection={setActiveSection}
        user={user}
        onLogout={onLogout}
        isLoggingOut={isLoggingOut}
      />

      {/* Main Layout Container (Desktop Sidebar + Content Area) */}
      <div className="app-shell-layout">
        {/* Desktop Sidebar (hidden on mobile/tablet < 1024px) */}
        <div className="app-shell-sidebar-container">
          <Sidebar
            activeSection={activeSection}
            setActiveSection={setActiveSection}
            user={user}
            onLogout={onLogout}
            isLoggingOut={isLoggingOut}
          />
        </div>

        {/* Right Main Column */}
        <div className="app-shell-main-column">
          {/* Top Page Header */}
          <PageHeader
            activeSection={activeSection}
            user={user}
            onLogout={onLogout}
            isLoggingOut={isLoggingOut}
            onOpenMobileMenu={() => setIsMobileMenuOpen(true)}
          />

          {/* Scrollable Responsive Main Content Area */}
          <main className="app-main-viewport" id="main-content">
            <div className="app-content-container">
              {children}
            </div>
          </main>
        </div>
      </div>
    </div>
  )
}

