import { describe, expect, it, vi } from 'vitest'

import { createXFeedStatusEndpoint } from '../src/payload/status-endpoint.js'

describe('X feed status endpoint', () => {
  it('rejects unauthenticated requests', async () => {
    const endpoint = createXFeedStatusEndpoint()
    const response = await endpoint.handler({
      payload: {},
      user: null,
      headers: new Headers(),
    } as unknown as Parameters<typeof endpoint.handler>[0])
    expect(response.status).toBe(401)
  })

  it('returns no-store admin status for authenticated users', async () => {
    const payload = {
      findGlobal: vi.fn(async () => ({
        enabled: false,
        username: 'clearfixx',
        sourceMode: 'official-api',
        monitorState: null,
      })),
      find: vi.fn(async () => ({ docs: [] })),
    }
    const endpoint = createXFeedStatusEndpoint()
    const response = await endpoint.handler({
      payload,
      user: { id: 1, collection: 'users' },
      headers: new Headers(),
    } as unknown as Parameters<typeof endpoint.handler>[0])

    expect(response.status).toBe(200)
    expect(response.headers.get('cache-control')).toBe('no-store')
    const body = (await response.json()) as { checkedAt: string }
    expect(Number.isNaN(Date.parse(body.checkedAt))).toBe(false)
  })

  it('validates endpoint paths', () => {
    expect(() =>
      createXFeedStatusEndpoint({ path: 'missing-slash' }),
    ).toThrow(/Endpoint path/)
  })
})
