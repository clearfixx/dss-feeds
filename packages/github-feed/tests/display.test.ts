import { describe, expect, it, vi } from 'vitest'

import {
  createGitHubFeedSettings,
  DEFAULT_GITHUB_FEED_DISPLAY_COMMIT_LIMIT,
  readGitHubFeedDisplaySettings,
  resolveGitHubFeedDisplayCommitLimit,
} from '../src/payload/index.js'

function createSettings() {
  return createGitHubFeedSettings({
    slug: 'github-settings',
    adminGroup: 'Activity',
    monitor: {
      cacheSlug: 'github-cache',
      cacheKey: 'github:default',
      taskSlug: 'github-sync',
      syncEndpointPath: '/github/sync',
    },
  })
}

describe('GitHub feed public display settings', () => {
  it('registers a limit independent from cached commits', () => {
    const settings = createSettings()
    const fields = new Map(
      settings.fields
        .filter((field) => 'name' in field)
        .map((field) => [field.name, field]),
    )

    expect(fields.get('displayCommitLimit')).toMatchObject({
      defaultValue: 2,
      max: 10,
      min: 1,
      required: true,
    })
  })

  it('reads the display limit independently', async () => {
    const findGlobal = vi.fn(async () => ({
      commitLimit: 50,
      displayCommitLimit: 5,
    }))

    await expect(
      readGitHubFeedDisplaySettings({
        payload: { findGlobal } as never,
      }),
    ).resolves.toEqual({
      commitLimit: 5,
    })
  })

  it('falls back for invalid or unavailable settings', async () => {
    expect(resolveGitHubFeedDisplayCommitLimit(1)).toBe(1)
    expect(resolveGitHubFeedDisplayCommitLimit(10)).toBe(10)
    expect(resolveGitHubFeedDisplayCommitLimit(11)).toBe(
      DEFAULT_GITHUB_FEED_DISPLAY_COMMIT_LIMIT,
    )

    await expect(
      readGitHubFeedDisplaySettings({
        payload: {
          findGlobal: vi.fn(async () => {
            throw new Error('unavailable')
          }),
        } as never,
      }),
    ).resolves.toEqual({
      commitLimit:
        DEFAULT_GITHUB_FEED_DISPLAY_COMMIT_LIMIT,
    })
  })
})
