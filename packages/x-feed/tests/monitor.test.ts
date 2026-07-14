import { describe, expect, it, vi } from 'vitest'

import {
  createInitialXFeedMonitorState,
  createMemoryXFeedMonitorStore,
  createMemoryXFeedSnapshotStore,
  parseXFeedMonitorState,
  runMonitoredXFeedSync,
  type XFeedMonitorState,
  type XFeedMonitorStore,
  type XFeedSource,
  type XPost,
} from '../src/index.js'
import { createFallbackXSource } from '../src/source/fallback.js'

describe('X feed health monitor', () => {
  it('creates and parses an empty monitor state', () => {
    const state = createInitialXFeedMonitorState()
    expect(parseXFeedMonitorState(state)).toEqual(state)
    expect(parseXFeedMonitorState({ schemaVersion: 999 })).toBeNull()
  })

  it('provides an isolated in-memory monitor store', async () => {
    const store = createMemoryXFeedMonitorStore()
    const state = createInitialXFeedMonitorState()
    await store.write(state)
    expect(store.inspect()).toEqual(state)
    store.clear()
    await expect(store.read()).resolves.toBeNull()
  })

  it('records a healthy successful synchronization', async () => {
    const monitor = memoryMonitor()
    const result = await run(monitor, fixtureSource('official', [fixturePost('100')]))
    expect(result.monitor).toMatchObject({
      status: 'healthy', consecutiveFailures: 0, selectedSourceId: 'official', cacheState: 'fresh',
    })
    expect(result.healthEvents).toEqual([])
  })

  it('records a successful fallback as degraded', async () => {
    const monitor = memoryMonitor()
    const source = createFallbackXSource({
      sources: [failingSource('rss'), fixtureSource('official', [fixturePost('101')])],
    })
    const result = await run(monitor, source)
    expect(result.monitor).toMatchObject({ status: 'degraded', selectedSourceId: 'official' })
  })

  it('emits a degradation event when the primary source keeps failing', async () => {
    const monitor = memoryMonitor()
    const events = vi.fn()
    for (let index = 0; index < 3; index += 1) {
      const source = createFallbackXSource({
        sources: [failingSource('rss'), fixtureSource('official', [fixturePost(String(110 + index))])],
      })
      await run(
        monitor,
        source,
        undefined,
        new Date(`2026-07-14T1${index}:00:00.000Z`),
        events,
      )
    }
    expect(events).toHaveBeenCalledTimes(1)
    expect(events.mock.calls[0]?.[0]).toMatchObject({
      type: 'source-degraded-threshold-reached',
    })
  })

  it('records a failed run without cache as failed', async () => {
    const monitor = memoryMonitor()
    await expect(run(monitor, failingSource('broken'))).rejects.toThrow()
    expect(monitor.value).toMatchObject({ status: 'failed', consecutiveFailures: 1, cacheState: 'empty' })
  })

  it('keeps a failed run degraded when a renderable snapshot exists', async () => {
    const monitor = memoryMonitor()
    const snapshots = createMemoryXFeedSnapshotStore()
    await run(monitor, fixtureSource('official', [fixturePost('100')]), snapshots)
    await expect(run(monitor, failingSource('broken'), snapshots, new Date('2026-07-14T10:30:00.000Z'))).rejects.toThrow()
    expect(monitor.value).toMatchObject({ status: 'degraded', consecutiveFailures: 1, cacheState: 'fresh' })
  })

  it('emits a threshold event after three consecutive failures', async () => {
    const monitor = memoryMonitor()
    const events = vi.fn()
    for (let index = 0; index < 3; index += 1) {
      await run(monitor, failingSource('broken'), undefined, new Date(`2026-07-14T1${index}:00:00.000Z`), events).catch(() => undefined)
    }
    expect(events).toHaveBeenCalledTimes(1)
    expect(events.mock.calls[0]?.[0]).toMatchObject({ type: 'failure-threshold-reached' })
  })

  it('suppresses repeated failure notifications during cooldown', async () => {
    const monitor = memoryMonitor()
    const events = vi.fn()
    for (let index = 0; index < 4; index += 1) {
      await run(monitor, failingSource('broken'), undefined, new Date(`2026-07-14T1${index}:00:00.000Z`), events).catch(() => undefined)
    }
    expect(events).toHaveBeenCalledTimes(1)
  })

  it('emits a recovered event after a failed source succeeds', async () => {
    const monitor = memoryMonitor()
    await run(monitor, failingSource('broken')).catch(() => undefined)
    const events = vi.fn()
    const result = await run(monitor, fixtureSource('official', [fixturePost('102')]), undefined, new Date('2026-07-14T11:00:00.000Z'), events)
    expect(result.monitor).toMatchObject({ status: 'healthy', consecutiveFailures: 0 })
    expect(events).toHaveBeenCalledWith(expect.objectContaining({ type: 'recovered' }))
  })

  it('wraps monitor persistence failures', async () => {
    const monitor: XFeedMonitorStore = {
      async read() { return null },
      async write() { throw new Error('database down') },
    }
    await expect(run(monitor, fixtureSource('official', []))).rejects.toMatchObject({ code: 'MONITOR_WRITE_FAILED' })
  })
})

async function run(
  monitorStore: XFeedMonitorStore,
  source: XFeedSource,
  snapshotStore = createMemoryXFeedSnapshotStore(),
  now = new Date('2026-07-14T10:00:00.000Z'),
  onHealthEvent?: (event: unknown) => void,
) {
  return runMonitoredXFeedSync({
    source, snapshotStore, monitorStore, trigger: 'schedule', now, force: true,
    config: { username: 'dss_feeds', postLimit: 5 },
    monitorPolicy: { failureThreshold: 3, notificationCooldownMs: 12 * 60 * 60 * 1000 },
    ...(onHealthEvent ? { onHealthEvent } : {}),
  })
}

function memoryMonitor(): XFeedMonitorStore & { value: XFeedMonitorState | null } {
  return {
    value: null,
    async read() { return this.value },
    async write(state) { this.value = structuredClone(state) },
  }
}
function fixtureSource(id: string, posts: readonly XPost[]): XFeedSource { return { id, async fetchPosts() { return posts } } }
function failingSource(id: string): XFeedSource { return { id, async fetchPosts() { throw new Error(`${id} unavailable`) } } }
function fixturePost(id: string): XPost {
  return {
    id, source: 'x', kind: 'post', url: `https://x.com/dss_feeds/status/${id}`, text: `Post ${id}`,
    createdAt: '2026-07-14T09:00:00.000Z', language: null, conversationId: null,
    author: { id: null, username: 'dss_feeds', name: 'DSS Feeds', profileImageUrl: null, verified: null, protected: null },
    metrics: { replies: 0, reposts: 0, likes: 0, quotes: 0, bookmarks: null, impressions: null }, media: [], references: [],
  }
}
