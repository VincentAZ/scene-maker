/** How an attached file reaches the model. */
export type AttachmentKind =
  "image" | "pdf" | "text" | "audio" | "video" | "file";
/** A file attached to a chat message, as stored and shown in the transcript. */
export type Attachment = {
  /** Random hex identifier; also the attachment's directory name on disk. */
  id: string;
  /** Sanitised file name, safe to use as a path segment. */
  name: string;
  mediaType: string;
  size: number;
  kind: AttachmentKind;
};
const MB = 1024 * 1024;
export const ATTACHMENT_LIMITS = {
  /** Largest single file accepted by the Code panel. */
  fileBytes: 100 * MB,
  /** Files per message. */
  perMessage: 10,
  /** Images up to this size are sent as they are; larger ones are downscaled. */
  imageInlineBytes: 5 * MB,
  /** PDFs up to this size are sent as documents to providers that read them. */
  pdfInlineBytes: 20 * MB,
  /** Text files are inlined up to this many bytes; the rest stays on disk. */
  textInlineBytes: 100_000,
  /** Studio assistant: reference images per message and size after downscaling. */
  assistantImages: 4,
  assistantImageBytes: 4 * MB,
} as const;
/** Raster formats every multimodal provider accepts. */
export const MODEL_IMAGE_TYPES = [
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
] as const;
export const attachmentIdPattern = /^[a-f0-9]{24}$/;
export function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < MB)
    return `${(bytes / 1024).toFixed(bytes < 10 * 1024 ? 1 : 0)} KB`;
  return `${(bytes / MB).toFixed(bytes < 10 * MB ? 1 : 0)} MB`;
}
