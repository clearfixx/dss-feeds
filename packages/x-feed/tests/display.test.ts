import { describe, expect, it, vi } from 'vitest'

import {
  createXFeedSettingsGlobal,
  DEFAULT_X_FEED_DISPLAY_POST_LIMIT,
  readXFeedDisplaySettings,
  resolveXFeedDisplayPostLimit,
} from '../src/payload/index.js'

describe('X feed public display settings', () => {
  it('registers a limit independent from cached posts', () => {
    const settings = createXFeedSettingsGlobal()
    const fields = new Map(
      settings.fields
        .filter((field) => 'name' in field)
        .map((field) => [field.name, field]),
    )

    expect(fields.get('displayPostLimit')).toMatchObject({
      defaultValue: 3,
      max: 5,
      min: 1,
      required: true,
    })
  })

  it('reads the display limit independently', async () => {
    const findGlobal = vi.fn(async () => ({
      postLimit: 40,
      displayPostLimit: 2,
    }))

    await expect(
      readXFeedDisplaySettings({
        payload: { findGlobal } as never,
      }),
    ).resolves.toEqual({
      postLimit: 2,
    })
  })

  it('falls back for invalid or unavailable settings', async () => {
    expect(resolveXFeedDisplayPostLimit(1)).toBe(1)
    expect(resolveXFeedDisplayPostLimit(5)).toBe(5)
    expect(resolveXFeedDisplayPostLimit(6)).toBe(
      DEFAULT_X_FEED_DISPLAY_POST_LIMIT,
    )

    await expect(
      readXFeedDisplaySettings({
        payload: {
          findGlobal: vi.fn(async () => {
            throw new Error('unavailable')
          }),
        } as never,
      }),
    ).resolves.toEqual({
      postLimit: DEFAULT_X_FEED_DISPLAY_POST_LIMIT,
    })
  })
})
