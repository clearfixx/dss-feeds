import type { CollectionConfig } from 'payload'
import { denyPayloadOperation, isAuthenticatedPayloadRequest } from './access.js'

export interface CreateInstagramFeedCacheOptions { slug: string }

export function createInstagramFeedCache(options: CreateInstagramFeedCacheOptions): CollectionConfig {
  return {
    slug: options.slug,
    labels: { singular: 'Instagram Feed Snapshot', plural: 'Instagram Feed Snapshots' },
    admin: {
      hidden: true,
      useAsTitle: 'key',
      defaultColumns: ['key', 'username', 'sourceUsed', 'generatedAt', 'freshUntil', 'staleUntil'],
    },
    access: {
      create: denyPayloadOperation,
      delete: denyPayloadOperation,
      read: isAuthenticatedPayloadRequest,
      update: denyPayloadOperation,
    },
    graphQL: false,
    timestamps: true,
    fields: [
      { name: 'key', type: 'text', required: true, unique: true, index: true },
      { name: 'username', type: 'text', required: true },
      {
        name: 'sourceMode', type: 'select', required: true,
        options: [
          { label: 'Official', value: 'official' },
          { label: 'Experimental web session', value: 'experimental-web-session' },
          { label: 'Official with experimental fallback', value: 'official-with-experimental-fallback' },
        ],
      },
      {
        name: 'sourceUsed', type: 'select', required: true,
        options: [
          { label: 'Official', value: 'official' },
          { label: 'Experimental web session', value: 'experimental-web-session' },
        ],
      },
      {
        name: 'posts', type: 'array', required: true,
        fields: [
          { name: 'externalId', type: 'text', required: true },
          { name: 'shortcode', type: 'text' },
          {
            name: 'mediaType', type: 'select', required: true,
            options: [
              { label: 'Image', value: 'image' },
              { label: 'Carousel', value: 'carousel' },
              { label: 'Video', value: 'video' },
            ],
          },
          { name: 'mediaProductType', type: 'text' },
          { name: 'imageUrl', type: 'text', required: true },
          { name: 'thumbnailUrl', type: 'text' },
          { name: 'providerImageUrl', type: 'text', required: true },
          { name: 'providerThumbnailUrl', type: 'text' },
          { name: 'permalink', type: 'text', required: true },
          { name: 'caption', type: 'textarea' },
          { name: 'publishedAt', type: 'date', required: true, index: true },
          { name: 'likeCount', type: 'number', min: 0 },
          { name: 'commentCount', type: 'number', min: 0 },
          { name: 'username', type: 'text', required: true },
          { name: 'width', type: 'number', min: 1 },
          { name: 'height', type: 'number', min: 1 },
        ],
      },
      { name: 'checksum', type: 'text', required: true },
      { name: 'adapterVersion', type: 'text', required: true },
      { name: 'generatedAt', type: 'date', required: true, index: true },
      { name: 'freshUntil', type: 'date', required: true, index: true },
      { name: 'staleUntil', type: 'date', required: true, index: true },
      { name: 'nextSyncAt', type: 'date', index: true },
      { name: 'warnings', type: 'array', fields: [{ name: 'message', type: 'text', required: true }] },
    ],
  }
}
