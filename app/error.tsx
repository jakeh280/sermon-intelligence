"use client";

import { useEffect } from "react";

export default function ErrorPage({
  error,
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <main className="flex min-h-screen items-center justify-center bg-zinc-950 px-6 text-zinc-100">
      <div className="w-full max-w-lg rounded-3xl border border-white/10 bg-white/5 p-8 text-center shadow-2xl">
        <p className="text-xs font-bold uppercase tracking-[0.2em] text-[#7DBEF7]">
          Sermon Intelligence
        </p>
        <h1 className="mt-4 text-3xl font-extrabold tracking-tight text-white">
          Something interrupted the page
        </h1>
        <p className="mt-4 text-base leading-7 text-zinc-400">
          Your transcript has not been submitted again. Try reloading this part of the app.
        </p>
        <button
          type="button"
          onClick={() => retry()}
          className="mt-7 inline-flex cursor-pointer items-center justify-center rounded-xl bg-[#0B6ED0] px-6 py-3 text-sm font-bold text-white hover:bg-[#3d8fe8]"
        >
          Try Again
        </button>
      </div>
    </main>
  );
}
