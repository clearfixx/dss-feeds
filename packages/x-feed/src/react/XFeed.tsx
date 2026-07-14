import { joinXFeedClassNames } from './format.js'
import { resolveXFeedLabels } from './labels.js'
import { XPostCard } from './XPostCard.js'
import type { XFeedProps } from './types.js'

export function XFeed({
  feed,
  className,
  listClassName,
  itemClassName,
  heading,
  labels: labelsInput,
  emptyState,
  unavailableState,
  staleNotice,
  locale = 'en',
  showMedia = true,
  showMetrics = true,
  linkTarget = '_blank',
  renderPost,
  formatDate,
}: XFeedProps) {
  const labels = resolveXFeedLabels(labelsInput)
  const unavailable =
    feed.state === 'expired' ||
    feed.state === 'invalid' ||
    feed.state === 'unavailable'

  return (
    <section
      className={joinXFeedClassNames('dss-x-feed', className)}
      data-state={feed.state}
      data-stale={feed.stale ? 'true' : 'false'}
    >
      {heading ? <div className="dss-x-feed__heading">{heading}</div> : null}

      {feed.stale ? (
        <div className="dss-x-feed__notice" role="status">
          {staleNotice ?? labels.stale}
        </div>
      ) : null}

      {feed.posts.length > 0 ? (
        <ol
          className={joinXFeedClassNames(
            'dss-x-feed__list',
            listClassName,
          )}
        >
          {feed.posts.map((post, index) => (
            <li
              className={joinXFeedClassNames(
                'dss-x-feed__item',
                itemClassName,
              )}
              key={post.id}
            >
              {renderPost ? (
                renderPost(post, index)
              ) : (
                <XPostCard
                  post={post}
                  labels={labels}
                  locale={locale}
                  showMedia={showMedia}
                  showMetrics={showMetrics}
                  linkTarget={linkTarget}
                  formatDate={formatDate}
                />
              )}
            </li>
          ))}
        </ol>
      ) : (
        <div
          className="dss-x-feed__empty"
          role={unavailable ? 'alert' : 'status'}
        >
          {unavailable
            ? (unavailableState ?? labels.unavailable)
            : (emptyState ?? labels.empty)}
        </div>
      )}
    </section>
  )
}
