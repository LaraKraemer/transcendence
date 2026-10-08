"use client";

import { useTranslations } from "next-intl";

import { MIN_PASSWORD_LENGTH } from "@/lib/validation";

type Strength = { score: 1 | 2 | 3; label: "tooShort" | "good" | "strong"; barClass: string; textClass: string };

function estimateStrength(password: string): Strength {
  if (password.length < MIN_PASSWORD_LENGTH) {
    return { score: 1, label: "tooShort", barClass: "bg-destructive", textClass: "text-destructive" };
  }
  const classes = [/[a-z]/, /[A-Z]/, /\d/, /[^A-Za-z0-9]/].filter((re) => re.test(password)).length;
  if (password.length >= 16 && classes >= 3) {
    return { score: 3, label: "strong", barClass: "bg-success", textClass: "text-success" };
  }
  return { score: 2, label: "good", barClass: "bg-success", textClass: "text-success" };
}

export function PasswordStrength({ password }: { password: string }) {
  const t = useTranslations("auth.strength");
  if (!password) return null;

  const { score, label, barClass, textClass } = estimateStrength(password);

  return (
    <div aria-live="polite">
      <div className="mt-2.5 mb-1.5 flex gap-1.5" aria-hidden>
        {[1, 2, 3].map((segment) => (
          <span key={segment} className={`h-1 flex-1 rounded-[3px] ${segment <= score ? barClass : "bg-border"}`} />
        ))}
      </div>
      <div className={`text-xs font-semibold ${textClass}`}>{t(label)}</div>
    </div>
  );
}
