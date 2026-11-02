"use client";

import { CircleCheck, CircleX, TriangleAlert } from "lucide-react";
import { useFormatter, useTranslations } from "next-intl";
import { useEffect, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { fetchApi } from "@/lib/api";

type Health = "ok" | "degraded" | "down";
type StatusResponse = {
  status: Health;
  components: { database: { status: "ok" | "down" }; storage: { status: "ok" | "down" } };
  lastBackupAt: string | null;
};
const refreshIntervalMs = 30_000;
const requestTimeoutMs = 10_000;

/** Refreshes public health data; failed requests discard stale healthy results. */
export function SystemStatus() {
  const t = useTranslations("systemStatus");
  const format = useFormatter();
  const [result, setResult] = useState<StatusResponse | null>(null);
  const [unreachable, setUnreachable] = useState(false);
  const [paused, setPaused] = useState(false);

  useEffect(() => {
    if (paused) return;
    const controller = new AbortController();
    async function refresh() {
      try {
        const response = await fetchApi<StatusResponse>("/status", {
          cache: "no-store",
          signal: AbortSignal.any([controller.signal, AbortSignal.timeout(requestTimeoutMs)]),
        });
        if (!controller.signal.aborted) {
          setResult(response);
          setUnreachable(false);
        }
      } catch {
        if (!controller.signal.aborted) {
          setResult(null);
          setUnreachable(true);
        }
      }
    }
    void refresh();
    const interval = setInterval(refresh, refreshIntervalMs);
    return () => {
      controller.abort();
      clearInterval(interval);
    };
  }, [paused]);

  function healthBadge(health: Health) {
    const Icon = health === "ok" ? CircleCheck : health === "down" ? CircleX : TriangleAlert;
    return (
      <Badge variant="pill" tone={health === "ok" ? "success" : health === "down" ? "danger" : "warning"}>
        <Icon size={16} aria-hidden className="shrink-0" />
        {t(health)}
      </Badge>
    );
  }

  return (
    <Card as="section" aria-labelledby="system-status-title" className="mx-auto w-full max-w-3xl p-5 sm:p-10">
      <h1 id="system-status-title" className="text-title">
        {t("title")}
      </h1>
      <p role="status" className="mt-2 text-muted-foreground">
        {t(paused ? "paused" : "refresh")}
      </p>
      {(result || unreachable) && (
        <Button variant="outline" className="mt-4" onClick={() => setPaused(!paused)}>
          {t(paused ? "resume" : "pause")}
        </Button>
      )}
      {/* Use the visible results for announcements so reading navigation encounters each result only once. */}
      <div role="status" aria-atomic="true" className="mt-6">
        {unreachable ? (
          <p className="flex items-start gap-2 text-destructive">
            <CircleX size={20} aria-hidden className="shrink-0" />
            {t("unreachable")}
          </p>
        ) : !result ? (
          <p>{t("loading")}</p>
        ) : null}
        {result && (
          <dl className="grid grid-cols-[minmax(0,1fr)_minmax(0,auto)] items-center gap-x-3 gap-y-5">
            <div className="contents">
              <dt className="font-semibold wrap-anywhere">{t("overall")}</dt>
              <dd>{healthBadge(result.status)}</dd>
            </div>
            {(["database", "storage"] as const).map((component) => (
              <div key={component} className="contents">
                <dt className="font-semibold wrap-anywhere">{t(component)}</dt>
                <dd>{healthBadge(result.components[component].status)}</dd>
              </div>
            ))}
            <div className="col-span-2">
              <dt className="font-semibold">{t("lastBackup")}</dt>
              <dd className="mt-1 text-muted-foreground">
                {result.lastBackupAt ? (
                  <time dateTime={result.lastBackupAt}>
                    {format.dateTime(new Date(result.lastBackupAt), {
                      dateStyle: "medium",
                      timeStyle: "short",
                      calendar: "gregory",
                    })}
                  </time>
                ) : (
                  t("noBackup")
                )}
              </dd>
            </div>
          </dl>
        )}
      </div>
    </Card>
  );
}
