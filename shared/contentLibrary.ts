import type { Asset } from "./scene";
import characters from "./content/characters.json";
import props from "./content/props.json";
import sets from "./content/sets.json";

/** A realistic library item downloaded by scripts/build-content.mjs into
 * the git-ignored content/ folder and served under /content/. Each category's
 * catalogue is a JSON file in shared/content/, written by that build. */
export type ContentEntry = Omit<Asset, "color" | "skin" | "body"> &
  Partial<Pick<Asset, "color" | "skin" | "body">> & {
    /** Who made it, the licence, where it came from and, when the licensor
     * asks for one, the exact credit line to include. */
    credit: {
      author: string;
      license: string;
      source: string;
      notice?: string;
    };
  };

const entries = [...characters, ...props, ...sets] as ContentEntry[];
export const contentAssets: Asset[] = entries.map(
  ({ credit: _credit, ...entry }) => ({
    color: "#9aa58f",
    skin: "#c99a7c",
    body: "masculine",
    ...entry,
  }),
);
export const contentCredits = new Map(entries.map((e) => [e.id, e.credit]));
export const contentURL = /^\/content\/[a-zA-Z0-9_./-]+$/;
