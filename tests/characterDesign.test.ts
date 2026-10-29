import { it, expect } from "vitest";
import { characterDraft } from "../shared/characterDesign";
import { assetSchema, applyCommands, starterScene } from "../shared/scene";
import { assistant } from "../server/ai";

it("bounds character recipes to supported local looks, colors, wearables, and previews", () => {
  const draft = characterDraft("quaternius-casual-female", "Cleo");
  expect(assetSchema.parse(draft)).toEqual(draft);
  for (const change of [
    { design: { ...draft.design, baseId: "../../private" } },
    { design: { ...draft.design, hairColor: "red" } },
    {
      design: {
        ...draft.design,
        baseId: "quaternius-knight-male",
        glasses: true,
      },
    },
    { category: "props" },
    {
      parts: [
        {
          shape: "sphere",
          position: [0, 1, 0],
          scale: [1, 1, 1],
          rotation: [0, 0, 0],
          color: "#ffffff",
        },
      ],
    },
    { thumbnail: "https://example.com/preview.png" },
    { thumbnail: "/uploads/../private.png" },
  ])
    expect(assetSchema.safeParse({ ...draft, ...change }).success).toBe(false);
});

it("opens the character maker or creates a named skinned character through the offline assistant", async () => {
  const config = { assistant: null, providers: {}, blender: "blender" },
    scene = starterScene();
  for (const prompt of [
    "Create a character",
    "Design a new character",
    "Create a character named Cleo from Missing",
  ])
    expect((await assistant(config, scene, prompt)).steps).toEqual([
      { type: "show", panel: "createCharacter" },
    ]);
  const plan = await assistant(
    config,
    scene,
    'Create a character named "Cleo" based on Sage',
  );
  expect(plan.mode).toBe("offline");
  const edit = plan.steps[0];
  if (edit.type !== "edit") throw Error("Expected character creation");
  const result = applyCommands(scene, edit.commands);
  expect(result.customAssets.at(-1)).toMatchObject({
    name: "Cleo",
    design: { baseId: "quaternius-casual-female" },
  });
  expect(result.entities.at(-1)?.name).toBe("Cleo");
  expect(plan.steps[1]).toEqual({
    type: "select",
    id: result.entities.at(-1)!.id,
  });
});
