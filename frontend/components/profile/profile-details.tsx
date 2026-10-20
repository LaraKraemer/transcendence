"use client";

import { Camera, ChevronLeft, Mail, Pencil, UserRound, type LucideIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  startTransition,
  useActionState,
  useEffect,
  useId,
  useRef,
  useState,
  useTransition,
  type ReactNode,
} from "react";

import { FormAlert, useAuthErrorText } from "@/components/auth/form-parts";
import { Button } from "@/components/ui/button";
import { useAnnounce } from "@/components/ui/live-status";
import { Modal } from "@/components/ui/modal";
import { TextField } from "@/components/ui/text-field";
import { UserAvatar } from "@/components/user-avatar";
import { ApiError, fetchApi } from "@/lib/api";
import { AVATAR_VERSION_COOKIE } from "@/lib/avatar-version";
import type { User } from "@/lib/types";
import { MAX_DISPLAY_NAME_LENGTH } from "@/lib/validation";

// The backend's avatar rules (PUT /auth/me/avatar), checked before uploading.
const MAX_AVATAR_BYTES = 5 * 1024 * 1024;
const AVATAR_TYPES = ["image/jpeg", "image/png"];
const avatarVersionMaxAgeSeconds = 60 * 60 * 24 * 365;

// Codes re-translate if the language changes; other backend rejections keep the backend's message.
type PhotoError = { code: "photoType" | "photoTooLarge" | "network" } | { message: string };

function photoErrorFor(error: unknown): PhotoError {
  if (!(error instanceof ApiError)) return { code: "network" };
  if (error.status === 413) return { code: "photoTooLarge" };
  if (error.status === 415) return { code: "photoType" };
  return { message: error.message };
}

/**
 * The profile page body after docs/design/desktop/profile.html: the header card
 * (cover, photo, name, email) and the Personal Information card. Photo changes
 * and the name form call the backend from the browser, then refresh the route,
 * so the header and the app shell re-render with the new user.
 */
export function ProfileDetails({ user }: { user: User }) {
  const t = useTranslations();
  const router = useRouter();
  const announce = useAnnounce();
  const [isEditingName, setIsEditingName] = useState(false);
  const [isSavingName, setIsSavingName] = useState(false);
  const [photoError, setPhotoError] = useState<PhotoError | null>(null);
  const [isPhotoPending, startPhotoTransition] = useTransition();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const cameraButtonRef = useRef<HTMLButtonElement>(null);

  function runPhotoRequest(request: () => Promise<unknown>, doneMessage: string) {
    setPhotoError(null);
    startPhotoTransition(async () => {
      try {
        await request();
      } catch (error) {
        setPhotoError(photoErrorFor(error));
        return;
      }
      // ponytail: only this browser learns about the new photo; another device keeps the
      // old one until its cache revalidates. Upgrade: a version in the backend's avatarUrl.
      document.cookie = `${AVATAR_VERSION_COOKIE}=${Date.now()}; path=/; max-age=${avatarVersionMaxAgeSeconds}; samesite=lax`;
      startPhotoTransition(() => router.refresh());
      announce(doneMessage);
      // "Remove photo" disappears with the photo, so focus needs a new home.
      cameraButtonRef.current?.focus();
    });
  }

  function uploadPhoto(file: File) {
    if (!AVATAR_TYPES.includes(file.type)) return setPhotoError({ code: "photoType" });
    if (file.size > MAX_AVATAR_BYTES) return setPhotoError({ code: "photoTooLarge" });
    // The backend takes the raw image; fetch sends the file's type as its Content-Type.
    runPhotoRequest(
      () => fetchApi("/auth/me/avatar", { method: "PUT", body: file }),
      t("profile.announcements.photoUpdated"),
    );
  }

  return (
    <div className="mx-auto w-full max-w-6xl pt-2">
      <div className="flex flex-wrap items-start gap-4 lg:mb-6">
        {/* The mobile design has no page title, only the cover with a back button. */}
        <div className="min-w-0 max-lg:sr-only">
          <h1 className="text-[26px] font-bold tracking-[-0.02em]">{t("nav.profile")}</h1>
          <p className="mt-1 text-sm text-muted-foreground">{t("profile.subtitle")}</p>
        </div>
        <button
          type="button"
          onClick={() => setIsEditingName(true)}
          className="ms-auto flex shrink-0 cursor-pointer items-center gap-[7px] rounded-[10px] bg-primary px-[18px] py-[11px] text-sm font-semibold text-primary-foreground hover:opacity-90 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background focus-visible:outline-none max-lg:hidden"
        >
          <Pencil size={15} aria-hidden />
          {t("profile.editProfile")}
        </button>
      </div>

      <section className="mb-5 overflow-hidden rounded-lg border border-border bg-card">
        <div className="relative h-[110px] bg-(image:--grad) lg:h-[120px]">
          {/* Mobile only: the More tab is where profile is opened from on small screens. */}
          <Link
            href="/more"
            className="absolute start-4 top-4 flex size-9 items-center justify-center rounded-[10px] bg-white/15 text-white transition-opacity hover:opacity-80 focus-visible:ring-2 focus-visible:ring-white focus-visible:outline-none lg:hidden"
          >
            <ChevronLeft size={18} aria-hidden className="rtl:-scale-x-100" />
            <span className="sr-only">{t("nav.back")}</span>
          </Link>
        </div>
        <div className="flex flex-col items-start gap-3 px-4 pt-[18px] pb-[22px] lg:flex-row lg:gap-[22px] lg:px-7">
          <div className="relative -mt-14 shrink-0 lg:-mt-16">
            <UserAvatar
              displayName={user.displayName}
              avatarUrl={user.avatarUrl}
              alt={t("profile.photoAlt", { name: user.displayName })}
              className="size-20 border-4 border-card bg-primary text-[26px] font-bold text-primary-foreground shadow-[0_10px_28px_rgba(8,14,25,.3)] lg:size-[104px] lg:text-[32px]"
            />
            <button
              ref={cameraButtonRef}
              type="button"
              // aria-disabled, not disabled: a disabled button drops keyboard focus mid-upload.
              aria-disabled={isPhotoPending}
              onClick={() => !isPhotoPending && fileInputRef.current?.click()}
              aria-label={t("profile.changePhoto")}
              title={t("profile.changePhoto")}
              className="absolute end-0.5 bottom-0.5 flex size-8 cursor-pointer items-center justify-center rounded-full bg-card text-primary shadow-[0_3px_10px_rgba(8,14,25,.28)] hover:opacity-90 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-card focus-visible:outline-none aria-disabled:cursor-wait aria-disabled:opacity-60 dark:text-accent-foreground"
            >
              <Camera size={16} aria-hidden />
            </button>
            <input
              ref={fileInputRef}
              type="file"
              accept={AVATAR_TYPES.join(",")}
              hidden
              onChange={(event) => {
                const file = event.target.files?.[0];
                // Cleared, so picking the same file again after an error fires onChange again.
                event.target.value = "";
                if (file) uploadPhoto(file);
              }}
            />
          </div>
          <div className="min-w-0 flex-1 lg:pt-1.5">
            <div className="text-lg font-bold break-words lg:text-[22px]">{user.displayName}</div>
            <div className="mt-0.5 truncate text-xs text-muted-foreground lg:mt-[5px] lg:text-sm">
              <bdi>{user.email}</bdi>
            </div>
            {user.avatarUrl && (
              <button
                type="button"
                aria-disabled={isPhotoPending}
                onClick={() =>
                  !isPhotoPending &&
                  runPhotoRequest(
                    () => fetchApi("/auth/me/avatar", { method: "DELETE" }),
                    t("profile.announcements.photoRemoved"),
                  )
                }
                className="mt-3 cursor-pointer rounded-[6px] text-[13px] font-semibold text-destructive hover:opacity-80 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none aria-disabled:cursor-wait aria-disabled:opacity-60"
              >
                {t("profile.removePhoto")}
              </button>
            )}
            {photoError && (
              <div className="mt-3">
                <FormAlert
                  message={"code" in photoError ? t(`profile.errors.${photoError.code}`) : photoError.message}
                />
              </div>
            )}
          </div>
        </div>
      </section>

      <section
        aria-labelledby="personal-info"
        className="rounded-lg border border-border bg-card p-[18px] lg:max-w-[60%] lg:p-6"
      >
        <div className="mb-1.5 flex items-center gap-3">
          <h2 id="personal-info" className="text-base font-semibold">
            {t("profile.personalInfo")}
          </h2>
          <button
            type="button"
            onClick={() => setIsEditingName(true)}
            className="ms-auto flex cursor-pointer items-center gap-[5px] rounded-[6px] text-[13px] font-semibold text-primary hover:opacity-80 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none dark:text-accent-foreground"
          >
            <Pencil size={13} aria-hidden />
            {t("profile.edit")}
          </button>
        </div>
        <div>
          <InfoRow icon={UserRound} label={t("profile.name")}>
            {user.displayName}
          </InfoRow>
          <InfoRow icon={Mail} label={t("profile.email")}>
            <bdi>{user.email}</bdi>
          </InfoRow>
        </div>
      </section>

      <Modal
        open={isEditingName}
        title={t("profile.nameDialog.title")}
        onClose={() => setIsEditingName(false)}
        busy={isSavingName}
      >
        {/* Mounted only while open, so reopening starts from the saved name without old errors. */}
        {isEditingName && (
          <NameForm
            displayName={user.displayName}
            onDone={() => setIsEditingName(false)}
            onPendingChange={setIsSavingName}
          />
        )}
      </Modal>
    </div>
  );
}

function InfoRow({ icon: Icon, label, children }: { icon: LucideIcon; label: string; children: ReactNode }) {
  return (
    <div className="flex items-center gap-3 border-b border-border py-[11px] last:border-b-0 lg:gap-3.5 lg:py-3.5">
      <span className="flex size-[38px] shrink-0 items-center justify-center rounded-[10px] bg-muted text-muted-foreground">
        <Icon size={17} aria-hidden />
      </span>
      <div className="min-w-0">
        <div className="text-[11px] font-semibold tracking-[.05em] text-muted-foreground uppercase">{label}</div>
        <div className="mt-0.5 truncate text-[13px] font-medium lg:text-sm">{children}</div>
      </div>
    </div>
  );
}

type NameFormState = {
  // A backend 400 carries its own validation message.
  fieldError: "displayNameRequired" | "displayNameTooLong" | { message: string } | null;
  error: "network" | "generic" | null;
};

const initialNameState: NameFormState = { fieldError: null, error: null };

/** Display-name form in the edit dialog: saves with `PATCH /auth/me`. */
function NameForm({
  displayName,
  onDone,
  onPendingChange,
}: {
  displayName: string;
  onDone: () => void;
  onPendingChange: (pending: boolean) => void;
}) {
  const t = useTranslations();
  const errorText = useAuthErrorText();
  const router = useRouter();
  const announce = useAnnounce();
  const fieldId = useId();
  const [value, setValue] = useState(displayName);

  const [{ fieldError, error }, submitAction, isPending] = useActionState(
    async (_prev: NameFormState, submitted: string): Promise<NameFormState> => {
      const nextName = submitted.trim();
      if (!nextName) return { fieldError: "displayNameRequired", error: null };
      if (nextName.length > MAX_DISPLAY_NAME_LENGTH) return { fieldError: "displayNameTooLong", error: null };
      try {
        await fetchApi("/auth/me", { method: "PATCH", body: JSON.stringify({ displayName: nextName }) });
      } catch (error) {
        if (!(error instanceof ApiError)) return { fieldError: null, error: "network" };
        return error.status === 400
          ? { fieldError: { message: error.message }, error: null }
          : { fieldError: null, error: "generic" };
      }
      router.refresh();
      announce(t("profile.announcements.nameSaved"));
      onDone();
      return initialNameState;
    },
    initialNameState,
  );

  useEffect(() => onPendingChange(isPending), [isPending, onPendingChange]);

  // After a rejected name, put keyboard focus back on the field.
  useEffect(() => {
    if (fieldError) document.getElementById(fieldId)?.focus();
  }, [fieldError, fieldId]);

  return (
    <form
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        startTransition(() => submitAction(value));
      }}
    >
      <fieldset disabled={isPending}>
        <FormAlert message={error && errorText(error)} />
        <TextField
          id={fieldId}
          data-autofocus
          label={t("profile.name")}
          type="text"
          required
          autoComplete="name"
          maxLength={MAX_DISPLAY_NAME_LENGTH}
          value={value}
          onChange={(event) => setValue(event.target.value)}
          error={fieldError ? (typeof fieldError === "string" ? errorText(fieldError) : fieldError.message) : undefined}
        />
        <div className="flex gap-3">
          <Button variant="outline" onClick={onDone}>
            {t("common.cancel")}
          </Button>
          <Button type="submit">{isPending ? t("profile.nameDialog.saving") : t("profile.nameDialog.save")}</Button>
        </div>
      </fieldset>
    </form>
  );
}
