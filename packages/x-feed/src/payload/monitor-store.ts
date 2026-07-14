import type { Payload } from 'payload'

import type { XFeedMonitorState, XFeedMonitorStore } from '../monitor.js'

export interface CreatePayloadXFeedMonitorStoreOptions {
  payload: Payload
  settingsSlug?: string
}

interface PayloadMonitorClient {
  findGlobal(args: Record<string, unknown>): Promise<Record<string, unknown>>
  updateGlobal(args: Record<string, unknown>): Promise<unknown>
}

const DEFAULT_SETTINGS_SLUG = 'dss-x-feed-settings'

export function createPayloadXFeedMonitorStore(
  options: CreatePayloadXFeedMonitorStoreOptions,
): XFeedMonitorStore {
  const client = options.payload as unknown as PayloadMonitorClient
  const slug = options.settingsSlug ?? DEFAULT_SETTINGS_SLUG

  return {
    async read() {
      const settings = await client.findGlobal({ slug, overrideAccess: true })
      return settings.monitorState ?? null
    },
    async write(state: XFeedMonitorState) {
      await client.updateGlobal({
        slug,
        data: { monitorState: state },
        overrideAccess: true,
      })
    },
  }
}
