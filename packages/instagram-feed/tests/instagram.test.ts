import {
  describe,
  expect,
  it,
  vi,
} from 'vitest'
import {
  fetchExperimentalInstagramPosts,
  fetchInstagramPosts,
  fetchOfficialInstagramPosts,
} from '../src/index.js'

describe('Instagram sources', () => {
  it('normalizes official media', async () => {
    const request = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            data: [
              {
                id: '1',
                media_type: 'IMAGE',
                media_url:
                  'https://scontent.cdninstagram.com/photo.jpg',
                permalink:
                  'https://www.instagram.com/p/ABC/',
                timestamp:
                  '2026-07-14T10:00:00+0000',
                username: 'clearfixx',
                like_count: 11,
                comments_count: 2,
                caption: 'Hello',
              },
            ],
          }),
          {
            status: 200,
            headers: {
              'content-type':
                'application/json',
            },
          },
        ),
    )

    const posts =
      await fetchOfficialInstagramPosts(
        {
          username: 'clearfixx',
          sourceMode: 'official',
        },
        {
          official: {
            accessToken: 'token',
            userId: '123',
          },
          fetch: request,
        },
      )

    expect(posts).toHaveLength(1)
    expect(posts[0]).toMatchObject({
      id: '1',
      shortcode: 'ABC',
      mediaType: 'image',
      likeCount: 11,
      commentCount: 2,
    })
  })

  it('normalizes the experimental profile posts GraphQL response', async () => {
    const request = vi.fn(
      async (
        _input: RequestInfo | URL,
        _init?: RequestInit,
      ) =>
        new Response(
          JSON.stringify({
            data: {
              xdt_api__v1__feed__user_timeline_graphql_connection:
                {
                  edges: [
                    {
                      node: {
                        code: 'XYZ',
                        pk: '2',
                        caption: {
                          text: 'Caption',
                        },
                        taken_at:
                          1784023200,
                        image_versions2: {
                          candidates: [
                            {
                              url: 'https://scontent.cdninstagram.com/experimental.jpg',
                              width: 1672,
                              height: 941,
                            },
                            {
                              url: 'https://scontent.cdninstagram.com/thumb.jpg',
                              width: 640,
                              height: 360,
                            },
                          ],
                        },
                        original_width:
                          1672,
                        original_height:
                          941,
                        comment_count: 3,
                        like_count: 7,
                        media_type: 1,
                        product_type:
                          'feed',
                        user: {
                          username:
                            'clearfixx',
                        },
                      },
                    },
                  ],
                  page_info: {
                    end_cursor: 'None',
                    has_next_page:
                      false,
                  },
                },
            },
            status: 'ok',
          }),
          {
            status: 200,
            headers: {
              'content-type':
                'application/json',
            },
          },
        ),
    )

    const posts =
      await fetchExperimentalInstagramPosts(
        {
          username: 'clearfixx',
          sourceMode:
            'experimental-web-session',
        },
        {
          experimental: {
            sessionId: 'session',
            csrfToken: 'csrf',
            appId: '',
            documentId:
              '25403009626063073',
          },
          fetch: request,
        },
      )

    expect(posts).toHaveLength(1)
    expect(posts[0]).toMatchObject({
      id: '2',
      shortcode: 'XYZ',
      mediaType: 'image',
      likeCount: 7,
      commentCount: 3,
      width: 1672,
      height: 941,
    })

    expect(
      request.mock.calls[0]?.[1],
    ).toMatchObject({
      method: 'POST',
    })

    const requestBody = new URLSearchParams(
      String(
        request.mock.calls[0]?.[1]?.body ??
          '',
      ),
    )

    expect(
      requestBody.get('doc_id'),
    ).toBe('25403009626063073')
    expect(
      requestBody.get(
        'fb_api_req_friendly_name',
      ),
    ).toBe('PolarisProfilePostsQuery')

    const variables = JSON.parse(
      requestBody.get('variables') ??
        '{}',
    ) as {
      data?: {
        count?: number
      }
      username?: string
    }

    expect(variables).toMatchObject({
      data: {
        count: 12,
      },
      username: 'clearfixx',
    })
  })

  it('normalizes carousel posts from the experimental GraphQL response', async () => {
    const request = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            data: {
              xdt_api__v1__feed__user_timeline_graphql_connection:
                {
                  edges: [
                    {
                      node: {
                        code: 'CAROUSEL',
                        pk: '3',
                        caption: null,
                        taken_at:
                          1784023200,
                        image_versions2: {
                          candidates: [],
                        },
                        carousel_media: [
                          {
                            image_versions2: {
                              candidates: [
                                {
                                  url: 'https://scontent.cdninstagram.com/carousel.jpg',
                                  width: 1080,
                                  height: 1080,
                                },
                              ],
                            },
                          },
                        ],
                        comment_count: 0,
                        like_count: 0,
                        media_type: 8,
                        product_type:
                          'feed',
                        user: {
                          username:
                            'clearfixx',
                        },
                      },
                    },
                  ],
                },
            },
          }),
          {
            status: 200,
            headers: {
              'content-type':
                'application/json',
            },
          },
        ),
    )

    const posts =
      await fetchExperimentalInstagramPosts(
        {
          username: 'clearfixx',
          sourceMode:
            'experimental-web-session',
        },
        {
          experimental: {
            sessionId: 'session',
            csrfToken: 'csrf',
            appId:
              '936619743392459',
          },
          fetch: request,
        },
      )

    expect(posts[0]).toMatchObject({
      id: '3',
      shortcode: 'CAROUSEL',
      mediaType: 'carousel',
      providerImageUrl:
        'https://scontent.cdninstagram.com/carousel.jpg',
    })
  })

  it('falls back from official to experimental', async () => {
    const request = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          'Unauthorized',
          {
            status: 401,
          },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            data: {
              xdt_api__v1__feed__user_timeline_graphql_connection:
                {
                  edges: [],
                },
            },
          }),
          {
            status: 200,
            headers: {
              'content-type':
                'application/json',
            },
          },
        ),
      )

    const result =
      await fetchInstagramPosts(
        {
          username: 'clearfixx',
          sourceMode:
            'official-with-experimental-fallback',
        },
        {
          official: {
            accessToken: 'token',
            userId: '123',
          },
          experimental: {
            sessionId: 'session',
            csrfToken: 'csrf',
            appId: '',
          },
          fetch: request,
        },
      )

    expect(result.sourceUsed).toBe(
      'experimental-web-session',
    )
    expect(
      result.warnings.length,
    ).toBeGreaterThan(0)
  })
})
