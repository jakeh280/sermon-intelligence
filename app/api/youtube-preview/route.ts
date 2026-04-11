import {
  extractYouTubeVideoId,
  watchUrlForVideoId,
} from "@/lib/youtube";

export const maxDuration = 30;

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
      { error: "Enter a valid YouTube link." },
      { status: 400 },
    );
  }

  try {
    const oEmbedUrl = `https://www.youtube.com/oembed?url=${encodeURIComponent(watchUrlForVideoId(videoId))}&format=json`;
    const oRes = await fetch(oEmbedUrl, { next: { revalidate: 0 } });
    if (!oRes.ok) {
      return Response.json(
        { error: "Could not find that video (private or unavailable)." },
        { status: 404 },
      );
    }
    const data = (await oRes.json()) as { title?: string };
    const title =
      typeof data.title === "string" && data.title.trim()
        ? data.title.trim()
        : "YouTube video";
    return Response.json({ title });
  } catch {
    return Response.json(
      { error: "Could not load video information." },
      { status: 502 },
    );
  }
}
