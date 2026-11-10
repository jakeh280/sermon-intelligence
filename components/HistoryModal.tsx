"use client";

import { History, Trash2, X } from "lucide-react";
import { useState } from "react";
import { formatDurationSec } from "@/lib/clipRange";
import type { HistoryItem } from "@/lib/history";
import { ModalFrame } from "@/components/ModalFrame";

export function HistoryModal({
  items,
  onSelect,
  onDelete,
  onClear,
  onClose,
  busy,
}: {
  items: HistoryItem[];
  onSelect: (item: HistoryItem) => void;
  onDelete: (id: string) => void;
  onClear: () => void;
  onClose: () => void;
  /** A generation is streaming; loading an entry now would be overwritten by it. */
  busy: boolean;
}) {
  // Clearing can't be undone and the results live nowhere else, so it takes a
  // second click. The dialog unmounts on close, which resets this.
  const [confirmingClear, setConfirmingClear] = useState(false);

  return (
    <ModalFrame
      onClose={onClose}
      titleId="history-dialog-title"
      panelClassName="relative w-full max-w-md overflow-hidden rounded-2xl border border-white/10 bg-zinc-950 shadow-3xl animate-in zoom-in-95 duration-200"
    >
        <header className="flex items-center justify-between p-4 border-b border-white/5">
          <h3 id="history-dialog-title" className="text-base font-bold text-white flex items-center gap-2">
            <History className="size-4" aria-hidden />
            Recent Generations
          </h3>
          <button
            type="button"
            onClick={onClose}
            className="cursor-pointer rounded-lg p-2 hover:bg-white/5"
            aria-label="Close history"
            data-dialog-initial-focus
          >
            <X className="size-5 text-zinc-400" aria-hidden />
          </button>
        </header>

        <div className="max-h-[60vh] overflow-y-auto p-2">
          {busy && items.length > 0 && (
            <p className="px-3 pb-2 pt-1 text-xs text-zinc-400">
              A result is still being generated. Open a saved one once it finishes.
            </p>
          )}
          {items.length === 0 ? (
            <div className="py-12 text-center">
              <History className="size-10 text-zinc-800 mx-auto mb-3" />
              <p className="text-sm text-zinc-400">No history yet.</p>
            </div>
          ) : (
            <div className="space-y-1">
              {items.map((item) => (
                <div
                  key={item.id}
                  className="group flex items-center justify-between gap-3 p-3 rounded-xl hover:bg-white/5 transition-all text-left"
                >
                  <button
                    type="button"
                    onClick={() => onSelect(item)}
                    disabled={busy}
                    className="flex-1 min-w-0 cursor-pointer text-left disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    <p className="text-sm font-semibold text-white truncate group-hover:text-[#7EB8F0] transition-colors text-left">
                      {item.label}
                    </p>
                    <p className="text-xs text-zinc-400 font-mono text-left">
                      {new Date(item.timestamp).toLocaleString()} • {formatDurationSec(item.clipMinSec)}-{formatDurationSec(item.clipMaxSec)}
                    </p>
                  </button>
                  <button
                    type="button"
                    onClick={() => onDelete(item.id)}
                    className="cursor-pointer rounded-lg p-2 transition-all hover:text-red-400 [@media(hover:hover)]:opacity-0 [@media(hover:hover)]:focus:opacity-100 [@media(hover:hover)]:group-hover:opacity-100 [@media(hover:hover)]:group-focus-within:opacity-100"
                    aria-label={`Delete ${item.label} from history`}
                  >
                    <Trash2 className="size-4" aria-hidden />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        {items.length > 0 && (
          <footer className="p-3 border-t border-white/5">
            <button
              type="button"
              onClick={() => {
                if (confirmingClear) {
                  setConfirmingClear(false);
                  onClear();
                } else {
                  setConfirmingClear(true);
                }
              }}
              onBlur={() => setConfirmingClear(false)}
              className="w-full py-2 text-xs font-bold text-red-500/80 hover:text-red-400 hover:bg-red-500/5 rounded-lg transition-all cursor-pointer"
            >
              {confirmingClear
                ? `Click again to clear ${items.length === 1 ? "it" : `all ${items.length}`}`
                : "Clear All History"}
            </button>
          </footer>
        )}
    </ModalFrame>
  );
}
