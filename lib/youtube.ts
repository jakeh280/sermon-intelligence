const VIDEO_ID_RE = /^[a-zA-Z0-9_-]{11}$/;

/**
 * Extract YouTube video id from common URL shapes (watch, youtu.be, embed, shorts).
 */
export function extractYouTubeVideoId(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  if (VIDEO_ID_RE.test(trimmed)) return trimmed;

  try {
    const u = new URL(trimmed);
    const host = u.hostname.replace(/^www\./, "").toLowerCase();

    if (host === "youtu.be") {
      const id = u.pathname.replace(/^\//, "").split("/")[0] ?? "";
      return VIDEO_ID_RE.test(id) ? id : null;
    }

    if (
      host === "youtube.com" ||
      host === "m.youtube.com" ||
      host === "music.youtube.com"
    ) {
      const v = u.searchParams.get("v");
      if (v && VIDEO_ID_RE.test(v)) return v;
      const parts = u.pathname.split("/").filter(Boolean);
      if (parts[0] === "embed" && parts[1] && VIDEO_ID_RE.test(parts[1])) {
        return parts[1];
      }
      if (parts[0] === "shorts" && parts[1] && VIDEO_ID_RE.test(parts[1])) {
        return parts[1];
      }
    }
  } catch {
    return null;
  }

  return null;
}

export function watchUrlForVideoId(videoId: string): string {
  return `https://www.youtube.com/watch?v=${videoId}`;
}
