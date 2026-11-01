import { expect, it } from "vitest";
import { applyCommands, starterScene, validateScene } from "../shared/scene";

it("enables animation collision detection for new and legacy projects and preserves an explicit opt-out", () => {
  const initial = starterScene();
  expect(initial.animationCollisions).toBe(true);
  const { animationCollisions: _, ...legacy } = initial;
  expect(validateScene(legacy).animationCollisions).toBe(true);
  const disabled = applyCommands(initial, [
    { type: "scene", changes: { animationCollisions: false } },
  ]);
  expect(disabled.animationCollisions).toBe(false);
  expect(
    validateScene(JSON.parse(JSON.stringify(disabled))).animationCollisions,
  ).toBe(false);
  expect(initial.animationCollisions).toBe(true);
  expect(
    applyCommands(disabled, [
      { type: "scene", changes: { animationCollisions: true } },
    ]).animationCollisions,
  ).toBe(true);
});
