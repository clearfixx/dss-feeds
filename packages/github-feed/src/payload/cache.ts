import type { CollectionConfig } from 'payload'

import {
  denyPayloadOperation,
  isAuthenticatedPayloadRequest,
} from './access.js'

export interface CreateGitHubFeedCacheOptions {
  slug: string
}

export function createGitHubFeedCache(
  options: CreateGitHubFeedCacheOptions,
): CollectionConfig {
  return {
    slug: options.slug,
    labels: {
      singular: 'GitHub Feed Snapshot',
      plural: 'GitHub Feed Snapshots',
    },
    admin: {
      hidden: true,
      useAsTitle: 'key',
      defaultColumns: [
        'key',
        'username',
        'generatedAt',
        'freshUntil',
        'staleUntil',
      ],
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
      {
        name: 'key',
        type: 'text',
        required: true,
        unique: true,
        index: true,
      },
      {
        name: 'username',
        type: 'text',
        required: true,
      },
      {
        name: 'repositories',
        type: 'array',
        required: true,
        minRows: 1,
        maxRows: 20,
        fields: [
          {
            name: 'repository',
            type: 'text',
            required: true,
          },
        ],
      },
      {
        name: 'commits',
        type: 'array',
        required: true,
        fields: [
          {
            name: 'externalId',
            type: 'text',
            required: true,
          },
          {
            name: 'sha',
            type: 'text',
            required: true,
          },
          {
            name: 'shortSha',
            type: 'text',
            required: true,
          },
          {
            name: 'repository',
            type: 'text',
            required: true,
          },
          {
            name: 'repositoryUrl',
            type: 'text',
            required: true,
          },
          {
            name: 'title',
            type: 'text',
            required: true,
          },
          {
            name: 'committedAt',
            type: 'date',
            required: true,
            index: true,
          },
          {
            name: 'url',
            type: 'text',
            required: true,
          },
          {
            name: 'authorLogin',
            type: 'text',
          },
          {
            name: 'authorName',
            type: 'text',
          },
        ],
      },
      {
        name: 'checksum',
        type: 'text',
        required: true,
      },
      {
        name: 'adapterVersion',
        type: 'text',
        required: true,
      },
      {
        name: 'generatedAt',
        type: 'date',
        required: true,
        index: true,
      },
      {
        name: 'freshUntil',
        type: 'date',
        required: true,
        index: true,
      },
      {
        name: 'staleUntil',
        type: 'date',
        required: true,
        index: true,
      },
      {
        name: 'nextSyncAt',
        type: 'date',
        index: true,
      },
      {
        name: 'warnings',
        type: 'array',
        fields: [
          {
            name: 'message',
            type: 'text',
            required: true,
          },
        ],
      },
    ],
  }
}
