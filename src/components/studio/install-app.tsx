"use client";
import { useEffect, useState } from "react";
import { Download, Share } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useI18n } from "@/lib/i18n/client";

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

/**
 * "Install app": uses the browser's install prompt where available (Chrome/
 * Edge/Android); on iPhone/iPad Safari shows the Share → Add to Home Screen
 * hint. Hidden when already running as an installed app.
 */
export function InstallApp() {
  const { d } = useI18n();
  const [event, setEvent] = useState<BeforeInstallPromptEvent | null>(null);
  const [platform, setPlatform] = useState<"ios" | "android" | "other">("other");
  const [installed, setInstalled] = useState(false);

  useEffect(() => {
    const standalone = window.matchMedia("(display-mode: standalone)").matches || (navigator as { standalone?: boolean }).standalone === true;
    setInstalled(standalone);
    const ua = navigator.userAgent;
    // iPadOS reports itself as a Mac; touch points give it away.
    const isIos = /iphone|ipad|ipod/i.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
    setPlatform(isIos ? "ios" : /android/i.test(ua) ? "android" : "other");
    const onPrompt = (e: Event) => {
      e.preventDefault();
      setEvent(e as BeforeInstallPromptEvent);
    };
    const onInstalled = () => setInstalled(true);
    window.addEventListener("beforeinstallprompt", onPrompt);
    window.addEventListener("appinstalled", onInstalled);
    return () => {
      window.removeEventListener("beforeinstallprompt", onPrompt);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);

  if (installed) return null;
  if (event) {
    return (
      <Button
        type="button"
        className="w-full"
        onClick={async () => {
          await event.prompt();
          const choice = await event.userChoice;
          if (choice.outcome === "accepted") setInstalled(true);
          setEvent(null);
        }}
      >
        <Download /> {d.app.install}
      </Button>
    );
  }
  if (platform === "ios") {
    return (
      <p className="flex items-start gap-2 rounded-xl border bg-card/60 p-3 text-xs text-muted-foreground">
        <Share className="mt-0.5 h-4 w-4 shrink-0" /> {d.app.iosHint}
      </p>
    );
  }
  // Other desktop browsers (Firefox, Safari on macOS) have no install menu item.
  if (platform !== "android") return null;
  return <p className="rounded-xl border bg-card/60 p-3 text-xs text-muted-foreground">{d.app.androidHint}</p>;
}
