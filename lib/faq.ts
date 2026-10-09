/**
 * Homepage FAQ. DRAFT wording, pending Jake's edits. Jake owns this copy:
 * do not rewrite it without his approval. Also feeds the FAQPage JSON-LD.
 */
export const faqs: { q: string; a: string }[] = [
  {
    q: "How do I make YouTube chapters from a sermon?",
    a: "Drop in your transcript and you'll get chapter markers with timestamps, ready to paste into your YouTube description. A transcript with timestamps gives you the most accurate chapters.",
  },
  {
    q: "Can it find clips for social media?",
    a: "Yep. It suggests clips with start and end times. Set the clip length range you want and it sizes the suggestions to fit.",
  },
  {
    q: "What file types can I upload?",
    a: "A .txt, .srt, or .vtt file, or just paste the transcript in. Caption exports from Premiere, DaVinci Resolve, or YouTube all work.",
  },
  {
    q: "Is it really free?",
    a: "Yes. No account, no credit card. If a lot of people are using it at once, you might have to wait a few minutes and try again.",
  },
  {
    q: "What happens to my transcript?",
    a: "It's sent to the AI model to make your results, and that's it. Nothing is saved on our end. Your history stays in your own browser.",
  },
  {
    q: "Who made this?",
    a: "I'm Jake Hill, a church production director and videographer. I built this to save church media teams time every week.",
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
