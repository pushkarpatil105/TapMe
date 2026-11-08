import { useTheme } from '../../context'

export function SettingsSection() {
  const { themePreference, resolvedTheme, setThemePreference } = useTheme()

  const themeOptions = [
    {
      id: 'light',
      label: 'Light Mode',
      description: 'Clean white surfaces, crisp dark typography, and professional blue accents.',
      icon: (
        <svg className="theme-option-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
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
      ),
    },
    {
      id: 'dark',
      label: 'Dark Mode',
      description: 'Low-light slate surfaces with high-contrast text to reduce eye fatigue.',
      icon: (
        <svg className="theme-option-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
        </svg>
      ),
    },
    {
      id: 'system',
      label: 'System Default',
      description: 'Automatically match your operating system theme settings and schedule.',
      icon: (
        <svg className="theme-option-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <rect x="2" y="3" width="20" height="14" rx="2" ry="2" />
          <line x1="8" y1="21" x2="16" y2="21" />
          <line x1="12" y1="17" x2="12" y2="21" />
        </svg>
      ),
    },
  ]

  return (
    <div className="settings-section" aria-label="Application Settings">
      {/* Settings Header */}
      <div className="settings-card">
        <div className="settings-card-header">
          <div>
            <h2 className="settings-card-title">Appearance & Theme</h2>
            <p className="settings-card-subtitle">
              Choose your interface theme. Your preference is saved locally and applies instantly across the entire portal.
            </p>
          </div>
          <div className="settings-current-badge">
            <span className="settings-current-dot" aria-hidden="true" />
            <span>Currently: {resolvedTheme === 'dark' ? 'Dark Mode' : 'Light Mode'}</span>
          </div>
        </div>

        {/* Theme Options Cards */}
        <div className="theme-selector-grid" role="radiogroup" aria-label="Theme selection">
          {themeOptions.map((opt) => {
            const isSelected = themePreference === opt.id

            return (
              <button
                key={opt.id}
                type="button"
                role="radio"
                aria-checked={isSelected}
                className={`theme-option-card ${isSelected ? 'active' : ''}`}
                onClick={() => setThemePreference(opt.id)}
              >
                <div className="theme-option-header">
                  <div className="theme-option-icon-wrap" aria-hidden="true">
                    {opt.icon}
                  </div>
                  <div className="theme-option-radio-indicator">
                    {isSelected && <span className="theme-option-radio-dot" />}
                  </div>
                </div>

                <div className="theme-option-body">
                  <span className="theme-option-label">{opt.label}</span>
                  <p className="theme-option-desc">{opt.description}</p>
                </div>

                {isSelected && (
                  <div className="theme-option-active-pill">
                    <span>Active Selection</span>
                  </div>
                )}
              </button>
            )
          })}
        </div>

        {/* Note footer */}
        <div className="settings-footer-note">
          <svg className="settings-info-icon" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
            <path
              fillRule="evenodd"
              d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z"
              clipRule="evenodd"
            />
          </svg>
          <span>
            Theme preferences are stored locally in your browser and will persist across browser restarts and navigation.
          </span>
        </div>
      </div>
    </div>
  )
}

