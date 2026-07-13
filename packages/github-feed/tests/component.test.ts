import {
  createElement,
} from 'react'
import {
  renderToStaticMarkup,
} from 'react-dom/server'
import {
  describe,
  expect,
  it,
} from 'vitest'

import {
  DSSGitHubFeed,
  type GitHubCommit,
} from '../src/index.js'

function createCommit(
  overrides: Partial<GitHubCommit> = {},
): GitHubCommit {
  return {
    id: 'clearfixx/portfolio@111',
    source: 'github',
    kind: 'commit',
    sha:
      '1111111111111111111111111111111111111111',
    shortSha: '1111111',
    repository:
      'clearfixx/portfolio',
    repositoryUrl:
      'https://github.com/clearfixx/portfolio',
    title:
      'feat(github): add neutral component',
    committedAt:
      '2026-07-13T11:30:00.000Z',
    url:
      'https://github.com/clearfixx/portfolio/commit/111',
    authorLogin: 'clearfixx',
    authorName: 'Andrii Kulahin',
    ...overrides,
  }
}

describe('DSSGitHubFeed', () => {
  it(
    'renders neutral semantic markup without attribution or tracking',
    () => {
      const html =
        renderToStaticMarkup(
          createElement(
            DSSGitHubFeed,
            {
              commits: [
                createCommit(),
              ],
              profileUrl:
                'https://github.com/clearfixx',
            },
          ),
        )

      expect(html).toContain(
        '<section',
      )
      expect(html).toContain(
        '<ol',
      )
      expect(html).toContain(
        '<article',
      )
      expect(html).toContain(
        'feat(github): add neutral component',
      )
      expect(html).not.toContain(
        'Buy me a coffee',
      )
      expect(html).not.toContain(
        'Powered by',
      )
      expect(html).not.toContain(
        '<script',
      )
    },
  )

  it(
    'filters, sorts, and limits commits before rendering',
    () => {
      const html =
        renderToStaticMarkup(
          createElement(
            DSSGitHubFeed,
            {
              commits: [
                createCommit({
                  id: 'portfolio-old',
                  title:
                    'Old portfolio commit',
                  committedAt:
                    '2026-07-13T10:00:00.000Z',
                }),
                createCommit({
                  id: 'dss-new',
                  repository:
                    'clearfixx/dss-universe',
                  repositoryUrl:
                    'https://github.com/clearfixx/dss-universe',
                  title:
                    'Newest DSS commit',
                  committedAt:
                    '2026-07-13T12:00:00.000Z',
                }),
                createCommit({
                  id: 'portfolio-new',
                  title:
                    'Newest portfolio commit',
                  committedAt:
                    '2026-07-13T11:00:00.000Z',
                }),
              ],
              repositories: [
                'clearfixx/portfolio',
              ],
              commitCount: 1,
              order: 'desc',
            },
          ),
        )

      expect(html).toContain(
        'Newest portfolio commit',
      )
      expect(html).not.toContain(
        'Old portfolio commit',
      )
      expect(html).not.toContain(
        'Newest DSS commit',
      )
    },
  )

  it(
    'returns the supplied empty state without a wrapper',
    () => {
      const html =
        renderToStaticMarkup(
          createElement(
            DSSGitHubFeed,
            {
              commits: [],
              emptyState:
                createElement(
                  'p',
                  null,
                  'No commits',
                ),
            },
          ),
        )

      expect(html).toBe(
        '<p>No commits</p>',
      )
    },
  )

  it(
    'does not create links for non-GitHub URLs',
    () => {
      const html =
        renderToStaticMarkup(
          createElement(
            DSSGitHubFeed,
            {
              commits: [
                createCommit({
                  url:
                    'https://example.com/unsafe',
                  repositoryUrl:
                    'javascript:alert(1)',
                }),
              ],
            },
          ),
        )

      expect(html).not.toContain(
        'href="https://example.com/unsafe"',
      )
      expect(html).not.toContain(
        'javascript:',
      )
      expect(html).toContain(
        'feat(github): add neutral component',
      )
    },
  )

  it(
    'supports a completely custom item renderer',
    () => {
      const html =
        renderToStaticMarkup(
          createElement(
            DSSGitHubFeed,
            {
              commits: [
                createCommit(),
              ],
              renderItem(commit) {
                return createElement(
                  'strong',
                  {
                    'data-custom':
                      'commit',
                  },
                  commit.shortSha,
                )
              },
            },
          ),
        )

      expect(html).toContain(
        'data-custom="commit"',
      )
      expect(html).toContain(
        '>1111111</strong>',
      )
      expect(html).not.toContain(
        'dss-github-feed__commit',
      )
    },
  )
})
