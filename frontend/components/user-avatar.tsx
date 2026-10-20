export function initialsOf(displayName: string): string {
  return displayName
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((word) => Array.from(word)[0] ?? "")
    .join("")
    .toUpperCase();
}

/**
 * The user's profile photo, or their initials when there is none. `avatarUrl` is
 * the API path of the photo; the browser sends the session cookie with it because
 * the frontend and API are same-site.
 * `className` sets the size, colours and font of the circle. An empty `alt` marks
 * it decorative, so screen readers skip the initials too.
 */
export function UserAvatar({
  displayName,
  avatarUrl,
  alt,
  className,
}: {
  displayName: string;
  avatarUrl: string | null;
  alt: string;
  className: string;
}) {
  return (
    <span
      aria-hidden={alt === "" || undefined}
      className={`flex shrink-0 items-center justify-center overflow-hidden rounded-full ${className}`}
    >
      {avatarUrl ? (
        // next/image would fetch the photo on the Next server, which has no session cookie.
        // eslint-disable-next-line @next/next/no-img-element
        <img src={`${process.env.NEXT_PUBLIC_API_URL}${avatarUrl}`} alt={alt} className="size-full object-cover" />
      ) : (
        initialsOf(displayName)
      )}
    </span>
  );
}
