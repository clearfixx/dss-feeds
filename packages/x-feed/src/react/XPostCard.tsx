import { formatXFeedDate, joinXFeedClassNames } from './format.js'
import { resolveXFeedLabels } from './labels.js'
import { XPostMedia } from './XPostMedia.js'
import { XPostMetrics } from './XPostMetrics.js'
import type { XPostCardProps } from './types.js'

export function XPostCard({
  post,
  className,
  labels: labelsInput,
  locale = 'en',
  showMedia = true,
  showMetrics = true,
  linkTarget = '_blank',
  formatDate,
}: XPostCardProps) {
  const labels = resolveXFeedLabels(labelsInput)
  const rel = linkTarget === '_blank' ? 'noreferrer noopener' : undefined
  const dateLabel = formatDate
    ? formatDate(post.createdAt, post)
    : formatXFeedDate(post.createdAt, locale)

  return (
    <article
      className={joinXFeedClassNames('dss-x-post', className)}
      data-post-id={post.id}
      lang={post.language ?? undefined}
    >
      <header className="dss-x-post__header">
        {post.author.profileImageUrl ? (
          <img
            className="dss-x-post__avatar"
            src={post.author.profileImageUrl}
            alt=""
            width={44}
            height={44}
            loading="lazy"
            decoding="async"
          />
        ) : (
          <span className="dss-x-post__avatar-fallback" aria-hidden="true">
            {post.author.name.trim().charAt(0).toUpperCase() || '@'}
          </span>
        )}

        <div className="dss-x-post__identity">
          <span className="dss-x-post__name">
            {post.author.name}
            {post.author.verified ? (
              <span className="dss-x-post__verified" title={labels.verified}>
                <span aria-hidden="true">✓</span>
                <span className="dss-x-feed__sr-only">{labels.verified}</span>
              </span>
            ) : null}
          </span>
          <span className="dss-x-post__username">
            @{post.author.username}
          </span>
        </div>

        <a
          className="dss-x-post__date-link"
          href={post.url}
          target={linkTarget}
          rel={rel}
          aria-label={labels.openPost}
        >
          <time dateTime={post.createdAt}>{dateLabel}</time>
        </a>
      </header>

      <p className="dss-x-post__text">{post.text}</p>

      {showMedia ? (
        <XPostMedia
          media={post.media}
          postUrl={post.url}
          labels={labels}
          linkTarget={linkTarget}
        />
      ) : null}

      {showMetrics ? (
        <XPostMetrics metrics={post.metrics} labels={labels} />
      ) : null}
    </article>
  )
}
