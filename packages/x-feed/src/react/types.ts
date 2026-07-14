import type { ReactNode } from 'react'

import type {
  XFeedPublicPost,
  XFeedPublicResult,
} from '../public.js'

export interface XFeedLabels {
  empty: ReactNode
  unavailable: ReactNode
  stale: ReactNode
  openPost: string
  replies: string
  reposts: string
  likes: string
  quotes: string
  photo: string
  video: string
  animatedGif: string
  engagement: string
  verified: string
}

export interface XFeedProps {
  feed: XFeedPublicResult
  className?: string
  listClassName?: string
  itemClassName?: string
  heading?: ReactNode
  labels?: Partial<XFeedLabels>
  emptyState?: ReactNode
  unavailableState?: ReactNode
  staleNotice?: ReactNode
  locale?: string
  showMedia?: boolean
  showMetrics?: boolean
  linkTarget?: '_blank' | '_self'
  renderPost?: (
    post: XFeedPublicPost,
    index: number,
  ) => ReactNode
  formatDate?: (createdAt: string, post: XFeedPublicPost) => ReactNode
}

export interface XPostCardProps {
  post: XFeedPublicPost
  className?: string
  labels?: Partial<XFeedLabels>
  locale?: string
  showMedia?: boolean
  showMetrics?: boolean
  linkTarget?: '_blank' | '_self'
  formatDate?: (createdAt: string, post: XFeedPublicPost) => ReactNode
}
