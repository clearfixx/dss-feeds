import { describe, expect, it, vi } from 'vitest'

import {
  getPayloadXFeedSourceModeMetadata,
  parseXFeedAdminStatus,
} from '../src/admin/status.js'
import { loadXFeedAdminStatus } from '../src/payload/admin-status.js'
import { createInitialXFeedMonitorState } from '../src/monitor.js'

describe('X feed admin status', () => {
  it('marks Nitter and RSSHub as experimental', () => {
    expect(getPayloadXFeedSourceModeMetadata('nitter')).toMatchObject({
      stability: 'experimental',
      official: false,
    })
    expect(getPayloadXFeedSourceModeMetadata('rsshub')).toMatchObject({
      stability: 'experimental',
      official: false,
    })
  })

  it('marks the official API as stable', () => {
    expect(getPayloadXFeedSourceModeMetadata('official-api')).toEqual({
      kind: 'official-api',
      stability: 'stable',
      label: 'Official X API',
      official: true,
      warning: null,
    })
  })

  it('loads empty cache and persistent monitor state', async () => {
    const monitorState = {
      ...createInitialXFeedMonitorState(),
      status: 'degraded' as const,
      consecutiveDegradedRuns: 3,
    }
    const payload = createPayload({
      settings: {
        enabled: true,
        username: 'clearfixx',
        sourceMode: 'nitter',
        monitorState,
      },
      snapshot: null,
    })

    const status = await loadXFeedAdminStatus({
      payload: payload as never,
      now: new Date('2026-07-14T12:00:00.000Z'),
    })

    expect(status.settings.configuredSource.stability).toBe('experimental')
    expect(status.cache.state).toBe('empty')
    expect(status.monitor.status).toBe('degraded')
    expect(status.monitor.consecutiveDegradedRuns).toBe(3)
  })

  it('derives the username cache key', async () => {
    const payload = createPayload({
      settings: {
        enabled: false,
        username: '@Clearfixx',
        sourceMode: 'official-api',
      },
      snapshot: null,
    })

    await loadXFeedAdminStatus({ payload: payload as never })

    expect(payload.find).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { key: { equals: 'x:clearfixx' } },
      }),
    )
  })

  it('parses a serialized admin status response', () => {
    const value = fixtureAdminStatus()
    expect(parseXFeedAdminStatus(value)).toMatchObject({
      settings: { sourceMode: 'official-api' },
      cache: { state: 'fresh', cachedPostCount: 2 },
      monitor: { status: 'healthy' },
    })
  })

  it('rejects malformed admin status responses', () => {
    expect(parseXFeedAdminStatus({ checkedAt: 'nope' })).toBeNull()
  })
})

function createPayload(input: {
  settings: Record<string, unknown>
  snapshot: unknown
}) {
  return {
    findGlobal: vi.fn(async () => input.settings),
    find: vi.fn(async () => ({
      docs: input.snapshot === null ? [] : [{ id: 1, snapshot: input.snapshot }],
    })),
  }
}

function fixtureAdminStatus() {
  const timestamp = '2026-07-14T12:00:00.000Z'
  return {
    checkedAt: timestamp,
    settings: {
      enabled: true,
      username: 'clearfixx',
      sourceMode: 'official-api',
      configuredSource: getPayloadXFeedSourceModeMetadata('official-api'),
    },
    cache: {
      state: 'fresh',
      renderable: true,
      cachedPostCount: 2,
      checksum: 'checksum',
      sourceId: 'x-api',
      source: getPayloadXFeedSourceModeMetadata('official-api'),
      adapterVersion: '0.0.0',
      generatedAt: timestamp,
      freshUntil: timestamp,
      staleUntil: timestamp,
      nextSyncAt: timestamp,
      warnings: [],
    },
    monitor: {
      status: 'healthy',
      runId: 'run-1',
      trigger: 'schedule',
      attemptCount: 1,
      consecutiveFailures: 0,
      consecutiveDegradedRuns: 0,
      lastAttemptAt: timestamp,
      lastSuccessAt: timestamp,
      lastFailureAt: null,
      lastRecoveryAt: null,
      completedAt: timestamp,
      durationMs: 25,
      lastError: null,
      requestedSourceId: 'x-api',
      selectedSourceId: 'x-api',
      notificationSuppressedUntil: null,
      lastNotificationAt: null,
      history: [],
    },
    diagnostics: null,
  }
}
