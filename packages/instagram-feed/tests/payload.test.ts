import { describe, expect, it } from 'vitest'
import type { Config } from 'payload'
import {
  createInstagramFeedSettings,
  instagramFeedPlugin,
} from '../src/payload/index.js'

const mediaMirror = async () => ({
  imageUrl: '/media/instagram/test.jpg',
})

const baseConfig = {
  secret: 'test-secret',
  collections: [],
  globals: [],
  endpoints: [],
  jobs: {
    tasks: [],
    workflows: [],
  },
} as unknown as Config

describe('Instagram Payload integration', () => {
  it('registers settings, cache, task, and endpoint', async () => {
    const config = await instagramFeedPlugin({
      mediaMirror,
    })(baseConfig)

    expect(
      config.globals?.some(
        (global) =>
          global.slug === 'dss-instagram-feed-settings',
      ),
    ).toBe(true)

    expect(
      config.collections?.some(
        (collection) =>
          collection.slug === 'dss-instagram-feed-cache',
      ),
    ).toBe(true)

    expect(
      config.jobs?.tasks?.some(
        (task) => task.slug === 'dss-instagram-feed-sync',
      ),
    ).toBe(true)

    expect(
      config.endpoints?.some(
        (endpoint) =>
          endpoint.path === '/dss-instagram-feed/sync',
      ),
    ).toBe(true)
  })

  it('exposes a configurable website display limit', () => {
    const settings = createInstagramFeedSettings({
      slug: 'dss-instagram-feed-settings',
      adminGroup: 'DSS Feeds',
      monitor: {
        cacheSlug: 'dss-instagram-feed-cache',
        cacheKey: 'instagram:default',
        taskSlug: 'dss-instagram-feed-sync',
        syncEndpointPath: '/dss-instagram-feed/sync',
      },
    })

    expect(
      settings.fields.some(
        (field) =>
          'name' in field &&
          field.name === 'displayPostLimit',
      ),
    ).toBe(true)
  })
})
