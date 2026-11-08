import { useState } from 'react'
import { useAuth } from '../context'
import { AppShell } from './layout/AppShell'
import { CardsSection } from './cards/CardsSection'
import { StaffSection } from './staff/StaffSection'
import { AuditSection } from './audit/AuditSection'
import { SystemHealthSection } from './system/SystemHealthSection'
import { StorageSection } from './system/StorageSection'
import { SettingsSection } from './settings/SettingsSection'

export function Dashboard() {
  const { user, logout } = useAuth()
  const [isLoggingOut, setIsLoggingOut] = useState(false)
  const [activeSection, setActiveSection] = useState('cards')

  const handleLogout = async () => {
    setIsLoggingOut(true)
    await logout()
  }

  const isMainAdmin = user?.role === 'main_admin'
  const staffAllowed = ['cards', 'settings']
  const effectiveSection = isMainAdmin
    ? activeSection
    : staffAllowed.includes(activeSection)
    ? activeSection
    : 'cards'

  return (
    <AppShell
      activeSection={effectiveSection}
      setActiveSection={setActiveSection}
      user={user}
      onLogout={handleLogout}
      isLoggingOut={isLoggingOut}
    >
      {effectiveSection === 'cards' && <CardsSection />}
      {effectiveSection === 'staff' && isMainAdmin && <StaffSection />}
      {effectiveSection === 'audit' && isMainAdmin && <AuditSection />}
      {effectiveSection === 'health' && isMainAdmin && <SystemHealthSection />}
      {effectiveSection === 'storage' && isMainAdmin && <StorageSection />}
      {effectiveSection === 'settings' && <SettingsSection />}
    </AppShell>
  )
}
