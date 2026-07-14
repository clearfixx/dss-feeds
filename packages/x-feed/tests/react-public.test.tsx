import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import type {
  XFeedPublicPost,
  XFeedPublicResult,
} from '../src/index.js'
import { XFeed, XPostCard } from '../src/react/index.js'

describe('neutral public X feed components', () => {
  it('renders semantic feed and post markup', () => {
    const html = renderToStaticMarkup(
      createElement(XFeed, {
        feed: fixtureFeed(),
        heading: createElement('h2', null, 'Latest posts'),
      }),
    )

    expect(html).toContain('<section')
    expect(html).toContain('<ol')
    expect(html).toContain('<article')
    expect(html).toContain('Latest posts')
    expect(html).toContain('@dss_feeds')
    expect(html).toContain('Open post on X')
  })

  it('renders a neutral empty state', () => {
    const html = renderToStaticMarkup(
      createElement(XFeed, {
        feed: fixtureFeed({ state: 'empty', renderable: false, posts: [] }),
      }),
    )

    expect(html).toContain('role="status"')
    expect(html).toContain('No posts are available yet.')
  })

  it('renders unavailable cache states as alerts', () => {
    const html = renderToStaticMarkup(
      createElement(XFeed, {
        feed: fixtureFeed({
          state: 'unavailable',
          renderable: false,
          posts: [],
        }),
      }),
    )

    expect(html).toContain('role="alert"')
    expect(html).toContain('temporarily unavailable')
  })

  it('announces stale cached content without hiding posts', () => {
    const html = renderToStaticMarkup(
      createElement(XFeed, {
        feed: fixtureFeed({ state: 'stale', stale: true }),
      }),
    )

    expect(html).toContain('data-stale="true"')
    expect(html).toContain('Showing the last cached posts.')
    expect(html).toContain('Neutral cached post')
  })

  it('renders media previews without provider widgets or iframes', () => {
    const html = renderToStaticMarkup(
      createElement(XPostCard, { post: fixturePost() }),
    )

    expect(html).toContain('loading="lazy"')
    expect(html).toContain('cdn.example.test/photo.jpg')
    expect(html).not.toContain('<iframe')
    expect(html).not.toContain('platform.twitter.com')
  })

  it('supports custom labels, classes, and deterministic date rendering', () => {
    const html = renderToStaticMarkup(
      createElement(XFeed, {
        feed: fixtureFeed(),
        className: 'consumer-feed',
        itemClassName: 'consumer-item',
        labels: { openPost: 'Read the source post' },
        formatDate: () => 'CUSTOM_DATE',
      }),
    )

    expect(html).toContain('consumer-feed')
    expect(html).toContain('consumer-item')
    expect(html).toContain('Read the source post')
    expect(html).toContain('CUSTOM_DATE')
  })
})

function fixtureFeed(
  overrides: Partial<XFeedPublicResult> = {},
): XFeedPublicResult {
  return {
    state: 'fresh',
    renderable: true,
    stale: false,
    cachedPostCount: 1,
    posts: [fixturePost()],
    generatedAt: '2026-07-14T10:00:00.000Z',
    freshUntil: '2026-07-14T11:00:00.000Z',
    staleUntil: '2026-07-15T11:00:00.000Z',
    ...overrides,
  }
}

function fixturePost(): XFeedPublicPost {
  return {
    id: '100',
    url: 'https://x.com/dss_feeds/status/100',
    text: 'Neutral cached post',
    createdAt: '2026-07-14T10:00:00.000Z',
    language: 'en',
    author: {
      username: 'dss_feeds',
      name: 'DSS Feeds',
      profileImageUrl: null,
      verified: true,
    },
    metrics: {
      replies: 1,
      reposts: 2,
      likes: 3,
      quotes: 1,
      bookmarks: null,
      impressions: null,
    },
    media: [
      {
        type: 'photo',
        url: 'https://cdn.example.test/photo.jpg',
        previewImageUrl: null,
        altText: 'Test media',
        width: 1200,
        height: 800,
        durationMs: null,
      },
    ],
    isReply: false,
    isQuote: false,
    isRepost: false,
  }
}

