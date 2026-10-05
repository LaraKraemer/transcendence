import type { Locale } from "@/i18n/config";
import type messages from "@/messages/en.json";

// Types next-intl against our locales and the English catalogue, so a missing or
// misspelled message key is a compile error rather than a runtime fallback.
declare module "next-intl" {
  interface AppConfig {
    Locale: Locale;
    Messages: typeof messages;
  }
}
