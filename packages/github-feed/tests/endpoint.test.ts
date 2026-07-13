import type { Config } from 'payload'
import {
  afterEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest'

import {
  createGitHubFeedSyncEndpoint,
  githubFeedPlugin,
} from '../src/payload/index.js'

const SECRET_ENV =
  'DSS_GITHUB_FEED_TEST_SYNC_SECRET'

afterEach(() => {
  delete process.env[SECRET_ENV]
})

function createRequest(options: {
  user?: unknown
  authorization?: string
  queueError?: boolean
} = {}) {
  const queue = options.queueError
    ? vi.fn(async () => {
        throw new Error(
          'queue unavailable',
        )
      })
    : vi.fn(async () => ({
        id: 'job-123',
      }))

  const headers = new Headers()

  if (options.authorization) {
    headers.set(
      'authorization',
      options.authorization,
    )
  }

  return {
    request: {
      user: options.user ?? null,
      headers,
      payload: {
        jobs: {
          queue,
        },
      },
    },
    queue,
  }
}

describe(
  'createGitHubFeedSyncEndpoint',
  () => {
    it(
      'queues a forced job for an authenticated Payload user',
      async () => {
        const endpoint =
          createGitHubFeedSyncEndpoint()
        const { request, queue } =
          createRequest({
            user: {
              id: 'admin-1',
            },
          })

        const response =
          await endpoint.handler(
            request as never,
          )
        const body =
          await response.json()

        expect(response.status).toBe(202)
        expect(body).toMatchObject({
          status: 'queued',
          jobId: 'job-123',
          queue:
            'dss-github-feed',
          task:
            'dss-github-feed-sync',
        })
        expect(
          queue,
        ).toHaveBeenCalledWith(
          expect.objectContaining({
            task:
              'dss-github-feed-sync',
            queue:
              'dss-github-feed',
            input: {
              trigger: 'endpoint',
              force: true,
            },
            overrideAccess: true,
          }),
        )
      },
    )

    it(
      'accepts the configured machine bearer secret',
      async () => {
        process.env[SECRET_ENV] =
          'machine-secret'

        const endpoint =
          createGitHubFeedSyncEndpoint({
            syncSecretEnvironmentVariable:
              SECRET_ENV,
          })
        const { request } =
          createRequest({
            authorization:
              'Bearer machine-secret',
          })

        const response =
          await endpoint.handler(
            request as never,
          )

        expect(response.status).toBe(202)
      },
    )

    it(
      'rejects anonymous and invalid bearer requests',
      async () => {
        process.env[SECRET_ENV] =
          'machine-secret'

        const endpoint =
          createGitHubFeedSyncEndpoint({
            syncSecretEnvironmentVariable:
              SECRET_ENV,
          })
        const { request, queue } =
          createRequest({
            authorization:
              'Bearer wrong-secret',
          })

        const response =
          await endpoint.handler(
            request as never,
          )

        expect(response.status).toBe(401)
        expect(
          queue,
        ).not.toHaveBeenCalled()
      },
    )

    it(
      'returns a generic service error when queueing fails',
      async () => {
        const endpoint =
          createGitHubFeedSyncEndpoint()
        const { request } =
          createRequest({
            user: {
              id: 'admin-1',
            },
            queueError: true,
          })

        const response =
          await endpoint.handler(
            request as never,
          )
        const body =
          await response.json()

        expect(response.status).toBe(503)
        expect(body).toEqual({
          error:
            'Unable to queue GitHub feed synchronization.',
        })
      },
    )

    it(
      'validates endpoint configuration',
      () => {
        expect(() =>
          createGitHubFeedSyncEndpoint({
            path:
              'missing-leading-slash',
          }),
        ).toThrow(
          'Endpoint path must start with "/"',
        )

        expect(() =>
          createGitHubFeedSyncEndpoint({
            syncSecretEnvironmentVariable:
              'invalid-name',
          }),
        ).toThrow(
          'Sync secret environment variable',
        )
      },
    )
  },
)

describe(
  'githubFeedPlugin endpoint registration',
  () => {
    const baseConfig = {
      secret: 'test-secret',
      collections: [],
      globals: [],
      endpoints: [
        {
          path: '/health',
          method: 'get',
          handler: async () =>
            Response.json({
              status: 'ok',
            }),
        },
      ],
    } as unknown as Config

    it(
      'preserves existing endpoints and appends the sync endpoint',
      async () => {
        const result =
          await githubFeedPlugin()(
            baseConfig,
          )

        expect(
          result.endpoints?.map(
            (endpoint) => [
              endpoint.method,
              endpoint.path,
            ],
          ),
        ).toEqual([
          ['get', '/health'],
          [
            'post',
            '/dss-github-feed/sync',
          ],
        ])
      },
    )

    it(
      'supports a custom endpoint path',
      async () => {
        const result =
          await githubFeedPlugin({
            syncEndpointPath:
              '/activity/github/sync',
          })(baseConfig)

        expect(
          result.endpoints?.some(
            (endpoint) =>
              endpoint.path ===
                '/activity/github/sync' &&
              endpoint.method === 'post',
          ),
        ).toBe(true)
      },
    )

    it(
      'fails early on endpoint collisions',
      () => {
        const collisionConfig = {
          ...baseConfig,
          endpoints: [
            ...(baseConfig.endpoints ?? []),
            {
              path:
                '/dss-github-feed/sync',
              method: 'post',
              handler: async () =>
                Response.json({}),
            },
          ],
        } as unknown as Config

        expect(() =>
          githubFeedPlugin()(
            collisionConfig,
          ),
        ).toThrow(
          'DSS GitHub Feed cannot register POST endpoint "/dss-github-feed/sync"',
        )
      },
    )
  },
)
