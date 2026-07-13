import { describe, expect, it } from 'vitest'

import { DSS_FEEDS_CORE_VERSION } from '../src/index.js'

describe('@dss-feeds/core workspace foundation', () => {
  it('exposes the internal foundation version', () => {
    expect(DSS_FEEDS_CORE_VERSION).toBe('0.0.0')
  })
})
