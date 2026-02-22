export const nowIso = (): string => new Date().toISOString()

export const isoAfterMs = (ms: number): string =>
  new Date(Date.now() + ms).toISOString()
