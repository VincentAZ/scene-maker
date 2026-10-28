import * as T from "three";
const point = (o: T.Object3D) => o.getWorldPosition(new T.Vector3());
function rotateWorld(bone: T.Bone, from: T.Vector3, to: T.Vector3) {
  const delta = new T.Quaternion().setFromUnitVectors(
    from.normalize(),
    to.normalize(),
  );
  const world = bone.getWorldQuaternion(new T.Quaternion()).premultiply(delta);
  const parent =
    bone.parent?.getWorldQuaternion(new T.Quaternion()) || new T.Quaternion();
  bone.quaternion.copy(parent.invert().multiply(world)).normalize();
  bone.updateWorldMatrix(true, true);
}
// Analytic two-segment IK. The pole is a world-space bend direction.
export function solveLimb(
  upper: T.Bone,
  lower: T.Bone,
  endOffset: T.Vector3,
  target: T.Vector3,
  pole: T.Vector3,
) {
  upper.updateWorldMatrix(true, true);
  const shoulder = point(upper),
    elbow = point(lower),
    hand = lower.localToWorld(endOffset.clone());
  const a = shoulder.distanceTo(elbow),
    b = elbow.distanceTo(hand),
    difference = target.clone().sub(shoulder),
    distance = difference.length();
  if (a < 1e-6 || b < 1e-6 || distance < 1e-6)
    return { error: hand.distanceTo(target), hand };
  const direction = difference.normalize(),
    d = Math.max(Math.abs(a - b) + 1e-6, Math.min(a + b - 1e-6, distance));
  let bend = pole.clone().addScaledVector(direction, -pole.dot(direction));
  if (bend.lengthSq() < 1e-8) {
    bend = new T.Vector3(0, 1, 0).cross(direction);
    if (bend.lengthSq() < 1e-8) bend = new T.Vector3(1, 0, 0).cross(direction);
  }
  bend.normalize();
  const along = (a * a - b * b + d * d) / (2 * d),
    height = Math.sqrt(Math.max(0, a * a - along * along));
  const desiredElbow = shoulder
    .clone()
    .addScaledVector(direction, along)
    .addScaledVector(bend, height);
  rotateWorld(upper, elbow.clone().sub(shoulder), desiredElbow.sub(shoulder));
  const newElbow = point(lower),
    newHand = lower.localToWorld(endOffset.clone());
  const reachable = shoulder.clone().addScaledVector(direction, d);
  rotateWorld(lower, newHand.sub(newElbow), reachable.sub(newElbow));
  const reached = lower.localToWorld(endOffset.clone());
  return { error: reached.distanceTo(target), hand: reached };
}
export type RigContacts = {
  hand: T.Vector3;
  leftHand?: T.Vector3;
  leftFoot?: T.Vector3;
  rightFoot?: T.Vector3;
};
export function configureRigContacts(group: T.Group): RigContacts | null {
  const bones = group.userData.bones as Record<string, T.Bone> | undefined;
  if (!bones?.rightArm || !bones.rightForearm) return null;
  group.updateWorldMatrix(true, true);
  const extension = (
    upper: T.Bone,
    lower: T.Bone,
    ratio: number,
    endpoint?: T.Bone,
  ) => {
    if (endpoint) return lower.worldToLocal(point(endpoint));
    const start = point(upper),
      mid = point(lower);
    return lower.worldToLocal(
      mid.clone().add(mid.clone().sub(start).multiplyScalar(ratio)),
    );
  };
  const contacts: RigContacts = {
    hand: extension(
      bones.rightArm,
      bones.rightForearm,
      0.3 / 0.29,
      bones.rightHand,
    ),
  };
  if (bones.leftArm && bones.leftForearm)
    contacts.leftHand = extension(
      bones.leftArm,
      bones.leftForearm,
      0.3 / 0.29,
      bones.leftHand,
    );
  for (const side of ["left", "right"] as const)
    if (bones[side + "Leg"] && bones[side + "Shin"])
      contacts[(side + "Foot") as "leftFoot" | "rightFoot"] = extension(
        bones[side + "Leg"],
        bones[side + "Shin"],
        0.35 / 0.4,
        bones[side + "Foot"],
      );
  group.userData.contacts = contacts;
  return contacts;
}
