import { describe, expect, it } from 'vitest'
import { readInstagramFeed } from '../src/payload/index.js'

describe('readInstagramFeed', () => {
  it('returns a fresh local snapshot', async () => {
    const payload = { find: async () => ({ docs: [{
      id: 1, sourceUsed: 'official', checksum: 'abc', adapterVersion: '0.1.0',
      generatedAt: '2026-07-14T10:00:00.000Z', freshUntil: '2026-07-14T12:00:00.000Z',
      staleUntil: '2026-07-20T12:00:00.000Z', nextSyncAt: '2026-07-14T16:00:00.000Z',
      warnings: [], posts: [{
        externalId: '1', shortcode: 'ABC', mediaType: 'image', imageUrl: '/media/instagram/1.jpg',
        providerImageUrl: 'https://scontent.cdninstagram.com/1.jpg',
        permalink: 'https://www.instagram.com/p/ABC/', publishedAt: '2026-07-14T09:00:00.000Z',
        username: 'clearfixx', likeCount: 4, commentCount: 2,
      }],
    }] }) }

    const result = await readInstagramFeed({ payload: payload as never, now: new Date('2026-07-14T11:00:00.000Z') })
    expect(result.state).toBe('fresh')
    expect(result.renderable).toBe(true)
    expect(result.posts).toHaveLength(1)
  })
})
