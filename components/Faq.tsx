import { faqs, faqJsonLd } from "@/lib/faq";

export function Faq() {
  return (
    <section aria-labelledby="faq-heading" className="mx-auto w-full max-w-3xl px-6 py-16">
      <h2 id="faq-heading" className="mb-6 text-xs font-semibold uppercase tracking-[0.18em] text-zinc-400">
        FAQ
      </h2>
      <div className="divide-y divide-white/5 border-y border-white/5">
        {faqs.map(({ q, a }) => (
          <details key={q} className="group py-4">
            <summary className="flex cursor-pointer list-none items-center justify-between gap-4 text-sm font-semibold text-zinc-200 hover:text-white">
              {q}
              <span aria-hidden className="text-zinc-500 transition-transform group-open:rotate-45">+</span>
            </summary>
            <p className="mt-3 text-sm leading-relaxed text-zinc-400">{a}</p>
          </details>
        ))}
      </div>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(faqJsonLd).replace(/</g, "\\u003c") }}
      />
    </section>
  );
}
