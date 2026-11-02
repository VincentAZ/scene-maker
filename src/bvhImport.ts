import * as T from "three";
import { BVHLoader } from "three/addons/loaders/BVHLoader.js";
import { GLTFExporter } from "three/addons/exporters/GLTFExporter.js";

/** A BVH motion capture as a mesh-less animated armature: the same shape as an
 * animation-only GLB export, so it imports, retargets and exports through the
 * existing GLB path. Joint names and values are kept as captured; only names
 * that cannot address an animation track are made safe, and unnamed end sites
 * are named after their joint. */
export function bvhArmature(text: string, name: string) {
  const { skeleton, clip } = new BVHLoader().parse(text);
  const root = skeleton.bones[0];
  const names = new Map<string, string>();
  for (const bone of skeleton.bones) {
    const original = bone.name;
    bone.name =
      bone.name === "ENDSITE" && bone.parent
        ? `${bone.parent.name}_End`
        : T.PropertyBinding.sanitizeNodeName(bone.name);
    names.set(original, bone.name);
  }
  // BVHLoader keys every joint's position; only joints that actually
  // translate (normally the root) keep a position track. A constant one
  // becomes the joint's rest position, so nothing moves.
  const byName = new Map(skeleton.bones.map((bone) => [bone.name, bone]));
  const tracks = clip.tracks.flatMap((track) => {
    const dot = track.name.lastIndexOf(".");
    const joint = names.get(track.name.slice(0, dot)) ?? track.name;
    track.name = joint + track.name.slice(dot);
    const values = track.values;
    if (
      track.name.endsWith(".quaternion") ||
      values.some((v, i) => Math.abs(v - values[i % 3]) > 1e-9)
    )
      return [track];
    byName.get(joint)?.position.fromArray(values, 0);
    return [];
  });
  const armature = new T.Group();
  armature.name = "Armature";
  armature.add(root);
  return { scene: armature, clip: new T.AnimationClip(name, -1, tracks) };
}

/** BVH text to a self-contained binary GLB file named after the capture. */
export async function bvhToGlb(text: string, fileName: string) {
  const name = fileName.replace(/\.bvh$/i, "") || "Motion capture";
  const { scene, clip } = bvhArmature(text, name);
  const bytes = await new GLTFExporter().parseAsync(scene, {
    binary: true,
    animations: [clip],
  });
  return new File([bytes as ArrayBuffer], name + ".glb", {
    type: "model/gltf-binary",
  });
}
