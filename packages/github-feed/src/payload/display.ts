import type { Payload } from 'payload'

export const DEFAULT_GITHUB_FEED_DISPLAY_COMMIT_LIMIT = 2
export const MAX_GITHUB_FEED_DISPLAY_COMMIT_LIMIT = 10

export interface GitHubFeedDisplaySettings {
  commitLimit: number
}

export interface ReadGitHubFeedDisplaySettingsOptions {
  payload: Payload
  settingsSlug?: string
}

interface GitHubFeedDisplaySettingsClient {
  findGlobal(args: {
    slug: string
    overrideAccess: true
  }): Promise<unknown>
}

const DEFAULT_SETTINGS_SLUG = 'dss-github-feed-settings'

export async function readGitHubFeedDisplaySettings(
  options: ReadGitHubFeedDisplaySettingsOptions,
): Promise<GitHubFeedDisplaySettings> {
  const client =
    options.payload as unknown as GitHubFeedDisplaySettingsClient

  try {
    const value = await client.findGlobal({
      slug: options.settingsSlug ?? DEFAULT_SETTINGS_SLUG,
      overrideAccess: true,
    })

    return {
      commitLimit: resolveGitHubFeedDisplayCommitLimit(
        isRecord(value) ? value.displayCommitLimit : undefined,
      ),
    }
  } catch {
    return {
      commitLimit: DEFAULT_GITHUB_FEED_DISPLAY_COMMIT_LIMIT,
    }
  }
}

export function resolveGitHubFeedDisplayCommitLimit(
  value: unknown,
): number {
  return typeof value === 'number' &&
    Number.isInteger(value) &&
    value >= 1 &&
    value <= MAX_GITHUB_FEED_DISPLAY_COMMIT_LIMIT
    ? value
    : DEFAULT_GITHUB_FEED_DISPLAY_COMMIT_LIMIT
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}
