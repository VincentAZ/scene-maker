export type CodingStatus =
  | "preparing"
  | "working"
  | "checking"
  | "ready"
  | "failed"
  | "cancelled"
  | "publishing"
  | "pushed";
import type { Attachment } from "./attachments";
export type CodingTask = {
  id: string;
  prompt: string;
  /** Reference files sent with the request (metadata only). */
  attachments?: Attachment[];
  branch: string;
  base: string;
  baseline: string;
  baseBranch: string;
  status: CodingStatus;
  created: number;
  /** When the current run began working. */
  started?: number;
  /** Last activity from the run, for liveness display. */
  updated?: number;
  /** Model turns completed in the current run. */
  step?: number;
  /** Configured step limit; 0 means unlimited. */
  maxSteps?: number;
  provider: string;
  model: string;
  summary: string;
  error?: string;
  events: string[];
  baselineFiles: string[];
  files: string[];
  diff: string;
  publishDiff: string;
  review: string;
  checkedReview?: string;
  checks: { name: string; ok: boolean; output: string }[];
  commit?: string;
  /** The agent pushed the branch itself. */
  pushed?: boolean;
  /** The agent merged the branch into the running studio and restarted it. */
  deployed?: boolean;
  previewUrl?: string;
  compareUrl?: string;
  pullRequestUrl?: string;
};
export type McpServerConfig =
  | {
      transport: "stdio";
      command: string;
      args?: string[];
      env?: Record<string, string>;
      cwd?: string;
    }
  | { transport: "http" | "sse"; url: string; headers?: Record<string, string> };
export type CodingInfo = {
  repository: string;
  remote: string;
  available: boolean;
  reason?: string;
  provider: string | null;
  model: string;
  mcpServers: string[];
  maxSteps: number;
  timeoutMinutes: number;
  tasks: CodingTask[];
};
export const codingBusy = (s: CodingStatus) =>
  ["preparing", "working", "checking", "publishing"].includes(s);
/** Activity lines the model wrote itself carry this prefix. */
export const NARRATION = "Assistant: ";
