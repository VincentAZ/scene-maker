// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { act, createElement as h } from "react";
import { createRoot, type Root } from "react-dom/client";
import * as T from "three";
import { RigMappingEditor } from "../src/RigMappingEditor";
import { loadImportedAsset } from "../src/importedAsset";
import { characters } from "../shared/scene";
vi.mock("../src/importedAsset", () => ({ loadImportedAsset: vi.fn() }));
let container: HTMLDivElement, root: Root;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  const group = new T.Group(),
    bone = new T.Bone();
  bone.name = "OpaqueJoint";
  group.add(bone);
  group.userData.bones = { hips: bone };
  group.userData.mixer = new T.AnimationMixer(group);
  vi.mocked(loadImportedAsset).mockResolvedValue(group);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.resetAllMocks();
  vi.unstubAllGlobals();
});
async function open(
  onSave: (mapping: Record<string, number[] | null>) => void,
) {
  act(() => root.render(h(RigMappingEditor, { asset: characters[0], onSave })));
  await act(async () => {
    const details = container.querySelector("details")!;
    details.open = true;
    details.dispatchEvent(new Event("toggle"));
  });
}
function select(role: string, value: string) {
  act(() => {
    const control = container.querySelector(
      `[aria-label="Map ${role}"]`,
    ) as HTMLSelectElement;
    control.value = value;
    control.dispatchEvent(new Event("change", { bubbles: true }));
  });
}
function apply() {
  act(() =>
    [...container.querySelectorAll("button")]
      .find((button) => button.textContent === "Apply rig mapping")!
      .click(),
  );
}
it("keeps edits as a draft, saves explicit paths, and rejects duplicate assignments", async () => {
  const save = vi.fn();
  await open(save);
  select("hips", "0");
  expect(save).not.toHaveBeenCalled();
  apply();
  expect(save).toHaveBeenLastCalledWith({ hips: [0] });
  expect(container.textContent).toContain("Rig mapping applied to this scene.");
  select("spine", "0");
  apply();
  expect(save).toHaveBeenCalledTimes(1);
  expect(container.querySelector('[role="alert"]')?.textContent).toContain(
    "two joint roles",
  );
  select("spine", "none");
  apply();
  expect(save).toHaveBeenLastCalledWith({ hips: [0], spine: null });
});
it("reports failed imports without leaving a misleading loading message", async () => {
  vi.mocked(loadImportedAsset).mockRejectedValue(
    Error("Missing original file"),
  );
  await open(vi.fn());
  expect(container.querySelector('[role="alert"]')?.textContent).toContain(
    "Missing original file",
  );
  expect(container.textContent).not.toContain("Reading skeleton");
});

it("tells the creator which roles automatic recognition did not find", async () => {
  await open(vi.fn());
  await act(async () => {});
  const option = (role: string) =>
    [
      ...(
        container.querySelector(
          `[aria-label="Map ${role}"]`,
        ) as HTMLSelectElement
      ).options,
    ].find((o) => o.value === "auto")!.textContent;
  expect(option("hips")).toContain("OpaqueJoint");
  expect(option("spine")).toContain("not recognized");
  expect(container.querySelector('[role="note"]')?.textContent).toContain(
    "not recognized",
  );
});
