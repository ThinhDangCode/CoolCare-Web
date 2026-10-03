/* eslint-disable react-refresh/only-export-components */
import { createContext, useCallback, useContext, useMemo, useState } from 'react'
import { ApiError, authApi } from '../api/authApi.js'

const AuthContext = createContext(null)
const storageKey = 'coolcare.admin.session'

function readStoredSession() {
  try {
    const rawSession = localStorage.getItem(storageKey) ?? sessionStorage.getItem(storageKey)
    const session = JSON.parse(rawSession)
    return session?.token && session?.user?.role === 'ADMIN' ? session : null
  } catch {
    localStorage.removeItem(storageKey)
    sessionStorage.removeItem(storageKey)
    return null
  }
}

export function AuthProvider({ children }) {
  const [session, setSession] = useState(readStoredSession)

  const login = useCallback(async ({ email, password, remember = false }) => {
    const nextSession = await authApi.login({ email: email.trim().toLowerCase(), password })
    if (nextSession.user?.role !== 'ADMIN') {
      await authApi.logout(nextSession.token).catch(() => {})
      throw new ApiError({ status: 403, code: 'ADMIN_ONLY', message: 'Cổng này chỉ dành cho quản trị viên.' })
    }
    const targetStorage = remember ? localStorage : sessionStorage
    localStorage.removeItem(storageKey)
    sessionStorage.removeItem(storageKey)
    targetStorage.setItem(storageKey, JSON.stringify(nextSession))
    setSession(nextSession)
  }, [])

  const logout = useCallback(async () => {
    const token = session?.token
    localStorage.removeItem(storageKey)
    sessionStorage.removeItem(storageKey)
    setSession(null)
    if (token) await authApi.logout(token).catch(() => {})
  }, [session?.token])

  const value = useMemo(() => ({
    user: session?.user ?? null,
    isAuthenticated: Boolean(session?.token),
    login,
    logout,
  }), [login, logout, session])

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth() {
  const context = useContext(AuthContext)
  if (!context) throw new Error('useAuth must be used inside AuthProvider')
  return context
}
