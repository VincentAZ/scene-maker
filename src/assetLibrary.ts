import type { Asset } from "../shared/scene";

export type AssetSort = "collection" | "name" | "newest";
export const assetSorts: { id: AssetSort; label: string }[] = [
  { id: "collection", label: "By collection" },
  { id: "name", label: "Name A–Z" },
  { id: "newest", label: "My imports first" },
];

export type AssetQuery = {
  sort: AssetSort;
  /** Only assets something in the scene uses. */
  usedOnly: boolean;
  showHidden: boolean;
  hidden: ReadonlySet<string>;
  /** The creator's own imports: this scene's and other projects'. */
  mine: ReadonlySet<string>;
  usage: ReadonlyMap<string, number>;
};

/** Order and narrow an already filtered asset list; the order of `assets` is
 * the library order, and later imports of the creator's own are newer. */
export function queryAssets(assets: Asset[], query: AssetQuery) {
  const order = new Map(assets.map((a, i) => [a.id, i]));
  const items = assets.filter(
    (a) =>
      (query.showHidden || !query.hidden.has(a.id)) &&
      (!query.usedOnly || !!query.usage.get(a.id)),
  );
  const mine = (a: Asset) => Number(query.mine.has(a.id));
  const by: Record<AssetSort, (a: Asset, b: Asset) => number> = {
    collection: (a, b) => order.get(a.id)! - order.get(b.id)!,
    name: (a, b) => a.name.localeCompare(b.name),
    newest: (a, b) =>
      mine(b) - mine(a) ||
      (mine(a)
        ? order.get(b.id)! - order.get(a.id)!
        : order.get(a.id)! - order.get(b.id)!),
  };
  return items.sort(by[query.sort]);
}
