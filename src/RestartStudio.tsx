import { useState } from "react";
import { createPortal } from "react-dom";
import { LoaderCircle, RotateCw } from "lucide-react";
import { api } from "./api";

type Phase = "idle" | "building" | "waiting" | "failed";
const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Rebuild and restart the studio service, then reload this window once the
 * new service answers. Running coding tasks are stopped only after the
 * person confirms; their conversations and changes are kept.
 */
export function RestartStudio({ variant = "icon" }: { variant?: "icon" | "button" }) {
  const [phase, setPhase] = useState<Phase>("idle");
  const [message, setMessage] = useState("");
  async function restart() {
    if (
      !window.confirm(
        "Restart Scene Maker?\n\nThe studio rebuilds from the files on disk and restarts. Your scenes are saved. This window reloads when it is back.",
      )
    )
      return;
    let before = "";
    try {
      before = (await api<{ started: string }>("/api/version")).started;
    } catch {
      // Unknown start time: wait for any healthy answer after the restart.
    }
    setPhase("building");
    setMessage("");
    const request = (force: boolean) =>
      api("/api/restart", { method: "POST", body: JSON.stringify({ force, rebuild: true }) });
    try {
      try {
        await request(false);
      } catch (e) {
        const error = e as Error & { status?: number };
        if (error.status !== 409 || !/running/.test(error.message)) throw error;
        if (
          !window.confirm(
            `${error.message}\n\nRestarting stops them. Their conversations and changes are kept, and you can send a message to continue. Restart anyway?`,
          )
        ) {
          setPhase("idle");
          return;
        }
        await request(true);
      }
    } catch (e) {
      setPhase("failed");
      setMessage((e as Error).message);
      return;
    }
    setPhase("waiting");
    const deadline = Date.now() + 180_000;
    await pause(1500);
    while (Date.now() < deadline) {
      try {
        const info = await api<{ started: string }>("/api/version");
        if (!before || info.started !== before) {
          window.location.reload();
          return;
        }
      } catch {
        // Still restarting.
      }
      await pause(1000);
    }
    setPhase("failed");
    setMessage("The studio did not come back within three minutes. Check .data/service.log, then open Scene Maker from its icon.");
  }
  const busy = phase === "building" || phase === "waiting";
  return (
    <>
      {variant === "icon" ? (
        <button
          className="icon-button"
          aria-label="Restart Scene Maker"
          title="Rebuild and restart Scene Maker"
          disabled={busy}
          onClick={() => void restart()}
        >
          <RotateCw size={16} />
        </button>
      ) : (
        <button className="secondary" disabled={busy} onClick={() => void restart()}>
          <RotateCw size={14} /> Restart Scene Maker
        </button>
      )}
      {phase !== "idle" &&
        createPortal(
          <div className="restart-overlay" role="alertdialog" aria-live="assertive" aria-label="Restarting Scene Maker">
            <div className="restart-card">
              {busy ? (
                <>
                  <LoaderCircle size={22} className="spin" />
                  <strong>{phase === "building" ? "Rebuilding Scene Maker…" : "Restarting…"}</strong>
                  <p>
                    {phase === "building"
                      ? "Checking and building the latest files. This takes a few seconds."
                      : "Waiting for the studio to come back. This window reloads on its own."}
                  </p>
                </>
              ) : (
                <>
                  <strong>Restart did not finish</strong>
                  <pre>{message}</pre>
                  <button className="secondary" onClick={() => setPhase("idle")}>
                    Close
                  </button>
                </>
              )}
            </div>
          </div>,
          document.body,
        )}
    </>
  );
}
