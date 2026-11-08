import { createContext } from 'react'

export const ThemeContext = createContext({
  themePreference: 'system',
  resolvedTheme: 'light',
  setThemePreference: () => {},
})

