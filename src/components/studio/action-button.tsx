"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { Button, type ButtonProps } from "@/components/ui/button";

type Result = { ok: true; data?: unknown } | { ok: false; error: string };

/**
 * Calls a (bound) server action, shows pending state and surfaces errors.
 * Optional native confirm for destructive actions.
 */
export function ActionButton({
  action,
  confirm,
  children,
  successText,
  onDone,
  ...props
}: Omit<ButtonProps, "onClick" | "action"> & {
  action: () => Promise<Result>;
  confirm?: string;
  successText?: string;
  onDone?: (result: Result) => void;
}) {
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const router = useRouter();
  return (
    <span className="inline-flex flex-col items-start gap-1">
      <Button
        type="button"
        {...props}
        disabled={pending || props.disabled}
        aria-busy={pending}
        onClick={() => {
          if (confirm && !window.confirm(confirm)) return;
          setMessage(null);
          startTransition(async () => {
            const result = await action();
            if (!result.ok) setMessage({ ok: false, text: result.error });
            else if (successText) setMessage({ ok: true, text: successText });
            onDone?.(result);
            router.refresh();
          });
        }}
      >
        {pending && <Loader2 className="animate-spin" />}
        {children}
      </Button>
      {message && (
        <span role={message.ok ? "status" : "alert"} className={`text-xs ${message.ok ? "text-success" : "text-destructive"}`}>
          {message.text}
        </span>
      )}
    </span>
  );
}
