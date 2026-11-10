"use client";

import { X } from "lucide-react";
import { ModalFrame } from "@/components/ModalFrame";

export function PrivacyDialog({ onClose }: { onClose: () => void }) {
  return (
    <ModalFrame
      onClose={onClose}
      titleId="privacy-dialog-title"
      align="bottom"
      panelClassName="w-full max-w-sm rounded-2xl border border-white/10 bg-zinc-950 p-6 shadow-2xl animate-in zoom-in-95 duration-200"
    >
        <div className="mb-4 flex items-center justify-between">
          <h3 id="privacy-dialog-title" className="text-sm font-bold text-white">Privacy</h3>
          <button
            type="button"
            onClick={onClose}
            className="cursor-pointer rounded-lg p-2 text-zinc-400 hover:bg-white/5 hover:text-white"
            aria-label="Close privacy information"
            data-dialog-initial-focus
          >
            <X className="size-4" aria-hidden />
          </button>
        </div>
        <ul className="space-y-3 text-xs text-zinc-400 leading-relaxed">
          <li>
            <span className="font-semibold text-zinc-300">Cloud processing</span> sends your transcript to a billing enabled Google Gemini API project. Google states that prompts and responses from paid services are not used to improve its products, though they may be logged for a limited period for policy enforcement and legal requirements. Only submit material you are allowed to share. Read the{" "}
            <a
              href="https://ai.google.dev/gemini-api/terms"
              target="_blank"
              rel="noopener noreferrer"
              className="text-[#3B93E8] underline underline-offset-2"
            >
              Gemini API terms
            </a>
            .
          </li>
          <li>
            <span className="font-semibold text-zinc-300">Local history</span> keeps up to 10 generated results in this browser only. You can remove them at any time from History.
          </li>
          <li>
            <span className="font-semibold text-zinc-300">Usage limits</span> count each analysis request against per-visitor and sitewide limits to prevent abuse. The limiter on Cloudflare receives only a keyed hash of your IP address, never the address itself, your transcript or the results.
          </li>
          <li>
            <span className="font-semibold text-zinc-300">Aggregate analytics</span> uses Vercel Web Analytics and Cloudflare Web Analytics to understand page traffic and performance. These analytics tools do not use session recordings, and the app does not send transcript text or generated content to either analytics tool. See{" "}
            <a
              href="https://vercel.com/docs/analytics/privacy-policy"
              target="_blank"
              rel="noopener noreferrer"
              className="text-[#3B93E8] underline underline-offset-2"
            >
              Vercel&apos;s privacy information
            </a>{" "}
            and{" "}
            <a
              href="https://developers.cloudflare.com/web-analytics/about/"
              target="_blank"
              rel="noopener noreferrer"
              className="text-[#3B93E8] underline underline-offset-2"
            >
              Cloudflare&apos;s analytics information
            </a>
            .
          </li>
        </ul>
    </ModalFrame>
  );
}
