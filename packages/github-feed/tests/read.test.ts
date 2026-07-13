import type { Payload } from 'payload'
import {
  describe,
  expect,
  it,
  vi,
} from 'vitest'

import {
  readGitHubFeed,
  resolveGitHubFeedCacheState,
} from '../src/payload/index.js'

const now =
  new Date('2026-07-13T12:00:00.000Z')

function createCommit(
  overrides: Record<string, unknown> = {},
) {
  return {
    externalId:
      'clearfixx/portfolio@1111111',
    sha:
      '1111111111111111111111111111111111111111',
    shortSha: '1111111',
    repository:
      'clearfixx/portfolio',
    repositoryUrl:
      'https://github.com/clearfixx/portfolio',
    title:
      'feat(github): add cache reader',
    committedAt:
      '2026-07-13T11:30:00.000Z',
    url:
      'https://github.com/clearfixx/portfolio/commit/1111111',
    authorLogin: 'clearfixx',
    authorName: 'Andrii Kulahin',
    ...overrides,
  }
}

function createSnapshot(
  overrides: Record<string, unknown> = {},
) {
  return {
    key: 'github:default',
    checksum: 'checksum-1',
    adapterVersion: '0.0.0',
    generatedAt:
      '2026-07-13T11:00:00.000Z',
    freshUntil:
      '2026-07-13T12:30:00.000Z',
    staleUntil:
      '2026-07-14T12:30:00.000Z',
    nextSyncAt:
      '2026-07-13T13:00:00.000Z',
    commits: [createCommit()],
    warnings: [],
    ...overrides,
  }
}

function createPayloadMock(
  docs: unknown[],
) {
  return {
    find: vi.fn(async () => ({
      docs,
    })),
  }
}

describe(
  'resolveGitHubFeedCacheState',
  () => {
    it(
      'keeps the snapshot fresh through its exact boundary',
      () => {
        expect(
          resolveGitHubFeedCacheState(
            {
              freshUntil:
                '2026-07-13T12:30:00.000Z',
              staleUntil:
                '2026-07-14T12:30:00.000Z',
            },
            new Date(
              '2026-07-13T12:30:00.000Z',
            ),
          ),
        ).toBe('fresh')
      },
    )

    it(
      'uses stale fallback after freshness expires',
      () => {
        expect(
          resolveGitHubFeedCacheState(
            {
              freshUntil:
                '2026-07-13T12:30:00.000Z',
              staleUntil:
                '2026-07-14T12:30:00.000Z',
            },
            new Date(
              '2026-07-13T12:30:00.001Z',
            ),
          ),
        ).toBe('stale')
      },
    )

    it(
      'expires after the stale boundary',
      () => {
        expect(
          resolveGitHubFeedCacheState(
            {
              freshUntil:
                '2026-07-13T12:30:00.000Z',
              staleUntil:
                '2026-07-14T12:30:00.000Z',
            },
            new Date(
              '2026-07-14T12:30:00.001Z',
            ),
          ),
        ).toBe('expired')
      },
    )
  },
)

describe('readGitHubFeed', () => {
  it(
    'returns an empty non-renderable result when no snapshot exists',
    async () => {
      const payload =
        createPayloadMock([])

      const result =
        await readGitHubFeed({
          payload:
            payload as unknown as Payload,
          now,
        })

      expect(result).toMatchObject({
        state: 'empty',
        renderable: false,
        commits: [],
      })
    },
  )

  it(
    'returns normalized fresh commits in descending order',
    async () => {
      const payload =
        createPayloadMock([
          createSnapshot({
            commits: [
              createCommit({
                externalId:
                  'clearfixx/portfolio@old',
                sha: 'old',
                shortSha: 'old',
                committedAt:
                  '2026-07-13T10:00:00.000Z',
              }),
              createCommit({
                externalId:
                  'clearfixx/portfolio@new',
                sha: 'new',
                shortSha: 'new',
                title: 'Newest commit',
                committedAt:
                  '2026-07-13T11:45:00.000Z',
              }),
            ],
          }),
        ])

      const result =
        await readGitHubFeed({
          payload:
            payload as unknown as Payload,
          now,
          commitCount: 2,
        })

      expect(result.state).toBe(
        'fresh',
      )
      expect(result.renderable).toBe(
        true,
      )
      expect(
        result.commits.map(
          (commit) => commit.title,
        ),
      ).toEqual([
        'Newest commit',
        'feat(github): add cache reader',
      ])
    },
  )

  it(
    'keeps stale commits renderable',
    async () => {
      const payload =
        createPayloadMock([
          createSnapshot({
            freshUntil:
              '2026-07-13T11:30:00.000Z',
            staleUntil:
              '2026-07-14T11:30:00.000Z',
          }),
        ])

      const result =
        await readGitHubFeed({
          payload:
            payload as unknown as Payload,
          now,
        })

      expect(result.state).toBe(
        'stale',
      )
      expect(result.renderable).toBe(
        true,
      )
      expect(result.commits).toHaveLength(
        1,
      )
    },
  )

  it(
    'suppresses expired content',
    async () => {
      const payload =
        createPayloadMock([
          createSnapshot({
            freshUntil:
              '2026-07-12T10:00:00.000Z',
            staleUntil:
              '2026-07-13T10:00:00.000Z',
          }),
        ])

      const result =
        await readGitHubFeed({
          payload:
            payload as unknown as Payload,
          now,
        })

      expect(result).toMatchObject({
        state: 'expired',
        renderable: false,
        commits: [],
        checksum: 'checksum-1',
      })
    },
  )

  it(
    'filters repositories before applying the display limit',
    async () => {
      const payload =
        createPayloadMock([
          createSnapshot({
            commits: [
              createCommit({
                externalId:
                  'clearfixx/portfolio@1',
                sha: '1',
                shortSha: '1',
              }),
              createCommit({
                externalId:
                  'clearfixx/dss-universe@2',
                sha: '2',
                shortSha: '2',
                repository:
                  'clearfixx/dss-universe',
                repositoryUrl:
                  'https://github.com/clearfixx/dss-universe',
                title:
                  'DSS Universe commit',
              }),
            ],
          }),
        ])

      const result =
        await readGitHubFeed({
          payload:
            payload as unknown as Payload,
          now,
          repositories: [
            'clearfixx/dss-universe',
          ],
          commitCount: 1,
        })

      expect(result.commits).toHaveLength(
        1,
      )
      expect(
        result.commits[0]?.repository,
      ).toBe(
        'clearfixx/dss-universe',
      )
    },
  )

  it(
    'skips malformed commit rows without throwing',
    async () => {
      const payload =
        createPayloadMock([
          createSnapshot({
            commits: [
              {
                title:
                  'Missing required fields',
              },
              createCommit(),
            ],
          }),
        ])

      const result =
        await readGitHubFeed({
          payload:
            payload as unknown as Payload,
          now,
        })

      expect(result.renderable).toBe(
        true,
      )
      expect(result.commits).toHaveLength(
        1,
      )
    },
  )

  it(
    'fails closed when the local cache read fails',
    async () => {
      const payload = {
        find: vi.fn(async () => {
          throw new Error(
            'database unavailable',
          )
        }),
      }

      const result =
        await readGitHubFeed({
          payload:
            payload as unknown as Payload,
          now,
        })

      expect(result).toMatchObject({
        state: 'unavailable',
        renderable: false,
        commits: [],
      })
    },
  )
})
