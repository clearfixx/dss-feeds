import type { Payload } from 'payload'
import { describe, expect, it, vi } from 'vitest'

import {
  createCommitChecksum,
  synchronizeGitHubFeed,
} from '../src/payload/index.js'
import type { GitHubCommit } from '../src/index.js'

const now = new Date('2026-07-13T12:00:00.000Z')

function createSettings(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    enabled: true,
    username: 'clearfixx',
    repositories: [
      {
        repository: 'clearfixx/portfolio',
      },
    ],
    commitLimit: 10,
    syncIntervalHours: 1,
    freshForMinutes: 90,
    staleForHours: 24,
    ...overrides,
  }
}

function createApiCommit() {
  return {
    sha: '1111111111111111111111111111111111111111',
    html_url:
      'https://github.com/clearfixx/portfolio/commit/1111111111111111111111111111111111111111',
    author: {
      login: 'clearfixx',
    },
    commit: {
      message: 'feat(github): add sync service\n\nDetails',
      author: {
        name: 'Andrii Kulahin',
        date: '2026-07-13T11:30:00.000Z',
      },
      committer: {
        date: '2026-07-13T11:30:00.000Z',
      },
    },
  }
}

function createPayloadMock(options: {
  settings?: Record<string, unknown>
  existing?: Array<Record<string, unknown>>
} = {}) {
  return {
    findGlobal: vi.fn(async () =>
      options.settings ?? createSettings(),
    ),
    find: vi.fn(async () => ({
      docs: options.existing ?? [],
    })),
    create: vi.fn(async ({ data }) => ({
      id: 'snapshot-1',
      ...data,
    })),
    update: vi.fn(async ({ id, data }) => ({
      id,
      ...data,
    })),
  }
}

function createFetchMock(status = 200) {
  return vi.fn(async () =>
    new Response(
      status === 200
        ? JSON.stringify([createApiCommit()])
        : 'request failed',
      {
        status,
        headers: {
          'Content-Type': 'application/json',
        },
      },
    ),
  )
}

describe('synchronizeGitHubFeed', () => {
  it('creates a complete snapshot after a successful provider request', async () => {
    const payloadMock = createPayloadMock()
    const fetchMock = createFetchMock()
    const logs: string[] = []

    const result = await synchronizeGitHubFeed({
      payload: payloadMock as unknown as Payload,
      fetch: fetchMock as typeof globalThis.fetch,
      now,
      onLog(entry) {
        logs.push(`${entry.level}:${entry.message}`)
      },
    })

    expect(result).toMatchObject({
      status: 'success',
      created: true,
      changed: true,
      commitCount: 1,
      generatedAt: '2026-07-13T12:00:00.000Z',
      freshUntil: '2026-07-13T13:30:00.000Z',
      staleUntil: '2026-07-14T13:30:00.000Z',
      nextSyncAt: '2026-07-13T13:00:00.000Z',
    })
    expect(payloadMock.create).toHaveBeenCalledTimes(1)
    expect(payloadMock.update).not.toHaveBeenCalled()

    const createCall = payloadMock.create.mock.calls[0]?.[0]
    expect(createCall).toMatchObject({
      collection: 'dss-github-feed-cache',
      overrideAccess: true,
      data: {
        key: 'github:default',
        username: 'clearfixx',
        adapterVersion: '0.0.0',
        commits: [
          {
            shortSha: '1111111',
            repository: 'clearfixx/portfolio',
            title: 'feat(github): add sync service',
          },
        ],
      },
    })
    expect(logs.at(-1)).toContain(
      'success:GitHub feed cache was created successfully.',
    )
  })

  it('replaces the existing snapshot in one update', async () => {
    const commits: GitHubCommit[] = [
      {
        id: 'clearfixx/portfolio@111',
        source: 'github',
        kind: 'commit',
        sha: '111',
        shortSha: '111',
        repository: 'clearfixx/portfolio',
        repositoryUrl:
          'https://github.com/clearfixx/portfolio',
        title: 'Previous title',
        committedAt: '2026-07-13T11:30:00.000Z',
        url: 'https://github.com/clearfixx/portfolio/commit/111',
        authorLogin: 'clearfixx',
        authorName: 'Andrii Kulahin',
      },
    ]
    const payloadMock = createPayloadMock({
      existing: [
        {
          id: 'snapshot-existing',
          checksum: createCommitChecksum(commits),
        },
      ],
    })

    const result = await synchronizeGitHubFeed({
      payload: payloadMock as unknown as Payload,
      fetch: createFetchMock() as typeof globalThis.fetch,
      now,
    })

    expect(result.created).toBe(false)
    expect(payloadMock.update).toHaveBeenCalledTimes(1)
    expect(payloadMock.update).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'snapshot-existing',
        overrideAccess: true,
      }),
    )
    expect(payloadMock.create).not.toHaveBeenCalled()
  })

  it('does not touch the cache when GitHub fails', async () => {
    const payloadMock = createPayloadMock()

    await expect(
      synchronizeGitHubFeed({
        payload: payloadMock as unknown as Payload,
        fetch: createFetchMock(500) as typeof globalThis.fetch,
        now,
      }),
    ).rejects.toMatchObject({
      code: 'REQUEST_FAILED',
      status: 500,
    })

    expect(payloadMock.find).not.toHaveBeenCalled()
    expect(payloadMock.create).not.toHaveBeenCalled()
    expect(payloadMock.update).not.toHaveBeenCalled()
  })

  it('skips all provider and cache work when disabled', async () => {
    const payloadMock = createPayloadMock({
      settings: createSettings({
        enabled: false,
      }),
    })
    const fetchMock = createFetchMock()

    const result = await synchronizeGitHubFeed({
      payload: payloadMock as unknown as Payload,
      fetch: fetchMock as typeof globalThis.fetch,
      now,
    })

    expect(result).toMatchObject({
      status: 'skipped',
      reason: 'disabled',
    })
    expect(fetchMock).not.toHaveBeenCalled()
    expect(payloadMock.find).not.toHaveBeenCalled()
    expect(payloadMock.create).not.toHaveBeenCalled()
    expect(payloadMock.update).not.toHaveBeenCalled()
  })

  it('rejects incomplete enabled settings before contacting GitHub', async () => {
    const payloadMock = createPayloadMock({
      settings: createSettings({
        repositories: [],
      }),
    })
    const fetchMock = createFetchMock()

    await expect(
      synchronizeGitHubFeed({
        payload: payloadMock as unknown as Payload,
        fetch: fetchMock as typeof globalThis.fetch,
        now,
      }),
    ).rejects.toMatchObject({
      code: 'INVALID_CONFIGURATION',
    })

    expect(fetchMock).not.toHaveBeenCalled()
    expect(payloadMock.create).not.toHaveBeenCalled()
    expect(payloadMock.update).not.toHaveBeenCalled()
  })
})
