"use client";

import { useTranslations } from "next-intl";
import { useCallback, useEffect, useState, type FormEvent } from "react";

import { Card } from "@/components/ui/card";
import { FormAlert } from "@/components/ui/form-alert";
import { useAnnounce } from "@/components/ui/live-status";
import { ApiError, fetchApi } from "@/lib/api";
import { isEmail, MAX_EMAIL_LENGTH } from "@/lib/validation";

type Connection = { id: string; user: { id: string; displayName: string; email: string } };
type Friend = Connection & { online: boolean };
type FriendLists = { friends: Friend[]; incoming: Connection[]; outgoing: Connection[] };
const pollIntervalMs = 60 * 1000;

/** Mutual requests and approximate presence, refreshed only while this tab is visible. */
export function Friends() {
  const t = useTranslations("profile.friends");
  const announce = useAnnounce();
  const [lists, setLists] = useState<FriendLists | null>(null);
  const [email, setEmail] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(
    async (signal?: AbortSignal) => {
      try {
        const next = await fetchApi<FriendLists>("/friends", { cache: "no-store", signal });
        if (!signal?.aborted) {
          setLists(next);
          setError((current) => (current === t("errors.load") ? "" : current));
        }
      } catch {
        if (!signal?.aborted) setError(t("errors.load"));
      }
    },
    [t],
  );

  useEffect(() => {
    const controller = new AbortController();
    const poll = () => {
      if (document.visibilityState === "visible") void refresh(controller.signal);
    };
    poll();
    const interval = window.setInterval(poll, pollIntervalMs);
    document.addEventListener("visibilitychange", poll);
    return () => {
      controller.abort();
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", poll);
    };
  }, [refresh]);

  async function act(
    path: string,
    method: "POST" | "DELETE",
    doneMessage: string,
    { body, focusId }: { body?: string; focusId?: string } = {},
  ) {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      await fetchApi(path, { method, ...(body ? { body } : {}) });
      if (body) setEmail("");
      await refresh();
      if (focusId) document.getElementById(focusId)?.focus();
      announce(doneMessage);
    } catch (failure) {
      if (failure instanceof ApiError) {
        const code =
          failure.status === 404
            ? body
              ? "noUser"
              : "notFound"
            : failure.status === 409
              ? "conflict"
              : failure.status === 429
                ? "limited"
                : "generic";
        setError(t(`errors.${code}`));
      } else {
        setError(t("errors.network"));
      }
    } finally {
      setBusy(false);
    }
  }

  function request(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const normalizedEmail = email.trim().toLowerCase();
    if (!isEmail(normalizedEmail)) {
      setError(t("errors.invalid"));
      return;
    }
    void act("/friends", "POST", t("announcements.sent"), {
      body: JSON.stringify({ email: normalizedEmail }),
    });
  }

  return (
    <Card as="section" aria-labelledby="friends-heading" className="mt-5 p-[18px] lg:p-6">
      <h2 id="friends-heading" className="text-base font-semibold">
        {t("title")}
      </h2>
      <p className="mt-1 text-sm text-muted-foreground">{t("description")}</p>
      <form onSubmit={request} className="mt-4 flex flex-wrap items-end gap-3">
        <div className="min-w-0 flex-1">
          <label htmlFor="friend-email" className="block text-sm font-medium">
            {t("email")}
          </label>
          <input
            id="friend-email"
            type="email"
            required
            maxLength={MAX_EMAIL_LENGTH}
            autoComplete="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            className="mt-1 w-full rounded-md border border-border bg-background px-3 py-2 text-foreground"
          />
        </div>
        <button
          type="submit"
          aria-disabled={busy}
          className="rounded-md bg-primary px-4 py-2 text-primary-foreground aria-disabled:cursor-not-allowed aria-disabled:opacity-50"
        >
          {t("send")}
        </button>
      </form>
      {error && (
        <div className="mt-3">
          <FormAlert message={error} />
        </div>
      )}
      {!lists ? (
        <p role="status" className="mt-4 text-sm">
          {t("loading")}
        </p>
      ) : (
        <div className="mt-5 grid grid-cols-1 gap-5 md:grid-cols-3">
          <section aria-labelledby="accepted-friends">
            <h3 id="accepted-friends" tabIndex={-1} className="font-semibold">
              {t("accepted")}
            </h3>
            {lists.friends.length === 0 && <p className="mt-2 text-sm text-muted-foreground">{t("empty")}</p>}
            <ul className="mt-2 space-y-3">
              {lists.friends.map((friend) => (
                <li key={friend.id} className="min-w-0 rounded-md border border-border p-3">
                  <Person connection={friend} />
                  <p className="mt-1 text-sm">
                    <span
                      aria-hidden
                      className={`me-1 inline-block size-2 rounded-full ${friend.online ? "bg-green-600" : "bg-muted-foreground"}`}
                    />
                    {friend.online ? t("online") : t("offline")}
                  </p>
                  <Action
                    label={t("remove")}
                    ariaLabel={t("removeNamed", { name: friend.user.displayName })}
                    aria-disabled={busy}
                    onClick={() =>
                      void act(`/friends/${friend.id}`, "DELETE", t("announcements.removed"), {
                        focusId: "accepted-friends",
                      })
                    }
                  />
                </li>
              ))}
            </ul>
          </section>
          <section aria-labelledby="incoming-friends">
            <h3 id="incoming-friends" tabIndex={-1} className="font-semibold">
              {t("incoming")}
            </h3>
            {lists.incoming.length === 0 && <p className="mt-2 text-sm text-muted-foreground">{t("empty")}</p>}
            <ul className="mt-2 space-y-3">
              {lists.incoming.map((connection) => (
                <li key={connection.id} className="min-w-0 rounded-md border border-border p-3">
                  <Person connection={connection} />
                  <Action
                    label={t("accept")}
                    ariaLabel={t("acceptNamed", { name: connection.user.displayName })}
                    aria-disabled={busy}
                    onClick={() =>
                      void act(`/friends/${connection.id}/accept`, "POST", t("announcements.accepted"), {
                        focusId: "incoming-friends",
                      })
                    }
                  />
                  <Action
                    label={t("decline")}
                    ariaLabel={t("declineNamed", { name: connection.user.displayName })}
                    aria-disabled={busy}
                    onClick={() =>
                      void act(`/friends/${connection.id}`, "DELETE", t("announcements.declined"), {
                        focusId: "incoming-friends",
                      })
                    }
                  />
                </li>
              ))}
            </ul>
          </section>
          <section aria-labelledby="outgoing-friends">
            <h3 id="outgoing-friends" tabIndex={-1} className="font-semibold">
              {t("outgoing")}
            </h3>
            {lists.outgoing.length === 0 && <p className="mt-2 text-sm text-muted-foreground">{t("empty")}</p>}
            <ul className="mt-2 space-y-3">
              {lists.outgoing.map((connection) => (
                <li key={connection.id} className="min-w-0 rounded-md border border-border p-3">
                  <Person connection={connection} />
                  <Action
                    label={t("cancel")}
                    ariaLabel={t("cancelNamed", { name: connection.user.displayName })}
                    aria-disabled={busy}
                    onClick={() =>
                      void act(`/friends/${connection.id}`, "DELETE", t("announcements.canceled"), {
                        focusId: "outgoing-friends",
                      })
                    }
                  />
                </li>
              ))}
            </ul>
          </section>
        </div>
      )}
    </Card>
  );
}

function Person({ connection }: { connection: Connection }) {
  return (
    <div className="min-w-0">
      <strong className="block break-words">{connection.user.displayName}</strong>
      <bdi className="block text-sm wrap-anywhere text-muted-foreground">{connection.user.email}</bdi>
    </div>
  );
}

function Action({
  label,
  ariaLabel,
  disabled,
  onClick,
}: {
  label: string;
  ariaLabel: string;
  disabled: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-label={ariaLabel}
      aria-disabled={disabled}
      onClick={onClick}
      className="me-3 mt-2 text-sm font-semibold text-primary underline-offset-2 hover:underline focus-ring aria-disabled:cursor-not-allowed aria-disabled:no-underline aria-disabled:opacity-50 dark:text-accent-foreground"
    >
      {label}
    </button>
  );
}
