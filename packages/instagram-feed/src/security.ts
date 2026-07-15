import { InstagramFeedError, type InstagramSourceMode } from './types.js'

const USERNAME_PATTERN = /^[A-Za-z0-9._]{1,30}$/
const GRAPH_VERSION_PATTERN = /^v\d+\.\d+$/

export function assertInstagramUsername(value: string): string {
  const normalized = value.trim().replace(/^@/, '')
  if (!USERNAME_PATTERN.test(normalized) || normalized.startsWith('.') || normalized.endsWith('.') || normalized.includes('..')) {
    throw new InstagramFeedError('INVALID_CONFIGURATION', 'Instagram username is invalid.')
  }
  return normalized
}

export function assertSourceMode(value: string): InstagramSourceMode {
  if (value !== 'official' && value !== 'experimental-web-session' && value !== 'official-with-experimental-fallback') {
    throw new InstagramFeedError('INVALID_CONFIGURATION', 'Instagram source mode is invalid.')
  }
  return value
}

export function assertResultLimit(value: number | undefined, fallback = 12): number {
  const resolved = value ?? fallback
  if (!Number.isInteger(resolved) || resolved < 1 || resolved > 50) {
    throw new InstagramFeedError('INVALID_CONFIGURATION', 'Instagram fetch limit must be an integer between 1 and 50.')
  }
  return resolved
}

export function assertDisplayLimit(value: number | undefined, fallback = 6): number {
  const resolved = value ?? fallback
  if (!Number.isInteger(resolved) || resolved < 1 || resolved > 24) {
    throw new InstagramFeedError('INVALID_CONFIGURATION', 'Instagram display limit must be an integer between 1 and 24.')
  }
  return resolved
}

export function assertTimeout(value: number | undefined): number {
  const resolved = value ?? 15_000
  if (!Number.isInteger(resolved) || resolved < 1_000 || resolved > 60_000) {
    throw new InstagramFeedError('INVALID_CONFIGURATION', 'Instagram request timeout must be between 1000 and 60000 milliseconds.')
  }
  return resolved
}

export function assertGraphVersion(value: string | undefined): string {
  const resolved = value?.trim() || 'v25.0'
  if (!GRAPH_VERSION_PATTERN.test(resolved)) {
    throw new InstagramFeedError('INVALID_CONFIGURATION', 'Instagram Graph API version must use the vNN.N format.')
  }
  return resolved
}

export function assertHttpsUrl(value: unknown, label: string): string {
  if (typeof value !== 'string') throw invalidUrl(label)
  try {
    const url = new URL(value)
    if (url.protocol !== 'https:') throw invalidUrl(label)
    return url.toString()
  } catch {
    throw invalidUrl(label)
  }
}

export function isSafeInstagramPermalink(value: string): boolean {
  try {
    const url = new URL(value)
    return url.protocol === 'https:' && (url.hostname === 'instagram.com' || url.hostname === 'www.instagram.com')
  } catch {
    return false
  }
}

export function isSafeCachedMediaUrl(value: string): boolean {
  if (value.startsWith('/')) return !value.startsWith('//')
  try {
    const url = new URL(value)
    return url.protocol === 'https:' && !isInstagramCdnHost(url.hostname)
  } catch {
    return false
  }
}

function isInstagramCdnHost(hostname: string): boolean {
  const normalized = hostname.toLowerCase()
  return normalized === 'instagram.com' || normalized.endsWith('.instagram.com') || normalized === 'cdninstagram.com' || normalized.endsWith('.cdninstagram.com') || normalized.endsWith('.fbcdn.net')
}

function invalidUrl(label: string): InstagramFeedError {
  return new InstagramFeedError('INVALID_RESPONSE', `${label} must be a valid HTTPS URL.`)
}
