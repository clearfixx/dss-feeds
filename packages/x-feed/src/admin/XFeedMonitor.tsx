import type { Payload } from 'payload'
import '../../admin.css'
import { loadXFeedAdminStatus } from '../payload/admin-status.js'
import { XFeedMonitorClient } from './XFeedMonitorClient.js'

export interface XFeedMonitorProps {
  payload: Payload
  settingsSlug?: string
  cacheSlug?: string
  cacheKey?: string
  statusEndpointPath?: string
  syncEndpointPath?: string
  pollIntervalMs?: number
  title?: string
}

const DEFAULT_STATUS_ENDPOINT_PATH = '/dss-x-feed/status'
const DEFAULT_SYNC_ENDPOINT_PATH = '/dss-x-feed/sync'

export async function XFeedMonitor({
  payload,
  settingsSlug,
  cacheSlug,
  cacheKey,
  statusEndpointPath = DEFAULT_STATUS_ENDPOINT_PATH,
  syncEndpointPath = DEFAULT_SYNC_ENDPOINT_PATH,
  pollIntervalMs = 1500,
  title = 'X Feed Monitor',
}: XFeedMonitorProps) {
  const initialStatus = await loadXFeedAdminStatus({
    payload,
    ...(settingsSlug ? { settingsSlug } : {}),
    ...(cacheSlug ? { cacheSlug } : {}),
    ...(cacheKey ? { cacheKey } : {}),
  })

  return (
    <XFeedMonitorClient
      initialStatus={initialStatus}
      statusEndpointURL={buildPayloadEndpointURL(
        payload,
        statusEndpointPath,
      )}
      syncEndpointURL={buildPayloadEndpointURL(payload, syncEndpointPath)}
      title={title}
      pollIntervalMs={pollIntervalMs}
    />
  )
}

function buildPayloadEndpointURL(
  payload: Payload,
  endpointPath: string,
): string {
  const serverURL = payload.config.serverURL ?? ''
  const apiRoute = payload.config.routes.api
  return joinURLParts(serverURL, apiRoute, endpointPath)
}

function joinURLParts(...parts: string[]): string {
  return parts
    .filter(Boolean)
    .map((part, index) => {
      if (index === 0) return part.replace(/\/$/, '')
      return `/${part.replace(/^\/+|\/+$/g, '')}`
    })
    .join('')
}
