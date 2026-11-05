import { useEffect, useState } from "react";
import * as T from "three";
import type { Asset } from "../shared/scene";
import { api } from "./api";
import { gltfLoader, prepareImportedAsset } from "./importedAsset";
import { clearHomeView, setBlockFor } from "./modelSet";

// Imported models get a real rendered preview instead of a drawn placeholder.
// Each is rendered once, one at a time, uploaded, and remembered per browser.
const KEY = "scene-maker-model-thumbnails";
const read = (): Record<string, string> => {
  try {
    return JSON.parse(localStorage.getItem(KEY) || "{}");
  } catch {
    return {};
  }
};
const remember = (id: string, url: string) => {
  try {
    localStorage.setItem(KEY, JSON.stringify({ ...read(), [id]: url }));
  } catch {
    // Without storage the preview is rendered again next session.
  }
};
const pending = new Map<string, Promise<string | null>>();
let queue: Promise<unknown> = Promise.resolve();
let renderer: T.WebGLRenderer | undefined;

async function render(asset: Asset): Promise<string | null> {
  // The studio's own loader reads compressed (Draco, meshopt, KTX2) files.
  const gltf = await gltfLoader().loadAsync(asset.url!);
  const model = prepareImportedAsset(asset, gltf);
  const scene = new T.Scene();
  scene.add(model);
  scene.add(new T.HemisphereLight("#ffffff", "#8a8f80", 2.2));
  const sun = new T.DirectionalLight("#ffffff", 2.4);
  sun.position.set(2, 4, 3);
  scene.add(sun);
  model.updateMatrixWorld(true);
  const box = new T.Box3().setFromObject(model);
  if (box.isEmpty()) return null;
  const size = box.getSize(new T.Vector3()),
    centre = box.getCenter(new T.Vector3());
  const width = 320,
    height = 250;
  const camera = new T.PerspectiveCamera(30, width / height, 0.01, 1000);
  if (asset.category === "environments") {
    // A set is seen as the studio opens it: from its home view, inside it,
    // rather than as a box from outside.
    const { position, target } = clearHomeView(
      model,
      setBlockFor(asset, model),
    ).camera;
    camera.fov = 38;
    camera.near = 0.05;
    camera.updateProjectionMatrix();
    camera.position.set(...position);
    camera.lookAt(...target);
  } else {
    const fit =
      Math.max(size.y, size.x / camera.aspect) /
      2 /
      Math.tan(T.MathUtils.degToRad(camera.fov / 2));
    camera.position.set(centre.x, centre.y, centre.z + fit * 1.15 + size.z / 2);
    camera.lookAt(centre);
  }
  renderer ??= new T.WebGLRenderer({
    antialias: true,
    alpha: true,
    preserveDrawingBuffer: true,
  });
  renderer.setSize(width, height, false);
  renderer.outputColorSpace = T.SRGBColorSpace;
  renderer.setClearColor(0x000000, 0);
  renderer.render(scene, camera);
  const blob = await new Promise<Blob | null>((resolve) =>
    renderer!.domElement.toBlob(resolve, "image/png"),
  );
  scene.traverse((o) => {
    const mesh = o as T.Mesh;
    mesh.geometry?.dispose();
    for (const m of [mesh.material].flat()) (m as T.Material)?.dispose?.();
  });
  if (!blob) return null;
  const form = new FormData();
  form.append("file", blob, "preview.png");
  const { url } = await api<{ url: string }>("/api/thumbnails", {
    method: "POST",
    body: form,
  });
  return url;
}

function thumbnailFor(asset: Asset) {
  let job = pending.get(asset.id);
  if (!job) {
    job = queue.then(() =>
      render(asset)
        .then((url) => {
          if (url) remember(asset.id, url);
          return url;
        })
        .catch(() => null),
    );
    queue = job;
    pending.set(asset.id, job);
  }
  return job;
}

/** The preview to show for an imported model: its own thumbnail, a cached
 * render, or undefined while one is being made (null when it cannot be).
 * `rerender` ignores saved previews, for one whose file is missing. */
export function useModelThumbnail(asset: Asset, rerender = false) {
  const own = rerender ? undefined : (asset.thumbnail ?? read()[asset.id]);
  const [url, setUrl] = useState<string | null | undefined>(own);
  useEffect(() => {
    if (own || !asset.url) return;
    let live = true;
    void thumbnailFor(asset).then((value) => live && setUrl(value));
    return () => {
      live = false;
    };
  }, [asset, own]);
  return own ?? url;
}
