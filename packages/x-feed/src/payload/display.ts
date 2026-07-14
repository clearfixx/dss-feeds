import type { Payload } from 'payload'

export const DEFAULT_X_FEED_DISPLAY_POST_LIMIT = 3
export const MAX_X_FEED_DISPLAY_POST_LIMIT = 5

export interface XFeedDisplaySettings {
  postLimit: number
}

export interface ReadXFeedDisplaySettingsOptions {
  payload: Payload
  settingsSlug?: string
}

interface XFeedDisplaySettingsClient {
  findGlobal(args: {
    slug: string
    overrideAccess: true
  }): Promise<unknown>
}

const DEFAULT_SETTINGS_SLUG = 'dss-x-feed-settings'

export async function readXFeedDisplaySettings(
  options: ReadXFeedDisplaySettingsOptions,
): Promise<XFeedDisplaySettings> {
  const client =
    options.payload as unknown as XFeedDisplaySettingsClient

  try {
    const value = await client.findGlobal({
      slug: options.settingsSlug ?? DEFAULT_SETTINGS_SLUG,
      overrideAccess: true,
    })

    return {
      postLimit: resolveXFeedDisplayPostLimit(
        isRecord(value) ? value.displayPostLimit : undefined,
      ),
    }
  } catch {
    return {
      postLimit: DEFAULT_X_FEED_DISPLAY_POST_LIMIT,
    }
  }
}

export function resolveXFeedDisplayPostLimit(
  value: unknown,
): number {
  return typeof value === 'number' &&
    Number.isInteger(value) &&
    value >= 1 &&
    value <= MAX_X_FEED_DISPLAY_POST_LIMIT
    ? value
    : DEFAULT_X_FEED_DISPLAY_POST_LIMIT
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}
