import type { XFeedLabels } from './types.js'

export const DEFAULT_X_FEED_LABELS: XFeedLabels = {
  empty: 'No posts are available yet.',
  unavailable: 'The feed is temporarily unavailable.',
  stale: 'Showing the last cached posts.',
  openPost: 'Open post on X',
  replies: 'Replies',
  reposts: 'Reposts',
  likes: 'Likes',
  quotes: 'Quotes',
  photo: 'Photo',
  video: 'Video preview',
  animatedGif: 'Animated image preview',
  engagement: 'Post engagement',
  verified: 'Verified account',
}

export function resolveXFeedLabels(
  labels: Partial<XFeedLabels> = {},
): XFeedLabels {
  return { ...DEFAULT_X_FEED_LABELS, ...labels }
}
