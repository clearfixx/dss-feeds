import { describe, expect, it, vi } from 'vitest'

import {
  fetchGitHubCommits,
  GitHubFeedError,
} from '../src/index.js'

function createCommit(
  sha: string,
  repository: string,
  committedAt: string,
  message: string,
) {
  return {
    sha,
    html_url: `https://github.com/${repository}/commit/${sha}`,
    author: {
      login: 'clearfixx',
    },
    commit: {
      message,
      author: {
        name: 'Andrii Kulahin',
        date: committedAt,
      },
      committer: {
        date: committedAt,
      },
    },
  }
}

describe('fetchGitHubCommits', () => {
  it('normalizes repositories, requests them sequentially, and sorts commits', async () => {
    const requestOrder: string[] = []

    const fetchMock = vi.fn(
      async (
        input: URL | RequestInfo,
        _init?: RequestInit,
      ) => {
        const url = new URL(String(input))
        const repository = url.pathname
          .replace('/repos/', '')
          .replace('/commits', '')

        requestOrder.push(repository)

        const body =
          repository === 'clearfixx/portfolio'
            ? [
                createCommit(
                  '1111111111111111111111111111111111111111',
                  repository,
                  '2026-07-13T10:00:00Z',
                  'feat(ui): add GitHub activity\n\nDetails',
                ),
              ]
            : [
                createCommit(
                  '2222222222222222222222222222222222222222',
                  repository,
                  '2026-07-13T11:00:00Z',
                  'feat(api): add storage provider',
                ),
              ]

        return new Response(JSON.stringify(body), {
          status: 200,
          headers: {
            'Content-Type': 'application/json',
          },
        })
      },
    )

    const commits = await fetchGitHubCommits(
      {
        username: 'clearfixx',
        repositories: [
          'portfolio',
          'clearfixx/dss-universe',
        ],
        commitLimit: 2,
      },
      {
        fetch: fetchMock as typeof globalThis.fetch,
      },
    )

    expect(requestOrder).toEqual([
      'clearfixx/portfolio',
      'clearfixx/dss-universe',
    ])
    expect(commits).toHaveLength(2)
    expect(commits[0]).toMatchObject({
      repository: 'clearfixx/dss-universe',
      shortSha: '2222222',
      title: 'feat(api): add storage provider',
    })
    expect(commits[1]).toMatchObject({
      repository: 'clearfixx/portfolio',
      shortSha: '1111111',
      title: 'feat(ui): add GitHub activity',
    })

    const firstRequest = fetchMock.mock.calls[0]

    expect(firstRequest).toBeDefined()

    const [firstInput, firstOptions] = firstRequest!
    const firstUrl = new URL(String(firstInput))
    const headers = new Headers(
      firstOptions?.headers,
    )

    expect(firstUrl.origin).toBe(
      'https://api.github.com',
    )
    expect(
      firstUrl.searchParams.get('author'),
    ).toBe('clearfixx')
    expect(
      firstUrl.searchParams.get('per_page'),
    ).toBe('10')
    expect(headers.get('User-Agent')).toBe(
      '@dss-feeds/github-feed',
    )
    expect(
      headers.get('X-GitHub-Api-Version'),
    ).toBe('2026-03-10')
  })

  it('adds server-side authentication without exposing it in errors', async () => {
    const token =
      'secret-token-that-must-not-leak'

    const fetchMock = vi.fn(
      async (
        _input: URL | RequestInfo,
        init?: RequestInit,
      ) => {
        const headers = new Headers(
          init?.headers,
        )

        expect(
          headers.get('Authorization'),
        ).toBe(`Bearer ${token}`)

        return new Response('rate limited', {
          status: 403,
        })
      },
    )

    let caught: unknown

    try {
      await fetchGitHubCommits(
        {
          username: 'clearfixx',
          repositories: ['portfolio'],
        },
        {
          fetch:
            fetchMock as typeof globalThis.fetch,
          token,
        },
      )
    } catch (error) {
      caught = error
    }

    expect(caught).toBeInstanceOf(
      GitHubFeedError,
    )
    expect(String(caught)).not.toContain(token)
    expect(
      (caught as GitHubFeedError).status,
    ).toBe(403)
  })

  it('rejects arbitrary repository URLs before making a request', async () => {
    const fetchMock = vi.fn()

    await expect(
      fetchGitHubCommits(
        {
          username: 'clearfixx',
          repositories: [
            'https://example.com/private',
          ],
        },
        {
          fetch:
            fetchMock as typeof globalThis.fetch,
        },
      ),
    ).rejects.toMatchObject({
      code: 'INVALID_CONFIGURATION',
    })

    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('deduplicates repeated repositories', async () => {
    const fetchMock = vi.fn(
      async (
        _input: URL | RequestInfo,
        _init?: RequestInit,
      ) => {
        return new Response(
          JSON.stringify([
            createCommit(
              '3333333333333333333333333333333333333333',
              'clearfixx/portfolio',
              '2026-07-13T12:00:00Z',
              'chore: verify release',
            ),
          ]),
          {
            status: 200,
          },
        )
      },
    )

    const commits = await fetchGitHubCommits(
      {
        username: 'clearfixx',
        repositories: [
          'portfolio',
          'clearfixx/portfolio',
          'CLEARFIXX/PORTFOLIO',
        ],
      },
      {
        fetch:
          fetchMock as typeof globalThis.fetch,
      },
    )

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(commits).toHaveLength(1)
  })
})
