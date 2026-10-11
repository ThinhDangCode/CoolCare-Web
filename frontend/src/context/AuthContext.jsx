/* eslint-disable react-refresh/only-export-components */
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { ApiError, authApi } from '../services/authApi.js'

const AuthContext = createContext(null)
const storageKey = 'coolcare.admin.session'
const idleTimeoutMs = 15 * 60 * 1000
const refreshIntervalMs = 8 * 60 * 1000
const activityWriteIntervalMs = 30 * 1000

function sessionStorageTarget() {
  return localStorage.getItem(storageKey) ? localStorage : sessionStorage
}

function writeStoredSession(session) {
  sessionStorageTarget().setItem(storageKey, JSON.stringify(session))
}

function readStoredSession() {
  try {
    const rawSession = localStorage.getItem(storageKey) ?? sessionStorage.getItem(storageKey)
    const session = JSON.parse(rawSession)
    if (!session?.token || session?.user?.role !== 'ADMIN') return null
    const lastActivityAt = Number(session.lastActivityAt) || Date.now()
    if (Date.now() - lastActivityAt >= idleTimeoutMs) {
      localStorage.removeItem(storageKey)
      sessionStorage.removeItem(storageKey)
      return null
    }
    return { ...session, lastActivityAt, refreshedAt: Number(session.refreshedAt) || 0 }
  } catch {
    localStorage.removeItem(storageKey)
    sessionStorage.removeItem(storageKey)
    return null
  }
}

export function AuthProvider({ children }) {
  const [session, setSession] = useState(readStoredSession)
  const lastActivityRef = useRef(null)
  const lastRefreshRef = useRef(null)
  const refreshingRef = useRef(false)

  const clearSession = useCallback(() => {
    localStorage.removeItem(storageKey)
    sessionStorage.removeItem(storageKey)
    setSession(null)
  }, [])

  const login = useCallback(async ({ email, password, remember = false }) => {
    const nextSession = await authApi.login({ email: email.trim().toLowerCase(), password })
    if (nextSession.user?.role !== 'ADMIN') {
      await authApi.logout(nextSession.token).catch(() => {})
      throw new ApiError({
        status: 403,
        code: 'ADMIN_ONLY',
        message: 'Cổng này chỉ dành cho quản trị viên.',
      })
    }
    const now = Date.now()
    const sessionWithActivity = { ...nextSession, lastActivityAt: now, refreshedAt: now }
    const targetStorage = remember ? localStorage : sessionStorage
    localStorage.removeItem(storageKey)
    sessionStorage.removeItem(storageKey)
    targetStorage.setItem(storageKey, JSON.stringify(sessionWithActivity))
    setSession(sessionWithActivity)
  }, [])

  const logout = useCallback(async () => {
    const token = session?.token
    clearSession()
    if (token) await authApi.logout(token).catch(() => {})
  }, [clearSession, session?.token])

  const updateUser = useCallback((user) => {
    setSession((current) => {
      if (!current) return current
      const nextSession = { ...current, user }
      writeStoredSession(nextSession)
      return nextSession
    })
  }, [])

  useEffect(() => {
    if (!session?.token) return undefined

    let active = true
    let lastActivityWriteAt = 0
    lastActivityRef.current = session.lastActivityAt ?? Date.now()
    lastRefreshRef.current = session.refreshedAt ?? 0

    const expireIdleSession = () => {
      const token = session.token
      active = false
      clearSession()
      authApi.logout(token).catch(() => {})
    }

    const recordActivity = () => {
      const now = Date.now()
      if (now - lastActivityRef.current >= idleTimeoutMs) {
        expireIdleSession()
        return
      }
      lastActivityRef.current = now
      if (now - lastActivityWriteAt >= activityWriteIntervalMs) {
        lastActivityWriteAt = now
        try {
          const storage = sessionStorageTarget()
          const stored = JSON.parse(storage.getItem(storageKey))
          if (stored?.token)
            storage.setItem(storageKey, JSON.stringify({ ...stored, lastActivityAt: now }))
        } catch {
          clearSession()
        }
      }
      if (now - lastRefreshRef.current >= refreshIntervalMs) void maintainSession()
    }

    const maintainSession = async () => {
      const now = Date.now()
      if (now - lastActivityRef.current >= idleTimeoutMs) {
        expireIdleSession()
        return
      }
      const hasActivitySinceRefresh = lastActivityRef.current > lastRefreshRef.current
      if (
        !hasActivitySinceRefresh ||
        now - lastRefreshRef.current < refreshIntervalMs ||
        refreshingRef.current
      )
        return

      refreshingRef.current = true
      try {
        const refreshed = await authApi.refresh(session.token)
        if (!active) return
        lastRefreshRef.current = Date.now()
        setSession((current) => {
          if (!current) return current
          const nextSession = {
            ...refreshed,
            lastActivityAt: lastActivityRef.current,
            refreshedAt: lastRefreshRef.current,
          }
          writeStoredSession(nextSession)
          return nextSession
        })
      } catch (error) {
        if (active && error.status === 401) clearSession()
      } finally {
        refreshingRef.current = false
      }
    }

    const activityEvents = ['pointerdown', 'keydown', 'scroll', 'touchstart']
    activityEvents.forEach((eventName) =>
      window.addEventListener(eventName, recordActivity, { passive: true })
    )
    const syncSessionAcrossTabs = (event) => {
      if (event.key !== storageKey) return
      if (!event.newValue) {
        setSession(null)
        return
      }
      try {
        const stored = JSON.parse(event.newValue)
        if (stored?.token && stored.token !== session.token) {
          setSession(stored)
          return
        }
        if (Number(stored?.lastActivityAt) > lastActivityRef.current)
          lastActivityRef.current = Number(stored.lastActivityAt)
      } catch {
        // Ignore malformed state written by an older application version.
      }
    }
    window.addEventListener('storage', syncSessionAcrossTabs)
    const intervalId = window.setInterval(maintainSession, 15 * 1000)

    return () => {
      active = false
      window.clearInterval(intervalId)
      activityEvents.forEach((eventName) => window.removeEventListener(eventName, recordActivity))
      window.removeEventListener('storage', syncSessionAcrossTabs)
    }
  }, [clearSession, session?.lastActivityAt, session?.refreshedAt, session?.token])

  const value = useMemo(
    () => ({
      user: session?.user ?? null,
      isAuthenticated: Boolean(session?.token),
      login,
      logout,
      clearSession,
      token: session?.token ?? null,
      updateUser,
    }),
    [clearSession, login, logout, session, updateUser]
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth() {
  const context = useContext(AuthContext)
  if (!context) throw new Error('useAuth must be used inside AuthProvider')
  return context
}
