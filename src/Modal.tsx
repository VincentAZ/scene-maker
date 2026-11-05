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
    pressedBackdrop = useRef(false),
    // Escape is answered from its keydown; a cancel or close the browser
    // raises for the same press must not ask the owner twice.
    escapePending = useRef(false),
    scrollTop = useRef(0),
    focused = useRef<HTMLElement | SVGElement | null>(null),
    close = useRef(onClose);
  close.current = onClose;
  useEffect(() => {
    const dialog = ref.current;
    leaving.current = false;
    dialog?.showModal();
    // Browsers force a modal shut on a repeated Escape unless the keydown is
    // handled, so Escape is taken here and routed through the owner.
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented || !dialog) return;
      const target = event.target;
      if (
        target instanceof Element &&
        target !== document.body &&
        !dialog.contains(target)
      )
        return;
      event.preventDefault();
      // Holding Escape asks once, not over and over.
      if (event.repeat) return;
      escapePending.current = true;
      close.current();
    };
    const onKeyUp = (event: KeyboardEvent) => {
      if (event.key === "Escape") escapePending.current = false;
    };
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    return () => {
      leaving.current = true;
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
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
        if (escapePending.current) escapePending.current = false;
        else onClose();
      }}
      onClose={() => {
        // Browsers may still force a modal shut (a second Escape in a row).
        // Tell the owner unless its keydown already did; if the owner keeps
        // the dialog, show it again where it was. StrictMode's rehearsal
        // unmount also closes and reopens it before this event arrives, so
        // only a dialog that is really shut counts.
        const dialog = ref.current;
        if (leaving.current || !dialog || dialog.open) return;
        if (escapePending.current) escapePending.current = false;
        else onClose();
        setTimeout(() => {
          const dialog = ref.current;
          if (!dialog || leaving.current || dialog.open) return;
          // Showing a dialog again resets its scroll and focus; put them back.
          dialog.showModal();
          dialog.scrollTop = scrollTop.current;
          if (focused.current?.isConnected)
            focused.current.focus({ preventScroll: true });
        });
      }}
      onScroll={(e) => {
        scrollTop.current = e.currentTarget.scrollTop;
      }}
      onFocus={(e) => {
        const target = e.target as EventTarget;
        if (target instanceof HTMLElement || target instanceof SVGElement)
          focused.current = target;
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
