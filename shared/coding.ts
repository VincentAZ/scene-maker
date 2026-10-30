import type { Attachment } from "./attachments";
import type { providers } from "./scene";
/** An explicit model choice owned by one coding task, not the scene assistant. */
export type CodingModelSelection = {
  provider: (typeof providers)[number];
  model: string;
};
export type CodingStatus =
  | "preparing"
  | "working"
  | "checking"
  | "ready"
  | "idle"
  | "failed"
  | "cancelled"
  | "publishing"
  | "pushed";
/** One line of a task's conversation, in the order it happened. */
export type TranscriptEntry =
  | {
      kind: "user";
      id: string;
      at: number;
      text: string;
      queued?: boolean;
      dropped?: boolean;
      /** Files sent with the message, saved in the task's attachments directory. */
      attachments?: Attachment[];
    }
  | { kind: "assistant"; id: string; at: number; text: string; depth?: number }
  | {
      kind: "tool";
      id: string;
      at: number;
      name: string;
      title: string;
      input?: string;
      status: "running" | "ok" | "error";
      output?: string;
      ended?: number;
      depth?: number;
    }
  | {
      kind: "status";
      id: string;
      at: number;
      text: string;
      tone?: "info" | "success" | "warning" | "error";
    };
export type CodingTask = {
  id: string;
  /** The first request; the task's title. */
  prompt: string;
  branch: string;
  base: string;
  baseline: string;
  baseBranch: string;
  status: CodingStatus;
  created: number;
  /** When the current run began working. */
  started?: number;
  /** Last activity, for liveness display. */
  updated?: number;
  /** Model turns completed in the current run. */
  step?: number;
  /** Configured step limit; 0 means unlimited. */
  maxSteps?: number;
  provider: CodingModelSelection["provider"];
  model: string;
  /** The engineer's last reply. */
  summary: string;
  error?: string;
  /** Legacy flat activity log, kept for tasks created before transcripts. */
  events: string[];
  transcript?: TranscriptEntry[];
  baselineFiles: string[];
  files: string[];
  diff: string;
  publishDiff: string;
  review: string;
  checkedReview?: string;
  checks: { name: string; ok: boolean; output: string }[];
  /** Latest commit on the task branch. */
  commit?: string;
  /** Commit last pushed to origin. */
  pushedCommit?: string;
  pushed?: boolean;
  /** The engineer merged the branch into the running studio and restarted it. */
  deployed?: boolean;
  previewUrl?: string;
  compareUrl?: string;
  pullRequestUrl?: string;
};
/** What the task list needs, without transcripts or diffs. */
export type CodingTaskSummary = Pick<
  CodingTask,
  | "id"
  | "prompt"
  | "branch"
  | "provider"
  | "model"
  | "status"
  | "created"
  | "updated"
  | "step"
  | "error"
  | "pushed"
  | "deployed"
  | "compareUrl"
  | "pullRequestUrl"
> & { fileCount: number; searchText: string; lastMessage: string };
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
  tasks: CodingTaskSummary[];
};
export const codingBusy = (s: CodingStatus) =>
  ["preparing", "working", "checking", "publishing"].includes(s);
/** Legacy activity lines the model wrote itself carry this prefix. */
export const NARRATION = "Assistant: ";
export const statusLabel = (task: Pick<CodingTask, "status" | "deployed">) =>
  ({
    preparing: "Preparing",
    working: "Working",
    checking: "Running checks",
    ready: "Ready for review",
    idle: "Done",
    failed: "Failed",
    cancelled: "Stopped",
    publishing: "Pushing",
    pushed: task.deployed ? "Deployed" : "Pushed",
  })[task.status];
