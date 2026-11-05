import { useEffect, useRef, type ReactNode } from "react";
import { X } from "lucide-react";
export function Modal({
  title,
  children,
  onClose,
  wide = false,
  error = "",
  onDismissError,
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
  wide?: boolean;
  error?: string;
  onDismissError?: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null),
    leaving = useRef(false),
    pressedBackdrop = useRef(false);
  useEffect(() => {
    const dialog = ref.current;
    leaving.current = false;
    dialog?.showModal();
    return () => {
      leaving.current = true;
      dialog?.close();
    };
  }, []);
  return (
    <dialog
      ref={ref}
      className={wide ? "modal wide" : "modal"}
      onCancel={(e) => {
        // Escape asks the owner, which may want to confirm first; the dialog
        // itself stays open until the owner unmounts it.
        e.preventDefault();
        onClose();
      }}
      onClose={() => {
        // Browsers may still force a modal shut (a second Escape in a row).
        // Tell the owner; if it keeps the dialog, show it again. StrictMode's
        // rehearsal unmount also closes and reopens it before this event
        // arrives, so only a dialog that is really shut counts.
        const dialog = ref.current;
        if (leaving.current || !dialog || dialog.open) return;
        onClose();
        setTimeout(() => {
          if (ref.current && !leaving.current && !ref.current.open)
            ref.current.showModal();
        });
      }}
      onPointerDown={(e) => {
        pressedBackdrop.current = e.target === ref.current;
      }}
      onClick={(e) => {
        // Only a press on the backdrop counts: a drag that starts inside and
        // ends outside must not close the dialog.
        if (e.target === ref.current && pressedBackdrop.current) onClose();
      }}
    >
      <header>
        <div>
          <span className="eyebrow">YOUR CREATIVE SPACE</span>
          <h2>{title}</h2>
        </div>
        <button
          className="icon-button"
          aria-label="Close dialog"
          onClick={onClose}
        >
          <X size={20} />
        </button>
      </header>
      {error && (
        <div className="modal-error" role="alert">
          <span>{error}</span>
          <button aria-label="Dismiss error" onClick={onDismissError}>
            <X size={15} />
          </button>
        </div>
      )}
      {children}
    </dialog>
  );
}
