import { env } from "../config/env.js"
import type { Feed, NormalizedPost } from "../domain/types.js"
import type { SourceAdapter } from "./base.js"
import { UpstreamRateLimitError, UpstreamTemporaryError } from "../services/errors.js"

type YouTubeChannelResponse = {
  items?: Array<{
    snippet?: {
      title?: string
    }
    contentDetails?: {
      relatedPlaylists?: {
        uploads?: string
      }
    }
  }>
}

type YouTubePlaylistItemsResponse = {
  items?: Array<{
    snippet?: {
      title?: string
      description?: string
      publishedAt?: string
      channelTitle?: string
      thumbnails?: { high?: { url?: string } }
      resourceId?: {
        videoId?: string
      }
    }
  }>
}

type RssEntry = {
  videoId: string
  title: string
  description: string
  publishedAt: string
  authorName: string
  thumbnailUrl?: string
  url: string
}

const xmlEntityMap: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
}

const decodeXml = (value: string): string =>
  value.replace(/&(#x?[0-9a-fA-F]+|amp|lt|gt|quot|apos);/g, (entity, token: string) => {
    const mapped = xmlEntityMap[token]
    if (mapped) {
      return mapped
    }
    if (token.startsWith("#x")) {
      return String.fromCodePoint(Number.parseInt(token.slice(2), 16))
    }
    if (token.startsWith("#")) {
      return String.fromCodePoint(Number.parseInt(token.slice(1), 10))
    }
    return entity
  })

const stripCdata = (value: string): string => value.replace(/^<!\[CDATA\[([\s\S]*?)\]\]>$/i, "$1")

const extractTag = (content: string, tag: string): string | undefined => {
  const pattern = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, "i")
  const match = content.match(pattern)
  if (!match?.[1]) {
    return undefined
  }
  return decodeXml(stripCdata(match[1].trim()))
}

const extractAttr = (content: string, tag: string, attr: string): string | undefined => {
  const pattern = new RegExp(`<${tag}\\b[^>]*\\b${attr}=(['"])(.*?)\\1[^>]*>`, "i")
  const match = content.match(pattern)
  if (!match?.[2]) {
    return undefined
  }
  return decodeXml(match[2].trim())
}

const toIso = (value: string | undefined): string => {
  const date = value ? new Date(value) : new Date()
  if (Number.isNaN(date.getTime())) {
    return new Date().toISOString()
  }
  return date.toISOString()
}

const toNormalizedPost = (feed: Feed, entry: RssEntry): NormalizedPost => ({
  source: "youtube",
  feedId: feed.id,
  externalPostId: entry.videoId,
  publishedAt: entry.publishedAt,
  title: entry.title || "New Video",
  text: entry.description || "",
  url: entry.url || `https://www.youtube.com/watch?v=${entry.videoId}`,
  authorName: entry.authorName || feed.displayName,
  media: entry.thumbnailUrl ? [{ type: "image" as const, url: entry.thumbnailUrl }] : [],
  tags: [],
  raw: entry,
})

export class YouTubeAdapter implements SourceAdapter {
  public supports(platform: Feed["platform"]): boolean {
    return platform === "youtube"
  }

  public async fetchLatest(feed: Feed): Promise<NormalizedPost[]> {
    let rssError: Error | undefined
    try {
      return await this.fetchLatestFromRss(feed)
    } catch (error) {
      rssError = error instanceof Error ? error : new Error("Unknown YouTube RSS error")
    }

    if (!env.YOUTUBE_API_FALLBACK_ENABLED) {
      throw new UpstreamTemporaryError(`YouTube RSS temporary error: ${rssError.message} (API fallback disabled)`)
    }

    if (!env.YOUTUBE_API_KEY) {
      throw new UpstreamTemporaryError(`YouTube RSS temporary error: ${rssError.message} (missing YOUTUBE_API_KEY)`)
    }

    return this.fetchLatestFromDataApi(feed, rssError.message)
  }

  private async fetchLatestFromRss(feed: Feed): Promise<NormalizedPost[]> {
    const url = new URL("https://www.youtube.com/feeds/videos.xml")
    url.searchParams.set("channel_id", feed.identifier)

    const response = await fetch(url)
    if (response.status >= 500) {
      throw new UpstreamTemporaryError(`YouTube RSS temporary error ${response.status}`)
    }
    if (!response.ok) {
      throw new Error(`YouTube RSS failed with ${response.status}`)
    }

    const xml = await response.text()
    const entries = this.parseRssEntries(xml)
    return entries.map((entry) => toNormalizedPost(feed, entry))
  }

  private parseRssEntries(xml: string): RssEntry[] {
    const entryMatches = xml.match(/<entry\b[^>]*>[\s\S]*?<\/entry>/gi) ?? []
    const results: RssEntry[] = []
    for (const entryXml of entryMatches) {
      const videoId = extractTag(entryXml, "yt:videoId")
      if (!videoId) {
        continue
      }
      const title = extractTag(entryXml, "title") ?? "New Video"
      const description = extractTag(entryXml, "media:description") ?? ""
      const authorName = extractTag(entryXml, "name") ?? "YouTube"
      const publishedAt = toIso(extractTag(entryXml, "published"))
      const thumbnailUrl = extractAttr(entryXml, "media:thumbnail", "url")
      const linkedUrl = extractAttr(entryXml, "link", "href")
      results.push({
        videoId,
        title,
        description,
        authorName,
        publishedAt,
        thumbnailUrl,
        url: linkedUrl && linkedUrl.startsWith("http") ? linkedUrl : `https://www.youtube.com/watch?v=${videoId}`,
      })
    }
    return results
  }

  private async fetchLatestFromDataApi(feed: Feed, rssReason: string): Promise<NormalizedPost[]> {
    const channelUrl = new URL("https://www.googleapis.com/youtube/v3/channels")
    channelUrl.searchParams.set("key", env.YOUTUBE_API_KEY ?? "")
    channelUrl.searchParams.set("part", "contentDetails,snippet")
    channelUrl.searchParams.set("id", feed.identifier)
    channelUrl.searchParams.set("maxResults", "1")

    const channelResponse = await fetch(channelUrl)
    if (channelResponse.status === 429 || channelResponse.status === 403) {
      throw new UpstreamRateLimitError(`YouTube API quota/rate limit reached (RSS fallback reason: ${rssReason})`)
    }
    if (channelResponse.status >= 500) {
      throw new UpstreamTemporaryError(`YouTube API temporary error ${channelResponse.status}`)
    }
    if (!channelResponse.ok) {
      throw new Error(`YouTube API channels.list failed with ${channelResponse.status}`)
    }
    const channelBody = (await channelResponse.json()) as YouTubeChannelResponse
    const channelItem = channelBody.items?.[0]
    const uploadsPlaylistId = channelItem?.contentDetails?.relatedPlaylists?.uploads
    const channelTitle = channelItem?.snippet?.title ?? feed.displayName
    if (!uploadsPlaylistId) {
      return []
    }

    const playlistUrl = new URL("https://www.googleapis.com/youtube/v3/playlistItems")
    playlistUrl.searchParams.set("key", env.YOUTUBE_API_KEY ?? "")
    playlistUrl.searchParams.set("part", "snippet")
    playlistUrl.searchParams.set("playlistId", uploadsPlaylistId)
    playlistUrl.searchParams.set("maxResults", "5")

    const playlistResponse = await fetch(playlistUrl)
    if (playlistResponse.status === 429 || playlistResponse.status === 403) {
      throw new UpstreamRateLimitError("YouTube API quota/rate limit reached")
    }
    if (playlistResponse.status >= 500) {
      throw new UpstreamTemporaryError(`YouTube API temporary error ${playlistResponse.status}`)
    }
    if (!playlistResponse.ok) {
      throw new Error(`YouTube API playlistItems.list failed with ${playlistResponse.status}`)
    }
    const playlistBody = (await playlistResponse.json()) as YouTubePlaylistItemsResponse
    const items = playlistBody.items ?? []
    const posts: NormalizedPost[] = []
    for (const item of items) {
      const videoId = item.snippet?.resourceId?.videoId
      if (!videoId) {
        continue
      }
      posts.push({
        source: "youtube",
        feedId: feed.id,
        externalPostId: videoId,
        publishedAt: toIso(item.snippet?.publishedAt),
        title: item.snippet?.title ?? "New Video",
        text: item.snippet?.description ?? "",
        url: `https://www.youtube.com/watch?v=${videoId}`,
        authorName: item.snippet?.channelTitle ?? channelTitle,
        media: item.snippet?.thumbnails?.high?.url
          ? [{ type: "image" as const, url: item.snippet.thumbnails.high.url }]
          : [],
        tags: [],
        raw: item,
      })
    }
    return posts
  }
}
