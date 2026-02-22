import { env } from "../config/env.js"
import type { Feed, NormalizedPost } from "../domain/types.js"
import type { SourceAdapter } from "./base.js"
import { UpstreamRateLimitError, UpstreamTemporaryError } from "../services/errors.js"

type HoyoTag = {
  is_user_top?: boolean
}

type HoyoImage = {
  url?: string
}

type HoyoUser = {
  uid?: string | number
  nickname?: string
  avatar_url?: string
  avatar?: string
}

type HoyoPostData = {
  post_id?: string | number
  subject?: string
  content?: string
  structured_content?: string
  created_at?: string | number
  view_type?: number
  game_id?: number
  lang?: string
  origin_lang?: string
}

type HoyoListItem = {
  post?: HoyoPostData
  cover?: { url?: string }
  image_list?: HoyoImage[]
  tags?: HoyoTag
  user?: HoyoUser
}

type HoyoApiResponse = {
  retcode?: number
  message?: string
  data?: {
    list?: HoyoListItem[]
  }
}

const DEFAULT_ENDPOINT = "https://bbs-api-os.hoyolab.com/community/post/wapi/userPost"

const escapeMarkdown = (text: string): string => text.replace(/([*_`~|\\])/g, "\\$1")

const parseStructuredContent = (structuredContent: string, maxLength = 1000): string => {
  try {
    const content = JSON.parse(structuredContent) as Array<{
      insert?: string | { video?: unknown; vote?: { title?: string } }
      attributes?: { link?: string }
    }>
    if (!Array.isArray(content) || content.length === 0) {
      return ""
    }

    let result = ""
    for (const element of content) {
      if (result.length >= maxLength) {
        break
      }

      if (typeof element.insert === "string") {
        result += escapeMarkdown(element.insert)
        continue
      }

      if (element.attributes?.link) {
        result += `[Link](${element.attributes.link}) `
        continue
      }

      if (element.insert && typeof element.insert === "object" && "video" in element.insert) {
        result += "\n[Video]\n"
        continue
      }

      if (element.insert && typeof element.insert === "object" && "vote" in element.insert) {
        result += `\nPoll: ${element.insert.vote?.title ?? "Untitled"}\n`
      }
    }

    const trimmed = result.trim()
    if (trimmed.length <= maxLength) {
      return trimmed
    }
    return `${trimmed.slice(0, maxLength - 3)}...`
  } catch {
    return ""
  }
}

const mapCreatedAt = (createdAt: string | number | undefined): string => {
  if (createdAt === undefined) {
    return new Date().toISOString()
  }
  if (typeof createdAt === "number") {
    return new Date(createdAt * 1000).toISOString()
  }
  const asNumber = Number(createdAt)
  if (Number.isFinite(asNumber) && asNumber > 1000000000) {
    return new Date(asNumber * 1000).toISOString()
  }
  const date = new Date(createdAt)
  if (Number.isNaN(date.getTime())) {
    return new Date().toISOString()
  }
  return date.toISOString()
}

const normalizeList = (list: HoyoListItem[]): HoyoListItem[] => {
  if (list.length <= 1) {
    return list
  }
  const first = list[0]
  const second = list[1]
  const firstId = Number(first.post?.post_id ?? 0)
  const secondId = Number(second.post?.post_id ?? 0)
  // HoYoLAB sometimes returns pinned entries first skip if it is likely a sticky older post.
  if (first.tags?.is_user_top && firstId > 0 && secondId > 0 && firstId < secondId) {
    return list.slice(1)
  }
  return list
}

const buildProfileUrl = (uid: string): string =>
  `https://www.hoyolab.com/accountCenter/postList?id=${encodeURIComponent(uid)}`

export class HoyoLabAdapter implements SourceAdapter {
  public supports(platform: Feed["platform"]): boolean {
    return platform === "hoyolab"
  }

  public async fetchLatest(feed: Feed): Promise<NormalizedPost[]> {
    const endpoint = env.HOYOLAB_ENDPOINT || DEFAULT_ENDPOINT
    const url = new URL(endpoint)
    url.searchParams.set("uid", feed.identifier)
    url.searchParams.set("size", "5")

    const resolvedLanguage =
      feed.language === "en-us" && env.HOYOLAB_LANGUAGE !== "en-us" ? env.HOYOLAB_LANGUAGE : feed.language

    const response = await fetch(url, {
      headers: {
        accept: "application/json",
        "x-rpc-language": resolvedLanguage,
        "x-rpc-show-translated": "true",
        "x-rpc-app_version": env.HOYOLAB_APP_VERSION,
        "user-agent":
          "Mozilla/5.0 (X11 Linux aarch64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
      },
    })
    if (response.status === 429) {
      throw new UpstreamRateLimitError("HoYoLAB API rate limited")
    }
    if (response.status >= 500) {
      throw new UpstreamTemporaryError(`HoYoLAB API temporary error ${response.status}`)
    }
    if (!response.ok) {
      throw new Error(`HoYoLAB API failed with ${response.status}`)
    }
    const body = (await response.json()) as HoyoApiResponse
    if (typeof body.retcode === "number" && body.retcode !== 0) {
      throw new Error(`HoYoLAB API retcode=${body.retcode} message=${body.message ?? ""}`)
    }

    const posts = normalizeList(body.data?.list ?? [])
    const normalized: NormalizedPost[] = []
    for (const post of posts) {
      const id = post.post?.post_id ? String(post.post.post_id) : null
      if (!id) {
        continue
      }
      const firstImage = post.cover?.url ?? post.image_list?.[0]?.url
      const text = post.post?.content?.trim() || ""
      const structured = text.length > 0 ? text : parseStructuredContent(post.post?.structured_content ?? "")
      const uid = post.user?.uid ? String(post.user.uid) : feed.identifier
      normalized.push({
        source: "hoyolab",
        feedId: feed.id,
        externalPostId: id,
        publishedAt: mapCreatedAt(post.post?.created_at),
        title: post.post?.subject ?? feed.displayName,
        text: structured,
        url: `https://www.hoyolab.com/article/${id}`,
        authorName: feed.displayName,
        authorUrl: buildProfileUrl(uid),
        authorIconUrl: post.user?.avatar_url ?? post.user?.avatar,
        media: firstImage ? [{ type: "image", url: firstImage }] : [],
        tags: [],
        raw: post,
      })
    }
    return normalized
  }
}
