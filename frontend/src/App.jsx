import { AuthProvider, useAuth, ThemeProvider } from './context'
import { LoginPage } from './components/LoginPage'
import { Dashboard } from './components/Dashboard'
import { LoadingScreen } from './components/LoadingScreen'
import './index.css'

function AuthFlow() {
  const { user, loading } = useAuth()

  if (loading) {
    return <LoadingScreen />
  }

  if (user) {
    return <Dashboard />
  }

  return <LoginPage />
}

export default function App() {
  return (
    <ThemeProvider>
      <AuthProvider>
        <AuthFlow />
      </AuthProvider>
    </ThemeProvider>
  )
}
