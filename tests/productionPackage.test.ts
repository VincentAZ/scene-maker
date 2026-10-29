import { it, expect } from "vitest";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import JSZip from "jszip";
import { productionPackage } from "../src/productionPackage";
import { starterScene, characters } from "../shared/scene";
import { assistant } from "../server/ai";

const read: typeof fetch = async (input) => {
  const url = String(input);
  if (url.startsWith("/engine/"))
    return new Response(await readFile("." + url));
  if (url === "/uploads/fixture.glb") return new Response("original source");
  return new Response("Missing", { status: 404 });
};
const hash = (data: Uint8Array) =>
  createHash("sha256").update(data).digest("hex");

it("exports the editable scene, original assets and automatic Unreal project together with exact content hashes", async () => {
  const scene = starterScene();
  scene.name = "A scene with “quotes” and / slashes";
  scene.customAssets.push({
    ...characters[0],
    id: "original",
    name: "Original character",
    category: "characters",
    color: "#ffffff",
    url: "/uploads/fixture.glb",
  });
  const bytes = new TextEncoder().encode("test production payload");
  const zip = await JSZip.loadAsync(
    await productionPackage(scene, bytes.buffer, read),
  );
  const project = JSON.parse(
    await zip.file("SceneMaker.uproject")!.async("string"),
  );
  expect(
    project.Plugins.map((plugin: { Name: string }) => plugin.Name),
  ).toEqual([
    "PythonScriptPlugin",
    "EditorScriptingUtilities",
    "Interchange",
    "SequencerScripting",
  ]);
  expect(JSON.parse(await zip.file("scene.json")!.async("string"))).toEqual(
    scene,
  );
  expect(await zip.file("assets/fixture.glb")!.async("string")).toBe(
    "original source",
  );
  const manifest = JSON.parse(
    await zip.file("unreal-manifest.json")!.async("string"),
  );
  for (const file of ["scene.json", "scene.glb"])
    expect(manifest.sha256[file]).toBe(
      hash(await zip.file(file)!.async("uint8array")),
    );
  expect(manifest.projectId).toBe(scene.id);
  expect(await zip.file("Config/DefaultEngine.ini")!.async("string")).toContain(
    "+StartupScripts=scene_maker_startup.py",
  );
  expect(
    await zip.file("Content/Python/scene_maker_startup.py")!.async("string"),
  ).toBe(await readFile("engine/unreal/scene_maker_startup.py", "utf8"));
  expect(Object.keys(zip.files).some((file) => file.includes(scene.name))).toBe(
    false,
  );
  expect(await zip.file("README.txt")!.async("string")).toContain(
    "playback parity",
  );
});

it("does not produce a partial package when an original asset or required adapter is missing", async () => {
  const scene = starterScene();
  scene.customAssets.push({
    ...characters[0],
    id: "missing",
    name: "Missing character",
    category: "characters",
    color: "#ffffff",
    url: "/uploads/missing.glb",
  });
  await expect(
    productionPackage(scene, new ArrayBuffer(0), read),
  ).rejects.toThrow("Cannot package Missing character");
  await expect(
    productionPackage(
      starterScene(),
      new ArrayBuffer(0),
      async () => new Response("", { status: 404 }),
    ),
  ).rejects.toThrow("production adapter");
});

it("routes explicit Unreal export prompts through the validated assistant workflow", async () => {
  const scene = starterScene();
  for (const prompt of ["Export Unreal", "Export Unreal project"]) {
    const reply = await assistant(
      { providers: {}, assistant: null, blender: "blender" },
      scene,
      prompt,
    );
    expect(reply.mode).toBe("offline");
    expect(reply.steps).toEqual([{ type: "export", format: "unreal" }]);
  }
});
