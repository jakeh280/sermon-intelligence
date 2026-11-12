import { pathToFileURL } from "node:url";
import { describeOutputIssues } from "../lib/outputHealth.ts";

const origin = "https://www.sermonintelligence.com";
const monitorHeaders: Record<string, string> = {
  "User-Agent": "SermonIntelligenceMonitor/1.0 (+https://www.sermonintelligence.com)",
};

export async function checkProduction(send: typeof fetch = fetch, generate = false) {
  const health = await send(`${origin}/api/health`, { headers: monitorHeaders, signal: AbortSignal.timeout(15_000) });
  if (!health.ok || (await health.json()).healthy !== true) {
    throw new Error(`Production analysis health check failed: HTTP ${health.status}, server ${health.headers.get("server") ?? "unknown"}, challenge ${health.headers.get("cf-mitigated") ?? "none"}`);
  }
  console.log("Production limiter authentication and storage are healthy.");

  if (generate) {
    // Synthetic sermon content, never a visitor's transcript. One generation
    // after deployment verifies the public route, provider, stream and parser.
    const text = `[00:00:00:00] Today we are reading John 15. Jesus tells his disciples to remain in him, as branches remain in a vine. A branch cannot produce fruit by working harder at being separate. It receives its life from the vine. In the same way, our service begins with receiving the love Christ has already given us. Before we ask what we can accomplish this week, we can ask how we will make room to listen to him.
[00:00:30:00] Think about an ordinary morning. We wake up and immediately reach for a screen. We hear demands before we remember that we are loved. Remaining in Christ can begin with one small act: before opening the inbox, read a passage of Scripture and pray. We are not earning his attention. We are turning our attention toward the one who is already present. A few quiet minutes can change the way we carry every task that follows.
[00:01:00:00] Jesus also commands us to love one another. Love becomes visible in ordinary decisions. We listen to a family member without planning our reply. We take a meal to a neighbor who is recovering from surgery. We tell the truth gently when silence would be easier. None of these acts makes us the source of love. They are fruit growing from a life rooted in Christ. The branch receives, and then the branch gives.
[00:01:30:00] Sometimes serving is difficult because we want to be noticed. We can ask a different question: who needs care even if nobody sees us provide it? That question loosens the grip of recognition. Jesus loved people who could offer him nothing in return. As we remain in him, we learn to serve with that same freedom. Our neighbor does not have to become a project or a performance. Our neighbor can simply be someone we love.
[00:02:00:00] This week choose one person and one practical act of care. Write a note, make a call, bring a meal, or offer a ride. Keep the promise small enough that you will actually do it. Then ask God to help you listen while you serve. We do not know every burden someone is carrying. By paying attention, we may discover that the most useful gift is our patient presence rather than our quick advice.
[00:02:30:00] Let us pray. Jesus, teach us to remain in your love. Help us receive before we try to give. Open our eyes to the people nearby and give us courage to serve them without seeking recognition. Let our words be truthful and kind. Let our schedules have room for mercy. May the love we have received from you become visible in the ordinary places where we live and work this week. Amen.
[00:03:00:00] End of sermon.`;
    const response = await send(`${origin}/api/chat`, {
      method: "POST", headers: { ...monitorHeaders, "Content-Type": "application/json" },
      body: JSON.stringify({ text, clipMinSec: 15, clipMaxSec: 60 }),
      signal: AbortSignal.timeout(75_000),
    });
    if (!response.ok) throw new Error(`Production generation failed: HTTP ${response.status}`);
    const output = await response.text();
    const issues = describeOutputIssues(output);
    if (issues.length) throw new Error(`Production output failed validation: ${issues.map(issue => issue.code).join(", ")}`);
    console.log("Production generation completed with all four sections and three complete clips.");
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await checkProduction(fetch, process.argv.includes("--generate"));
}
