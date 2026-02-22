import { env } from "../config/env.js"
import type { Feed, NormalizedPost } from "../domain/types.js"
import type { SourceAdapter } from "./base.js"
import { UpstreamRateLimitError, UpstreamTemporaryError } from "../services/errors.js"

type YoutubeItem = {
  id?: { videoId?: string }
  snippet?: {
    title?: string
    description?: string
    publishedAt?: string
    channelTitle?: string
    thumbnails?: { high?: { url?: string } }
  }
}

type YoutubeSearchResponse = {
  items?: YoutubeItem[]
}

export class YouTubeAdapter implements SourceAdapter {
  public supports(platform: Feed["platform"]): boolean {
    return platform === "youtube"
  }

  public async fetchLatest(feed: Feed): Promise<NormalizedPost[]> {
    if (!env.YOUTUBE_API_KEY) {
      return []
    }
    const url = new URL("https://www.googleapis.com/youtube/v3/search")
    url.searchParams.set("key", env.YOUTUBE_API_KEY)
    url.searchParams.set("part", "snippet")
    url.searchParams.set("order", "date")
    url.searchParams.set("type", "video")
    url.searchParams.set("maxResults", "5")
    url.searchParams.set("channelId", feed.identifier)
    if (env.MAX_POST_AGE_HOURS > 0) {
      const publishedAfter = new Date(Date.now() - env.MAX_POST_AGE_HOURS * 60 * 60 * 1000).toISOString()
      url.searchParams.set("publishedAfter", publishedAfter)
    }

    const response = await fetch(url)
    if (response.status === 429 || response.status === 403) {
      throw new UpstreamRateLimitError("YouTube API quota/rate limit reached")
    }
    if (response.status >= 500) {
      throw new UpstreamTemporaryError(`YouTube API temporary error ${response.status}`)
    }
    if (!response.ok) {
      throw new Error(`YouTube API failed with ${response.status}`)
    }
    const body = (await response.json()) as YoutubeSearchResponse
    const items = body.items ?? []
    return items
      .filter((item) => item.id?.videoId)
      .map((item) => ({
        source: "youtube",
        feedId: feed.id,
        externalPostId: String(item.id?.videoId),
        publishedAt: item.snippet?.publishedAt ?? new Date().toISOString(),
        title: item.snippet?.title ?? "New Video",
        text: item.snippet?.description ?? "",
        url: `https://www.youtube.com/watch?v=${item.id?.videoId}`,
        authorName: item.snippet?.channelTitle ?? feed.displayName,
        media: item.snippet?.thumbnails?.high?.url
          ? [{ type: "image" as const, url: item.snippet.thumbnails.high.url }]
          : [],
        tags: [],
        raw: item,
      }))
  }
}
