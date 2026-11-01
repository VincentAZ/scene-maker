import * as T from "three";
import type { Entity } from "../shared/scene";
import type { SeatSample, SeatBody } from "../shared/seating";
import { turnPoint } from "../shared/ladder";
import { configureRigContacts, solveLimb, type RigContacts } from "./ik";

/** Called in the calibrated neutral pose; all dimensions are character-local. */
export function measureSeatBody(rig: T.Group): SeatBody | undefined {
  rig.updateMatrixWorld(true);
  const bones = rig.userData.bones as Record<string, T.Bone> | undefined;
  const contacts =
    (rig.userData.contacts as RigContacts) || configureRigContacts(rig);
  if (
    !bones?.hips ||
    !bones.leftLeg ||
    !bones.leftShin ||
    !bones.rightLeg ||
    !bones.rightShin ||
    !contacts?.leftFoot ||
    !contacts.rightFoot
  )
    return;
  const local = (bone: T.Object3D) =>
    rig.worldToLocal(bone.getWorldPosition(new T.Vector3()));
  const hip = local(bones.hips),
    upper = local(bones.rightLeg),
    lower = local(bones.rightShin),
    foot = rig.worldToLocal(
      bones.rightShin.localToWorld(contacts.rightFoot.clone()),
    );
  let skinBottom = hip.y;
  const soleVertices: Record<
    "left" | "right",
    { mesh: T.SkinnedMesh; vertices: number[] }[]
  > = { left: [], right: [] };
  const soles = { left: Infinity, right: Infinity };
  rig.traverse((object) => {
    if (!(object instanceof T.SkinnedMesh)) return;
    const index = object.skeleton.bones.indexOf(bones.hips),
      indices = object.geometry.getAttribute("skinIndex"),
      weights = object.geometry.getAttribute("skinWeight");
    if (!indices || !weights) return;
    for (const side of ["left", "right"] as const) {
      const footBones: number[] = [];
      bones[side + "Shin"].traverse((bone) => {
        if (bone instanceof T.Bone) {
          const i = object.skeleton.bones.indexOf(bone);
          if (i >= 0) footBones.push(i);
        }
      });
      bones[side + "Foot"]?.traverse((bone) => {
        const i = object.skeleton.bones.indexOf(bone as T.Bone);
        if (i >= 0 && !footBones.includes(i)) footBones.push(i);
      });
      const vertices: number[] = [];
      for (let i = 0; i < indices.count; i++) {
        let influence = 0;
        for (let j = 0; j < 4; j++)
          if (footBones.includes(indices.getComponent(i, j)))
            influence += weights.getComponent(i, j);
        if (influence < 0.1) continue;
        vertices.push(i);
        const point = rig.worldToLocal(
          object.localToWorld(object.getVertexPosition(i, new T.Vector3())),
        );
        soles[side] = Math.min(soles[side], point.y);
      }
      if (vertices.length) soleVertices[side].push({ mesh: object, vertices });
    }
    for (let i = 0; i < indices.count; i++) {
      let influence = 0;
      for (let j = 0; j < 4; j++)
        if (indices.getComponent(i, j) === index)
          influence += weights.getComponent(i, j);
      if (influence < 0.4) continue;
      const vertex = rig.worldToLocal(
        object.localToWorld(object.getVertexPosition(i, new T.Vector3())),
      );
      skinBottom = Math.min(skinBottom, vertex.y);
    }
  });
  rig.userData.seatSoles = soleVertices;
  for (const side of ["left", "right"] as const)
    if (!Number.isFinite(soles[side])) soles[side] = 0;
  const padding = Math.max(0.04, Math.min(0.25, hip.y - skinBottom)) + 0.003;
  return {
    padding,
    hipToLeg: hip.y - upper.y,
    soles,
    hipHeight: hip.y,
    hipOffset: hip.toArray(),
    feet: {
      left: rig
        .worldToLocal(bones.leftShin.localToWorld(contacts.leftFoot!.clone()))
        .toArray(),
      right: foot.toArray(),
    },
    upperLength: upper.distanceTo(lower),
    lowerLength: lower.distanceTo(foot),
    footHeight: foot.y,
    hipWidth: local(bones.leftLeg).distanceTo(upper),
  };
}
/** Seat support is applied after body blending, leaving upper-body gestures free. */
export function applySeatSupport(rig: T.Group, actor: Entity) {
  const sample = rig.userData.seat as SeatSample | undefined;
  if (!sample || !actor.visible) return;
  if (sample.plan.warning) {
    rig.userData.motionWarning = sample.plan.warning;
    return;
  }
  if (sample.amount <= 0) return;
  const bones = rig.userData.bones as Record<string, T.Bone>;
  const contacts =
    (rig.userData.contacts as RigContacts) || configureRigContacts(rig);
  const body = rig.userData.seatBody as SeatBody;
  if (!body || !contacts?.leftFoot || !contacts.rightFoot) return;
  rig.updateWorldMatrix(true, true);
  // Suppress lower-body bob/lean translations while retaining authored torso rotations.
  const seatedHeight = sample.plan.anchor[1] + body.padding * actor.scale;
  const standingHeight = sample.plan.floor + body.hipHeight * actor.scale;
  const hipOffset = turnPoint(
    body.hipOffset.map((n) => n * actor.scale * (1 - sample.amount)) as [
      number,
      number,
      number,
    ],
    sample.plan.facing,
  );
  const position = new T.Vector3(
    rig.position.x + hipOffset[0],
    standingHeight + (seatedHeight - standingHeight) * sample.amount,
    rig.position.z + hipOffset[2],
  );
  bones.hips.position.copy(bones.hips.parent!.worldToLocal(position));
  bones.hips.updateWorldMatrix(true, true);
  let error = 0;
  for (const side of ["left", "right"] as const) {
    const horizontal = turnPoint(
      body.feet[side].map((n) => n * actor.scale) as [number, number, number],
      sample.plan.facing,
    );
    const goal = new T.Vector3(
      sample.plan.front[0] + horizontal[0],
      sample.plan.floor + horizontal[1],
      sample.plan.front[2] + horizontal[2],
    );
    const pole = new T.Vector3(...turnPoint([0, 0, 1], sample.plan.facing));
    const foot = bones[side + "Foot"],
      shin = bones[side + "Shin"];
    const detached =
      foot &&
      (
        rig.userData.detachedJointAnchors as Map<T.Bone, T.Bone> | undefined
      )?.has(foot);
    const relativeRotation = detached
      ? shin
          .getWorldQuaternion(new T.Quaternion())
          .invert()
          .multiply(foot.getWorldQuaternion(new T.Quaternion()))
      : undefined;
    const solve = () => {
      const result = solveLimb(
        bones[side + "Leg"],
        bones[side + "Shin"],
        contacts[`${side}Foot`]!,
        goal,
        pole,
      );
      if (detached && relativeRotation) {
        foot.position.copy(foot.parent!.worldToLocal(result.hand.clone()));
        foot.quaternion.copy(
          foot
            .parent!.getWorldQuaternion(new T.Quaternion())
            .invert()
            .multiply(shin.getWorldQuaternion(new T.Quaternion()))
            .multiply(relativeRotation),
        );
        foot.updateWorldMatrix(true, true);
      }
      return result.error;
    };
    let reachError = solve();
    const meshes = rig.userData.seatSoles[side] as {
      mesh: T.SkinnedMesh;
      vertices: number[];
    }[];
    // Correct the visible sole, since ankle contact alone leaves some shoes floating.
    const height =
      sample.plan.floor + body.soles[side] * actor.scale * (1 - sample.amount);
    for (let attempt = 0; attempt < 8 && meshes.length; attempt++) {
      rig.updateMatrixWorld(true);
      let bottom = Infinity;
      for (const { mesh, vertices } of meshes)
        for (const index of vertices)
          bottom = Math.min(
            bottom,
            mesh.localToWorld(mesh.getVertexPosition(index, new T.Vector3())).y,
          );
      if (Math.abs(bottom - height) < 0.0005 * actor.scale) break;
      goal.y += height - bottom;
      reachError = solve();
    }
    error = Math.max(error, reachError);
  }
  if (error > 0.025 * actor.scale)
    rig.userData.motionWarning = `Resize ${sample.plan.targetName} to give ${actor.name} a supported sitting pose.`;
}
