import type { Asset } from "./scene";
import characters from "./content/characters.json";
import props from "./content/props.json";
import sets from "./content/sets.json";

/** Who made a library item, under which licence, and where it came from. */
export type Credit = { author: string; license: string; source: string };

/** A realistic library item downloaded by scripts/build-content.mjs into
 * the git-ignored content/ folder and served under /content/. Each category's
 * catalogue is a JSON file in shared/content/, written by that build. */
export type ContentEntry = Omit<Asset, "color" | "skin" | "body"> &
  Partial<Pick<Asset, "color" | "skin" | "body">> & { credit: Credit };

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

/** Collections the library draws from, named for the credits list. Other
 * sources are named after their website. */
const collections: [RegExp, string][] = [
  [/polyhaven\.com/, "Poly Haven"],
  [/github\.com\/microsoft\/Microsoft-Rocketbox/, "Microsoft Rocketbox"],
  [/blender\.org/, "Blender Studio demo files"],
  [/developer\.nvidia\.com/, "NVIDIA ORCA"],
  [/casual-effects\.com/, "McGuire Computer Graphics Archive"],
  [/intel\.com/, "Intel Graphics Research"],
  [/benedikt-bitterli\.me/, "Benedikt Bitterli's rendering resources"],
];
export function creditCollection(source: string) {
  const known = collections.find(([pattern]) => pattern.test(source));
  if (known) return known[1];
  try {
    return new URL(source).hostname.replace(/^www\./, "");
  } catch {
    return source;
  }
}

export type CreditGroup = {
  collection: string;
  licenses: string[];
  items: (Credit & {
    id: string;
    name: string;
    category: Asset["category"];
  })[];
};

/** Every credited library item, grouped by the collection it came from, for
 * the Credits dialog: characters, props and sets alike. */
export function creditGroups(): CreditGroup[] {
  const order: Asset["category"][] = ["characters", "props", "environments"];
  const groups = new Map<string, CreditGroup>();
  for (const entry of entries) {
    const collection = creditCollection(entry.credit.source);
    let group = groups.get(collection);
    if (!group) {
      group = { collection, licenses: [], items: [] };
      groups.set(collection, group);
    }
    if (!group.licenses.includes(entry.credit.license))
      group.licenses.push(entry.credit.license);
    group.items.push({
      id: entry.id,
      name: entry.name,
      category: entry.category,
      ...entry.credit,
    });
  }
  for (const group of groups.values())
    group.items.sort(
      (a, b) =>
        order.indexOf(a.category) - order.indexOf(b.category) ||
        a.name.localeCompare(b.name),
    );
  return [...groups.values()].sort(
    (a, b) =>
      b.items.length - a.items.length ||
      a.collection.localeCompare(b.collection),
  );
}
