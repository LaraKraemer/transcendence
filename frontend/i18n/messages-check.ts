import type de from "@/messages/de.json";
import type en from "@/messages/en.json";
import type fa from "@/messages/fa.json";
import type uk from "@/messages/uk.json";

type HasKeysOf<Catalogue extends Reference, Reference> = Catalogue;

export type CataloguesMatchEnglish = [
  HasKeysOf<typeof de, typeof en>,
  HasKeysOf<typeof en, typeof de>,
  HasKeysOf<typeof uk, typeof en>,
  HasKeysOf<typeof en, typeof uk>,
  HasKeysOf<typeof fa, typeof en>,
  HasKeysOf<typeof en, typeof fa>,
];
