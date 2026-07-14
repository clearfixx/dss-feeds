import type { XFeedPublicMedia } from '../public.js'
import { joinXFeedClassNames } from './format.js'
import { resolveXFeedLabels } from './labels.js'
import type { XFeedLabels } from './types.js'

export interface XPostMediaProps {
  media: readonly XFeedPublicMedia[]
  postUrl: string
  className?: string
  labels?: Partial<XFeedLabels>
  linkTarget?: '_blank' | '_self'
}

export function XPostMedia({
  media,
  postUrl,
  className,
  labels: labelsInput,
  linkTarget = '_blank',
}: XPostMediaProps) {
  const labels = resolveXFeedLabels(labelsInput)
  const visibleMedia = media.filter(
    (item) => item.url || item.previewImageUrl,
  )

  if (visibleMedia.length === 0) {
    return null
  }

  const rel = linkTarget === '_blank' ? 'noreferrer noopener' : undefined

  return (
    <div
      className={joinXFeedClassNames('dss-x-post__media', className)}
      data-count={visibleMedia.length}
    >
      {visibleMedia.map((item, index) => {
        const imageUrl = item.previewImageUrl ?? item.url
        if (!imageUrl) return null

        const label =
          item.type === 'photo'
            ? labels.photo
            : item.type === 'video'
              ? labels.video
              : labels.animatedGif

        return (
          <a
            className="dss-x-post__media-link"
            href={postUrl}
            key={`${item.type}:${imageUrl}:${index}`}
            target={linkTarget}
            rel={rel}
            aria-label={label}
          >
            <img
              className="dss-x-post__media-image"
              src={imageUrl}
              alt={item.altText ?? ''}
              width={item.width ?? undefined}
              height={item.height ?? undefined}
              loading="lazy"
              decoding="async"
            />
            {item.type !== 'photo' ? (
              <span className="dss-x-post__media-badge" aria-hidden="true">
                {item.type === 'video' ? '▶' : 'GIF'}
              </span>
            ) : null}
          </a>
        )
      })}
    </div>
  )
}
