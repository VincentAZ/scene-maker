import { useEffect, useState } from "react";
import {
  Check,
  ExternalLink,
  LoaderCircle,
  RefreshCw,
  TriangleAlert,
} from "lucide-react";
import { api } from "./api";
import { studioBuild, studioVersion } from "./version";

type VersionInfo = {
  version: string;
  started: string;
  git: boolean;
  commit?: string;
  branch?: string;
  date?: string;
  subject?: string;
  dirty?: boolean;
  restartNeeded?: boolean;
};
type UpdateCheck = VersionInfo & {
  checked: string;
  available: boolean;
  behind?: number;
  ahead?: number;
  latest?: { commit: string; date: string; subject: string };
  repoUrl?: string;
  compareUrl?: string;
  reason?: string;
};
const when = (iso?: string) =>
  iso
    ? new Date(iso).toLocaleString(undefined, {
        dateStyle: "medium",
        timeStyle: "short",
      })
    : "";

/** Version line for the settings screen, with an on-demand update check. */
export function UpdateCheck() {
  const [info, setInfo] = useState<VersionInfo | null>(null);
  const [result, setResult] = useState<UpdateCheck | null>(null);
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    api<VersionInfo>("/api/version").then(setInfo, () => setInfo(null));
  }, []);
  const source = result ?? info;
  async function check() {
    setChecking(true);
    setError("");
    try {
      setResult(
        await api<UpdateCheck>("/api/update/check", {
          method: "POST",
          body: "{}",
        }),
      );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setChecking(false);
    }
  }
  return (
    <section className="update-check" aria-label="Version and updates">
      <div className="update-version">
        <strong>Scene Maker v{studioVersion}</strong>
        <small>
          build {studioBuild}
          {source?.git && source.commit
            ? ` · ${source.commit} on ${source.branch}${source.dirty ? " · local changes" : ""}`
            : ""}
          {source?.date ? ` · ${when(source.date)}` : ""}
        </small>
      </div>
      <div className="row update-actions">
        <button
          className="secondary"
          disabled={checking}
          onClick={() => void check()}
        >
          {checking ? (
            <>
              <LoaderCircle size={14} className="spin" /> Checking…
            </>
          ) : (
            <>
              <RefreshCw size={14} /> Check for updates
            </>
          )}
        </button>
        {result?.repoUrl && (
          <a
            className="text-link"
            href={result.repoUrl}
            target="_blank"
            rel="noreferrer"
          >
            Project on GitHub <ExternalLink size={12} />
          </a>
        )}
      </div>
      {error && (
        <p className="update-status warning" role="alert">
          <TriangleAlert size={14} /> {error}
        </p>
      )}
      {source?.restartNeeded && (
        <p className="update-status warning" role="status">
          <TriangleAlert size={14} /> The files on disk are newer than the
          running service. Stop the local service from the dock icon and launch
          Scene Maker again.
        </p>
      )}
      {result && !error && (
        <div className="update-status" role="status">
          {result.reason ? (
            <p>
              <TriangleAlert size={14} /> {result.reason}
            </p>
          ) : result.available ? (
            <>
              <p>
                <TriangleAlert size={14} /> <strong>Update available:</strong>{" "}
                {result.behind} new {result.behind === 1 ? "commit" : "commits"}{" "}
                on GitHub. Latest: “{result.latest?.subject}” (
                {when(result.latest?.date)}).
                {result.compareUrl && (
                  <>
                    {" "}
                    <a
                      href={result.compareUrl}
                      target="_blank"
                      rel="noreferrer"
                    >
                      See what changed <ExternalLink size={12} />
                    </a>
                  </>
                )}
              </p>
              <p>
                To update, run this in the Scene Maker folder, then relaunch
                from the dock icon:
              </p>
              <pre>
                <code>git pull --ff-only && npm ci && npm run build</code>
              </pre>
              {!!result.ahead && (
                <p className="small muted">
                  This copy also has {result.ahead} local{" "}
                  {result.ahead === 1 ? "commit" : "commits"} not on GitHub;
                  pull will keep them if they do not conflict.
                </p>
              )}
            </>
          ) : (
            <p>
              <Check size={14} /> You are up to date
              {result.ahead
                ? ` (${result.ahead} local ${result.ahead === 1 ? "commit" : "commits"} ahead of GitHub)`
                : ""}
              . Checked {when(result.checked)}.
            </p>
          )}
        </div>
      )}
    </section>
  );
}
