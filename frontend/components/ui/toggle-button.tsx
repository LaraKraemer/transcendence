import { IconButton, type IconButtonProps } from "@/components/ui/icon-button";

type ToggleButtonProps = Omit<IconButtonProps, "aria-pressed" | "onClick"> & {
  pressed: boolean;
  onPressedChange: (pressed: boolean) => void;
};

/**
 * An IconButton that is on or off, e.g. "Show password". The label stays the same in both
 * states; screen readers announce the state from aria-pressed. The icon may change with it.
 */
export function ToggleButton({ pressed, onPressedChange, ...props }: ToggleButtonProps) {
  return <IconButton aria-pressed={pressed} onClick={() => onPressedChange(!pressed)} {...props} />;
}
