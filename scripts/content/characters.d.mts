// Types of the character dispatcher, for the catalogue tests.
import type { ContentEntry } from "../../shared/contentLibrary";

export function build(options: {
  out: string;
  cache: string;
  root: string;
  log: (...message: unknown[]) => void;
}): Promise<ContentEntry[]>;
export function mergeCatalogue<E extends { id: string }>(options: {
  current: E[];
  built: E[];
  owned: string[];
}): E[];
