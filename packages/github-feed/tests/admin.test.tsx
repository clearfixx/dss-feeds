import type {
  Payload,
} from 'payload'
import {
  createElement,
} from 'react'
import {
  renderToStaticMarkup,
} from 'react-dom/server'
import {
  describe,
  expect,
  it,
  vi,
} from 'vitest'

import {
  GitHubFeedMonitor,
  loadGitHubFeedAdminStatus,
} from '../src/admin/index.js'
import {
  createGitHubFeedSettings,
} from '../src/payload/index.js'

const now =
  new Date(
    '2026-07-13T12:00:00.000Z',
  )

function createPayloadMock() {
  return {
    config: {
      serverURL:
        'https://example.com',
      routes: {
        api: '/api',
      },
    },
    find: vi.fn(
      async (
        input: {
          collection: string
        },
      ) => {
        if (
          input.collection ===
          'dss-github-feed-cache'
        ) {
          return {
            docs: [
              {
                key:
                  'github:default',
                checksum:
                  'checksum-1',
                adapterVersion:
                  '0.0.0',
                generatedAt:
                  '2026-07-13T11:00:00.000Z',
                freshUntil:
                  '2026-07-13T12:30:00.000Z',
                staleUntil:
                  '2026-07-14T12:30:00.000Z',
                nextSyncAt:
                  '2026-07-13T13:00:00.000Z',
                warnings: [],
                commits: [
                  {
                    externalId:
                      'clearfixx/portfolio@111',
                    sha:
                      '1111111111111111111111111111111111111111',
                    shortSha:
                      '1111111',
                    repository:
                      'clearfixx/portfolio',
                    repositoryUrl:
                      'https://github.com/clearfixx/portfolio',
                    title:
                      'feat(github): add admin monitor',
                    committedAt:
                      '2026-07-13T11:30:00.000Z',
                    url:
                      'https://github.com/clearfixx/portfolio/commit/111',
                  },
                ],
              },
            ],
          }
        }

        return {
          docs: [
            {
              id: 'job-1',
              taskSlug:
                'dss-github-feed-sync',
              createdAt:
                '2026-07-13T11:00:00.000Z',
              completedAt:
                '2026-07-13T11:00:02.000Z',
              hasError: false,
              processing: false,
              totalTried: 1,
              log: [
                {
                  message:
                    'Job queued.',
                  createdAt:
                    '2026-07-13T11:00:00.000Z',
                },
              ],
              taskStatus: {
                'dss-github-feed-sync': {
                  '1': {
                    output: {
                      events: [
                        {
                          level:
                            'success',
                          message:
                            'Cache replaced.',
                          timestamp:
                            '2026-07-13T11:00:02.000Z',
                        },
                      ],
                    },
                  },
                },
              },
            },
          ],
        }
      },
    ),
  }
}

describe(
  'loadGitHubFeedAdminStatus',
  () => {
    it(
      'combines cache state and recent Payload job events',
      async () => {
        const payload =
          createPayloadMock()

        const status =
          await loadGitHubFeedAdminStatus({
            payload:
              payload as unknown as Payload,
            cacheSlug:
              'dss-github-feed-cache',
            cacheKey:
              'github:default',
            taskSlug:
              'dss-github-feed-sync',
            now,
          })

        expect(
          status.cache,
        ).toMatchObject({
          state: 'fresh',
          renderable: true,
          cachedCommitCount: 1,
          nextSyncAt:
            '2026-07-13T13:00:00.000Z',
        })
        expect(
          status.jobs[0],
        ).toMatchObject({
          id: 'job-1',
          status: 'success',
          totalTried: 1,
        })
        expect(
          status.jobs[0]?.events.map(
            (event) =>
              event.message,
          ),
        ).toEqual([
          'Job queued.',
          'Cache replaced.',
        ])
      },
    )
  },
)

describe(
  'GitHubFeedMonitor',
  () => {
    it(
      'renders local operational status and regenerate control',
      async () => {
        const payload =
          createPayloadMock()
        const component =
          await GitHubFeedMonitor({
            payload:
              payload as unknown as Payload,
            cacheSlug:
              'dss-github-feed-cache',
            cacheKey:
              'github:default',
            taskSlug:
              'dss-github-feed-sync',
            syncEndpointPath:
              '/dss-github-feed/sync',
          })
        const html =
          renderToStaticMarkup(
            createElement(
              'div',
              null,
              component,
            ),
          )

        expect(html).toContain(
          'GitHub Feed Monitor',
        )
        expect(html).toContain(
          'Cached commits',
        )
        expect(html).toContain(
          'Cache replaced.',
        )
        expect(html).toContain(
          'Regenerate cache',
        )
        expect(html).toContain(
          'https://example.com/api/dss-github-feed/sync',
        )
      },
    )
  },
)

describe(
  'settings monitor field',
  () => {
    it(
      'registers the package component and serializable server props',
      () => {
        const settings =
          createGitHubFeedSettings({
            slug:
              'github-settings',
            adminGroup:
              'Activity',
            monitor: {
              cacheSlug:
                'github-cache',
              cacheKey:
                'github:default',
              taskSlug:
                'github-sync',
              syncEndpointPath:
                '/github/sync',
            },
          })
        const monitor =
          settings.fields.find(
            (field) =>
              'name' in field &&
              field.name ===
                'monitor',
          )

        expect(monitor).toMatchObject({
          type: 'ui',
          admin: {
            components: {
              Field: {
                path:
                  '@dss-feeds/github-feed/admin',
                exportName:
                  'GitHubFeedMonitor',
                serverProps: {
                  cacheSlug:
                    'github-cache',
                  cacheKey:
                    'github:default',
                  taskSlug:
                    'github-sync',
                  syncEndpointPath:
                    '/github/sync',
                  jobLimit: 5,
                },
              },
            },
          },
        })
      },
    )
  },
)
