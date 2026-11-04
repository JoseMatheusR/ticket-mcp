import { TicketApiError } from "./client.js";
import type { MediaKind } from "./client.js";

export const MAX_ATTACHMENTS = 5;
export const MAX_ATTACHMENT_BYTES = 5 * 1024 * 1024;

const IMAGE_MIMES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/heic",
  "image/heif",
]);

const VIDEO_MIMES = new Set(["video/mp4", "video/webm", "video/quicktime"]);

const ATTACHMENT_MIMES = new Set([
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.ms-powerpoint",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  "text/plain",
  "text/csv",
  "application/zip",
  "application/x-zip-compressed",
]);

export function mediaKind(mimeType: string, fileName: string): MediaKind {
  const mime = mimeType.trim().toLowerCase();
  if (IMAGE_MIMES.has(mime)) return "image";
  if (VIDEO_MIMES.has(mime)) return "video";
  if (mime.startsWith("audio/")) return "audio";
  if (ATTACHMENT_MIMES.has(mime)) return "attachment";
  throw new TicketApiError(
    `Tipo de mídia não suportado: ${mime || fileName || "desconhecido"}`,
    400,
    "INVALID_MEDIA",
  );
}
