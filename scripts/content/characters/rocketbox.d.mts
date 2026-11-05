// Types of the Rocketbox source module, for the catalogue tests.
import type { ContentEntry } from "../../../shared/contentLibrary";

export type RocketboxAvatar = {
  /** Assets/Avatars/<folder> upstream. */
  folder: string;
  name: string;
  role?: string;
  body: "feminine" | "masculine";
  style: string;
  description: string;
};
type Log = (...message: unknown[]) => void;

export const cast: RocketboxAvatar[];
export const idPrefix: string;
export function idOf(avatar: Pick<RocketboxAvatar, "folder">): string;
export function downloadAll(options: {
  cache: string;
  log: Log;
  avatars?: RocketboxAvatar[];
}): Promise<void>;
export function build(options: {
  out: string;
  cache: string;
  root: string;
  log: Log;
}): Promise<ContentEntry[]>;
