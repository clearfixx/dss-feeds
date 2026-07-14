import { describe, expect, it } from 'vitest'

import {
  collectXPosts,
  XFeedError,
  type XFeedSource,
  type XPost,
} from '../src/index.js'

describe('collectXPosts', () => {
  it('resolves defaults and strips the leading handle marker', async () => {
    let seenUsername = ''

    const source: XFeedSource = {
      id: 'fixture',
      async fetchPosts({ config }) {
        seenUsername = config.username
        return []
      },
    }

    await collectXPosts(source, { username: '@dss_feeds' })

    expect(seenUsername).toBe('dss_feeds')
  })

  it('sorts, deduplicates, and limits normalized posts', async () => {
    const source = fixtureSource([
      fixturePost('100', '2026-07-12T10:00:00.000Z'),
      fixturePost('101', '2026-07-14T10:00:00.000Z'),
      fixturePost('100', '2026-07-13T10:00:00.000Z'),
    ])

    const posts = await collectXPosts(source, {
      username: 'dss_feeds',
      postLimit: 1,
    })

    expect(posts.map((post) => post.id)).toEqual(['101'])
  })

  it('filters replies and reposts by default', async () => {
    const source = fixtureSource([
      fixturePost('100', '2026-07-14T10:00:00.000Z'),
      fixturePost('101', '2026-07-13T10:00:00.000Z', 'replied_to'),
      fixturePost('102', '2026-07-12T10:00:00.000Z', 'reposted'),
      fixturePost('103', '2026-07-11T10:00:00.000Z', 'quoted'),
    ])

    const posts = await collectXPosts(source, {
      username: 'dss_feeds',
    })

    expect(posts.map((post) => post.id)).toEqual(['100', '103'])
  })

  it('can retain replies and reposts explicitly', async () => {
    const source = fixtureSource([
      fixturePost('101', '2026-07-13T10:00:00.000Z', 'replied_to'),
      fixturePost('102', '2026-07-12T10:00:00.000Z', 'reposted'),
    ])

    const posts = await collectXPosts(source, {
      username: 'dss_feeds',
      excludeReplies: false,
      excludeReposts: false,
    })

    expect(posts).toHaveLength(2)
  })

  it('rejects an invalid source id', async () => {
    const source: XFeedSource = {
      id: 'Portfolio X Widget',
      async fetchPosts() {
        return []
      },
    }

    await expect(
      collectXPosts(source, { username: 'dss_feeds' }),
    ).rejects.toMatchObject({
      code: 'INVALID_SOURCE',
    })
  })

  it('rejects invalid normalized records', async () => {
    const source: XFeedSource = {
      id: 'fixture',
      async fetchPosts() {
        return [{ id: 'not-an-x-id' } as unknown as XPost]
      },
    }

    await expect(
      collectXPosts(source, { username: 'dss_feeds' }),
    ).rejects.toMatchObject({
      code: 'INVALID_RESPONSE',
      sourceId: 'fixture',
    })
  })

  it('wraps unknown source failures', async () => {
    const source: XFeedSource = {
      id: 'fixture',
      async fetchPosts() {
        throw new Error('network unavailable')
      },
    }

    await expect(
      collectXPosts(source, { username: 'dss_feeds' }),
    ).rejects.toMatchObject({
      code: 'REQUEST_FAILED',
      sourceId: 'fixture',
    })
  })

  it('preserves structured source failures', async () => {
    const source: XFeedSource = {
      id: 'fixture',
      async fetchPosts() {
        throw new XFeedError('REQUEST_FAILED', 'rate limited', {
          sourceId: 'fixture',
          status: 429,
        })
      },
    }

    await expect(
      collectXPosts(source, { username: 'dss_feeds' }),
    ).rejects.toMatchObject({
      code: 'REQUEST_FAILED',
      sourceId: 'fixture',
      status: 429,
    })
  })
})

function fixtureSource(posts: readonly XPost[]): XFeedSource {
  return {
    id: 'fixture',
    async fetchPosts() {
      return posts
    },
  }
}

function fixturePost(
  id: string,
  createdAt: string,
  referenceType?: 'replied_to' | 'quoted' | 'reposted',
): XPost {
  return {
    id,
    source: 'x',
    kind: 'post',
    url: `https://x.com/dss_feeds/status/${id}`,
    text: `Post ${id}`,
    createdAt,
    language: 'en',
    conversationId: id,
    author: {
      id: '999',
      username: 'dss_feeds',
      name: 'DSS Feeds',
      profileImageUrl: null,
      verified: null,
      protected: false,
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
    references: referenceType
      ? [{ type: referenceType, postId: '777' }]
      : [],
  }
}
