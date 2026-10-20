/**
 * When the profile photo last changed in this browser. The profile page writes
 * it client-side after an upload or removal; `getCurrentUser` appends it to
 * `avatarUrl`, so a replaced photo gets a new URL instead of the cached one.
 * Kept free of "use client" so server code can import the value.
 */
export const AVATAR_VERSION_COOKIE = "avatarVersion";
