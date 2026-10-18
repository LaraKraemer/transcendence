import { createWriteStream, unlink } from "node:fs";
import { mkdir, readFile, rename } from "node:fs/promises";
import { join } from "node:path";
import { Writable } from "node:stream";

import busboy from "busboy";
import type { Request } from "express";

import { isJpegOrPng } from "./validation.ts";

const MAX_AVATAR_SIZE_BYTES = 5 * 1024 * 1024;

/** Returns the directory where avatar files are stored. */
export function avatarDir(): string {
  return process.env["AVATAR_DIR"] ?? "/app/avatars";
}

/** Parses a multipart upload and returns the validated image buffer and MIME type.
 *  Throws with a `status` property for 400 (no/multiple files), 413 (too large), 415 (not JPEG/PNG). */
export async function parseAvatarUpload(
  req: Request,
): Promise<{ buffer: Buffer; mimeType: "image/jpeg" | "image/png" }> {
  return new Promise((resolve, reject) => {
    const bb = busboy({ headers: req.headers, limits: { files: 1, fileSize: MAX_AVATAR_SIZE_BYTES } });
    let fileReceived = false;

    bb.on("file", (_field, fileStream, _info) => {
      fileReceived = true;
      const chunks: Buffer[] = [];
      let truncated = false;

      fileStream.on("limit", () => {
        truncated = true;
        fileStream.resume();
      });

      fileStream.on("data", (chunk: Buffer) => chunks.push(chunk));

      fileStream.on("end", () => {
        if (truncated) {
          const err = Object.assign(new Error("File exceeds 5 MiB limit"), { status: 413 });
          return reject(err);
        }
        const buffer = Buffer.concat(chunks);
        const mimeType = isJpegOrPng(buffer);
        if (!mimeType) {
          return reject(Object.assign(new Error("Only JPEG and PNG images are accepted"), { status: 415 }));
        }
        resolve({ buffer, mimeType });
      });
    });

    bb.on("finish", () => {
      if (!fileReceived) {
        reject(Object.assign(new Error("No image file provided"), { status: 400 }));
      }
    });

    bb.on("error", (err: Error) => reject(err));

    req.pipe(bb as unknown as Writable);
  });
}

/** Writes a buffer to the avatar directory under the given key, using an atomic tmp+rename. */
export async function writeAvatar(key: string, data: Buffer): Promise<void> {
  const dir = avatarDir();
  await mkdir(dir, { recursive: true });
  const tmpPath = join(dir, `${key}.tmp`);
  const finalPath = join(dir, key);

  await new Promise<void>((resolve, reject) => {
    const ws = createWriteStream(tmpPath);
    ws.on("finish", resolve);
    ws.on("error", reject);
    ws.end(data);
  });

  await rename(tmpPath, finalPath);
}

/** Returns the buffer for a stored avatar, or null if the file does not exist. */
export async function readAvatar(key: string): Promise<Buffer | null> {
  try {
    return await readFile(join(avatarDir(), key));
  } catch {
    return null;
  }
}

/** Deletes a stored avatar; resolves even if the file does not exist. */
export async function deleteAvatar(key: string): Promise<void> {
  return new Promise((resolve) => {
    unlink(join(avatarDir(), key), () => resolve());
  });
}
