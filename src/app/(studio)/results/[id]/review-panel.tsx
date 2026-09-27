"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, Loader2, RefreshCw, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { regenerateResult, reviewResults } from "@/server/actions/generation";
import { useI18n } from "@/lib/i18n/client";
import { fmt } from "@/lib/i18n/config";

export function ReviewPanel({
  resultId,
  currentNotes,
  canRegenerate,
}: {
  resultId: string;
  currentNotes: string | null;
  canRegenerate: boolean;
}) {
  const router = useRouter();
  const { d } = useI18n();
  const t = d.result.panel;
  const [notes, setNotes] = useState(currentNotes ?? "");
  const [pending, start] = useTransition();
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [regenKey, setRegenKey] = useState(() => crypto.randomUUID());

  const review = (decision: "approved" | "rejected" | "pending") =>
    start(async () => {
      const res = await reviewResults({ resultIds: [resultId], decision, notes: notes || undefined });
      setMessage(res.ok ? { ok: true, text: fmt(t.marked, { status: d.enums.reviewStatus[decision] }) } : { ok: false, text: res.error });
      router.refresh();
    });

  return (
    <div className="space-y-3">
      <div className="space-y-1">
        <Label htmlFor="review-notes">{t.notesLabel}</Label>
        <Textarea
          id="review-notes"
          rows={3}
          maxLength={2000}
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder={t.notesPlaceholder}
        />
      </div>
      <div className="flex flex-wrap gap-2">
        <Button variant="success" disabled={pending} onClick={() => review("approved")}>
          {pending ? <Loader2 className="animate-spin" /> : <Check />} {d.common.approve}
        </Button>
        <Button variant="destructive" disabled={pending} onClick={() => review("rejected")}>
          <X /> {d.common.reject}
        </Button>
        <Button variant="ghost" disabled={pending} onClick={() => review("pending")}>
          {t.resetPending}
        </Button>
      </div>
      {canRegenerate && (
        <Button
          variant="outline"
          disabled={pending}
          onClick={() =>
            start(async () => {
              const res = await regenerateResult({ resultId, note: notes || undefined, idempotencyKey: regenKey });
              if (res.ok) {
                setRegenKey(crypto.randomUUID());
                setMessage({ ok: true, text: t.regenerationQueued });
              } else setMessage({ ok: false, text: res.error });
              router.refresh();
            })
          }
        >
          <RefreshCw /> {notes ? t.regenerateWithFeedback : t.regenerateSame}
        </Button>
      )}
      {message && <p className={`text-sm ${message.ok ? "text-success" : "text-destructive"}`}>{message.text}</p>}
    </div>
  );
}
