import { z } from "zod";
import { libraryCharacters, libraryEntries } from "./characterLibrary";
import type { Asset } from "./scene";

const color = z.string().regex(/^#[0-9a-fA-F]{6}$/);
export const characterDesignSchema = z.object({
  baseId: z.enum(
    libraryEntries.map((entry) => entry.id) as [string, ...string[]],
  ),
  hairColor: color,
  accentColor: color,
  glasses: z.boolean(),
  backpack: z.boolean(),
});
export type CharacterDesign = z.infer<typeof characterDesignSchema>;
export const supportsGlasses = (baseId: string) => !baseId.includes("knight");
export const supportsHair = (baseId: string) =>
  !/(casual-bald|worker-male|knight-male|knight-golden-male|pirate-male|kimono-male|elf)$/.test(
    baseId,
  );
export function characterDraft(baseId: string, name = "My character"): Asset {
  const base = libraryCharacters.find((asset) => asset.id === baseId);
  if (!base) throw Error("Choose a starting look from the character library.");
  return {
    id: crypto.randomUUID(),
    name,
    category: "characters",
    style: base.style,
    color: "#527f8c",
    skin: base.skin,
    body: base.body,
    description: `A custom ${base.style.toLowerCase()} character, based on a Quaternius CC0 model.`,
    design: {
      baseId,
      hairColor: "#674332",
      accentColor: "#d9a64d",
      glasses: false,
      backpack: false,
    },
  };
}
