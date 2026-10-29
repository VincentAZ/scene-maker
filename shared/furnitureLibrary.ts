import catalogue from "./furniture-catalogue.json";
import type { Asset } from "./scene";

export const furnitureCollections = Object.keys(catalogue);
export const furnitureEntries = Object.entries(catalogue).flatMap(
  ([collection, items]) =>
    items.map(([source, name]) => {
      const slug = source.replace(/([a-z])([A-Z])/g, "$1-$2").toLowerCase();
      return {
        source,
        name,
        collection,
        id: "furniture-" + slug,
        url: `/library/furniture/${slug}.glb`,
        thumbnail: `/library/furniture/${slug}.png`,
      };
    }),
);
export const furnitureAssets: Asset[] = furnitureEntries.map((entry) => ({
  id: entry.id,
  name: entry.name,
  category: "props",
  style: entry.collection,
  url: entry.url,
  color: "#b4a184",
  skin: "#bf8866",
  body: "mannequin",
  description: `${entry.name}. ${entry.collection} collection. An editable scene prop by Kenney (CC0).`,
}));
export const furnitureURLs = new Set(
  furnitureEntries.map((entry) => entry.url),
);
export function furnitureEntry(asset: Asset) {
  return furnitureEntries.find(
    (entry) => entry.id === asset.id && entry.url === asset.url,
  );
}
