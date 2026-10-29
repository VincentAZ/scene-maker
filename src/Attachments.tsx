import { useEffect, useRef, useState, type RefObject } from "react";
import {
  FileText,
  FileType,
  Film,
  Image as ImageIcon,
  LoaderCircle,
  Paperclip,
  X,
} from "lucide-react";
import { api } from "./api";
import {
  attachmentAccept,
  attachmentExtensions,
  attachmentKindLabel,
  attachmentLimits,
  formatAttachmentSize,
  maxAttachments,
  unsupportedAttachmentMessage,
  type Attachment,
  type AttachmentKind,
} from "../shared/attachments";
import type { Provider } from "../shared/modelChoices";

/** Guess the kind from the file name so oversized files fail before upload. */
export function guessAttachmentKind(name: string): AttachmentKind | null {
  const lower = name.toLowerCase();
  for (const kind of Object.keys(attachmentExtensions) as AttachmentKind[])
    if (attachmentExtensions[kind].some((ext) => lower.endsWith(ext)))
      return kind;
  return null;
}
/** A local reason this file cannot be attached, or "" when it can be uploaded. */
export function attachmentProblem(
  file: { name: string; size: number },
  current: number,
) {
  if (current >= maxAttachments)
    return `Attach up to ${maxAttachments} files per message.`;
  const kind = guessAttachmentKind(file.name);
  if (!kind)
    return `${file.name}: attach a PDF, an image (PNG, JPEG, GIF, WebP), a video (MP4, WebM, MOV) or a Markdown file.`;
  if (file.size < 1) return `${file.name} is empty.`;
  if (file.size > attachmentLimits[kind])
    return `${file.name}: ${attachmentKindLabel[kind]} attachments must be ${formatAttachmentSize(attachmentLimits[kind])} or smaller.`;
  return "";
}
function kindIcon(kind: AttachmentKind, size = 13) {
  return kind === "image" ? (
    <ImageIcon size={size} />
  ) : kind === "video" ? (
    <Film size={size} />
  ) : kind === "pdf" ? (
    <FileType size={size} />
  ) : (
    <FileText size={size} />
  );
}
/** Read-only chips, used in chat history and coding task summaries. */
export function AttachmentChips({
  attachments,
  onRemove,
  disabled,
}: {
  attachments: Attachment[];
  onRemove?: (attachment: Attachment) => void;
  disabled?: boolean;
}) {
  if (!attachments.length) return null;
  return (
    <ul className="attachment-chips" aria-label="Attached files">
      {attachments.map((a) => (
        <li key={a.id} className={`attachment-chip ${a.kind}`}>
          <a
            href={a.url}
            target="_blank"
            rel="noreferrer"
            title={`${a.name} · ${attachmentKindLabel[a.kind]} · ${formatAttachmentSize(a.size)}`}
          >
            {a.kind === "image" ? (
              <img src={a.url} alt="" />
            ) : (
              <span className="attachment-icon">{kindIcon(a.kind)}</span>
            )}
            <span className="attachment-name">{a.name}</span>
            <span className="attachment-meta">
              {attachmentKindLabel[a.kind]} · {formatAttachmentSize(a.size)}
            </span>
          </a>
          {onRemove && (
            <button
              type="button"
              aria-label={`Remove ${a.name}`}
              disabled={disabled}
              onClick={() => onRemove(a)}
            >
              <X size={11} />
            </button>
          )}
        </li>
      ))}
    </ul>
  );
}
/**
 * Attach reference files to a request. Files upload immediately and the
 * parent only keeps the resulting metadata; `dropZone` also accepts dropped
 * and pasted files.
 */
export function AttachmentPicker({
  attachments,
  onChange,
  provider,
  disabled,
  dropZone,
  label = "Attach files",
}: {
  attachments: Attachment[];
  onChange: (next: Attachment[]) => void;
  provider: Provider | null | undefined;
  disabled?: boolean;
  dropZone?: RefObject<HTMLElement | null>;
  label?: string;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState<string[]>([]);
  const [error, setError] = useState("");
  const latest = useRef(attachments);
  latest.current = attachments;
  const busy = useRef(0);
  async function addFiles(files: Iterable<File>) {
    if (disabled) return;
    setError("");
    const problems: string[] = [];
    for (const file of files) {
      const problem = attachmentProblem(
        file,
        latest.current.length + busy.current,
      );
      if (problem) {
        problems.push(problem);
        continue;
      }
      busy.current++;
      setUploading((u) => [...u, file.name]);
      try {
        const form = new FormData();
        form.append("file", file, file.name);
        const saved = await api<Attachment>("/api/attachments", {
          method: "POST",
          body: form,
        });
        latest.current = [...latest.current, saved];
        onChange(latest.current);
      } catch (e) {
        problems.push(`${file.name}: ${(e as Error).message}`);
      } finally {
        busy.current--;
        setUploading((u) => {
          const index = u.indexOf(file.name);
          return index < 0 ? u : [...u.slice(0, index), ...u.slice(index + 1)];
        });
      }
    }
    if (problems.length) setError(problems.join(" "));
  }
  function remove(attachment: Attachment) {
    latest.current = latest.current.filter((a) => a.id !== attachment.id);
    onChange(latest.current);
    void api(`/api/attachments/${attachment.id}`, { method: "DELETE" }).catch(
      () => {},
    );
  }
  useEffect(() => {
    const zone = dropZone?.current;
    if (!zone) return;
    const over = (event: DragEvent) => {
      if (!event.dataTransfer?.types.includes("Files")) return;
      event.preventDefault();
      zone.classList.add("drop-active");
    };
    const leave = () => zone.classList.remove("drop-active");
    const drop = (event: DragEvent) => {
      zone.classList.remove("drop-active");
      if (!event.dataTransfer?.files.length) return;
      event.preventDefault();
      void addFiles(event.dataTransfer.files);
    };
    const paste = (event: ClipboardEvent) => {
      const files = [...(event.clipboardData?.items || [])]
        .filter((item) => item.kind === "file")
        .map((item) => item.getAsFile())
        .filter((file): file is File => !!file)
        .map((file) =>
          // Pasted screenshots are unnamed; give them a usable file name.
          file.name && file.name !== "image.png"
            ? file
            : new File(
                [file],
                `pasted-${Date.now()}.${file.type.split("/")[1] || "png"}`,
                { type: file.type },
              ),
        );
      if (!files.length) return;
      event.preventDefault();
      void addFiles(files);
    };
    zone.addEventListener("dragover", over);
    zone.addEventListener("dragleave", leave);
    zone.addEventListener("drop", drop);
    zone.addEventListener("paste", paste);
    return () => {
      zone.removeEventListener("dragover", over);
      zone.removeEventListener("dragleave", leave);
      zone.removeEventListener("drop", drop);
      zone.removeEventListener("paste", paste);
    };
    // addFiles reads the latest attachments through refs, so the listeners
    // only need re-binding when the zone or disabled state changes.
  }, [dropZone, disabled]);
  const warning = unsupportedAttachmentMessage(provider ?? null, attachments);
  const full = attachments.length + uploading.length >= maxAttachments;
  return (
    <div className="attachment-picker">
      <input
        ref={input}
        type="file"
        hidden
        multiple
        accept={attachmentAccept}
        onChange={(e) => {
          if (e.target.files) void addFiles(e.target.files);
          e.target.value = "";
        }}
      />
      <AttachmentChips
        attachments={attachments}
        onRemove={remove}
        disabled={disabled}
      />
      {!!uploading.length && (
        <p className="attachment-uploading" role="status">
          <LoaderCircle size={12} className="spin" /> Uploading{" "}
          {uploading.join(", ")}…
        </p>
      )}
      {(error || warning) && (
        <p className="attachment-warning" role="alert">
          {error || warning}
        </p>
      )}
      <button
        type="button"
        className="attachment-button"
        aria-label={label}
        title={
          full
            ? `Up to ${maxAttachments} files per message`
            : `${label}: PDF, image, video or Markdown`
        }
        disabled={disabled || full}
        onClick={() => input.current?.click()}
      >
        <Paperclip size={13} />
        <span>
          {attachments.length ? `${attachments.length} attached` : "Attach"}
        </span>
      </button>
    </div>
  );
}
