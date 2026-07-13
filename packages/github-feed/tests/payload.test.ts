import { describe, expect, it } from 'vitest'
import type { Config } from 'payload'

import {
  createGitHubFeedCache,
  createGitHubFeedSettings,
  githubFeedPlugin,
} from '../src/payload/index.js'
import {
  denyPayloadOperation,
  isAuthenticatedPayloadRequest,
} from '../src/payload/access.js'

const baseConfig: Config = {
  secret: 'test-secret',
  collections: [
    {
      slug: 'users',
      auth: true,
      fields: [],
    },
  ],
  globals: [
    {
      slug: 'site-settings',
      fields: [],
    },
  ],
}

describe('githubFeedPlugin', () => {
  it('preserves existing config and appends owned Payload schemas', () => {
    const result = githubFeedPlugin()(baseConfig)

    expect(result.collections?.map(({ slug }) => slug)).toEqual([
      'users',
      'dss-github-feed-cache',
    ])
    expect(result.globals?.map(({ slug }) => slug)).toEqual([
      'site-settings',
      'dss-github-feed-settings',
    ])
  })

  it('supports custom slugs and admin grouping', () => {
    const result = githubFeedPlugin({
      settingsSlug: 'github-settings',
      cacheSlug: 'github-cache',
      adminGroup: 'Activity',
    })(baseConfig)

    const settings = result.globals?.find(
      ({ slug }) => slug === 'github-settings',
    )

    expect(
      result.collections?.some(
        ({ slug }) => slug === 'github-cache',
      ),
    ).toBe(true)
    expect(settings?.admin?.group).toBe('Activity')
  })

  it('fails early on schema slug collisions', () => {
    expect(() =>
      githubFeedPlugin({
        settingsSlug: 'site-settings',
      })(baseConfig),
    ).toThrow(
      'DSS GitHub Feed cannot register global "site-settings"',
    )
  })
})

describe('Payload schema access', () => {
  it('requires authentication for settings and external cache reads', () => {
    expect(
      isAuthenticatedPayloadRequest({
        req: {},
      }),
    ).toBe(false)
    expect(
      isAuthenticatedPayloadRequest({
        req: {
          user: {
            id: 'admin-1',
          },
        },
      }),
    ).toBe(true)
  })

  it('denies external cache mutations', () => {
    expect(denyPayloadOperation()).toBe(false)
  })
})

describe('Payload schema factories', () => {
  it('keeps the cache collection hidden and unique by key', () => {
    const cache = createGitHubFeedCache({
      slug: 'github-cache',
    })
    const keyField = cache.fields.find(
      (field) => 'name' in field && field.name === 'key',
    )

    expect(cache.admin?.hidden).toBe(true)
    expect(keyField).toMatchObject({
      type: 'text',
      required: true,
      unique: true,
      index: true,
    })
  })

  it('uses safe synchronization defaults', () => {
    const settings = createGitHubFeedSettings({
      slug: 'github-settings',
      adminGroup: 'Activity',
    })
    const fields = new Map(
      settings.fields
        .filter((field) => 'name' in field)
        .map((field) => [field.name, field]),
    )

    expect(fields.get('enabled')).toMatchObject({
      defaultValue: false,
    })
    expect(fields.get('commitLimit')).toMatchObject({
      defaultValue: 10,
    })
    expect(fields.get('syncIntervalHours')).toMatchObject({
      defaultValue: 1,
    })
    expect(fields.get('freshForMinutes')).toMatchObject({
      defaultValue: 90,
    })
    expect(fields.get('staleForHours')).toMatchObject({
      defaultValue: 24,
    })
  })
})
