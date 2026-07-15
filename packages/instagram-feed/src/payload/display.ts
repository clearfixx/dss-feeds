import type { Payload } from 'payload'
import { assertDisplayLimit } from '../security.js'

export const DEFAULT_INSTAGRAM_FEED_DISPLAY_POST_LIMIT = 6
export const MAX_INSTAGRAM_FEED_DISPLAY_POST_LIMIT = 24

export interface InstagramFeedDisplaySettings { postLimit: number }
export interface ReadInstagramFeedDisplaySettingsOptions { payload: Payload; settingsSlug?: string }

interface Client {
  findGlobal(args: { slug: string; overrideAccess: true }): Promise<unknown>
}

export async function readInstagramFeedDisplaySettings(options: ReadInstagramFeedDisplaySettingsOptions): Promise<InstagramFeedDisplaySettings> {
  const client = options.payload as unknown as Client
  try {
    const value = await client.findGlobal({ slug: options.settingsSlug ?? 'dss-instagram-feed-settings', overrideAccess: true })
    return { postLimit: resolveInstagramFeedDisplayPostLimit(isRecord(value) ? value.displayPostLimit : undefined) }
  } catch {
    return { postLimit: DEFAULT_INSTAGRAM_FEED_DISPLAY_POST_LIMIT }
  }
}

export function resolveInstagramFeedDisplayPostLimit(value: unknown): number {
  try {
    return assertDisplayLimit(typeof value === 'number' ? value : undefined, DEFAULT_INSTAGRAM_FEED_DISPLAY_POST_LIMIT)
  } catch {
    return DEFAULT_INSTAGRAM_FEED_DISPLAY_POST_LIMIT
  }
}

function isRecord(value: unknown): value is Record<string, unknown> { return typeof value === 'object' && value !== null }
