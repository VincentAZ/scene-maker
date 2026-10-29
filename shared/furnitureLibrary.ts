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
// Sitting surfaces measured on the shipped +Z-facing models. Unknown seats stay untagged.
const seatProfiles: Record<string, Asset["seat"]> = {
  chair: { position: [0, 0.48, 0], width: 0.4, depth: 0.4 },
  chairCushion: { position: [0, 0.48, 0], width: 0.4, depth: 0.4 },
  chairRounded: { position: [0, 0.44, 0], width: 0.4, depth: 0.4 },
  chairDesk: { position: [0, 0.467, 0.056], width: 0.54, depth: 0.516 },
  loungeChair: { position: [0, 0.46, 0.09], width: 0.62, depth: 0.64 },
};
export const furnitureAssets: Asset[] = furnitureEntries.map((entry) => ({
  id: entry.id,
  name: entry.name,
  category: "props",
  style: entry.collection,
  url: entry.url,
  color: "#b4a184",
  skin: "#bf8866",
  body: "mannequin",
  ...(seatProfiles[entry.source] ? { seat: seatProfiles[entry.source] } : {}),
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
