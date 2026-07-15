import { fetchExperimentalInstagramPosts } from './experimental.js'
import { fetchOfficialInstagramPosts } from './official.js'
import { assertSourceMode } from './security.js'
import { InstagramFeedError, type InstagramFeedConfig, type InstagramFeedRequestOptions, type InstagramFetchResult } from './types.js'

export async function fetchInstagramPosts(config: InstagramFeedConfig, options: InstagramFeedRequestOptions = {}): Promise<InstagramFetchResult> {
  const sourceMode = assertSourceMode(config.sourceMode)
  if (sourceMode === 'official') {
    return { posts: await fetchOfficialInstagramPosts(config, options), sourceUsed: 'official', warnings: [] }
  }
  if (sourceMode === 'experimental-web-session') {
    return {
      posts: await fetchExperimentalInstagramPosts(config, options),
      sourceUsed: 'experimental-web-session',
      warnings: ['Experimental Instagram web-session source is not an official Meta API and may stop working without notice.'],
    }
  }
  try {
    return { posts: await fetchOfficialInstagramPosts(config, options), sourceUsed: 'official', warnings: [] }
  } catch (officialError) {
    try {
      return {
        posts: await fetchExperimentalInstagramPosts(config, options),
        sourceUsed: 'experimental-web-session',
        warnings: [
          `Official Instagram source failed: ${readErrorMessage(officialError)}`,
          'Experimental Instagram web-session fallback was used.',
        ],
      }
    } catch (experimentalError) {
      throw new InstagramFeedError('REQUEST_FAILED', `All Instagram sources failed. Official: ${readErrorMessage(officialError)} Experimental: ${readErrorMessage(experimentalError)}`, { cause: experimentalError })
    }
  }
}

function readErrorMessage(error: unknown): string {
  return error instanceof Error && error.message.trim() ? error.message.trim() : 'Unknown source error.'
}
