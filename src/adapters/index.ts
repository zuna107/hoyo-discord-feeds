import type { Feed } from "../domain/types.js"
import type { SourceAdapter } from "./base.js"
import { HoyoLabAdapter } from "./hoyolab.js"
import { TwitterAdapter } from "./twitter.js"
import { YouTubeAdapter } from "./youtube.js"

const adapters: SourceAdapter[] = [new TwitterAdapter(), new YouTubeAdapter(), new HoyoLabAdapter()]

export const getAdapter = (feed: Feed): SourceAdapter => {
  const adapter = adapters.find((item) => item.supports(feed.platform))
  if (!adapter) {
    throw new Error(`No adapter for platform ${feed.platform}`)
  }
  return adapter
}
