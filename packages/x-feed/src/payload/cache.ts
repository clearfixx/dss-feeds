import type { CollectionConfig, Payload } from 'payload'

import type { XFeedSnapshot, XFeedSnapshotStore } from '../cache.js'

export interface CreateXFeedCacheCollectionOptions {
  slug?: string
  adminGroup?: string
}

export interface CreatePayloadXFeedSnapshotStoreOptions {
  payload: Payload
  collectionSlug?: string
}

interface PayloadCacheDocument {
  id: string | number
  snapshot?: unknown
}

interface PayloadFindResult {
  docs: PayloadCacheDocument[]
}

interface PayloadCacheClient {
  find(args: Record<string, unknown>): Promise<PayloadFindResult>
  create(args: Record<string, unknown>): Promise<unknown>
  update(args: Record<string, unknown>): Promise<unknown>
}

const DEFAULT_CACHE_SLUG = 'dss-x-feed-cache'
const DEFAULT_ADMIN_GROUP = 'DSS Feeds'

export function createXFeedCacheCollection(
  options: CreateXFeedCacheCollectionOptions = {},
): CollectionConfig {
  return {
    slug: options.slug ?? DEFAULT_CACHE_SLUG,
    labels: { singular: 'X Feed Snapshot', plural: 'X Feed Snapshots' },
    admin: {
      group: options.adminGroup ?? DEFAULT_ADMIN_GROUP,
      useAsTitle: 'key',
      defaultColumns: ['key', 'username', 'sourceStability', 'postCount', 'generatedAt'],
    },
    access: {
      read: isAuthenticated,
      create: isAuthenticated,
      update: isAuthenticated,
      delete: isAuthenticated,
    },
    fields: [
      { name: 'key', type: 'text', required: true, unique: true, index: true },
      { name: 'username', type: 'text', required: true, index: true },
      { name: 'postCount', type: 'number', required: true, min: 0 },
      { name: 'sourceId', type: 'text', required: true },
      {
        name: 'sourceStability',
        type: 'select',
        required: true,
        options: ['stable', 'experimental', 'composite', 'unknown'],
      },
      { name: 'checksum', type: 'text', required: true },
      { name: 'generatedAt', type: 'date', required: true, index: true },
      { name: 'freshUntil', type: 'date', required: true },
      { name: 'staleUntil', type: 'date', required: true },
      { name: 'nextSyncAt', type: 'date', required: true, index: true },
      {
        name: 'warnings',
        type: 'array',
        fields: [{ name: 'message', type: 'text', required: true }],
      },
      {
        name: 'snapshot',
        type: 'json',
        required: true,
        admin: { hidden: true },
      },
    ],
  }
}

export function createPayloadXFeedSnapshotStore(
  options: CreatePayloadXFeedSnapshotStoreOptions,
): XFeedSnapshotStore {
  const client = options.payload as unknown as PayloadCacheClient
  const collection = options.collectionSlug ?? DEFAULT_CACHE_SLUG

  return {
    async read(key) {
      const result = await client.find({
        collection,
        where: { key: { equals: key } },
        limit: 1,
        depth: 0,
        pagination: false,
        overrideAccess: true,
      })
      return result.docs[0]?.snapshot ?? null
    },
    async write(snapshot) {
      const result = await client.find({
        collection,
        where: { key: { equals: snapshot.key } },
        limit: 1,
        depth: 0,
        pagination: false,
        overrideAccess: true,
      })
      const existing = result.docs[0]
      const data = toPayloadSnapshot(snapshot)
      if (existing) {
        await client.update({ collection, id: existing.id, data, overrideAccess: true })
      } else {
        await client.create({ collection, data, overrideAccess: true })
      }
    },
  }
}

function toPayloadSnapshot(snapshot: XFeedSnapshot): Record<string, unknown> {
  return {
    key: snapshot.key,
    username: snapshot.username,
    postCount: snapshot.posts.length,
    sourceId: snapshot.source.id,
    sourceStability: snapshot.source.stability,
    checksum: snapshot.checksum,
    generatedAt: snapshot.generatedAt,
    freshUntil: snapshot.freshUntil,
    staleUntil: snapshot.staleUntil,
    nextSyncAt: snapshot.nextSyncAt,
    warnings: snapshot.warnings.map((message) => ({ message })),
    snapshot,
  }
}

function isAuthenticated({ req }: { req?: { user?: unknown } }): boolean {
  return Boolean(req?.user)
}
