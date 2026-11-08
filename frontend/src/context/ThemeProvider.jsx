import { useState, useEffect, useCallback } from 'react'
import { ThemeContext } from './theme-context'

const THEME_STORAGE_KEY = 'tapme_theme'
const VALID_PREFERENCES = ['light', 'dark', 'system']

function getSystemTheme() {
  if (typeof window !== 'undefined' && window.matchMedia) {
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
  }
  return 'light'
}

function getStoredPreference() {
  if (typeof window !== 'undefined') {
    try {
      const stored = localStorage.getItem(THEME_STORAGE_KEY)
      if (stored && VALID_PREFERENCES.includes(stored)) {
        return stored
      }
    } catch {
      // Ignore storage access errors
    }
  }
  return 'system'
}

export function ThemeProvider({ children }) {
  const [themePreference, setThemePreferenceState] = useState(getStoredPreference)
  const [systemTheme, setSystemTheme] = useState(getSystemTheme)

  // Listen to OS system color scheme changes
  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return

    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)')
    const handleChange = (e) => {
      setSystemTheme(e.matches ? 'dark' : 'light')
    }

    if (mediaQuery.addEventListener) {
      mediaQuery.addEventListener('change', handleChange)
    } else if (mediaQuery.addListener) {
      mediaQuery.addListener(handleChange)
    }

    return () => {
      if (mediaQuery.removeEventListener) {
        mediaQuery.removeEventListener('change', handleChange)
      } else if (mediaQuery.removeListener) {
        mediaQuery.removeListener(handleChange)
      }
    }
  }, [])

  // Calculate resolved theme: light or dark
  const resolvedTheme = themePreference === 'system' ? systemTheme : themePreference

  // Apply to root document
  useEffect(() => {
    if (typeof document !== 'undefined') {
      document.documentElement.setAttribute('data-theme', resolvedTheme)
    }
  }, [resolvedTheme])

  const setThemePreference = useCallback((preference) => {
    if (!VALID_PREFERENCES.includes(preference)) return

    setThemePreferenceState(preference)
    try {
      localStorage.setItem(THEME_STORAGE_KEY, preference)
    } catch {
      // Ignore storage access errors
    }
  }, [])

  return (
    <ThemeContext.Provider
      value={{
        themePreference,
        resolvedTheme,
        setThemePreference,
      }}
    >
      {children}
    </ThemeContext.Provider>
  )
}

