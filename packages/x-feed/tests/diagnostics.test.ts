import { describe, expect, it } from 'vitest'

import {
  collectXPosts,
  readXFeedSourceRunDiagnostics,
  type XFeedSource,
  type XPost,
} from '../src/index.js'
import { createFallbackXSource } from '../src/source/fallback.js'

describe('X source diagnostics', () => {
  it('reports a normal source as selected and healthy', () => {
    const source: XFeedSource = { id: 'custom', async fetchPosts() { return [] } }
    expect(readXFeedSourceRunDiagnostics(source)).toEqual({
      requestedSourceId: 'custom',
      selectedSourceId: 'custom',
      degraded: false,
      attempts: [{ sourceId: 'custom', index: 0, outcome: 'success', errorCode: null, status: null }],
    })
  })

  it('records the first successful fallback source', async () => {
    const source = createFallbackXSource({ sources: [fixtureSource('rss', [fixturePost('100')])] })
    await collectXPosts(source, { username: 'dss_feeds' })
    expect(readXFeedSourceRunDiagnostics(source)).toMatchObject({
      selectedSourceId: 'rss',
      degraded: false,
    })
  })

  it('marks a later fallback selection as degraded', async () => {
    const source = createFallbackXSource({
      sources: [failingSource('broken'), fixtureSource('official', [fixturePost('101')])],
    })
    await collectXPosts(source, { username: 'dss_feeds' })
    expect(readXFeedSourceRunDiagnostics(source)).toEqual({
      requestedSourceId: 'x-fallback',
      selectedSourceId: 'official',
      degraded: true,
      attempts: [
        { sourceId: 'broken', index: 0, outcome: 'error', errorCode: 'REQUEST_FAILED', status: null },
        { sourceId: 'official', index: 1, outcome: 'success', errorCode: null, status: null },
      ],
    })
  })

  it('retains exhausted fallback attempts after failure', async () => {
    const source = createFallbackXSource({ sources: [failingSource('first'), failingSource('second')] })
    await expect(collectXPosts(source, { username: 'dss_feeds' })).rejects.toThrow()
    expect(readXFeedSourceRunDiagnostics(source)).toMatchObject({
      selectedSourceId: null,
      degraded: true,
      attempts: [{ sourceId: 'first' }, { sourceId: 'second' }],
    })
  })
})

function fixtureSource(id: string, posts: readonly XPost[]): XFeedSource {
  return { id, async fetchPosts() { return posts } }
}
function failingSource(id: string): XFeedSource {
  return { id, async fetchPosts() { throw new Error(`${id} unavailable`) } }
}
function fixturePost(id: string): XPost {
  return {
    id, source: 'x', kind: 'post', url: `https://x.com/dss_feeds/status/${id}`,
    text: `Post ${id}`, createdAt: '2026-07-14T10:00:00.000Z', language: null,
    conversationId: null,
    author: { id: null, username: 'dss_feeds', name: 'DSS Feeds', profileImageUrl: null, verified: null, protected: null },
    metrics: { replies: 0, reposts: 0, likes: 0, quotes: 0, bookmarks: null, impressions: null },
    media: [], references: [],
  }
}
