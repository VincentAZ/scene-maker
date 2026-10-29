import type { Asset } from "./scene";

// Curated from Quaternius's CC0 Ultimate Animated Character Pack.
// Stable filenames and IDs keep saved scenes independent of display names.
const catalogue = [
  ["Casual_Female", "Sage", "Everyday", "Everyday"],
  ["Casual_Male", "Theo", "Everyday", "Everyday"],
  ["Casual_Bald", "Marcus", "Everyday", "Everyday"],
  ["Casual2_Female", "Dara", "Everyday", "Everyday"],
  ["Casual2_Male", "Rafael", "Everyday", "Everyday"],
  ["Casual3_Female", "Tess", "Everyday", "Everyday"],
  ["Casual3_Male", "Finn", "Everyday", "Everyday"],
  ["Doctor_Female_Young", "Dr. Amara", "Doctor", "Professionals"],
  ["Doctor_Male_Young", "Dr. Dev", "Doctor", "Professionals"],
  ["Doctor_Female_Old", "Dr. Beatrice", "Doctor", "Professionals"],
  ["Doctor_Male_Old", "Dr. Hugo", "Doctor", "Professionals"],
  ["Chef_Female", "Colette", "Chef", "Professionals"],
  ["Chef_Male", "Lucien", "Chef", "Professionals"],
  ["Chef_Hat", "Remy", "Head chef", "Professionals"],
  ["Worker_Female", "Harper", "Builder", "Professionals"],
  ["Worker_Male", "Mateo", "Builder", "Professionals"],
  ["Suit_Female", "Simone", "Business", "Professionals"],
  ["Suit_Male", "Adrian", "Business", "Professionals"],
  ["OldClassy_Female", "Evelyn", "Formal wear", "Everyday"],
  ["OldClassy_Male", "Arthur", "Formal wear", "Everyday"],
  ["Kimono_Female", "Aiko", "Kimono", "Everyday"],
  ["Kimono_Male", "Ren", "Kimono", "Everyday"],
  ["Cowboy_Female", "Billie", "Cowgirl", "Adventure"],
  ["Cowboy_Male", "Wyatt", "Cowboy", "Adventure"],
  ["Pirate_Female", "Captain Morgan", "Pirate", "Adventure"],
  ["Pirate_Male", "Captain Flint", "Pirate", "Adventure"],
  ["Knight_Male", "Gareth", "Knight", "Fantasy"],
  ["Knight_Golden_Female", "Seraphine", "Golden knight", "Fantasy"],
  ["Knight_Golden_Male", "Aldric", "Golden knight", "Fantasy"],
  ["Witch", "Selene", "Witch", "Fantasy"],
  ["Wizard", "Merlin", "Wizard", "Fantasy"],
  ["Elf", "Elowen", "Elf", "Fantasy"],
] as const;

export const libraryEntries = catalogue.map(
  ([source, name, style, collection], index) => {
    const slug = source.toLowerCase().replaceAll("_", "-");
    return {
      source,
      name,
      style,
      collection,
      id: "quaternius-" + slug,
      url: `/library/quaternius/${slug}.glb`,
      thumbnail: `/library/quaternius/${slug}.png`,
      skin: ["#9b6045", "#e0ad87", "#6b4030", "#be825b", "#875139", "#ebc19f"][
        index % 6
      ],
    };
  },
);
export const libraryCharacters: Asset[] = libraryEntries.map((entry) => ({
  id: entry.id,
  name: entry.name,
  style: entry.style,
  url: entry.url,
  category: "characters",
  color: "#819778",
  skin: entry.skin,
  body: /Female|Witch|Elf/.test(entry.source) ? "feminine" : "masculine",
  description: `${entry.style} character with a skinned humanoid rig. ${entry.collection} collection. Model by Quaternius (CC0).`,
}));
export const libraryAssetURLs = new Set(
  libraryEntries.map((entry) => entry.url),
);
export function libraryEntry(asset: Asset) {
  return libraryEntries.find(
    (entry) => entry.id === asset.id && entry.url === asset.url,
  );
}
export function characterCollection(asset: Asset) {
  if (asset.style === "Imported") return "My assets";
  return (
    libraryEntry(asset)?.collection ??
    (asset.body === "mannequin"
      ? "Mannequins"
      : ["Creative", "Everyday", "Artist", "Filmmaker"].includes(asset.style)
        ? "Everyday"
        : asset.style === "Explorer"
          ? "Adventure"
          : "Professionals")
  );
}
