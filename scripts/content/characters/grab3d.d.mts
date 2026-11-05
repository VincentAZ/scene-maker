import type { ContentEntry } from "../../../shared/contentLibrary";

export const cast: {
  slug: string;
  name: string;
  body: "feminine" | "masculine";
  style: string;
  metal?: boolean;
  description: string;
}[];
export function imageSize(bytes: Buffer): { width: number; height: number };
export function build(options: {
  out: string;
  cache: string;
  root: string;
  log: (...message: unknown[]) => void;
}): Promise<ContentEntry[]>;
