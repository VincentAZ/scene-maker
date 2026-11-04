import type { Motion } from "../shared/scene";
import { motionCollections, motionDetails } from "../shared/motionLibrary";

export type ActionSource = "all" | "recorded" | "stylized" | "mine";
export type ActionSort = "grouped" | "name" | "shortest" | "longest" | "newest";
export const actionSources: { id: ActionSource; label: string }[] = [
  { id: "all", label: "All" },
  { id: "recorded", label: "Recorded" },
  { id: "mine", label: "My imports" },
];
export const actionSorts: { id: ActionSort; label: string }[] = [
  { id: "grouped", label: "By category" },
  { id: "name", label: "Name A–Z" },
  { id: "shortest", label: "Shortest first" },
  { id: "longest", label: "Longest first" },
  { id: "newest", label: "Newest first" },
];
/** Categories a creator can filter by (sources have their own filter). */
export const actionCategories = motionCollections.filter(
  (c) => !["All", "Stylized", "My actions"].includes(c),
);

export type ActionQuery = {
  search: string;
  source: ActionSource;
  category: string;
  sort: ActionSort;
  /** Only actions some clip in the scene plays. */
  usedOnly: boolean;
  showHidden: boolean;
  hidden: ReadonlySet<string>;
  /** The creator's own actions: this scene's and other projects'. */
  mine: ReadonlySet<string>;
  usage: ReadonlyMap<string, number>;
};

export type ActionItem = {
  motion: Motion;
  category: string;
  description: string;
  source: Exclude<ActionSource, "all">;
  hidden: boolean;
};

/** Filter and order the action library; the order of `motions` is the
 * library order, and later entries of the creator's own are newer. */
export function queryActions(motions: Motion[], query: ActionQuery) {
  const words = query.search.toLowerCase().split(/\s+/).filter(Boolean);
  const items: ActionItem[] = motions.flatMap((motion) => {
    const details = motionDetails(motion);
    const source = query.mine.has(motion.id) ? "mine" : details.source;
    const category = source === "mine" ? "My actions" : details.collection;
    const hidden = query.hidden.has(motion.id);
    const text =
      `${motion.name} ${details.description} ${category} ${motion.role ?? ""}`.toLowerCase();
    if (
      (hidden && !query.showHidden) ||
      (query.source !== "all" && source !== query.source) ||
      (query.category !== "All" && category !== query.category) ||
      (query.usedOnly && !query.usage.get(motion.id)) ||
      !words.every((word) => text.includes(word))
    )
      return [];
    return [
      { motion, category, description: details.description, source, hidden },
    ];
  });
  const order = new Map(motions.map((m, i) => [m.id, i]));
  const by: Record<ActionSort, (a: ActionItem, b: ActionItem) => number> = {
    grouped: (a, b) =>
      categoryIndex(a.category) - categoryIndex(b.category) ||
      order.get(a.motion.id)! - order.get(b.motion.id)!,
    name: (a, b) => a.motion.name.localeCompare(b.motion.name),
    shortest: (a, b) => a.motion.duration - b.motion.duration,
    longest: (a, b) => b.motion.duration - a.motion.duration,
    // Library entries keep their order after the creator's own, newest first.
    newest: (a, b) =>
      Number(b.source === "mine") - Number(a.source === "mine") ||
      (a.source === "mine"
        ? order.get(b.motion.id)! - order.get(a.motion.id)!
        : order.get(a.motion.id)! - order.get(b.motion.id)!),
  };
  return items.sort(by[query.sort]);
}

const categoryIndex = (category: string) => {
  const index = motionCollections.indexOf(category);
  return index < 0 ? motionCollections.length : index;
};

/** Section headings for the panel: categories when grouped, else one list. */
export function actionGroups(items: ActionItem[], sort: ActionSort) {
  if (sort !== "grouped") return [{ title: "", items }];
  const groups: { title: string; items: ActionItem[] }[] = [];
  for (const item of items) {
    const last = groups.at(-1);
    if (last?.title === item.category) last.items.push(item);
    else groups.push({ title: item.category, items: [item] });
  }
  return groups;
}
