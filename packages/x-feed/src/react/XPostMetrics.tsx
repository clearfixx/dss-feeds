import type { XPostMetrics as XPostMetricValues } from '../types.js'
import { joinXFeedClassNames } from './format.js'
import { resolveXFeedLabels } from './labels.js'
import type { XFeedLabels } from './types.js'

export interface XPostMetricsProps {
  metrics: XPostMetricValues
  className?: string
  labels?: Partial<XFeedLabels>
}

export function XPostMetrics({
  metrics,
  className,
  labels: labelsInput,
}: XPostMetricsProps) {
  const labels = resolveXFeedLabels(labelsInput)
  const items = [
    { key: 'replies', label: labels.replies, value: metrics.replies },
    { key: 'reposts', label: labels.reposts, value: metrics.reposts },
    { key: 'likes', label: labels.likes, value: metrics.likes },
    { key: 'quotes', label: labels.quotes, value: metrics.quotes },
  ].filter((item) => item.value > 0)

  if (items.length === 0) {
    return null
  }

  return (
    <dl
      className={joinXFeedClassNames('dss-x-post__metrics', className)}
      aria-label={labels.engagement}
    >
      {items.map((item) => (
        <div className="dss-x-post__metric" key={item.key}>
          <dt className="dss-x-post__metric-label">{item.label}</dt>
          <dd className="dss-x-post__metric-value">{item.value}</dd>
        </div>
      ))}
    </dl>
  )
}
