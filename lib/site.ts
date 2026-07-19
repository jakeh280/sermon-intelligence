/**
 * Canonical origin and structured data for Sermon Intelligence.
 * Mirrors the same pattern used in the overflowcreative repo.
 */

/**
 * The apex 307-redirects to www, so www is the real canonical host. Pointing
 * canonicals or the sitemap at the apex sends Search Console to a redirect.
 * Note this differs from overflowcreative.net, which serves on its apex.
 */
export const SITE_URL = "https://www.sermonintelligence.com";

export const SITE_NAME = "Sermon Intelligence";

export const SITE_DESCRIPTION =
  "Break down your sermons into details you can use. Upload a transcript and get summaries, key points, and shareable takeaways. Free.";

/**
 * WebApplication rather than WebSite: this is a tool, not a content site, and
 * the free price is the main thing worth stating to an answer engine.
 */
export const appJsonLd = {
  "@context": "https://schema.org",
  "@type": "WebApplication",
  name: SITE_NAME,
  url: SITE_URL,
  description: SITE_DESCRIPTION,
  applicationCategory: "UtilitiesApplication",
  operatingSystem: "Any",
  browserRequirements: "Requires JavaScript",
  offers: {
    "@type": "Offer",
    price: "0",
    priceCurrency: "USD",
  },
  author: {
    "@type": "Person",
    name: "Jake Hill",
    url: "https://overflowcreative.net/about",
  },
  publisher: {
    "@type": "Organization",
    name: "Overflow Creative, LLC",
    url: "https://overflowcreative.net",
  },
};
