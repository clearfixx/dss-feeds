import { describe, expect, it, vi } from 'vitest'

import type { XFeedSource } from '../src/index.js'
import {
  createPayloadXFeedSource,
  readPayloadXFeedRuntimeSettings,
  type PayloadXFeedRuntimeSettings,
} from '../src/payload/index.js'

describe('Payload X feed runtime settings', () => {
  it('reads enabled settings and converts durations to milliseconds', async () => {
    const settings = await readPayloadXFeedRuntimeSettings({
      payload: { findGlobal: vi.fn(async () => rawSettings()) } as never,
    })
    expect(settings).toMatchObject({
      enabled: true,
      sourceMode: 'official-api',
      config: { username: 'dss_feeds', postLimit: 8 },
      cachePolicy: { syncIntervalMs: 3_600_000, staleForMs: 86_400_000 },
      monitorPolicy: { failureThreshold: 3, notificationCooldownMs: 43_200_000 },
    })
  })

  it('allows disabled settings without a username', async () => {
    const settings = await readPayloadXFeedRuntimeSettings({
      payload: { findGlobal: vi.fn(async () => ({ enabled: false })) } as never,
    })
    expect(settings).toMatchObject({ enabled: false, config: { username: '' } })
  })

  it('creates the official X API source from an environment token', async () => {
    const source = await createPayloadXFeedSource({
      settings: runtimeSettings('official-api'),
      environment: { DSS_X_BEARER_TOKEN: 'secret-token' },
    })
    expect(source.id).toBe('x-api')
  })

  it('creates experimental Nitter and composite fallback sources', async () => {
    const nitter = await createPayloadXFeedSource({
      settings: { ...runtimeSettings('nitter'), nitterBaseUrl: 'https://nitter.example' },
      environment: {},
    })
    const fallback = await createPayloadXFeedSource({
      settings: {
        ...runtimeSettings('fallback'),
        nitterBaseUrl: 'https://nitter.example',
        rssHubBaseUrl: 'https://rsshub.example',
      },
      environment: { DSS_X_BEARER_TOKEN: 'secret-token' },
    })
    expect(nitter.metadata?.stability).toBe('experimental')
    expect(fallback).toMatchObject({ id: 'x-fallback', metadata: { stability: 'composite' } })
  })

  it('rejects an official source without a bearer token', async () => {
    await expect(createPayloadXFeedSource({
      settings: runtimeSettings('official-api'),
      environment: {},
    })).rejects.toMatchObject({ code: 'INVALID_CONFIGURATION' })
  })

  it('uses a custom source factory for custom mode', async () => {
    const custom: XFeedSource = { id: 'custom-source', async fetchPosts() { return [] } }
    await expect(createPayloadXFeedSource({
      settings: runtimeSettings('custom'),
      customSourceFactory: async () => custom,
    })).resolves.toBe(custom)
  })
})

function rawSettings() {
  return {
    enabled: true, username: 'dss_feeds', sourceMode: 'official-api', postLimit: 8,
    excludeReplies: true, excludeReposts: true, syncIntervalMinutes: 60,
    freshForMinutes: 90, staleForHours: 24, failureThreshold: 3,
    notificationCooldownHours: 12,
  }
}
function runtimeSettings(sourceMode: PayloadXFeedRuntimeSettings['sourceMode']): PayloadXFeedRuntimeSettings {
  return {
    enabled: true, sourceMode, nitterBaseUrl: null, rssHubBaseUrl: null,
    config: { username: 'dss_feeds', postLimit: 5 },
    cachePolicy: { syncIntervalMs: 3_600_000, freshForMs: 5_400_000, staleForMs: 86_400_000 },
    monitorPolicy: { failureThreshold: 3, notificationCooldownMs: 43_200_000 },
  }
}
