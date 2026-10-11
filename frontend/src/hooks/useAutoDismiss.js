import { useEffect, useState } from 'react'

export function useAutoDismiss(value, setValue, duration = 4500) {
  const [paused, setPaused] = useState(false)

  useEffect(() => {
    if (!value || paused) return undefined
    const timer = setTimeout(() => setValue(''), duration)
    return () => clearTimeout(timer)
  }, [duration, paused, setValue, value])

  return {
    onMouseEnter: () => setPaused(true),
    onMouseLeave: () => setPaused(false),
  }
}
