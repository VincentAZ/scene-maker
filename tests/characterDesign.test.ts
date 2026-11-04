import { it, expect } from "vitest";
import { characterDraft } from "../shared/characterDesign";
import { assetSchema, applyCommands, starterScene } from "../shared/scene";
import { assistant } from "../server/ai";
import { validatePlan } from "../shared/studio";

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

it("asks for an imported character instead of building a retired starting look through the offline assistant", async () => {
  const config = { assistant: null, providers: {}, blender: "blender" },
    scene = starterScene();
  for (const prompt of [
    "Create a character",
    "Design a new character",
    "Create a character named Cleo from Missing",
    'Create a character named "Cleo" based on Sage',
  ]) {
    const plan = await assistant(config, scene, prompt);
    expect(plan.mode).toBe("offline");
    expect(plan.steps, prompt).toEqual([
      { type: "show", panel: "importAsset", category: "characters" },
    ]);
    expect(plan.response).toContain("Import");
  }
  // A recolored starting look is still a valid recipe for old projects, but
  // the assistant may no longer create one.
  const draft = characterDraft("quaternius-casual-female", "Cleo");
  expect(
    applyCommands(scene, [
      { type: "createAsset", asset: draft },
    ]).customAssets.at(-1)?.design,
  ).toEqual(draft.design);
  expect(() =>
    validatePlan(
      {
        response: "Created Cleo.",
        steps: [
          {
            type: "edit",
            commands: [
              { type: "createAsset", asset: draft },
              { type: "add", id: "cleo", assetId: draft.id },
            ],
          },
        ],
      },
      scene,
      () => scene,
    ),
  ).toThrow("retired");
});
