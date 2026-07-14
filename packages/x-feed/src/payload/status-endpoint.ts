import type { Config } from 'payload'
import { loadXFeedAdminStatus } from './admin-status.js'

type PayloadEndpoint = NonNullable<Config['endpoints']>[number]

export interface CreateXFeedStatusEndpointOptions {
  path?: string
  settingsSlug?: string
  cacheSlug?: string
  cacheKey?: string
}

export function createXFeedStatusEndpoint(
  options: CreateXFeedStatusEndpointOptions = {},
): PayloadEndpoint {
  const path = normalizeEndpointPath(
    options.path ?? '/dss-x-feed/status',
  )

  return {
    path,
    method: 'get',
    handler: async (req) => {
      if (!req.user) {
        return Response.json({ error: 'Unauthorized.' }, { status: 401 })
      }

      try {
        const status = await loadXFeedAdminStatus({
          payload: req.payload,
          ...(options.settingsSlug
            ? { settingsSlug: options.settingsSlug }
            : {}),
          ...(options.cacheSlug ? { cacheSlug: options.cacheSlug } : {}),
          ...(options.cacheKey ? { cacheKey: options.cacheKey } : {}),
        })
        return Response.json(status, {
          status: 200,
          headers: { 'Cache-Control': 'no-store' },
        })
      } catch {
        return Response.json(
          { error: 'Unable to read X feed status.' },
          { status: 503 },
        )
      }
    },
  }
}

function normalizeEndpointPath(value: string): string {
  const normalized = value.trim()
  if (
    !/^\/[A-Za-z0-9/_-]+$/.test(normalized) ||
    normalized.includes('//') ||
    normalized.endsWith('/')
  ) {
    throw new TypeError(
      'Endpoint path must start with "/" and contain only URL-safe path segments.',
    )
  }
  return normalized
}
