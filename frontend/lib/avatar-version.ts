/**
 * When the profile photo last changed in this browser. The photo actions in
 * lib/actions/profile.ts write it after an upload or removal; `getCurrentUser`
 * appends it to `avatarUrl`, so a replaced photo gets a new URL instead of the
 * cached one. Kept out of the "use server" file, which may only export actions.
 */
export const AVATAR_VERSION_COOKIE = "avatarVersion";
