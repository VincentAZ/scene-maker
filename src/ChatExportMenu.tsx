import { useEffect, useRef, useState } from "react";
import { Check, Copy, Download } from "lucide-react";
import { download } from "./api";
import type { ExportFormat } from "./code/transcriptExport";

/** Copy text, falling back to a hidden textarea where the Clipboard API is unavailable. */
export async function copyText(text: string) {
  try {
    await navigator.clipboard.writeText(text);
    return;
  } catch {
    // Insecure origins and some browsers refuse; try the legacy route.
  }
  const area = document.createElement("textarea");
  area.value = text;
  area.setAttribute("readonly", "");
  area.style.position = "fixed";
  area.style.opacity = "0";
  document.body.appendChild(area);
  area.select();
  const ok = document.execCommand("copy");
  area.remove();
  if (!ok) throw Error("Copy is not available in this browser.");
}

/** "Copy all" plus Markdown and plain-text downloads for one conversation. */
export function ChatExportMenu({
  build,
  filename,
  disabled,
  label = "conversation",
}: {
  build: (format: ExportFormat) => string;
  filename: (format: ExportFormat) => string;
  disabled?: boolean;
  label?: string;
}) {
  const [copied, setCopied] = useState<"" | "ok" | "failed">("");
  const [open, setOpen] = useState(false);
  const menu = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(""), 1800);
    return () => clearTimeout(timer);
  }, [copied]);
  useEffect(() => {
    if (!open) return;
    const close = (e: Event) => {
      if (
        e instanceof KeyboardEvent
          ? e.key === "Escape"
          : !menu.current?.contains(e.target as Node)
      )
        setOpen(false);
    };
    document.addEventListener("pointerdown", close);
    document.addEventListener("keydown", close);
    return () => {
      document.removeEventListener("pointerdown", close);
      document.removeEventListener("keydown", close);
    };
  }, [open]);
  const save = (format: ExportFormat) => {
    setOpen(false);
    download(
      build(format),
      filename(format),
      format === "md"
        ? "text/markdown;charset=utf-8"
        : "text/plain;charset=utf-8",
    );
  };
  return (
    <div className="chat-export" ref={menu}>
      <button
        className="icon-button"
        disabled={disabled}
        title={
          copied === "ok" ? "Copied" : `Copy the whole ${label} as Markdown`
        }
        aria-label={`Copy all of the ${label}`}
        onClick={() =>
          void copyText(build("md")).then(
            () => setCopied("ok"),
            () => setCopied("failed"),
          )
        }
      >
        {copied === "ok" ? <Check size={14} /> : <Copy size={14} />}
      </button>
      <button
        className="icon-button"
        disabled={disabled}
        title={`Export the ${label}`}
        aria-label={`Export the ${label}`}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      >
        <Download size={14} />
      </button>
      {open && (
        <div className="chat-export-menu" role="menu">
          <button role="menuitem" onClick={() => save("md")}>
            Export as Markdown (.md)
          </button>
          <button role="menuitem" onClick={() => save("txt")}>
            Export as text (.txt)
          </button>
        </div>
      )}
      {copied && (
        <span
          className={`chat-export-note${copied === "failed" ? " failed" : ""}`}
          role="status"
        >
          {copied === "ok" ? "Copied" : "Copy failed"}
        </span>
      )}
    </div>
  );
}
