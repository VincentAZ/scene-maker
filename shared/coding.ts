export type CodingStatus =
  | "preparing"
  | "working"
  | "checking"
  | "ready"
  | "failed"
  | "cancelled"
  | "publishing"
  | "pushed";
export type CodingTask = {
  id: string;
  prompt: string;
  branch: string;
  base: string;
  baseline: string;
  baseBranch: string;
  status: CodingStatus;
  created: number;
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
  previewUrl?: string;
  compareUrl?: string;
  pullRequestUrl?: string;
};
export type CodingInfo = {
  repository: string;
  remote: string;
  available: boolean;
  reason?: string;
  provider: string | null;
  model: string;
  tasks: CodingTask[];
};
export const codingBusy = (s: CodingStatus) =>
  ["preparing", "working", "checking", "publishing"].includes(s);
