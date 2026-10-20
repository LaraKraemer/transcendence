import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

/** Returns the directory where avatar files are stored. */
export function avatarDir(): string {
  return process.env["AVATAR_DIR"] ?? "/app/avatars";
}

/** Writes a buffer to the avatar directory under the given key, using an atomic tmp+rename. */
export async function writeAvatar(key: string, data: Buffer): Promise<void> {
  const directory = avatarDir();
  await mkdir(directory, { recursive: true });
  const temporaryPath = join(directory, `${key}.tmp`);

  await writeFile(temporaryPath, data);
  await rename(temporaryPath, join(directory, key));
}

/** Returns the buffer for a stored avatar, or null if the file does not exist. */
export async function readAvatar(key: string): Promise<Buffer | null> {
  try {
    return await readFile(join(avatarDir(), key));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

/** Deletes a stored avatar; resolves even if the file does not exist. */
export async function deleteAvatar(key: string): Promise<void> {
  await rm(join(avatarDir(), key), { force: true });
}
