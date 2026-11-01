import * as T from "three";
import type { RigMapping } from "../shared/rigMapping";

export function rigBoneInventory(root: T.Object3D) {
  const entries: { bone: T.Bone; path: number[]; label: string }[] = [];
  const visit = (node: T.Object3D, path: number[], names: string[]) => {
    const label =
      (node.name || "Unnamed") +
      (names.length ? ` — ${[...names].reverse().join(" / ")}` : "");
    if (node instanceof T.Bone) entries.push({ bone: node, path, label });
    node.children.forEach((child, index) =>
      visit(child, [...path, index], [...names, node.name || "Unnamed"]),
    );
  };
  visit(root, [], []);
  return entries;
}
export function resolveRigMapping(root: T.Object3D, mapping: RigMapping = {}) {
  const semanticKeys = new Map<T.Bone, string>();
  const roles = new Set(Object.keys(mapping).map((role) => role.toLowerCase()));
  const invalid: string[] = [];
  for (const [role, path] of Object.entries(mapping)) {
    if (path === null) continue;
    let node: T.Object3D | undefined = root;
    for (const index of path) node = node?.children[index];
    if (!(node instanceof T.Bone)) invalid.push(role);
    else semanticKeys.set(node, role.toLowerCase());
  }
  return { semanticKeys, roles, invalid };
}
