import { describe, expect, it, vi } from 'vitest'

import { collectXPosts, XFeedError, type XFeedSource, type XPost } from '../src/index.js'
import { createFallbackXSource } from '../src/source/fallback.js'

describe('createFallbackXSource', () => {
  it('returns the first successful source without calling later sources', async () => {
    const second = vi.fn(async () => [fixturePost('101')])
    const source = createFallbackXSource({
      sources: [fixtureSource('first', [fixturePost('100')]), { id: 'second', fetchPosts: second }],
    })

    const posts = await collectXPosts(source, { username: 'dss_feeds' })

    expect(posts.map((post) => post.id)).toEqual(['100'])
    expect(second).not.toHaveBeenCalled()
  })

  it('continues after a source failure', async () => {
    const attempts: string[] = []
    const source = createFallbackXSource({
      sources: [
        {
          id: 'broken',
          async fetchPosts() {
            throw new XFeedError('RATE_LIMITED', 'limited', {
              sourceId: 'broken',
              status: 429,
            })
          },
        },
        fixtureSource('working', [fixturePost('101')]),
      ],
      onAttempt(info) {
        attempts.push(`${info.sourceId}:${info.outcome}`)
      },
    })

    const posts = await collectXPosts(source, { username: 'dss_feeds' })

    expect(posts.map((post) => post.id)).toEqual(['101'])
    expect(attempts).toEqual(['broken:error', 'working:success'])
  })

  it('accepts an empty successful response by default', async () => {
    const second = vi.fn(async () => [fixturePost('101')])
    const source = createFallbackXSource({
      sources: [fixtureSource('empty', []), { id: 'second', fetchPosts: second }],
    })

    await expect(
      collectXPosts(source, { username: 'dss_feeds' }),
    ).resolves.toEqual([])
    expect(second).not.toHaveBeenCalled()
  })

  it('can continue when a source returns no posts', async () => {
    const source = createFallbackXSource({
      sources: [
        fixtureSource('empty', []),
        fixtureSource('working', [fixturePost('102')]),
      ],
      fallbackOnEmpty: true,
    })

    const posts = await collectXPosts(source, { username: 'dss_feeds' })
    expect(posts.map((post) => post.id)).toEqual(['102'])
  })

  it('reports a structured error when all sources fail', async () => {
    const source = createFallbackXSource({
      sources: [
        failingSource('first'),
        failingSource('second'),
      ],
    })

    const error = await collectXPosts(source, {
      username: 'dss_feeds',
    }).catch((caught: unknown) => caught)

    expect(error).toBeInstanceOf(XFeedError)
    expect(error).toMatchObject({
      code: 'REQUEST_FAILED',
      sourceId: 'x-fallback',
    })
    expect((error as Error).cause).toBeInstanceOf(AggregateError)
  })

  it('rejects empty, duplicate, and recursive source lists', () => {
    expect(() => createFallbackXSource({ sources: [] })).toThrowError(
      XFeedError,
    )
    expect(() =>
      createFallbackXSource({
        sources: [fixtureSource('same', []), fixtureSource('same', [])],
      }),
    ).toThrowError(XFeedError)
    expect(() =>
      createFallbackXSource({
        sources: [fixtureSource('x-fallback', [])],
      }),
    ).toThrowError(XFeedError)
  })
})

function fixtureSource(id: string, posts: readonly XPost[]): XFeedSource {
  return {
    id,
    async fetchPosts() {
      return posts
    },
  }
}

function failingSource(id: string): XFeedSource {
  return {
    id,
    async fetchPosts() {
      throw new Error(`${id} unavailable`)
    },
  }
}

function fixturePost(id: string): XPost {
  return {
    id,
    source: 'x',
    kind: 'post',
    url: `https://x.com/dss_feeds/status/${id}`,
    text: `Post ${id}`,
    createdAt: '2026-07-14T10:00:00.000Z',
    language: null,
    conversationId: null,
    author: {
      id: null,
      username: 'dss_feeds',
      name: 'DSS Feeds',
      profileImageUrl: null,
      verified: null,
      protected: null,
    },
    metrics: {
      replies: 0,
      reposts: 0,
      likes: 0,
      quotes: 0,
      bookmarks: null,
      impressions: null,
    },
    media: [],
    references: [],
  }
}
