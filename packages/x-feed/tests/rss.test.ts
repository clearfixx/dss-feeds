import { describe, expect, it, vi } from 'vitest'

import { collectXPosts, XFeedError } from '../src/index.js'
import {
  createXRssSource,
  type XRssResponseInfo,
} from '../src/source/rss.js'

describe('createXRssSource', () => {
  it('builds a Nitter-compatible URL and normalizes RSS 2.0 posts', async () => {
    const calls: URL[] = []
    const source = createXRssSource({
      provider: 'nitter',
      baseUrl: 'https://nitter.example/',
      authorId: '42',
      authorName: 'Andrii',
      fetch: vi.fn(async (input: RequestInfo | URL) => {
        calls.push(new URL(String(input)))
        return xmlResponse(nitterFeed())
      }),
    })

    const posts = await collectXPosts(source, {
      username: '@clearfixx',
      postLimit: 5,
    })

    expect(calls[0]?.toString()).toBe(
      'https://nitter.example/clearfixx/rss',
    )
    expect(posts).toEqual([
      expect.objectContaining({
        id: '1900000000000000001',
        text: 'Hello & world\nSecond line',
        url: 'https://x.com/clearfixx/status/1900000000000000001',
        author: expect.objectContaining({
          id: '42',
          name: 'Andrii',
          username: 'clearfixx',
          profileImageUrl: 'https://cdn.example.com/avatar.jpg',
        }),
        media: [
          expect.objectContaining({
            type: 'photo',
            url: 'https://cdn.example.com/post.jpg',
            width: 1200,
            height: 800,
          }),
        ],
      }),
    ])
  })

  it('builds the RSSHub route and normalizes Atom entries', async () => {
    const calls: URL[] = []
    const source = createXRssSource({
      provider: 'rsshub',
      baseUrl: 'https://rss.example/base',
      fetch: vi.fn(async (input: RequestInfo | URL) => {
        calls.push(new URL(String(input)))
        return xmlResponse(atomFeed())
      }),
    })

    const posts = await collectXPosts(source, {
      username: 'dss_feeds',
    })

    expect(calls[0]?.toString()).toBe(
      'https://rss.example/base/twitter/user/dss_feeds',
    )
    expect(posts[0]).toMatchObject({
      id: '1900000000000000002',
      text: 'Atom post',
      author: {
        id: null,
        username: 'dss_feeds',
        name: 'DSS Feeds',
      },
    })
  })

  it('filters older RSS posts using sinceId locally', async () => {
    const source = createXRssSource({
      provider: 'nitter',
      baseUrl: 'https://nitter.example',
      fetch: async () =>
        xmlResponse(
          nitterFeed([
            rssItem('1900000000000000001', 'Old post'),
            rssItem('1900000000000000003', 'New post'),
          ]),
        ),
    })

    const posts = await collectXPosts(
      source,
      { username: 'clearfixx' },
      { sinceId: '1900000000000000001' },
    )

    expect(posts.map((post) => post.id)).toEqual(['1900000000000000003'])
  })

  it('marks a feed item from another creator as a repost', async () => {
    const source = createXRssSource({
      provider: 'nitter',
      baseUrl: 'https://nitter.example',
      fetch: async () =>
        xmlResponse(
          nitterFeed([
            rssItem(
              '1900000000000000004',
              'Shared post',
              '@another_author',
              'another_author',
            ),
          ]),
        ),
    })

    const retained = await collectXPosts(source, {
      username: 'clearfixx',
      excludeReposts: false,
    })
    const filtered = await collectXPosts(source, {
      username: 'clearfixx',
    })

    expect(retained[0]).toMatchObject({
      author: { id: null, username: 'another_author' },
      references: [
        { type: 'reposted', postId: '1900000000000000004' },
      ],
    })
    expect(filtered).toEqual([])
  })

  it('passes private self-hosted headers and reports response metadata', async () => {
    const responseInfo: XRssResponseInfo[] = []
    let requestHeaders = new Headers()
    const source = createXRssSource({
      provider: 'rsshub',
      baseUrl: 'https://rss.example',
      headers: { authorization: 'Basic server-secret' },
      fetch: async (_input, init) => {
        requestHeaders = new Headers(init?.headers)
        return xmlResponse('<rss><channel></channel></rss>', {
          headers: {
            'content-length': '30',
            'content-type': 'application/rss+xml',
          },
        })
      },
      onResponse(info) {
        responseInfo.push(info)
      },
    })

    await collectXPosts(source, { username: 'dss_feeds' })

    expect(requestHeaders.get('authorization')).toBe('Basic server-secret')
    expect(requestHeaders.get('accept')).toContain('application/rss+xml')
    expect(responseInfo).toEqual([
      {
        provider: 'rsshub',
        status: 200,
        contentType: 'application/rss+xml',
        contentLength: 30,
      },
    ])
  })

  it('maps RSS endpoint rate limiting', async () => {
    const source = createXRssSource({
      provider: 'nitter',
      baseUrl: 'https://nitter.example',
      fetch: async () => new Response('rate limited', { status: 429 }),
    })

    await expect(
      collectXPosts(source, { username: 'clearfixx' }),
    ).rejects.toMatchObject({
      code: 'RATE_LIMITED',
      sourceId: 'x-rss-nitter',
      status: 429,
    })
  })

  it('rejects oversized RSS responses before parsing', async () => {
    const source = createXRssSource({
      provider: 'rsshub',
      baseUrl: 'https://rss.example',
      maxResponseBytes: 1024,
      fetch: async () =>
        new Response('x'.repeat(1025), {
          headers: { 'content-length': '1025' },
          status: 200,
        }),
    })

    await expect(
      collectXPosts(source, { username: 'dss_feeds' }),
    ).rejects.toMatchObject({ code: 'INVALID_RESPONSE' })
  })

  it('rejects XML entity and doctype declarations', async () => {
    const source = createXRssSource({
      provider: 'nitter',
      baseUrl: 'https://nitter.example',
      fetch: async () =>
        xmlResponse(
          '<!DOCTYPE rss [<!ENTITY xxe SYSTEM "file:///etc/passwd">]><rss><channel /></rss>',
        ),
    })

    await expect(
      collectXPosts(source, { username: 'clearfixx' }),
    ).rejects.toMatchObject({ code: 'INVALID_RESPONSE' })
  })

  it('rejects unsafe remote base URLs and managed headers', () => {
    expect(() =>
      createXRssSource({
        provider: 'nitter',
        baseUrl: 'http://public.example',
      }),
    ).toThrowError(XFeedError)

    expect(() =>
      createXRssSource({
        provider: 'rsshub',
        baseUrl: 'https://rss.example',
        headers: { accept: 'text/plain' },
      }),
    ).toThrowError(XFeedError)
  })
})

function nitterFeed(items: readonly string[] = [rssItem()]): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:media="http://search.yahoo.com/mrss/">
  <channel>
    <title>Andrii / X</title>
    <image><url>https://cdn.example.com/avatar.jpg</url></image>
    ${items.join('\n')}
  </channel>
</rss>`
}

function rssItem(
  id = '1900000000000000001',
  title = 'Hello &amp; world&lt;br&gt;Second line',
  creator = '@clearfixx',
  postUsername = 'clearfixx',
): string {
  return `<item>
  <title><![CDATA[${title}]]></title>
  <dc:creator>${creator}</dc:creator>
  <description><![CDATA[<p>${title}</p>]]></description>
  <pubDate>Tue, 14 Jul 2026 08:00:00 GMT</pubDate>
  <guid>https://nitter.example/${postUsername}/status/${id}#m</guid>
  <link>https://nitter.example/${postUsername}/status/${id}#m</link>
  <media:content url="https://cdn.example.com/post.jpg" type="image/jpeg" width="1200" height="800" />
</item>`
}

function atomFeed(): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <title>DSS Feeds</title>
  <entry>
    <title>Atom post</title>
    <id>https://x.com/dss_feeds/status/1900000000000000002</id>
    <link rel="alternate" href="https://x.com/dss_feeds/status/1900000000000000002" />
    <published>2026-07-14T09:00:00.000Z</published>
    <author><name>@dss_feeds</name></author>
  </entry>
</feed>`
}

function xmlResponse(
  xml: string,
  init: ResponseInit = {},
): Response {
  return new Response(xml, {
    ...init,
    headers: {
      'content-type': 'application/rss+xml',
      ...Object.fromEntries(new Headers(init.headers).entries()),
    },
    status: init.status ?? 200,
  })
}
