import { describe, expect, it } from 'vitest'

import { createXFeedSettingsGlobal } from '../src/payload/settings.js'

describe('X feed admin monitor settings field', () => {
  it('does not register the monitor unless requested', () => {
    const global = createXFeedSettingsGlobal()
    expect(global.fields.some((field) => 'name' in field && field.name === 'monitor')).toBe(false)
  })

  it('registers the neutral admin component and endpoint props', () => {
    const global = createXFeedSettingsGlobal({
      slug: 'custom-x-settings',
      monitor: {
        cacheSlug: 'custom-x-cache',
        statusEndpointPath: '/custom-x/status',
        syncEndpointPath: '/custom-x/sync',
        pollIntervalMs: 2000,
      },
    })
    const monitor = global.fields.find(
      (field) => 'name' in field && field.name === 'monitor',
    )
    expect(monitor).toMatchObject({
      type: 'ui',
      admin: {
        components: {
          Field: {
            path: '@dss-feeds/x-feed/admin',
            exportName: 'XFeedMonitor',
            serverProps: {
              settingsSlug: 'custom-x-settings',
              cacheSlug: 'custom-x-cache',
              statusEndpointPath: '/custom-x/status',
              syncEndpointPath: '/custom-x/sync',
              pollIntervalMs: 2000,
            },
          },
        },
      },
    })
  })

  it('rejects an unsafe polling interval', () => {
    expect(() =>
      createXFeedSettingsGlobal({ monitor: { pollIntervalMs: 100 } }),
    ).toThrow(/pollIntervalMs/)
  })
})
