export interface XFeedRunLease {
  release(): void | Promise<void>
}

export interface XFeedRunLock {
  acquire(key: string): Promise<XFeedRunLease | null>
}

export interface MemoryXFeedRunLock extends XFeedRunLock {
  isLocked(key: string): boolean
  clear(): void
}

const LOCK_KEY_PATTERN = /^[A-Za-z0-9][A-Za-z0-9:._-]{0,159}$/

export function createMemoryXFeedRunLock(): MemoryXFeedRunLock {
  const active = new Set<string>()

  return {
    async acquire(key) {
      const normalized = assertXFeedRunLockKey(key)
      if (active.has(normalized)) return null
      active.add(normalized)
      let released = false

      return {
        release() {
          if (released) return
          released = true
          active.delete(normalized)
        },
      }
    },
    isLocked(key) {
      return active.has(assertXFeedRunLockKey(key))
    },
    clear() {
      active.clear()
    },
  }
}

export function assertXFeedRunLockKey(value: string): string {
  const normalized = typeof value === 'string' ? value.trim() : ''
  if (!LOCK_KEY_PATTERN.test(normalized)) {
    throw new TypeError(
      'X feed run lock key must contain only letters, numbers, colons, dots, underscores, and hyphens.',
    )
  }
  return normalized
}
