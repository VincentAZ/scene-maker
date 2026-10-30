import { useCallback, useEffect, useRef, useState } from "react";
import {
  File as FileIcon,
  FileAudio,
  FileText,
  FileVideo,
  Image as ImageIcon,
  Loader2,
  Paperclip,
  X,
} from "lucide-react";
import { api } from "./api";
import {
  ATTACHMENT_LIMITS,
  formatBytes,
  type Attachment,
  type AttachmentKind,
} from "../shared/attachments";

/** A file chosen in a composer, before the message is sent. */
export type PendingAttachment = {
  key: string;
  name: string;
  size: number;
  status: "uploading" | "ready";
  /** Local object or data URL for an image thumbnail. */
  preview?: string;
  kind?: AttachmentKind;
  /** Set once the Code panel upload has finished. */
  attachment?: Attachment;
  /** Studio assistant images: downscaled base64 data, sent with the request. */
  image?: { mediaType: string; data: string };
};
let counter = 0;
const nextKey = () => `a${Date.now().toString(36)}${(counter++).toString(36)}`;
const isImage = (file: File) => file.type.startsWith("image/");
/** Pasted screenshots all arrive as "image.png"; give them distinct names. */
function named(file: File) {
  if (!/^image\.\w+$/.test(file.name)) return file;
  const stamp = new Date().toISOString().slice(0, 19).replace(/[T:]/g, "-");
  return new File([file], `pasted-${stamp}.${file.name.split(".")[1]}`, {
    type: file.type,
  });
}

/**
 * Code panel attachments, kept per draft. Each file uploads as soon as it is
 * chosen so problems show before sending; the message then refers to the
 * uploaded ids.
 */
export function useCodeAttachments(onError: (message: string) => void) {
  const [lists, setLists] = useState<Record<string, PendingAttachment[]>>({});
  const listsRef = useRef(lists);
  listsRef.current = lists;
  const removed = useRef(new Set<string>());
  useEffect(
    () => () => {
      for (const list of Object.values(listsRef.current))
        for (const item of list)
          if (item.preview) URL.revokeObjectURL(item.preview);
    },
    [],
  );
  const update = useCallback(
    (draft: string, fn: (list: PendingAttachment[]) => PendingAttachment[]) =>
      setLists((all) => ({ ...all, [draft]: fn(all[draft] || []) })),
    [],
  );
  const add = useCallback(
    (draft: string, chosen: File[]) => {
      const current = listsRef.current[draft]?.length || 0;
      const room = ATTACHMENT_LIMITS.perMessage - current;
      if (chosen.length > room)
        onError(
          `Attach at most ${ATTACHMENT_LIMITS.perMessage} files per message.`,
        );
      for (const raw of chosen.slice(0, Math.max(0, room))) {
        const file = named(raw);
        if (file.size > ATTACHMENT_LIMITS.fileBytes) {
          onError(
            `“${file.name}” is ${formatBytes(file.size)}; attachments can be up to ${formatBytes(ATTACHMENT_LIMITS.fileBytes)}.`,
          );
          continue;
        }
        const key = nextKey();
        const item: PendingAttachment = {
          key,
          name: file.name,
          size: file.size,
          status: "uploading",
          preview: isImage(file) ? URL.createObjectURL(file) : undefined,
        };
        update(draft, (list) => [...list, item]);
        const body = new FormData();
        body.append("files", file, file.name);
        api<{ attachments: Attachment[] }>("/api/coding/attachments", {
          method: "POST",
          body,
        })
          .then(({ attachments: [attachment] }) => {
            if (removed.current.has(key)) {
              void discard(attachment.id);
              return;
            }
            update(draft, (list) =>
              list.map((i) =>
                i.key === key
                  ? {
                      ...i,
                      status: "ready",
                      attachment,
                      kind: attachment.kind,
                      name: attachment.name,
                    }
                  : i,
              ),
            );
          })
          .catch((e: Error) => {
            if (item.preview) URL.revokeObjectURL(item.preview);
            update(draft, (list) => list.filter((i) => i.key !== key));
            if (!removed.current.has(key))
              onError(`Could not attach “${file.name}”: ${e.message}`);
          });
      }
    },
    [onError, update],
  );
  const remove = useCallback(
    (draft: string, key: string) => {
      const item = listsRef.current[draft]?.find((i) => i.key === key);
      if (!item) return;
      removed.current.add(key);
      if (item.preview) URL.revokeObjectURL(item.preview);
      if (item.attachment) void discard(item.attachment.id);
      update(draft, (list) => list.filter((i) => i.key !== key));
    },
    [update],
  );
  /** Forget a draft's files after they were sent; the server keeps them. */
  const clear = useCallback(
    (draft: string) => {
      for (const item of listsRef.current[draft] || [])
        if (item.preview) URL.revokeObjectURL(item.preview);
      update(draft, () => []);
    },
    [update],
  );
  return {
    list: (draft: string) => lists[draft] || [],
    add,
    remove,
    clear,
  };
}
const discard = (id: string) =>
  api(`/api/coding/attachments/${id}`, { method: "DELETE" }).catch(() => {});

const PREVIEW_PIXELS = 1568;
/** Downscale and re-encode an image in the browser (also drops photo metadata). */
async function encodeImage(file: File) {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(
    1,
    PREVIEW_PIXELS / Math.max(bitmap.width, bitmap.height),
  );
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(bitmap.width * scale));
  canvas.height = Math.max(1, Math.round(bitmap.height * scale));
  canvas.getContext("2d")!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  const encode = (type: string) =>
    new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, type, 0.86));
  let blob = file.type === "image/png" ? await encode("image/png") : null;
  if (!blob || blob.size > ATTACHMENT_LIMITS.assistantImageBytes)
    blob = await encode("image/jpeg");
  if (!blob || blob.size > ATTACHMENT_LIMITS.assistantImageBytes)
    throw Error("it is too large even after downscaling");
  const url = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
  return { mediaType: blob.type, data: url.split(",")[1], preview: url };
}
/** Studio assistant reference images, prepared in the browser and sent inline. */
export function useImageAttachments(onError: (message: string) => void) {
  const [items, setItems] = useState<PendingAttachment[]>([]);
  const itemsRef = useRef(items);
  itemsRef.current = items;
  const add = useCallback(
    (chosen: File[]) => {
      const images = chosen.filter(isImage);
      if (images.length < chosen.length)
        onError(
          "The scene assistant takes images only. Attach other files in the Code panel.",
        );
      const room = ATTACHMENT_LIMITS.assistantImages - itemsRef.current.length;
      if (images.length > room)
        onError(
          `Attach up to ${ATTACHMENT_LIMITS.assistantImages} images per message.`,
        );
      for (const raw of images.slice(0, Math.max(0, room))) {
        const file = named(raw);
        const key = nextKey();
        setItems((list) => [
          ...list,
          {
            key,
            name: file.name,
            size: file.size,
            status: "uploading",
            kind: "image",
          },
        ]);
        encodeImage(file)
          .then(({ preview, ...image }) =>
            setItems((list) =>
              list.map((i) =>
                i.key === key
                  ? {
                      ...i,
                      status: "ready",
                      preview,
                      image,
                      size: image.data.length * 0.75,
                    }
                  : i,
              ),
            ),
          )
          .catch((e: Error) => {
            setItems((list) => list.filter((i) => i.key !== key));
            onError(
              `Could not attach “${file.name}”: ${e.message || "the browser could not read this image"}.`,
            );
          });
      }
    },
    [onError],
  );
  const remove = useCallback(
    (key: string) => setItems((list) => list.filter((i) => i.key !== key)),
    [],
  );
  const clear = useCallback(() => setItems([]), []);
  return { items, add, remove, clear };
}

/** Files from a paste event; text pastes are left alone. */
export function pastedFiles(event: React.ClipboardEvent) {
  return Array.from(event.clipboardData?.files || []);
}
/** Drag-and-drop of files onto a composer. */
export function useFileDrop(
  onFiles: (files: File[]) => void,
  disabled = false,
) {
  const [dragging, setDragging] = useState(false);
  const depth = useRef(0);
  const hasFiles = (e: React.DragEvent) =>
    Array.from(e.dataTransfer?.types || []).includes("Files");
  return {
    dragging,
    handlers: {
      onDragEnter: (e: React.DragEvent) => {
        if (disabled || !hasFiles(e)) return;
        e.preventDefault();
        depth.current += 1;
        setDragging(true);
      },
      onDragOver: (e: React.DragEvent) => {
        if (disabled || !hasFiles(e)) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = "copy";
      },
      onDragLeave: (e: React.DragEvent) => {
        if (!hasFiles(e)) return;
        depth.current = Math.max(0, depth.current - 1);
        if (!depth.current) setDragging(false);
      },
      onDrop: (e: React.DragEvent) => {
        if (!hasFiles(e)) return;
        e.preventDefault();
        depth.current = 0;
        setDragging(false);
        if (!disabled) onFiles(Array.from(e.dataTransfer.files));
      },
    },
  };
}

export function AttachButton({
  onFiles,
  disabled,
  accept,
  label = "Attach files",
  className = "attach-button",
}: {
  onFiles: (files: File[]) => void;
  disabled?: boolean;
  accept?: string;
  label?: string;
  className?: string;
}) {
  const input = useRef<HTMLInputElement>(null);
  return (
    <>
      <button
        type="button"
        className={className}
        title={label}
        aria-label={label}
        disabled={disabled}
        onClick={() => input.current?.click()}
      >
        <Paperclip size={15} />
      </button>
      <input
        ref={input}
        type="file"
        multiple
        hidden
        accept={accept}
        onChange={(e) => {
          const files = Array.from(e.target.files || []);
          e.target.value = "";
          if (files.length) onFiles(files);
        }}
      />
    </>
  );
}
function KindIcon({ kind }: { kind?: AttachmentKind }) {
  const Icon =
    kind === "image"
      ? ImageIcon
      : kind === "audio"
        ? FileAudio
        : kind === "video"
          ? FileVideo
          : kind === "text" || kind === "pdf"
            ? FileText
            : FileIcon;
  return <Icon size={14} aria-hidden />;
}
/** Removable chips for files waiting to be sent. */
export function PendingChips({
  items,
  onRemove,
}: {
  items: PendingAttachment[];
  onRemove: (key: string) => void;
}) {
  if (!items.length) return null;
  return (
    <ul className="attach-chips" aria-label="Attached files">
      {items.map((item) => (
        <li
          key={item.key}
          className={`attach-chip${item.preview ? " has-thumb" : ""}`}
          title={`${item.name} · ${formatBytes(item.size)}`}
        >
          {item.preview ? (
            <img src={item.preview} alt="" />
          ) : (
            <KindIcon kind={item.kind} />
          )}
          <span className="attach-name">{item.name}</span>
          <span className="attach-size">
            {item.status === "uploading" ? (
              <Loader2 size={11} className="spin" aria-label="Uploading" />
            ) : (
              formatBytes(item.size)
            )}
          </span>
          <button
            type="button"
            className="attach-remove"
            aria-label={`Remove ${item.name}`}
            onClick={() => onRemove(item.key)}
          >
            <X size={11} />
          </button>
        </li>
      ))}
    </ul>
  );
}
/** Files sent with a message, shown in the conversation. */
export function SentAttachments({
  attachments,
  href,
}: {
  attachments: Attachment[];
  href: (attachment: Attachment) => string;
}) {
  if (!attachments.length) return null;
  const images = attachments.filter((a) => a.kind === "image");
  const files = attachments.filter((a) => a.kind !== "image");
  return (
    <div className="attach-sent">
      {images.map((a) => (
        <a
          key={a.id}
          className="attach-thumb"
          href={href(a)}
          target="_blank"
          rel="noreferrer"
          title={`${a.name} · ${formatBytes(a.size)}`}
        >
          <img src={href(a)} alt={a.name} loading="lazy" />
        </a>
      ))}
      {files.map((a) => (
        <a
          key={a.id}
          className="attach-chip"
          href={href(a)}
          download={a.name}
          title={`${a.name} · ${a.mediaType} · ${formatBytes(a.size)}`}
        >
          <KindIcon kind={a.kind} />
          <span className="attach-name">{a.name}</span>
          <span className="attach-size">{formatBytes(a.size)}</span>
        </a>
      ))}
    </div>
  );
}
