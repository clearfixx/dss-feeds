import { describe, expect, it, vi } from 'vitest'

import { createInitialXFeedMonitorState, type XFeedSnapshot } from '../src/index.js'
import {
  createPayloadXFeedMonitorStore,
  createPayloadXFeedSnapshotStore,
  createXFeedCacheCollection,
  createXFeedSettingsGlobal,
} from '../src/payload/index.js'

describe('Payload X feed persistence', () => {
  it('creates a cache collection with isolated snapshot JSON', () => {
    const collection = createXFeedCacheCollection()
    expect(collection.slug).toBe('dss-x-feed-cache')
    expect(collection.fields).toEqual(expect.arrayContaining([expect.objectContaining({ name: 'snapshot', type: 'json' })]))
  })

  it('creates settings with explicit experimental source labels', () => {
    const settings = createXFeedSettingsGlobal()
    expect(settings.slug).toBe('dss-x-feed-settings')
    expect(settings.fields).toEqual(expect.arrayContaining([expect.objectContaining({ name: 'sourceMode' })]))
    expect(JSON.stringify(settings)).toContain('experimental')
  })

  it('creates a new Payload snapshot document', async () => {
    const client = payloadClient([])
    const store = createPayloadXFeedSnapshotStore({ payload: client as never })
    await store.write(fixtureSnapshot())
    expect(client.create).toHaveBeenCalledWith(expect.objectContaining({ collection: 'dss-x-feed-cache' }))
  })

  it('updates an existing Payload snapshot document', async () => {
    const client = payloadClient([{ id: 7, snapshot: fixtureSnapshot() }])
    const store = createPayloadXFeedSnapshotStore({ payload: client as never })
    await store.write(fixtureSnapshot())
    expect(client.update).toHaveBeenCalledWith(expect.objectContaining({ id: 7 }))
  })

  it('reads the isolated snapshot from Payload', async () => {
    const snapshot = fixtureSnapshot()
    const client = payloadClient([{ id: 7, snapshot }])
    const store = createPayloadXFeedSnapshotStore({ payload: client as never })
    await expect(store.read(snapshot.key)).resolves.toEqual(snapshot)
  })

  it('persists monitor state in the settings global', async () => {
    const state = createInitialXFeedMonitorState()
    const updateGlobal = vi.fn(async () => ({}))
    const store = createPayloadXFeedMonitorStore({
      payload: {
        findGlobal: vi.fn(async () => ({ monitorState: state })),
        updateGlobal,
      } as never,
    })
    await expect(store.read()).resolves.toEqual(state)
    await store.write(state)
    expect(updateGlobal).toHaveBeenCalledWith(expect.objectContaining({ data: { monitorState: state } }))
  })
})

function payloadClient(docs: unknown[]) {
  return {
    find: vi.fn(async () => ({ docs })),
    create: vi.fn(async () => ({})),
    update: vi.fn(async () => ({})),
  }
}
function fixtureSnapshot(): XFeedSnapshot {
  return {
    schemaVersion: 1, key: 'x:dss_feeds', username: 'dss_feeds', posts: [], checksum: 'cbf29ce484222325',
    source: { id: 'official', kind: 'official-api', stability: 'stable', label: 'Official', official: true, warning: null },
    adapterVersion: '0.0.0', generatedAt: '2026-07-14T10:00:00.000Z', freshUntil: '2026-07-14T11:00:00.000Z',
    staleUntil: '2026-07-15T11:00:00.000Z', nextSyncAt: '2026-07-14T11:00:00.000Z', warnings: [],
  }
}
