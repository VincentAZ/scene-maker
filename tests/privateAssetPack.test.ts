import { describe, expect, it } from "vitest";
import {
  localStudioURL,
  privatePackScene,
  privatePackSchema,
  type ImportedPrivateModel,
} from "../scripts/register-private-pack";
import { validateScene } from "../shared/scene";

function fixture() {
  const pack = privatePackSchema.parse({
    name: "Private cast",
    mission: "Review the user's own imported cast, not a bundled asset collection.",
    models: [
      { slug: "actor", name: "Actor", category: "characters", body: "feminine", glb: "actor.glb", thumbnail: "actor.png",
        placement: { position: [-1, 0, 0], scale: 0.9, action: "Greeting" } },
      { slug: "source", name: "Motion source", category: "characters", glb: "source.glb", thumbnail: "source.png" },
      { slug: "bench", name: "Bench", category: "props", glb: "bench.glb", thumbnail: "bench.png",
        seat: { position: [0, 0.45, 0.05], width: 1.2, depth: 0.4 }, placement: { position: [1, 0, 1] } },
    ],
  });
  const imported: ImportedPrivateModel[] = pack.models.map((definition, i) => ({
    definition, sha256: String(i + 1).repeat(64), url: `/uploads/model-${i}.glb`,
    thumbnail: `/uploads/preview-${i}.png`, animations: i === 1 ? [{ name: "Greeting", duration: 28.133333333 }] : [],
  }));
  return { pack, imported };
}

describe("private downloaded asset collections", () => {
  it("creates an independent, validated project with real thumbnails and shared motions", () => {
    const { pack, imported } = fixture();
    const before = JSON.stringify({ pack, imported });
    const scene = privatePackScene(pack, imported);
    expect(validateScene(scene)).toEqual(scene);
    expect(scene.customAssets).toHaveLength(3);
    expect(scene.entities).toHaveLength(2);
    expect(scene.revision).toBe(0);
    expect(scene.environment).toBe("studio");
    expect(scene.transcript).toEqual([]);
    expect(scene.customAssets[0]).toMatchObject({ thumbnail: "/uploads/preview-0.png", style: "Imported", body: "feminine" });
    expect(scene.customAssets[2].seat).toEqual(pack.models[2].seat);
    expect(scene.entities[0]).toMatchObject({ scale: 0.9, position: [-1, 0, 0] });
    expect(scene.customMotions[0].sourceAssetId).toBe(scene.customAssets[1].id);
    expect(scene.entities[0].clips[0]).toMatchObject({ motionId: scene.customMotions[0].id, duration: 28.133333333 });
    expect(JSON.stringify({ pack, imported })).toBe(before);
  });

  it("uses content-stable asset IDs but creates a new project every time", () => {
    const { pack, imported } = fixture();
    const a = privatePackScene(pack, imported), b = privatePackScene(pack, imported);
    expect(a.id).not.toBe(b.id);
    expect(a.customAssets.map((asset) => asset.id)).toEqual(b.customAssets.map((asset) => asset.id));
    imported[0].sha256 = "a".repeat(64);
    expect(privatePackScene(pack, imported).customAssets[0].id).not.toBe(a.customAssets[0].id);
  });

  it("rejects mismatched imports, missing hashes, and untrusted upload URLs", () => {
    const { pack, imported } = fixture();
    expect(() => privatePackScene(pack, imported.slice(1))).toThrow("match");
    expect(() => privatePackScene(pack, [imported[1], imported[0], imported[2]])).toThrow("match");
    expect(() => privatePackScene(pack, [{ ...imported[0], sha256: "missing" }, ...imported.slice(1)])).toThrow("hash");
    imported[0].url = "https://example.com/model.glb";
    expect(() => privatePackScene(pack, imported)).toThrow();
  });

  it("requires unique slugs, unique requested takes, supported durations and character sources", () => {
    const { pack, imported } = fixture();
    expect(() => privatePackSchema.parse({ ...pack, models: [pack.models[0], pack.models[0]] })).toThrow("unique");
    imported[0].animations = [{ name: "Greeting", duration: 1 }];
    expect(() => privatePackScene(pack, imported)).toThrow("one take");
    imported[0].animations = [];
    imported[1].animations[0].duration = 61;
    expect(() => privatePackScene(pack, imported)).toThrow();
    imported[1].animations[0].duration = 1;
    imported[2].animations = [{ name: "Unexpected", duration: 1 }];
    expect(() => privatePackScene(pack, imported)).toThrow("Only characters");
  });

  it("rejects missing showcase actions without silently substituting an idle", () => {
    const { pack, imported } = fixture();
    pack.models[0].placement!.action = "Not downloaded";
    expect(() => privatePackScene(pack, imported)).toThrow("Not downloaded");
  });
});

describe("private pack registration origin", () => {
  it("permits only the local studio, without URL credentials, query or path", () => {
    expect(localStudioURL("http://localhost:4311").origin).toBe("http://localhost:4311");
    expect(localStudioURL("http://127.0.0.1:4311/").origin).toBe("http://127.0.0.1:4311");
    for (const value of ["https://example.com", "http://127.0.0.1.example.com:4311", "file:///tmp", "http://user:pass@localhost:4311", "http://localhost:4311/path", "http://localhost:4311/?secret=1", "http://localhost:4311/#fragment"])
      expect(() => localStudioURL(value), value).toThrow("local studio");
  });
});
