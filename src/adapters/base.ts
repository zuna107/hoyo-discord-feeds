import type { Feed, NormalizedPost } from "../domain/types.js"

export interface SourceAdapter {
  supports(platform: Feed["platform"]): boolean
  fetchLatest(feed: Feed): Promise<NormalizedPost[]>
}
