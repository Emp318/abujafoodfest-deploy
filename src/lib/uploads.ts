/**
 * Upload helpers.
 * - On Vercel (BLOB_READ_WRITE_TOKEN set): files go to Vercel Blob and the full https URL is stored.
 * - Locally (no token): files go to public/uploads and are served as /uploads/<filename>.
 */
import fs from "fs";
import { put, del } from "@vercel/blob";
import path from "path";
import { randomBytes } from "crypto";

const UPLOAD_DIR = path.join(process.cwd(), "public", "uploads");

const ALLOWED_MIME: Record<string, string> = {
  "image/jpeg": ".jpg",
  "image/jpg": ".jpg",
  "image/png": ".png",
  "image/webp": ".webp",
  "image/gif": ".gif",
};

const MAX_BYTES = 5 * 1024 * 1024; // 5 MB

export function ensureUploadDir(): void {
  if (!fs.existsSync(UPLOAD_DIR)) {
    fs.mkdirSync(UPLOAD_DIR, { recursive: true });
  }
}

function extensionFor(file: File): string | null {
  const fromMime = ALLOWED_MIME[file.type.toLowerCase()];
  if (fromMime) return fromMime;
  const name = (file.name || "").toLowerCase();
  const match = name.match(/\.(jpe?g|png|webp|gif)$/);
  return match ? `.${match[1] === "jpeg" ? "jpg" : match[1]}` : null;
}

/**
 * Save an uploaded image to public/uploads.
 * Returns the public path e.g. `/uploads/abc123.jpg`
 */
export async function saveUploadedImage(file: File): Promise<{
  ok: boolean;
  publicPath?: string;
  filename?: string;
  error?: string;
}> {
  if (!file || !(file instanceof File) || file.size === 0) {
    return { ok: false, error: "No file provided." };
  }
  if (file.size > MAX_BYTES) {
    return { ok: false, error: "Image must be 5 MB or smaller." };
  }
  const ext = extensionFor(file);
  if (!ext) {
    return { ok: false, error: "Only JPEG, PNG, WebP and GIF images are allowed." };
  }

  const filename = `${Date.now()}-${randomBytes(6).toString("hex")}${ext}`;

  if (process.env.BLOB_READ_WRITE_TOKEN) {
    try {
      const blob = await put(`uploads/${filename}`, file, {
        access: "public",
        addRandomSuffix: false,
      });
      return { ok: true, publicPath: blob.url, filename };
    } catch (e) {
      console.error("Blob upload failed", e);
      return { ok: false, error: "Image upload failed. Please try again." };
    }
  }

  ensureUploadDir();
  const diskPath = path.join(UPLOAD_DIR, filename);
  const buffer = Buffer.from(await file.arrayBuffer());
  fs.writeFileSync(diskPath, buffer);

  return { ok: true, publicPath: `/uploads/${filename}`, filename };
}

/**
 * Delete a local upload if the src points at /uploads/...
 * External URLs (Unsplash etc.) are left alone.
 */
export async function deleteLocalUpload(src: string | null | undefined): Promise<void> {
  if (!src || typeof src !== "string") return;
  // Vercel Blob files
  if (src.includes(".public.blob.vercel-storage.com/")) {
    try {
      await del(src);
    } catch (e) {
      console.error("deleteBlobUpload", e);
    }
    return;
  }
  // Only delete files under our uploads folder
  if (!src.startsWith("/uploads/")) return;
  const filename = path.basename(src);
  if (!filename || filename.includes("..") || filename === ".gitkeep") return;
  const diskPath = path.join(UPLOAD_DIR, filename);
  try {
    if (fs.existsSync(diskPath)) {
      fs.unlinkSync(diskPath);
    }
  } catch (e) {
    console.error("deleteLocalUpload", e);
  }
}

export function isLocalUpload(src: string): boolean {
  return (
    typeof src === "string" &&
    (src.startsWith("/uploads/") || src.includes(".public.blob.vercel-storage.com/"))
  );
}
