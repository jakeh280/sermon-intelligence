/**
 * Homepage FAQ. Wording approved by Jake 2026-10-09. Jake owns this copy:
 * do not rewrite it without his approval. Also feeds the FAQPage JSON-LD.
 */
export const faqs: { q: string; a: string }[] = [
  {
    q: "How do I make YouTube chapters from a sermon?",
    a: "Grab a transcript: export one from your video editor, download it from YouTube, or drop your video or audio into Transcrisper (linked at the top). Paste it here, hit generate, and you'll get chapter markers with timestamps and a copy button. Paste them straight into your YouTube description.",
  },
  {
    q: "Can it find clips for social media?",
    a: "Yep! It suggests clips with start and end times. Set the clip length range you want and it sizes the suggestions to fit.",
  },
  {
    q: "Does it edit the clips for me?",
    a: "Nope, on purpose. This is an assist for editors who want to cut their own clips but want help finding the best moments. No AI-looking auto-edits.",
  },
  {
    q: "What file types can I upload?",
    a: "A .txt, .srt, or .vtt file, or just paste the transcript in. If you edit in Premiere or DaVinci Resolve, export the transcript or captions and drop them in.",
  },
  {
    q: "Is it really free?",
    a: "Yes. No account, no credit card. There's a rate limit to prevent abuse, so if it's busy you might need to wait a few minutes and try again.",
  },
  {
    q: "What happens to my transcript?",
    a: "It's sent to the AI model to make your results. We don't save it. Your history stays in your own browser.",
  },
  {
    q: "Who made this?",
    a: "I'm Jake Hill, a church production director and videographer. I built this to save church media teams time every week. More at overflowcreative.net.",
  },
];

export const faqJsonLd = {
  "@context": "https://schema.org",
  "@type": "FAQPage",
  mainEntity: faqs.map(({ q, a }) => ({
    "@type": "Question",
    name: q,
    acceptedAnswer: { "@type": "Answer", text: a },
  })),
};
