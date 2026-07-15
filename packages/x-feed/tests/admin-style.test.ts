import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const css = readFileSync(new URL('../admin.css', import.meta.url), 'utf8')

describe('X Feed Payload Admin styling', () => {
  it('uses Payload theme tokens', () => {
    expect(css).toContain('var(--theme-elevation-')
    expect(css).toContain('var(--theme-text')
    expect(css).toContain('var(--theme-success-')
    expect(css).toContain('var(--theme-warning-')
    expect(css).toContain('var(--theme-error-')
  })

  it('does not contain Portfolio or provider-branded presentation tokens', () => {
    const forbidden = [
      '--rgb-',
      'site-footer__',
      'portfolio-',
      '#0d1117',
      '#111827',
      '#238636',
      '#2ea043',
      'linear-gradient',
      'radial-gradient',
      'box-shadow',
      'text-shadow',
    ]

    for (const token of forbidden) {
      expect(css).not.toContain(token)
    }
  })
})
