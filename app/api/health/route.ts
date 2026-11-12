import { limiterHealth } from "@/lib/sharedRateLimit";

export async function GET() {
  const healthy = Boolean(process.env.GOOGLE_GENERATIVE_AI_API_KEY) && await limiterHealth();
  return Response.json({ healthy }, {
    status: healthy ? 200 : 503,
    // Bound public probe load while still detecting an outage within a minute.
    headers: { "Cache-Control": "public, max-age=0, s-maxage=60" },
  });
}
