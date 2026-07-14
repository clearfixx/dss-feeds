import {
  assertXFeedCacheKey,
  parseXFeedSnapshot,
  type XFeedSnapshot,
  type XFeedSnapshotStore,
} from './cache.js'

export interface MemoryXFeedSnapshotStore extends XFeedSnapshotStore {
  inspect(key: string): XFeedSnapshot | null
  clear(): void
}

export function createMemoryXFeedSnapshotStore(
  initialSnapshots: readonly XFeedSnapshot[] = [],
): MemoryXFeedSnapshotStore {
  const snapshots = new Map<string, XFeedSnapshot>()

  for (const snapshot of initialSnapshots) {
    const parsed = parseXFeedSnapshot(snapshot)
    if (!parsed) {
      throw new TypeError('Initial X feed snapshot is invalid.')
    }
    snapshots.set(parsed.key, cloneSnapshot(parsed))
  }

  return {
    async read(key) {
      const snapshot = snapshots.get(assertXFeedCacheKey(key))
      return snapshot ? cloneSnapshot(snapshot) : null
    },
    async write(snapshot) {
      const parsed = parseXFeedSnapshot(snapshot)
      if (!parsed) {
        throw new TypeError('X feed snapshot is invalid.')
      }
      snapshots.set(parsed.key, cloneSnapshot(parsed))
    },
    inspect(key) {
      const snapshot = snapshots.get(assertXFeedCacheKey(key))
      return snapshot ? cloneSnapshot(snapshot) : null
    },
    clear() {
      snapshots.clear()
    },
  }
}

function cloneSnapshot(snapshot: XFeedSnapshot): XFeedSnapshot {
  return structuredClone(snapshot)
}
