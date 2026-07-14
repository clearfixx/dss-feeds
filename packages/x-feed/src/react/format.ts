export function formatXFeedDate(
  value: string,
  locale = 'en',
): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) {
    return value
  }

  return new Intl.DateTimeFormat(locale, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(date)
}

export function joinXFeedClassNames(
  ...values: Array<string | null | undefined | false>
): string | undefined {
  const className = values.filter(Boolean).join(' ')
  return className.length > 0 ? className : undefined
}
