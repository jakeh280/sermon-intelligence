import {
  YoutubeTranscript,
  YoutubeTranscriptDisabledError,
  YoutubeTranscriptError,
  YoutubeTranscriptNotAvailableError,
  YoutubeTranscriptTooManyRequestError,
  YoutubeTranscriptVideoUnavailableError,
} from "youtube-transcript";
import {
  extractYouTubeVideoId,
  watchUrlForVideoId,
} from "@/lib/youtube";

export const maxDuration = 60;

function errorMessage(err: unknown): string {
  if (err instanceof YoutubeTranscriptTooManyRequestError) {
    return "YouTube is rate-limiting transcript requests. Try again in a minute.";
  }
  if (err instanceof YoutubeTranscriptVideoUnavailableError) {
    return "That video is unavailable or private.";
  }
  if (err instanceof YoutubeTranscriptDisabledError) {
    return "Captions are disabled for this video.";
  }
  if (err instanceof YoutubeTranscriptNotAvailableError) {
    return "No captions are available for this video.";
  }
  if (err instanceof YoutubeTranscriptError) {
    return err.message || "Could not load captions.";
  }
  return "Could not load the YouTube transcript.";
}

export async function POST(req: Request) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const url =
    typeof body === "object" &&
    body !== null &&
    "url" in body &&
    typeof (body as { url: unknown }).url === "string"
      ? (body as { url: string }).url.trim()
      : "";

  const videoId = extractYouTubeVideoId(url);
  if (!videoId) {
    return Response.json(
      { error: "Enter a valid YouTube link (watch, youtu.be, embed, or shorts)." },
      { status: 400 },
    );
  }

  let title = "YouTube video";
  try {
    const oEmbedUrl = `https://www.youtube.com/oembed?url=${encodeURIComponent(watchUrlForVideoId(videoId))}&format=json`;
    const oRes = await fetch(oEmbedUrl, { next: { revalidate: 0 } });
    if (oRes.ok) {
      const data = (await oRes.json()) as { title?: string };
      if (typeof data.title === "string" && data.title.trim()) {
        title = data.title.trim();
      }
    }
  } catch {
    /* keep fallback title */
  }

  try {
    const segments = await YoutubeTranscript.fetchTranscript(videoId);
    const text = segments.map((s) => s.text).join("\n").trim();
    if (!text) {
      return Response.json(
        { error: "Captions were empty for this video." },
        { status: 422 },
      );
    }
    return Response.json({ title, text });
  } catch (e) {
    return Response.json({ error: errorMessage(e) }, { status: 502 });
  }
}
