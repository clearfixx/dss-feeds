import type { Payload } from 'payload'
import {
  describe,
  expect,
  it,
  vi,
} from 'vitest'

import {
  beginGitHubFeedRun,
  completeGitHubFeedRun,
  failGitHubFeedRun,
  readGitHubFeedRuntimeState,
} from '../src/payload/index.js'

function createPayloadMock(
  initial: Record<string, unknown> = {},
) {
  let globalData = {
    monitorStatus: 'idle',
    monitorAttemptCount: 0,
    monitorEvents: [],
    ...initial,
  }

  return {
    findGlobal: vi.fn(
      async () => globalData,
    ),
    updateGlobal: vi.fn(
      async ({
        data,
      }: {
        data:
          Record<string, unknown>
      }) => {
        globalData = {
          ...globalData,
          ...data,
        }

        return globalData
      },
    ),
    read() {
      return globalData
    },
  }
}

describe(
  'GitHub feed runtime state',
  () => {
    it(
      'persists running and successful state independently of Payload jobs',
      async () => {
        const payload =
          createPayloadMock()
        const startedAt =
          new Date(
            '2026-07-14T10:00:00.000Z',
          )
        const context =
          await beginGitHubFeedRun({
            payload:
              payload as unknown as Payload,
            trigger: 'endpoint',
            now: startedAt,
          })

        expect(
          payload.read(),
        ).toMatchObject({
          monitorStatus:
            'running',
          monitorTrigger:
            'endpoint',
          monitorAttemptCount: 1,
          monitorLastAttemptAt:
            startedAt.toISOString(),
        })

        await completeGitHubFeedRun({
          payload:
            payload as unknown as Payload,
          context,
          completedAt:
            new Date(
              '2026-07-14T10:00:02.500Z',
            ),
          result: {
            status: 'success',
            cacheKey:
              'github:default',
            created: false,
            changed: true,
            commitCount: 10,
            checksum:
              'checksum-1',
            generatedAt:
              '2026-07-14T10:00:00.000Z',
            freshUntil:
              '2026-07-14T11:30:00.000Z',
            staleUntil:
              '2026-07-15T11:30:00.000Z',
            nextSyncAt:
              '2026-07-14T11:00:00.000Z',
          },
          events: [
            {
              level:
                'success',
              message:
                'Cache replaced.',
              timestamp:
                '2026-07-14T10:00:02.500Z',
            },
          ],
        })

        const state =
          await readGitHubFeedRuntimeState({
            payload:
              payload as unknown as Payload,
          })

        expect(state).toMatchObject({
          status: 'success',
          attemptCount: 1,
          durationMs: 2500,
          commitCount: 10,
          checksum:
            'checksum-1',
          adapterVersion:
            '0.0.0',
        })
        expect(
          state?.events.map(
            (event) =>
              event.message,
          ),
        ).toEqual([
          'Synchronization trigger: endpoint.',
          'Cache replaced.',
        ])
      },
    )

    it(
      'persists failure details without replacing the cache',
      async () => {
        const payload =
          createPayloadMock()
        const context =
          await beginGitHubFeedRun({
            payload:
              payload as unknown as Payload,
            trigger:
              'schedule',
            now: new Date(
              '2026-07-14T10:00:00.000Z',
            ),
          })

        await failGitHubFeedRun({
          payload:
            payload as unknown as Payload,
          context,
          completedAt:
            new Date(
              '2026-07-14T10:00:01.000Z',
            ),
          events: [],
          error:
            new Error(
              'GitHub rate limit exceeded.',
            ),
        })

        const state =
          await readGitHubFeedRuntimeState({
            payload:
              payload as unknown as Payload,
          })

        expect(state).toMatchObject({
          status: 'error',
          durationMs: 1000,
          lastError:
            'GitHub rate limit exceeded.',
        })
        expect(
          state?.events.at(-1),
        ).toMatchObject({
          level: 'error',
          message:
            'GitHub rate limit exceeded.',
        })
      },
    )
  },
)
