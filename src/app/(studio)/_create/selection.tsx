"use client";
import { createContext, useContext, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CheckSquare, Download, Loader2, Trash2 } from "lucide-react";
import { deleteResults } from "@/server/actions/generation";
import { useI18n } from "@/lib/i18n/client";
import { fmt } from "@/lib/i18n/config";
import { cn } from "@/lib/utils";

interface SelectionState {
  selecting: boolean;
  selected: Set<string>;
  toggle: (id: string) => void;
  setSelecting: (on: boolean) => void;
  clear: () => void;
}

const SelectionContext = createContext<SelectionState | null>(null);

/** Canvas selection mode shared by tiles, the toggle, the action bar and the composer. */
export function SelectionProvider({ children }: { children: React.ReactNode }) {
  const [selecting, setSelectingState] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const value: SelectionState = {
    selecting,
    selected,
    toggle: (id) =>
      setSelected((prev) => {
        const next = new Set(prev);
        if (next.has(id)) next.delete(id);
        else next.add(id);
        return next;
      }),
    setSelecting: (on) => {
      setSelectingState(on);
      if (!on) setSelected(new Set());
    },
    clear: () => setSelected(new Set()),
  };
  return <SelectionContext.Provider value={value}>{children}</SelectionContext.Provider>;
}

export function useSelection(): SelectionState | null {
  return useContext(SelectionContext);
}

export function SelectToggle() {
  const sel = useSelection();
  const { d } = useI18n();
  if (!sel) return null;
  return (
    <button
      type="button"
      onClick={() => sel.setSelecting(!sel.selecting)}
      aria-pressed={sel.selecting}
      className={cn(
        "flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs active:scale-95",
        sel.selecting ? "bg-primary text-primary-foreground" : "bg-card/60 text-muted-foreground hover:text-foreground",
      )}
    >
      <CheckSquare className="h-3.5 w-3.5" /> {sel.selecting ? d.create.done : d.create.select}
    </button>
  );
}

/** Bottom action bar in selection mode: ZIP download and (admins) delete. */
export function SelectionBar({ canDelete }: { canDelete: boolean }) {
  const sel = useSelection();
  const router = useRouter();
  const { d } = useI18n();
  const t = d.create;
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<"zip" | "delete" | null>(null);
  const [, start] = useTransition();
  if (!sel?.selecting) return null;
  const ids = Array.from(sel.selected);
  const n = ids.length;

  function zip() {
    setError(null);
    setBusy("zip");
    start(async () => {
      const res = await fetch("/api/export", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ resultIds: ids, approvedOnly: false }) });
      setBusy(null);
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null;
        return setError(body?.error ?? d.errors.generic);
      }
      const url = URL.createObjectURL(await res.blob());
      const a = document.createElement("a");
      a.href = url;
      a.download = `pandiones-${new Date().toISOString().slice(0, 10)}.zip`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
    });
  }

  function remove() {
    setError(null);
    setBusy("delete");
    start(async () => {
      const res = await deleteResults({ resultIds: ids });
      setBusy(null);
      setConfirming(false);
      if (!res.ok) return setError(res.error);
      sel?.setSelecting(false);
      router.refresh();
    });
  }

  return (
    <div className="fixed inset-x-0 bottom-[calc(var(--tabbar-h)+env(safe-area-inset-bottom))] z-30 px-3 pb-3 lg:bottom-0 lg:pb-5">
      <div className="mx-auto flex max-w-3xl flex-wrap items-center gap-2 rounded-3xl border bg-card/95 p-3 shadow-2xl shadow-black/50 backdrop-blur-xl">
        <span className="px-1 text-sm font-medium">{confirming ? fmt(t.confirmDeleteSelected, { n }) : fmt(t.selectedCount, { n })}</span>
        {error && <span className="w-full px-1 text-xs text-destructive">{error}</span>}
        <div className="ml-auto flex gap-2">
          {confirming ? (
            <>
              <button type="button" onClick={() => setConfirming(false)} className="rounded-full border px-4 py-2 text-sm">
                {d.common.cancel}
              </button>
              <button
                type="button"
                disabled={busy !== null}
                onClick={remove}
                className="flex items-center gap-1.5 rounded-full bg-destructive px-4 py-2 text-sm font-medium text-destructive-foreground disabled:opacity-60"
              >
                {busy === "delete" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />} {t.confirmDelete}
              </button>
            </>
          ) : (
            <>
              <button
                type="button"
                disabled={!n || busy !== null}
                onClick={zip}
                className="flex items-center gap-1.5 rounded-full border px-4 py-2 text-sm disabled:opacity-40"
              >
                {busy === "zip" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />} {fmt(t.downloadSelected, { n })}
              </button>
              {canDelete && (
                <button
                  type="button"
                  disabled={!n || busy !== null}
                  onClick={() => setConfirming(true)}
                  className="flex items-center gap-1.5 rounded-full bg-destructive/15 px-4 py-2 text-sm text-destructive disabled:opacity-40"
                >
                  <Trash2 className="h-4 w-4" /> {fmt(t.deleteSelected, { n })}
                </button>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
