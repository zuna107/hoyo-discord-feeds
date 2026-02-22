export const HOYOLAB_LANGUAGES = [
  "en-us",
  "zh-cn",
  "zh-tw",
  "de-de",
  "es-es",
  "fr-fr",
  "id-id",
  "it-it",
  "ja-jp",
  "ko-kr",
  "pt-pt",
  "ru-ru",
  "th-th",
  "tr-tr",
  "vi-vn",
] as const

export type HoyoLabLanguage = (typeof HOYOLAB_LANGUAGES)[number]
