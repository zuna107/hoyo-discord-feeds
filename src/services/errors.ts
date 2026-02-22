export class UpstreamRateLimitError extends Error {
  public readonly retryAfterMs: number | null

  public constructor(message: string, retryAfterMs: number | null = null) {
    super(message)
    this.name = "UpstreamRateLimitError"
    this.retryAfterMs = retryAfterMs
  }
}

export class UpstreamTemporaryError extends Error {
  public constructor(message: string) {
    super(message)
    this.name = "UpstreamTemporaryError"
  }
}
