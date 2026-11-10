import { Camera, CirclePlay } from "lucide-react";

// lucide-react dropped brand/logo icons (Github, Twitter, etc.) from its
// exports, so the GitHub mark is inlined here instead of imported.
function GithubIcon({ className }: { className?: string }) {
  return (
      <svg
        viewBox="0 0 24 24"
        fill="currentColor"
        className={className}
        aria-hidden="true"
      >
        <path d="M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61-.546-1.385-1.333-1.755-1.333-1.755-1.089-.744.083-.729.083-.729 1.205.084 1.84 1.236 1.84 1.236 1.07 1.835 2.807 1.305 3.492.998.108-.775.42-1.305.762-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.399 3-.405 1.02.006 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81 2.22 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12" />
      </svg>
  );
}

export function SiteFooter({ onShowPrivacy }: { onShowPrivacy: () => void }) {
  return (
    <footer className="mt-auto border-t border-white/5 bg-black/40 px-6 py-12 backdrop-blur-xl">
      <div className="mx-auto flex max-w-6xl flex-col items-center gap-8 text-center sm:flex-row sm:justify-between sm:text-left">
        <div className="space-y-4">
          <div className="flex flex-col gap-1">
            <p className="text-xs font-bold text-zinc-400 uppercase tracking-widest">Engineered by</p>
            <a
              href="https://overflowcreative.net"
              target="_blank"
              rel="noopener noreferrer"
              className="text-lg font-bold text-white hover:text-[#3B93E8] transition-colors"
            >
              Overflow Creative
            </a>
          </div>
          <a
            href="https://tally.so/r/VL14Rg"
            className="inline-flex py-1 text-xs font-bold text-[#3B93E8] hover:text-white transition-colors underline decoration-[#3B93E8]/40 underline-offset-4"
          >
            Share Feedback
          </a>
        </div>

        <div className="flex items-center gap-4">
          <a
            href="https://www.instagram.com/jake.crtv/"
            className="flex size-12 items-center justify-center rounded-2xl bg-white/5 border border-white/5 text-zinc-400 hover:text-white hover:border-white/10 transition-all hover:scale-110"
            aria-label="Instagram"
          >
            <Camera className="size-5" />
          </a>
          <a
            href="https://www.youtube.com/@overflow.creative"
            className="flex size-12 items-center justify-center rounded-2xl bg-white/5 border border-white/5 text-zinc-400 hover:text-white hover:border-white/10 transition-all hover:scale-110"
            aria-label="YouTube"
          >
            <CirclePlay className="size-5" />
          </a>
          <a
            href="https://github.com/jakeh280/sermon-intelligence"
            className="flex size-12 items-center justify-center rounded-2xl bg-white/5 border border-white/5 text-zinc-400 hover:text-white hover:border-white/10 transition-all hover:scale-110"
            aria-label="GitHub"
          >
            <GithubIcon className="size-5" />
          </a>
        </div>
      </div>
      <div className="mx-auto max-w-6xl mt-12 pt-8 border-t border-white/5 flex flex-col items-center gap-3 text-center sm:flex-row sm:justify-between">
        <p className="text-xs text-zinc-400 font-semibold uppercase tracking-[0.18em]">
          © {new Date().getFullYear()} Overflow Creative. All Rights Reserved.
        </p>
        <button
          type="button"
          onClick={onShowPrivacy}
          className="text-xs text-zinc-400 font-semibold uppercase tracking-[0.18em] hover:text-white transition-colors"
        >
          Privacy
        </button>
      </div>
    </footer>
  );
}
