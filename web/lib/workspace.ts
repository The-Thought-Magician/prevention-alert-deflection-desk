'use client'

// Shared helper to persist the active workspace id across dashboard pages.
const KEY = 'padd.active_workspace'

export function getActiveWorkspace(): string | null {
  if (typeof window === 'undefined') return null
  try {
    return window.localStorage.getItem(KEY)
  } catch {
    return null
  }
}

export function setActiveWorkspace(id: string) {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(KEY, id)
  } catch {
    /* ignore */
  }
}

export function clearActiveWorkspace() {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.removeItem(KEY)
  } catch {
    /* ignore */
  }
}
