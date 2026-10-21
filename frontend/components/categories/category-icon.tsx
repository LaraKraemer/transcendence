import {
  Banknote,
  Briefcase,
  Car,
  Gift,
  HandCoins,
  Heart,
  House,
  Music,
  PiggyBank,
  Plane,
  ShoppingCart,
  Tag,
  TrendingUp,
  Utensils,
  Zap,
  type LucideIcon,
} from "lucide-react";

/**
 * The icons the category form offers, stored in the backend as their Lucide
 * key. A short fixed list keeps the bundle small (no import of all icons).
 * The order is the picker's 5-column grid: two rows of expenses, then income.
 * Keys are stored on existing categories, so never rename or remove one.
 */
export const CATEGORY_ICONS = {
  "shopping-cart": ShoppingCart,
  utensils: Utensils,
  home: House,
  car: Car,
  zap: Zap,
  heart: Heart,
  plane: Plane,
  music: Music,
  gift: Gift,
  tag: Tag,
  briefcase: Briefcase,
  banknote: Banknote,
  "trending-up": TrendingUp,
  "hand-coins": HandCoins,
  "piggy-bank": PiggyBank,
} satisfies Record<string, LucideIcon>;

export type CategoryIconKey = keyof typeof CATEGORY_ICONS;
export const CATEGORY_ICON_KEYS = Object.keys(CATEGORY_ICONS) as CategoryIconKey[];

export function isCategoryIconKey(value: string): value is CategoryIconKey {
  return Object.hasOwn(CATEGORY_ICONS, value);
}

/**
 * Renders a category's icon. The backend accepts any text, so a value that
 * isn't one of our keys (an emoji, or a key from another client) is shown as
 * plain text instead.
 */
export function CategoryIcon({ icon, size = 17 }: { icon: string; size?: number }) {
  if (!isCategoryIconKey(icon)) {
    return (
      // Inherits the tile's readable colour (see readableOn).
      <span aria-hidden className="max-w-full truncate text-sm leading-none">
        {icon}
      </span>
    );
  }
  const Icon = CATEGORY_ICONS[icon];
  return <Icon size={size} aria-hidden />;
}
