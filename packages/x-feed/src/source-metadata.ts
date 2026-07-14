import {
  type XFeedSource,
  type XFeedSourceMetadata,
} from './types.js'

const CUSTOM_SOURCE_WARNING =
  'This custom X feed source does not declare stability metadata.'

/**
 * Returns normalized source metadata for admin UIs and operational monitors.
 */
export function getXFeedSourceMetadata(
  source: XFeedSource,
): XFeedSourceMetadata {
  const metadata = source.metadata

  if (!metadata) {
    return {
      kind: 'custom',
      stability: 'unknown',
      label: source.id,
      official: null,
      warning: CUSTOM_SOURCE_WARNING,
    }
  }

  return {
    kind: metadata.kind,
    stability: metadata.stability,
    label: metadata.label,
    official: metadata.official,
    warning: metadata.warning,
  }
}
