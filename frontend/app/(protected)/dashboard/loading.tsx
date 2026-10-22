import { useTranslations } from "next-intl";

const cardClassName = "rounded-lg border border-border bg-card p-[18px] sm:p-6";
const lineClassName = "rounded-md bg-muted";

export default function DashboardLoading() {
  const t = useTranslations("dashboard");
  return (
    <div className="mx-auto w-full max-w-6xl pt-2" aria-busy="true">
      <p role="status" className="sr-only">
        {t("loading")}
      </p>
      <div aria-hidden className="animate-pulse motion-reduce:animate-none">
        <div className="mb-[18px] sm:mb-6">
          <div className={`h-5 w-40 sm:h-8 sm:w-64 ${lineClassName}`} />
          <div className={`mt-2 h-3.5 w-52 sm:w-72 ${lineClassName}`} />
        </div>
        <div className="grid grid-cols-1 items-start gap-3.5 sm:gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(0,1.18fr)]">
          <div className="flex flex-col gap-3.5 sm:gap-6">
            <div className={cardClassName}>
              <div className={`h-3.5 w-40 ${lineClassName}`} />
              <div className={`mt-3 h-10 w-48 ${lineClassName}`} />
              <div className={`mt-4 h-3.5 w-full ${lineClassName}`} />
            </div>
            <div className={cardClassName}>
              <div className={`h-4 w-36 ${lineClassName}`} />
              <div className="mt-5 grid grid-cols-2 gap-5">
                <div className={`h-14 ${lineClassName}`} />
                <div className={`h-14 ${lineClassName}`} />
              </div>
            </div>
          </div>
          <div className={cardClassName}>
            <div className={`h-4 w-44 ${lineClassName}`} />
            {[0, 1, 2, 3].map((row) => (
              <div key={row} className={`mt-5 h-9 ${lineClassName}`} />
            ))}
          </div>
        </div>
        <div className={`mt-3.5 sm:mt-6 ${cardClassName}`}>
          <div className={`h-4 w-40 ${lineClassName}`} />
          {[0, 1, 2].map((row) => (
            <div key={row} className={`mt-5 h-9 ${lineClassName}`} />
          ))}
        </div>
      </div>
    </div>
  );
}
