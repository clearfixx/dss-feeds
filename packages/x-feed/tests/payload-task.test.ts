import { afterEach, describe, expect, it, vi } from 'vitest'

import type { XFeedSource, XPost } from '../src/index.js'
import {
  createXFeedSyncEndpoint,
  createXFeedSyncTask,
} from '../src/payload/index.js'

type XFeedTask = ReturnType<typeof createXFeedSyncTask>
type XFeedTaskHandler = Exclude<XFeedTask['handler'], string>

function getInlineTaskHandler(task: XFeedTask): XFeedTaskHandler {
  if (typeof task.handler !== 'function') {
    throw new TypeError('Expected an inline Payload task handler.')
  }

  return task.handler
}

describe('Payload X feed task and endpoint', () => {
  afterEach(() => {
    delete process.env.DSS_X_FEED_SYNC_SECRET
  })

  it('creates a scheduled exclusive Payload task', () => {
    const task = createXFeedSyncTask()
    expect(task).toMatchObject({
      slug: 'dss-x-feed-sync',
      retries: 3,
      concurrency: { exclusive: true, supersedes: false },
    })
    expect(task.schedule).toEqual([{ cron: '0 * * * *', queue: 'dss-x-feed' }])
  })

  it('skips the task when synchronization is disabled', async () => {
    const task = createXFeedSyncTask({ scheduleEnabled: false })
    const handler = getInlineTaskHandler(task)
    const result = await handler({
      input: { trigger: 'manual', force: true },
      req: {
        payload: disabledPayload(),
        headers: new Headers(),
      },
    } as unknown as Parameters<typeof handler>[0]) as {
      output: Record<string, unknown>
    }
    expect(result.output).toMatchObject({
      status: 'skipped', reason: 'disabled', trigger: 'manual',
    })
  })

  it('runs a custom source through Payload persistence and monitoring', async () => {
    const payload = enabledPayload()
    const source: XFeedSource = {
      id: 'custom-source',
      async fetchPosts() { return [fixturePost('100')] },
    }
    const task = createXFeedSyncTask({
      scheduleEnabled: false,
      sourceFactory: async () => source,
      now: () => new Date('2026-07-14T10:00:00.000Z'),
    })
    const handler = getInlineTaskHandler(task)
    const result = await handler({
      input: { trigger: 'manual', force: true },
      req: {
        payload,
        headers: new Headers(),
      },
    } as unknown as Parameters<typeof handler>[0]) as {
      output: Record<string, unknown>
    }

    expect(result.output).toMatchObject({
      status: 'success', trigger: 'manual', cachedPostCount: 1,
      selectedSourceId: 'custom-source', monitorStatus: 'healthy',
    })
    expect(payload.create).toHaveBeenCalled()
    expect(payload.updateGlobal).toHaveBeenCalled()
  })

  it('rejects an unauthenticated sync endpoint request', async () => {
    const endpoint = createXFeedSyncEndpoint()
    const response = await endpoint.handler({
      payload: { jobs: { queue: vi.fn() } },
      user: null,
      headers: new Headers(),
    } as unknown as Parameters<typeof endpoint.handler>[0])
    expect(response.status).toBe(401)
  })

  it('queues a forced endpoint sync for an authenticated Payload user', async () => {
    const queue = vi.fn(async () => ({ id: 7 }))
    const endpoint = createXFeedSyncEndpoint()
    const response = await endpoint.handler({
      payload: { jobs: { queue } },
      user: { id: 1, collection: 'users' },
      headers: new Headers(),
    } as unknown as Parameters<typeof endpoint.handler>[0])
    expect(response.status).toBe(202)
    expect(queue).toHaveBeenCalledWith(expect.objectContaining({
      task: 'dss-x-feed-sync',
      queue: 'dss-x-feed',
      input: { trigger: 'endpoint', force: true },
    }))
  })

  it('accepts a timing-safe bearer secret for machine sync', async () => {
    process.env.DSS_X_FEED_SYNC_SECRET = 'machine-secret'
    const queue = vi.fn(async () => ({ id: 'job-1' }))
    const endpoint = createXFeedSyncEndpoint()
    const response = await endpoint.handler({
      payload: { jobs: { queue } },
      user: null,
      headers: new Headers({ authorization: 'Bearer machine-secret' }),
    } as unknown as Parameters<typeof endpoint.handler>[0])
    expect(response.status).toBe(202)
  })
})

function disabledPayload() {
  return {
    findGlobal: vi.fn(async () => ({ enabled: false })),
    updateGlobal: vi.fn(async () => ({})),
    jobs: {},
  }
}

function enabledPayload() {
  let monitorState: unknown = null
  const docs: Array<Record<string, unknown>> = []
  return {
    jobs: {},
    findGlobal: vi.fn(async () => ({
      enabled: true, username: 'dss_feeds', sourceMode: 'custom', postLimit: 5,
      excludeReplies: true, excludeReposts: true, syncIntervalMinutes: 60,
      freshForMinutes: 90, staleForHours: 24, failureThreshold: 3,
      notificationCooldownHours: 12, monitorState,
    })),
    updateGlobal: vi.fn(async ({ data }: { data: { monitorState?: unknown } }) => {
      if ('monitorState' in data) monitorState = data.monitorState
      return {}
    }),
    find: vi.fn(async () => ({ docs })),
    create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
      docs.splice(0, docs.length, { id: 1, ...data })
      return docs[0]
    }),
    update: vi.fn(async ({ id, data }: { id: number; data: Record<string, unknown> }) => ({ id, ...data })),
  }
}

function fixturePost(id: string): XPost {
  return {
    id, source: 'x', kind: 'post', url: `https://x.com/dss_feeds/status/${id}`,
    text: `Post ${id}`, createdAt: '2026-07-14T09:00:00.000Z', language: null,
    conversationId: null,
    author: { id: null, username: 'dss_feeds', name: 'DSS Feeds', profileImageUrl: null, verified: null, protected: null },
    metrics: { replies: 0, reposts: 0, likes: 0, quotes: 0, bookmarks: null, impressions: null },
    media: [], references: [],
  }
}
