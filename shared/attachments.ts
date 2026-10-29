import { z } from "zod";
import { providers } from "./scene";
type Provider = (typeof providers)[number];
/** Reference material a creator can attach to an assistant or coding request. */
export const attachmentKinds = ["pdf", "image", "video", "markdown"] as const;
export type AttachmentKind = (typeof attachmentKinds)[number];
export type Attachment = {
  id: string;
  /** Original file name, cleaned for display. */
  name: string;
  kind: AttachmentKind;
  mime: string;
  size: number;
  /** Local studio URL for previews. */
  url: string;
};
export const maxAttachments = 6;
/** Per-kind byte limits. Markdown is inlined as text, so it stays small. */
export const attachmentLimits: Record<AttachmentKind, number> = {
  pdf: 20 * 1024 * 1024,
  image: 10 * 1024 * 1024,
  video: 50 * 1024 * 1024,
  markdown: 100 * 1024,
};
export const attachmentExtensions: Record<AttachmentKind, string[]> = {
  pdf: [".pdf"],
  image: [".png", ".jpg", ".jpeg", ".gif", ".webp"],
  video: [".mp4", ".m4v", ".webm", ".mov"],
  markdown: [".md", ".markdown"],
};
/** The browser file picker's accept list. */
export const attachmentAccept = Object.values(attachmentExtensions)
  .flat()
  .join(",");
export const attachmentKindLabel: Record<AttachmentKind, string> = {
  pdf: "PDF",
  image: "Image",
  video: "Video",
  markdown: "Markdown",
};
/**
 * Which attachment kinds each provider adapter can receive. Markdown is always
 * inlined as text. Image file parts work everywhere. PDF file parts are
 * supported by the native OpenAI, Anthropic and Google adapters and by
 * OpenRouter; video file parts only by Google models. Unsupported kinds fail
 * before any paid request instead of being silently dropped.
 */
export const attachmentSupport: Record<Provider, AttachmentKind[]> = {
  openai: ["image", "pdf", "markdown"],
  anthropic: ["image", "pdf", "markdown"],
  google: ["image", "pdf", "video", "markdown"],
  xai: ["image", "markdown"],
  kimi: ["image", "markdown"],
  openrouter: ["image", "pdf", "markdown"],
};
export function unsupportedAttachments(
  provider: Provider | null,
  attachments: Pick<Attachment, "kind" | "name">[],
) {
  if (!provider) return [];
  return attachments.filter(
    (a) => !attachmentSupport[provider].includes(a.kind),
  );
}
/** Why these attachments cannot be sent to the provider, or "" when they can. */
export function unsupportedAttachmentMessage(
  provider: Provider | null,
  attachments: Pick<Attachment, "kind" | "name">[],
) {
  const unsupported = unsupportedAttachments(provider, attachments);
  if (!unsupported.length || !provider) return "";
  const kinds = [...new Set(unsupported.map((a) => a.kind))];
  return `${kinds.map((k) => attachmentKindLabel[k]).join(" and ")} attachments cannot be sent to ${provider} models (${unsupported.map((a) => a.name).join(", ")}). ${
    kinds.includes("video")
      ? "Video needs a Google model. "
      : "PDFs need an OpenAI, Anthropic, Google or OpenRouter model. "
  }Remove the file or switch the assistant model.`;
}
export const attachmentSchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(1).max(120),
  kind: z.enum(attachmentKinds),
  mime: z.string().min(1).max(100),
  size: z.number().int().min(1),
  url: z.string().regex(/^\/attachments\/[a-f0-9-]{36}\.[a-z0-9]+$/),
});
export const attachmentIdsSchema = z
  .array(z.string().uuid())
  .max(maxAttachments)
  .default([]);
export function formatAttachmentSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
/** A short line listing attachments, used in chat history and task titles. */
export function describeAttachments(
  attachments: Pick<Attachment, "name" | "kind">[],
) {
  return attachments.length
    ? `Attached: ${attachments.map((a) => `${a.name} (${attachmentKindLabel[a.kind]})`).join(", ")}`
    : "";
}
