import { timingSafeEqual } from 'node:crypto'

import type { Config } from 'payload'

import {
  DEFAULT_X_FEED_QUEUE,
  DEFAULT_X_FEED_TASK_SLUG,
} from './task.js'

type PayloadEndpoint = NonNullable<Config['endpoints']>[number]

interface QueueJobResult {
  id: string | number
}

interface XFeedJobsClient {
  queue(args: {
    task: string
    input: { trigger: 'endpoint'; force: true }
    queue: string
    overrideAccess: true
    log: Array<{ message: string; createdAt: string }>
  }): Promise<QueueJobResult>
}

export interface CreateXFeedSyncEndpointOptions {
  path?: string
  taskSlug?: string
  queue?: string
  syncSecretEnvironmentVariable?: string
}

export function createXFeedSyncEndpoint(
  options: CreateXFeedSyncEndpointOptions = {},
): PayloadEndpoint {
  const path = normalizeEndpointPath(options.path ?? '/dss-x-feed/sync')
  const taskSlug = options.taskSlug ?? DEFAULT_X_FEED_TASK_SLUG
  const queue = options.queue ?? DEFAULT_X_FEED_QUEUE
  const secretEnvironmentVariable =
    options.syncSecretEnvironmentVariable ?? 'DSS_X_FEED_SYNC_SECRET'

  assertIdentifier(taskSlug, 'Task slug')
  assertIdentifier(queue, 'Queue name')
  assertEnvironmentVariableName(secretEnvironmentVariable)

  return {
    path,
    method: 'post',
    handler: async (req) => {
      if (
        !isAuthorizedRequest(
          req.user,
          req.headers,
          secretEnvironmentVariable,
        )
      ) {
        return Response.json({ error: 'Unauthorized.' }, { status: 401 })
      }

      const queuedAt = new Date().toISOString()
      const jobs = req.payload.jobs as unknown as XFeedJobsClient

      try {
        const job = await jobs.queue({
          task: taskSlug,
          input: { trigger: 'endpoint', force: true },
          queue,
          overrideAccess: true,
          log: [
            {
              message:
                'X feed synchronization queued by protected endpoint.',
              createdAt: queuedAt,
            },
          ],
        })

        return Response.json(
          {
            status: 'queued',
            jobId: job.id,
            queue,
            task: taskSlug,
            queuedAt,
          },
          { status: 202 },
        )
      } catch {
        return Response.json(
          { error: 'Unable to queue X feed synchronization.' },
          { status: 503 },
        )
      }
    },
  }
}

function isAuthorizedRequest(
  user: unknown | null | undefined,
  headers: Headers,
  secretEnvironmentVariable: string,
): boolean {
  if (user) return true
  const expectedSecret = process.env[secretEnvironmentVariable]
  if (!expectedSecret) return false
  const authorization = headers.get('authorization')
  if (!authorization?.startsWith('Bearer ')) return false
  return safeEqual(
    authorization.slice('Bearer '.length).trim(),
    expectedSecret,
  )
}

function safeEqual(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left)
  const rightBuffer = Buffer.from(right)
  if (leftBuffer.length !== rightBuffer.length) return false
  return timingSafeEqual(leftBuffer, rightBuffer)
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

function assertIdentifier(value: string, label: string): void {
  if (
    value.length === 0 ||
    value.length > 100 ||
    !/^[A-Za-z0-9][A-Za-z0-9_-]*$/.test(value)
  ) {
    throw new TypeError(
      `${label} must contain only letters, numbers, underscores, and hyphens.`,
    )
  }
}

function assertEnvironmentVariableName(value: string): void {
  if (!/^[A-Z_][A-Z0-9_]*$/.test(value)) {
    throw new TypeError(
      'Sync secret environment variable must use uppercase letters, numbers, and underscores.',
    )
  }
}
