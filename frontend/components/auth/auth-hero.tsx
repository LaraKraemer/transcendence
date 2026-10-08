import { TrendingUp } from "lucide-react";
import { getFormatter, getTranslations } from "next-intl/server";
import Link from "next/link";
import type { ReactNode } from "react";

function AuthHero({ title, description, children }: { title: string; description: string; children: ReactNode }) {
  return (
    <div className="flex w-full flex-col bg-(image:--grad-panel) p-12 text-[#e6ecf5]">
      <Link href="/" className="flex items-center gap-2.5 font-bold hover:opacity-80">
        <span className="flex size-[34px] items-center justify-center rounded-[9px] border-[1.5px] border-white/40">
          P
        </span>
        <span className="text-lg">Poolaki</span>
      </Link>
      <div className="mt-auto">
        <h2 className="mb-4 text-4xl leading-[1.12] font-bold tracking-[-0.02em]">{title}</h2>
        <p className="mb-[30px] max-w-[380px] text-[15px] leading-relaxed text-[#e6ecf5]/70">{description}</p>
        <div
          aria-hidden
          className="rounded-2xl bg-card p-5 text-card-foreground shadow-[0_20px_40px_rgba(0,0,0,.22)]"
        >
          {children}
        </div>
      </div>
    </div>
  );
}

function DeltaBadge({ value }: { value: string }) {
  return (
    <span className="flex items-center gap-1 rounded-full bg-success-bg px-2.5 py-[5px] text-xs font-semibold text-success">
      {/* A rising trend reads in the direction of text, so the arrow mirrors in RTL. */}
      <TrendingUp size={13} className="rtl:-scale-x-100" />
      {value}
    </span>
  );
}

const money = { style: "currency", currency: "EUR", signDisplay: "exceptZero" } as const;
const delta = { style: "percent", signDisplay: "always" } as const;

export async function SignInHero() {
  const t = await getTranslations("auth.hero.signIn");
  const format = await getFormatter();

  return (
    <AuthHero title={t("title")} description={t("description")}>
      <div className="mb-1.5 flex items-start justify-between">
        <div>
          <div className="text-xs text-muted-foreground">
            {t("netBalance", { month: format.dateTime(new Date(2026, 7, 15), { month: "long" }) })}
          </div>
          <div className="text-[26px] font-bold text-success">{format.number(1729.55, money)}</div>
        </div>
        <DeltaBadge value={format.number(0.18, delta)} />
      </div>
    </AuthHero>
  );
}

export async function SignUpHero() {
  const t = await getTranslations("auth.hero.signUp");
  const format = await getFormatter();

  return (
    <AuthHero title={t("title")} description={t("description")}>
      <div className="mb-3.5 flex items-start justify-between">
        <div>
          <div className="text-xs text-muted-foreground">{t("thisMonth")}</div>
          <div className="text-2xl font-bold">{format.number(2480.32, { style: "currency", currency: "EUR" })}</div>
        </div>
        <DeltaBadge value={format.number(0.12, delta)} />
      </div>
    </AuthHero>
  );
}
