import { describe, expect, it, vi } from 'vitest'

import { collectXPosts, XFeedError } from '../src/index.js'
import {
  createXApiSource,
  type XApiResponseInfo,
} from '../src/source/x-api.js'

describe('createXApiSource', () => {
  it('resolves a user and maps the official API response', async () => {
    const calls: Array<{ init: RequestInit | undefined; url: URL }> = []
    const responses = [
      jsonResponse({
        data: {
          id: '42',
          name: 'DSS Feeds',
          profile_image_url: 'https://cdn.example.com/avatar.jpg',
          protected: false,
          username: 'dss_feeds',
          verified: true,
        },
      }),
      jsonResponse({
        data: [
          {
            attachments: { media_keys: ['3_100'] },
            author_id: '42',
            conversation_id: '90',
            created_at: '2026-07-14T08:00:00.000Z',
            id: '100',
            lang: 'en',
            public_metrics: {
              bookmark_count: 5,
              impression_count: 600,
              like_count: 30,
              quote_count: 2,
              reply_count: 4,
              retweet_count: 8,
            },
            referenced_tweets: [{ id: '91', type: 'quoted' }],
            text: 'Official API adapter',
          },
        ],
        includes: {
          media: [
            {
              alt_text: 'Adapter preview',
              height: 720,
              media_key: '3_100',
              type: 'photo',
              url: 'https://cdn.example.com/post.jpg',
              width: 1280,
            },
          ],
        },
      }),
    ]
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      calls.push({ init, url: new URL(String(input)) })
      const response = responses.shift()
      if (!response) {
        throw new Error('Unexpected request')
      }
      return response
    })
    const source = createXApiSource({
      bearerToken: 'server-side-bearer-token',
      fetch: fetchMock,
    })

    const posts = await collectXPosts(
      source,
      {
        username: '@dss_feeds',
        postLimit: 1,
      },
      { sinceId: '99' },
    )

    expect(posts).toEqual([
      expect.objectContaining({
        id: '100',
        url: 'https://x.com/dss_feeds/status/100',
        author: expect.objectContaining({
          id: '42',
          username: 'dss_feeds',
          verified: true,
        }),
        metrics: {
          bookmarks: 5,
          impressions: 600,
          likes: 30,
          quotes: 2,
          replies: 4,
          reposts: 8,
        },
        media: [
          expect.objectContaining({
            key: '3_100',
            type: 'photo',
            width: 1280,
          }),
        ],
        references: [{ postId: '91', type: 'quoted' }],
      }),
    ])
    expect(calls).toHaveLength(2)
    expect(calls[0]?.url.pathname).toBe('/2/users/by/username/dss_feeds')
    expect(calls[0]?.url.searchParams.get('user.fields')).toContain(
      'profile_image_url',
    )
    expect(calls[1]?.url.pathname).toBe('/2/users/42/tweets')
    expect(calls[1]?.url.searchParams.get('max_results')).toBe('5')
    expect(calls[1]?.url.searchParams.get('since_id')).toBe('99')
    expect(calls[1]?.url.searchParams.get('exclude')).toBe(
      'replies,retweets',
    )
    expect(new Headers(calls[0]?.init?.headers).get('authorization')).toBe(
      'Bearer server-side-bearer-token',
    )
  })

  it('retains and normalizes repost references when requested', async () => {
    const source = createXApiSource({
      bearerToken: 'server-side-bearer-token',
      fetch: sequenceFetch([
        userResponse(),
        jsonResponse({
          data: [
            {
              created_at: '2026-07-14T08:00:00.000Z',
              id: '100',
              referenced_tweets: [{ id: '80', type: 'retweeted' }],
              text: 'RT @example repost',
            },
          ],
        }),
      ]),
    })

    const posts = await collectXPosts(source, {
      username: 'dss_feeds',
      excludeReplies: false,
      excludeReposts: false,
    })

    expect(posts[0]?.references).toEqual([
      { postId: '80', type: 'reposted' },
    ])
  })

  it('caches the user lookup inside a source instance', async () => {
    const fetchMock = sequenceFetch([
      userResponse(),
      jsonResponse({}),
      jsonResponse({}),
    ])
    const source = createXApiSource({
      bearerToken: 'server-side-bearer-token',
      fetch: fetchMock,
    })

    await collectXPosts(source, { username: 'dss_feeds' })
    await collectXPosts(source, { username: 'DSS_FEEDS' })

    expect(fetchMock).toHaveBeenCalledTimes(3)
  })

  it('can disable the in-memory user cache', async () => {
    const fetchMock = sequenceFetch([
      userResponse(),
      jsonResponse({}),
      userResponse(),
      jsonResponse({}),
    ])
    const source = createXApiSource({
      bearerToken: 'server-side-bearer-token',
      fetch: fetchMock,
      userCacheTtlMs: 0,
    })

    await collectXPosts(source, { username: 'dss_feeds' })
    await collectXPosts(source, { username: 'dss_feeds' })

    expect(fetchMock).toHaveBeenCalledTimes(4)
  })

  it('returns an empty list when X returns no data and no errors', async () => {
    const source = createXApiSource({
      bearerToken: 'server-side-bearer-token',
      fetch: sequenceFetch([userResponse(), jsonResponse({ meta: { result_count: 0 } })]),
    })

    await expect(
      collectXPosts(source, { username: 'dss_feeds' }),
    ).resolves.toEqual([])
  })

  it('maps authentication failures without exposing the token', async () => {
    const source = createXApiSource({
      bearerToken: 'do-not-leak-this-token',
      fetch: sequenceFetch([
        jsonResponse(
          {
            errors: [
              {
                detail: 'Unauthorized',
                status: 401,
                title: 'Unauthorized',
              },
            ],
          },
          { status: 401 },
        ),
      ]),
    })

    const error = await collectXPosts(source, {
      username: 'dss_feeds',
    }).catch((caught: unknown) => caught)

    expect(error).toBeInstanceOf(XFeedError)
    expect(error).toMatchObject({
      code: 'AUTHENTICATION_FAILED',
      sourceId: 'x-api',
      status: 401,
    })
    expect(String(error)).not.toContain('do-not-leak-this-token')
  })

  it('maps rate limiting and reports response metadata', async () => {
    const responseInfo: XApiResponseInfo[] = []
    const source = createXApiSource({
      bearerToken: 'server-side-bearer-token',
      fetch: sequenceFetch([
        jsonResponse(
          { errors: [{ detail: 'Too many requests', status: 429 }] },
          {
            headers: {
              'x-rate-limit-limit': '15',
              'x-rate-limit-remaining': '0',
              'x-rate-limit-reset': '1784019600',
              'x-request-id': 'request-123',
            },
            status: 429,
          },
        ),
      ]),
      onResponse(info) {
        responseInfo.push(info)
      },
    })

    await expect(
      collectXPosts(source, { username: 'dss_feeds' }),
    ).rejects.toMatchObject({
      code: 'RATE_LIMITED',
      status: 429,
    })
    expect(responseInfo).toEqual([
      {
        endpoint: 'user_lookup',
        rateLimit: {
          limit: 15,
          remaining: 0,
          resetAt: '2026-07-14T09:00:00.000Z',
        },
        requestId: 'request-123',
        status: 429,
      },
    ])
  })

  it('rejects successful responses containing invalid JSON', async () => {
    const source = createXApiSource({
      bearerToken: 'server-side-bearer-token',
      fetch: sequenceFetch([
        new Response('not-json', {
          headers: { 'content-type': 'application/json' },
          status: 200,
        }),
      ]),
    })

    await expect(
      collectXPosts(source, { username: 'dss_feeds' }),
    ).rejects.toMatchObject({
      code: 'INVALID_RESPONSE',
      sourceId: 'x-api',
      status: 200,
    })
  })

  it('rejects invalid credentials and incremental IDs before a request', async () => {
    expect(() =>
      createXApiSource({ bearerToken: 'invalid\nheader' }),
    ).toThrowError(XFeedError)

    const fetchMock = vi.fn()
    const source = createXApiSource({
      bearerToken: 'server-side-bearer-token',
      fetch: fetchMock,
    })

    await expect(
      collectXPosts(
        source,
        { username: 'dss_feeds' },
        { sinceId: 'not-an-id' },
      ),
    ).rejects.toMatchObject({
      code: 'INVALID_CONFIGURATION',
    })
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

function userResponse(): Response {
  return jsonResponse({
    data: {
      id: '42',
      name: 'DSS Feeds',
      protected: false,
      username: 'dss_feeds',
      verified: false,
    },
  })
}

function jsonResponse(
  body: unknown,
  init: ResponseInit = {},
): Response {
  return new Response(JSON.stringify(body), {
    ...init,
    headers: {
      'content-type': 'application/json',
      ...init.headers,
    },
  })
}

function sequenceFetch(responses: Response[]) {
  return vi.fn(async () => {
    const response = responses.shift()
    if (!response) {
      throw new Error('Unexpected request')
    }
    return response
  })
}
