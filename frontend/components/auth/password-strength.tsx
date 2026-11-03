"use client";

import { useTranslations } from "next-intl";

import { StrengthMeter } from "@/components/ui/strength-meter";
import { MIN_PASSWORD_LENGTH } from "@/lib/validation";

type Strength = { score: 1 | 2 | 3; label: "tooShort" | "good" | "strong"; tone: "danger" | "success" };

function estimateStrength(password: string): Strength {
  if (password.length < MIN_PASSWORD_LENGTH) {
    return { score: 1, label: "tooShort", tone: "danger" };
  }
  const classes = [/[a-z]/, /[A-Z]/, /\d/, /[^A-Za-z0-9]/].filter((re) => re.test(password)).length;
  if (password.length >= 16 && classes >= 3) {
    return { score: 3, label: "strong", tone: "success" };
  }
  return { score: 2, label: "good", tone: "success" };
}

export function PasswordStrength({ password }: { password: string }) {
  const t = useTranslations("auth.strength");
  if (!password) return null;

  const { score, label, tone } = estimateStrength(password);
  return <StrengthMeter score={score} label={t(label)} tone={tone} />;
}
