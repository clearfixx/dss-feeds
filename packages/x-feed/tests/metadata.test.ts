import { describe, expect, it } from 'vitest'

import { getXFeedSourceMetadata, type XFeedSource } from '../src/index.js'
import { createFallbackXSource } from '../src/source/fallback.js'
import { createXRssSource } from '../src/source/rss.js'
import { createXApiSource } from '../src/source/x-api.js'

describe('X feed source metadata', () => {
  it('marks the official X API as stable and official', () => {
    const metadata = getXFeedSourceMetadata(
      createXApiSource({ bearerToken: 'test-bearer-token-value' }),
    )

    expect(metadata).toEqual({
      kind: 'official-api',
      stability: 'stable',
      label: 'Official X API',
      official: true,
      warning: null,
    })
  })

  it('marks RSS bridges as experimental and unofficial', () => {
    const metadata = getXFeedSourceMetadata(
      createXRssSource({
        provider: 'nitter',
        baseUrl: 'https://rss.example.com',
      }),
    )

    expect(metadata).toMatchObject({
      kind: 'rss-bridge',
      stability: 'experimental',
      official: false,
    })
    expect(metadata.warning).toContain('may stop working without notice')
  })

  it('marks a mixed fallback chain as composite', () => {
    const source = createFallbackXSource({
      sources: [
        createXRssSource({
          provider: 'rsshub',
          baseUrl: 'https://rss.example.com',
        }),
        createXApiSource({ bearerToken: 'test-bearer-token-value' }),
      ],
    })

    expect(getXFeedSourceMetadata(source)).toMatchObject({
      kind: 'fallback',
      stability: 'composite',
      official: null,
    })
  })

  it('provides safe unknown metadata for custom sources', () => {
    const source: XFeedSource = {
      id: 'custom-source',
      async fetchPosts() {
        return []
      },
    }

    expect(getXFeedSourceMetadata(source)).toEqual({
      kind: 'custom',
      stability: 'unknown',
      label: 'custom-source',
      official: null,
      warning: 'This custom X feed source does not declare stability metadata.',
    })
  })
})
