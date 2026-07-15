import type { ReactNode } from 'react'
import { isSafeCachedMediaUrl, isSafeInstagramPermalink } from '../security.js'
import type { InstagramPost } from '../types.js'

export interface DSSInstagramFeedProps {
  posts: readonly InstagramPost[]
  postCount?: number
  className?: string
  ariaLabel?: string
  heading?: ReactNode
  profileUrl?: string
  profileLabel?: ReactNode
  emptyState?: ReactNode
  showEngagement?: boolean
  openInNewTab?: boolean
  renderItem?: (post: InstagramPost, index: number) => ReactNode
}

export function DSSInstagramFeed({
  posts,
  postCount = 6,
  className,
  ariaLabel = 'Recent Instagram posts',
  heading,
  profileUrl,
  profileLabel = 'View Instagram',
  emptyState = null,
  showEngagement = true,
  openInNewTab = true,
  renderItem,
}: DSSInstagramFeedProps): ReactNode {
  if (!Number.isInteger(postCount) || postCount < 1 || postCount > 24) {
    throw new RangeError('postCount must be an integer between 1 and 24.')
  }

  const visiblePosts = [...posts]
    .filter((post) => isSafeCachedMediaUrl(post.imageUrl) && isSafeInstagramPermalink(post.permalink))
    .sort((left, right) => Date.parse(right.publishedAt) - Date.parse(left.publishedAt))
    .slice(0, postCount)

  if (visiblePosts.length === 0) return emptyState

  const rootClassName = ['dss-instagram-feed', className].filter(Boolean).join(' ')
  const safeProfileUrl = profileUrl && isSafeInstagramPermalink(profileUrl) ? profileUrl : null

  return (
    <section aria-label={ariaLabel} className={rootClassName}>
      {(heading || safeProfileUrl) && (
        <header className="dss-instagram-feed__header">
          {heading && <h2 className="dss-instagram-feed__heading">{heading}</h2>}
          {safeProfileUrl && (
            <a
              className="dss-instagram-feed__profile-link"
              href={safeProfileUrl}
              rel={openInNewTab ? 'noreferrer noopener' : undefined}
              target={openInNewTab ? '_blank' : undefined}
            >
              {profileLabel}
            </a>
          )}
        </header>
      )}

      <ul className="dss-instagram-feed__grid">
        {visiblePosts.map((post, index) => (
          <li className="dss-instagram-feed__item" key={post.id}>
            {renderItem ? renderItem(post, index) : (
              <DefaultPost post={post} showEngagement={showEngagement} openInNewTab={openInNewTab} />
            )}
          </li>
        ))}
      </ul>
    </section>
  )
}

function DefaultPost({ post, showEngagement, openInNewTab }: { post: InstagramPost; showEngagement: boolean; openInNewTab: boolean }): ReactNode {
  const alt = post.caption?.trim() || `Instagram post by @${post.username}`
  return (
    <a
      aria-label={`Open Instagram post by @${post.username}`}
      className="dss-instagram-feed__link"
      href={post.permalink}
      rel={openInNewTab ? 'noreferrer noopener' : undefined}
      target={openInNewTab ? '_blank' : undefined}
    >
      <img
        alt={alt}
        className="dss-instagram-feed__image"
        decoding="async"
        height={post.height ?? undefined}
        loading="lazy"
        src={post.thumbnailUrl ?? post.imageUrl}
        width={post.width ?? undefined}
      />
      {showEngagement && (post.likeCount !== null || post.commentCount !== null) && (
        <span aria-hidden="true" className="dss-instagram-feed__overlay">
          {post.likeCount !== null && <span className="dss-instagram-feed__metric"><HeartIcon />{post.likeCount}</span>}
          {post.commentCount !== null && <span className="dss-instagram-feed__metric"><CommentIcon />{post.commentCount}</span>}
        </span>
      )}
    </a>
  )
}

function HeartIcon(): ReactNode {
  return <svg aria-hidden="true" fill="none" viewBox="0 0 24 24"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78L12 21.23l8.84-8.84a5.5 5.5 0 0 0 0-7.78Z" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" /></svg>
}

function CommentIcon(): ReactNode {
  return <svg aria-hidden="true" fill="none" viewBox="0 0 24 24"><path d="M21 15a4 4 0 0 1-4 4H8l-5 3V7a4 4 0 0 1 4-4h10a4 4 0 0 1 4 4v8Z" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" /></svg>
}
