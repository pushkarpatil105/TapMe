import { useState, useEffect } from 'react'
import { AuthContext } from './auth-context'

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  useEffect(() => {
    let isMounted = true

    fetch('/api/auth/me', {
      method: 'GET',
      credentials: 'include',
      headers: {
        Accept: 'application/json',
      },
    })
      .then((res) => (res.ok ? res.json() : null))
      .then((json) => {
        if (!isMounted) return
        if (json?.success && json?.data) {
          setUser(json.data)
        } else {
          setUser(null)
        }
      })
      .catch((err) => {
        if (!isMounted) return
        console.error('Session check failed:', err)
        setUser(null)
      })
      .finally(() => {
        if (isMounted) {
          setLoading(false)
        }
      })

    return () => {
      isMounted = false
    }
  }, [])

  const login = async (username, password) => {
    try {
      setError(null)
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify({
          username: username.trim(),
          password,
        }),
      })

      const json = await res.json().catch(() => null)

      if (res.ok && json?.success && json?.data) {
        setUser(json.data)
        return { success: true }
      }

      const errorMessage =
        json?.error ||
        (res.status === 429
          ? 'Too many login attempts. Please try again later.'
          : 'Invalid username or password.')
      setError(errorMessage)
      return { success: false, error: errorMessage }
    } catch (err) {
      console.error('Login request failed:', err)
      const networkError = 'Network error. Could not connect to API server.'
      setError(networkError)
      return { success: false, error: networkError }
    }
  }

  const logout = async () => {
    try {
      await fetch('/api/auth/logout', {
        method: 'POST',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
      })
    } catch (err) {
      console.error('Logout error:', err)
    } finally {
      setUser(null)
    }
  }

  return (
    <AuthContext.Provider
      value={{
        user,
        loading,
        error,
        login,
        logout,
      }}
    >
      {children}
    </AuthContext.Provider>
  )
}
