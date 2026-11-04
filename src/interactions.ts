import * as T from "three";
import {
  type Scene,
  type Entity,
  allAssets,
  allMotions,
} from "../shared/scene";
import {
  type HoldSession,
  interactionSessions,
  interactionPhase,
} from "../shared/interactions";
import { applyAnimatedEntityPose } from "./world";
import { configureRigContacts, solveLimb, type RigContacts } from "./ik";
import { applyClimbContacts } from "./climbing";
import { humanoidJointOrientation } from "./rig";
const smooth = (n: number) => {
  const t = Math.min(1, Math.max(0, n));
  return t * t * (3 - 2 * t);
};
const worldPoint = (o: T.Object3D) => o.getWorldPosition(new T.Vector3());
type PropPose = { position: T.Vector3; rotation: T.Quaternion };
export type InteractionWarning = {
  actorId: string;
  targetId: string;
  message: string;
};
function blend(a: PropPose, b: PropPose, t: number): PropPose {
  return {
    position: a.position.clone().lerp(b.position, t),
    rotation: a.rotation.clone().slerp(b.rotation, t),
  };
}
function propPoseAtGrip(
  grip: T.Vector3,
  offset: T.Vector3,
  scale: number,
  rotation: T.Quaternion,
): PropPose {
  return {
    position: grip
      .clone()
      .sub(offset.clone().multiplyScalar(scale).applyQuaternion(rotation)),
    rotation,
  };
}
function crouch(
  rig: T.Group,
  actor: Entity,
  goal: T.Vector3,
  contacts: RigContacts,
  influence = 1,
) {
  if (rig.userData.seat?.amount > 0) return;
  const bones = rig.userData.bones as Record<string, T.Bone>;
  const localY = rig.worldToLocal(goal.clone()).y;
  const shoulder = worldPoint(bones.rightArm),
    elbow = worldPoint(bones.rightForearm);
  const hand = bones.rightForearm.localToWorld(contacts.hand.clone());
  const reach =
    (shoulder.distanceTo(elbow) + elbow.distanceTo(hand)) / actor.scale;
  // A tall/short-armed body may need a shallow crouch even for a tabletop.
  // Leave some arm span available horizontally rather than exhausting it vertically.
  const drop = rig.worldToLocal(shoulder.clone()).y - localY - reach * 0.65;
  const amount =
    influence *
    Math.max(
      smooth((0.7 - localY) / 0.7),
      Math.min(1, Math.max(0, drop / 0.65)),
    );
  if (!amount || !bones.spine || !contacts.leftFoot || !contacts.rightFoot)
    return;
  const feet = ["left", "right"].map((side) =>
    bones[side + "Shin"].localToWorld(
      contacts[(side + "Foot") as "leftFoot" | "rightFoot"]!.clone(),
    ),
  );
  rig.position.y -= 0.65 * actor.scale * amount;
  // Apply the bend in creator/world axes so imported bone rest axes also work.
  const heading = rig.getWorldQuaternion(new T.Quaternion());
  const axis = new T.Vector3(1, 0, 0).applyQuaternion(heading);
  const spineWorld = bones.spine
    .getWorldQuaternion(new T.Quaternion())
    .premultiply(new T.Quaternion().setFromAxisAngle(axis, 0.9 * amount));
  const parent = bones.spine
    .parent!.getWorldQuaternion(new T.Quaternion())
    .invert();
  bones.spine.quaternion.copy(parent.multiply(spineWorld));
  rig.updateWorldMatrix(true, true);
  const pole = new T.Vector3(0, 0, 1).applyQuaternion(heading);
  ["left", "right"].forEach((side, i) =>
    solveLimb(
      bones[side + "Leg"],
      bones[side + "Shin"],
      contacts[(side + "Foot") as "leftFoot" | "rightFoot"]!,
      feet[i],
      pole,
    ),
  );
}
function handTarget(
  rig: T.Group,
  actor: Entity,
  goal: T.Vector3,
  contacts: RigContacts,
  influence = 1,
) {
  const bones = rig.userData.bones as Record<string, T.Bone>;
  if (influence === 0) {
    const hand = bones.rightForearm.localToWorld(contacts.hand.clone());
    return { error: hand.distanceTo(goal), hand };
  }
  crouch(rig, actor, goal, contacts, influence);
  const before =
    influence < 1
      ? [
          bones.rightArm.quaternion.clone(),
          bones.rightForearm.quaternion.clone(),
        ]
      : undefined;
  const pole = new T.Vector3(-1, -0.3, 0.2).applyQuaternion(
    rig.getWorldQuaternion(new T.Quaternion()),
  );
  const result = solveLimb(
    bones.rightArm,
    bones.rightForearm,
    contacts.hand,
    goal,
    pole,
  );
  if (!before) return result;
  // Reaching/releasing must not snap into the IK bend plane at zero contact
  // weight. Full grip contact still uses the exact solved pose at influence 1.
  bones.rightArm.quaternion.copy(
    before[0].slerp(bones.rightArm.quaternion, influence),
  );
  bones.rightForearm.quaternion.copy(
    before[1].slerp(bones.rightForearm.quaternion, influence),
  );
  rig.updateWorldMatrix(true, true);
  const hand = bones.rightForearm.localToWorld(contacts.hand.clone());
  return { error: hand.distanceTo(goal), hand };
}
// Uses the same crouch and arm solver as actual acquisition. Callers restore
// the sampled rig afterward; this probe never edits scene data or a prop.
export function reachableGrip(rig: T.Group, actor: Entity, goal: T.Vector3) {
  const contacts =
    (rig.userData.contacts as RigContacts | undefined) ||
    configureRigContacts(rig);
  return (
    !!contacts &&
    handTarget(rig, actor, goal, contacts).error <= 0.025 * actor.scale
  );
}
/** The character's facing taken from its pelvis (yaw only), so poses built
 * around the body follow the body rather than the root. */
function bodyFacing(rig: T.Group) {
  const root = rig.getWorldQuaternion(new T.Quaternion());
  const pelvis = humanoidJointOrientation(rig, "hips");
  if (!pelvis) return root;
  const forward = new T.Vector3(0, 0, 1).applyQuaternion(pelvis);
  if (Math.hypot(forward.x, forward.z) < 1e-6) return root;
  return new T.Quaternion().setFromAxisAngle(
    new T.Vector3(0, 1, 0),
    Math.atan2(forward.x, forward.z),
  );
}
export function applyInteractions(
  scene: Scene,
  time: number,
  objects: Map<string, T.Group>,
  sessions = interactionSessions(scene, allMotions(scene)),
): InteractionWarning[] {
  const warnings: InteractionWarning[] = [];
  const heldTargets = new Set<string>(),
    occupiedActors = new Set<string>();
  for (const session of sessions) {
    if (time < session.acquire.start) continue;
    const release = session.actions.find((action) => action.kind === "place");
    if (time >= session.end && !release) continue;
    const actor = scene.entities.find((e) => e.id === session.actorId)!,
      target = scene.entities.find((e) => e.id === session.targetId)!;
    const rig = objects.get(actor.id),
      prop = objects.get(target.id);
    if (!actor.visible || !target.visible || !rig || !prop) continue;
    if (heldTargets.has(target.id) || occupiedActors.has(actor.id)) {
      warnings.push({
        actorId: actor.id,
        targetId: target.id,
        message: `Finish putting down the held prop before ${actor.name} uses ${target.name}.`,
      });
      continue;
    }
    const contacts =
      (rig.userData.contacts as RigContacts | undefined) ||
      configureRigContacts(rig);
    if (!contacts) {
      warnings.push({
        actorId: actor.id,
        targetId: target.id,
        message: `${actor.name} needs a compatible arm rig to use ${target.name}.`,
      });
      continue;
    }
    const asset = allAssets(scene).find((a) => a.id === target.assetId)!;
    const grip = new T.Vector3(
      ...((asset.grip ||
        (asset.style === "cup" ? [0.13, 0.08, 0] : [0, 0.1, 0])) as [
        number,
        number,
        number,
      ]),
    );
    const mouth = new T.Vector3(
      ...((asset.mouth || [0, 0.15, -0.04]) as [number, number, number]),
    );
    const home: PropPose = {
      position: worldPoint(prop),
      rotation: prop.getWorldQuaternion(new T.Quaternion()),
    };
    const homeGrip = grip
      .clone()
      .multiplyScalar(target.scale)
      .applyQuaternion(home.rotation)
      .add(home.position);
    // Test contact at acquisition time even while carrying later. A distant prop
    // must never become attached merely because the carried pose is reachable.
    const contactTime =
      session.acquire.start +
      (session.acquire.end - session.acquire.start) *
        (session.temporary ? 0.22 : 0.4);
    applyAnimatedEntityPose(rig, actor, scene, contactTime);
    rig.updateWorldMatrix(true, true);
    const contact = handTarget(rig, actor, homeGrip, contacts);
    applyAnimatedEntityPose(rig, actor, scene, time);
    rig.updateWorldMatrix(true, true);
    if (contact.error > 0.025 * actor.scale) {
      if (time < session.end)
        warnings.push({
          actorId: actor.id,
          targetId: target.id,
          message: `Move ${actor.name} closer to ${target.name}, or add a walk before this action.`,
        });
      continue;
    }
    // A character may have walked away while carrying. Check the release pose
    // too, and keep holding when the original placement is no longer reachable.
    let releaseFailed = false;
    if (release && time >= release.start) {
      applyAnimatedEntityPose(
        rig,
        actor,
        scene,
        release.start + (release.end - release.start) * 0.65,
      );
      rig.updateWorldMatrix(true, true);
      releaseFailed =
        handTarget(rig, actor, homeGrip, contacts).error > 0.025 * actor.scale;
      applyAnimatedEntityPose(rig, actor, scene, time);
      rig.updateWorldMatrix(true, true);
    }
    if (time >= session.end && !releaseFailed) continue;
    heldTargets.add(target.id);
    occupiedActors.add(actor.id);
    if (releaseFailed)
      warnings.push({
        actorId: actor.id,
        targetId: target.id,
        message: `Move ${actor.name} back to ${target.name}'s original spot before Put down. The prop is still in hand.`,
      });
    const bones = rig.userData.bones as Record<string, T.Bone>;
    // Face where the body faces: when a recording ends, its own turn moves
    // onto the root while the blended body continues unchanged.
    const heading = bodyFacing(rig);
    const restHand = bones.rightForearm.localToWorld(contacts.hand.clone());
    // A carried prop rides with the body, not the root: recorded hips move,
    // and one recording stands a little differently on the root than the
    // next (the blended body is continuous across them; the root is not).
    const hips = (rig.userData.bones as Record<string, T.Bone> | undefined)
      ?.hips;
    const carryGrip =
      hips && contacts.hipsHeight !== undefined
        ? hips
            .getWorldPosition(new T.Vector3())
            .add(
              new T.Vector3(-0.25, 1.05 - contacts.hipsHeight, 0.26)
                .multiplyScalar(rig.getWorldScale(new T.Vector3()).x)
                .applyQuaternion(heading),
            )
        : rig.localToWorld(new T.Vector3(-0.25, 1.05, 0.26));
    const carry = propPoseAtGrip(
      carryGrip,
      grip,
      target.scale,
      heading.clone(),
    );
    const mouthPoint = bones.head
      ? worldPoint(bones.head).add(
          new T.Vector3(0, -0.03, 0.18)
            .multiplyScalar(actor.scale)
            .applyQuaternion(heading),
        )
      : rig.localToWorld(new T.Vector3(0, 1.58, 0.18));
    const drinkingRotation = heading
      .clone()
      .multiply(
        new T.Quaternion().setFromAxisAngle(new T.Vector3(1, 0, 0), -0.65),
      );
    const drinking: PropPose = {
      position: mouthPoint.sub(
        mouth
          .clone()
          .multiplyScalar(target.scale)
          .applyQuaternion(drinkingRotation),
      ),
      rotation: drinkingRotation,
    };
    const { kind, u, acquiring } = releaseFailed
      ? { kind: "hold", u: 1, acquiring: false }
      : interactionPhase(session, time);
    let desired = carry,
      attached = true,
      influence = 1,
      goal: T.Vector3 | undefined;
    if (kind === "pick" && acquiring) {
      if (u < 0.4) {
        desired = home;
        attached = false;
        influence = smooth(u / 0.4);
        goal = restHand.clone().lerp(homeGrip, smooth(u / 0.4));
      } else desired = blend(home, carry, smooth((u - 0.4) / 0.6));
    } else if (kind === "sip") {
      if (session.temporary) {
        if (u < 0.22) {
          desired = home;
          attached = false;
          influence = smooth(u / 0.22);
          goal = restHand.clone().lerp(homeGrip, smooth(u / 0.22));
        } else if (u < 0.48)
          desired = blend(home, drinking, smooth((u - 0.22) / 0.26));
        else if (u < 0.62) desired = drinking;
        else if (u < 0.85)
          desired = blend(drinking, home, smooth((u - 0.62) / 0.23));
        else {
          desired = home;
          attached = false;
          influence = 1 - smooth((u - 0.85) / 0.15);
          goal = homeGrip.clone().lerp(restHand, smooth((u - 0.85) / 0.15));
        }
      } else {
        desired =
          u < 0.35
            ? blend(carry, drinking, smooth(u / 0.35))
            : u < 0.65
              ? drinking
              : blend(drinking, carry, smooth((u - 0.65) / 0.35));
      }
    } else if (kind === "place") {
      if (u < 0.65) desired = blend(carry, home, smooth(u / 0.65));
      else {
        desired = home;
        attached = false;
        influence = 1 - smooth((u - 0.65) / 0.35);
        goal = homeGrip.clone().lerp(restHand, smooth((u - 0.65) / 0.35));
      }
    }
    const intendedGrip =
      goal ||
      grip
        .clone()
        .multiplyScalar(target.scale)
        .applyQuaternion(desired.rotation)
        .add(desired.position);
    const solved = handTarget(rig, actor, intendedGrip, contacts, influence);
    if (attached) {
      // The hand and grip stay coincident even at the limb's reach limit.
      desired.position.add(solved.hand.clone().sub(intendedGrip));
      prop.position.copy(
        prop.parent
          ? prop.parent.worldToLocal(desired.position.clone())
          : desired.position,
      );
      const parent =
        prop.parent?.getWorldQuaternion(new T.Quaternion()) ||
        new T.Quaternion();
      prop.quaternion.copy(parent.invert().multiply(desired.rotation));
      prop.updateWorldMatrix(true, true);
    }
  }
  return [...warnings, ...applyClimbContacts(scene, objects, occupiedActors)];
}
