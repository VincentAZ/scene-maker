import { describe, expect, it } from "vitest";
import * as T from "three";
import { characters, starterScene } from "../shared/scene";
import { applyAnimatedEntityPose, createCharacter } from "../src/world";
import { pathToWorld, samplePath } from "../shared/path";
import {
  applyHumanoidPose,
  applyTransferredClip,
  configureImportedRig,
} from "../src/rig";
import {
  captureFootSurfaces,
  sampleFootSurfaces,
  transferFootClearance,
  footSurfaceContact,
  supportRouteGround,
} from "../src/footSurface";
import {
  correctFootContact,
  footPosition,
  supportRouteFootContacts,
} from "../src/routeContacts";
import { applyRouteFootPlanting } from "../src/routeFootPlanting";
import type { LocomotionProfile } from "../src/locomotion";

function rig(detached = false, weighted = true, rigid = false) {
  const group = new T.Group(),
    body = createCharacter(characters[0]);
  group.add(body);
  const bones = { ...body.userData.bones } as Record<string, T.Bone>;
  for (const [side, suffix] of [
    ["left", "L"],
    ["right", "R"],
  ]) {
    const foot = new T.Bone();
    foot.name = "Foot" + suffix;
    foot.position.set(0, -0.35, 0.03);
    bones[side + "Shin"].add(foot);
    group.updateMatrixWorld(true);
    if (detached) {
      body.attach(foot);
      // Import order must not cause this skin joint to be solved before its leg.
      body.children.splice(body.children.indexOf(foot), 1);
      body.children.unshift(foot);
    }
    bones[side + "Foot"] = foot;
    if (rigid) {
      foot.add(
        new T.Mesh(new T.BoxGeometry(0.1, 0.1, 0.2), new T.MeshBasicMaterial()),
      );
      continue;
    }
    const location = foot.getWorldPosition(new T.Vector3());
    const geometry = new T.BoxGeometry(0.1, 0.1, 0.2).translate(
      ...location.toArray(),
    );
    const count = geometry.attributes.position.count;
    geometry.setAttribute(
      "skinIndex",
      new T.Uint16BufferAttribute(new Uint16Array(count * 4), 4),
    );
    const weights = new Float32Array(count * 4);
    for (let i = 0; i < count; i++) weights[i * 4] = weighted ? 1 : 0;
    geometry.setAttribute(
      "skinWeight",
      new T.Float32BufferAttribute(weights, 4),
    );
    const mesh = new T.SkinnedMesh(geometry, new T.MeshBasicMaterial());
    body.add(mesh);
    group.updateMatrixWorld(true);
    mesh.bind(new T.Skeleton([foot]));
  }
  const configure = (clips: T.AnimationClip[] = []) =>
    configureImportedRig(group, body, clips);
  configure();
  return { group, body, bones, configure };
}

function useShoeGeometryOnly(f: ReturnType<typeof rig>) {
  // This fixture adds shoes to a procedural character that already contains
  // lower-leg meshes. Isolate the rigidly skinned shoe for these assertions.
  const bodyMeshes: T.Mesh[] = [];
  f.body.traverse((node) => {
    if (
      node instanceof T.SkinnedMesh &&
      node.skeleton.bones.includes(f.bones.leftShin)
    )
      bodyMeshes.push(node);
  });
  bodyMeshes.forEach((mesh) => mesh.removeFromParent());
  for (const side of ["left", "right"]) {
    const meshes: T.Mesh[] = [];
    f.bones[side + "Shin"].traverse((node) => {
      if (node instanceof T.Mesh) meshes.push(node);
    });
    meshes.forEach((mesh) => mesh.removeFromParent());
  }
  captureFootSurfaces(f.group);
}

describe("geometry-based foot clearance", () => {
  it("keeps native loop ground support continuous when closure moves the studio root", () => {
    const f = rig();
    const animation = new T.AnimationClip("Small vertical endpoint drift", 2, [
      new T.VectorKeyframeTrack(
        f.body.uuid + ".position",
        [0, 2],
        [0, 0, 0, 0, 0.01, 2],
      ),
    ]);
    f.configure([animation]);
    const scene = starterScene(),
      actor = scene.entities[0];
    actor.position = [1, 0.5, -2];
    actor.rotation = 0.3;
    actor.scale = 1.3;
    scene.customMotions = [
      {
        id: "vertical-loop",
        name: "Vertical loop",
        kind: "imported",
        sourceAssetId: actor.assetId,
        animationName: animation.name,
        path: {
          points: [
            [0, 0, 0],
            [0, 0, 4.4],
          ],
          smooth: false,
        },
        duration: 4.4,
        distance: 0,
        poses: [],
      },
    ];
    actor.clips = [
      {
        id: "loop",
        motionId: "vertical-loop",
        duration: 4.4,
        playbackRate: 1,
        transition: "cut",
      },
    ];
    const sample = (time: number) => {
      applyAnimatedEntityPose(f.group, actor, scene, time);
      const surface = sampleFootSurfaces(f.group)!;
      return {
        hip: f.bones.hips.getWorldPosition(new T.Vector3()),
        sole: surface.lowest * actor.scale + f.group.position.y,
      };
    };
    const before = sample(2 - 1e-6),
      after = sample(2 + 1e-6);
    expect(before.hip.distanceTo(after.hip)).toBeLessThan(1e-5);
    expect(Math.abs(before.sole - after.sole)).toBeLessThan(1e-6);
    const expected = sample(1.95);
    sample(0.1);
    expect(sample(1.95).hip.distanceTo(expected.hip)).toBeLessThan(1e-9);
  });

  it("uses the sampled route elevation rather than world zero for ground support", () => {
    const f = rig();
    const animation = new T.AnimationClip("Elevated route", 2, [
      new T.VectorKeyframeTrack(
        f.body.uuid + ".position",
        [0, 2],
        [0, -0.08, 0, 0, -0.08, 2],
      ),
    ]);
    f.configure([animation]);
    const scene = starterScene(),
      actor = scene.entities[0];
    actor.position = [2, 0.5, -1];
    actor.rotation = 0.7;
    actor.scale = 1.2;
    const path = {
      points: [
        [0, 1, 0],
        [0, 2, 3],
      ] as [number, number, number][],
      smooth: false,
    };
    const duration = samplePath(path, 1).length;
    scene.customMotions = [
      {
        id: "raised-route",
        name: "Raised route",
        kind: "imported",
        sourceAssetId: actor.assetId,
        animationName: animation.name,
        path,
        duration,
        distance: 0,
        poses: [],
      },
    ];
    actor.clips = [
      {
        id: "raised-clip",
        motionId: "raised-route",
        duration,
        transition: "cut",
      },
    ];
    for (const progress of [0.2, 0.6, 0.2]) {
      applyAnimatedEntityPose(f.group, actor, scene, duration * progress);
      const foot = sampleFootSurfaces(f.group)!;
      const ground = pathToWorld(samplePath(path, progress).point, {
        position: actor.position,
        heading: actor.rotation,
        scale: actor.scale,
      })[1];
      const actual = foot.lowest * actor.scale + f.group.position.y;
      expect(actual).toBeCloseTo(ground + foot.bindFloor * actor.scale, 6);
    }
  });
  it("lets bent legs absorb body support near contact while leaving airborne feet alone", () => {
    const f = rig();
    useShoeGeometryOnly(f);
    for (const side of ["left", "right"]) {
      f.bones[side + "Leg"].rotation.x = 0.3;
      f.bones[side + "Shin"].rotation.x = -0.6;
      f.bones[side + "Foot"].rotation.x = 0.3;
    }
    const surface = sampleFootSurfaces(f.group)!;
    f.group.position.y = surface.bindFloor - surface.lowest + 0.02;
    const rotations = ["left", "right"].map((side) =>
      f.bones[side + "Foot"].getWorldQuaternion(new T.Quaternion()),
    );
    const source = {
      left: surface.bindFloor,
      right: surface.bindFloor,
      bindFloor: surface.bindFloor,
    };
    supportRouteFootContacts(f.group, new T.Vector3(), source, 1, 0.75);
    const planted = sampleFootSurfaces(f.group)!;
    expect(planted.lowest + f.group.position.y - planted.bindFloor).toBeCloseTo(
      0,
      6,
    );
    ["left", "right"].forEach((side, i) =>
      expect(
        f.bones[side + "Foot"]
          .getWorldQuaternion(new T.Quaternion())
          .angleTo(rotations[i]),
      ).toBeLessThan(1e-6),
    );
    const pose = Object.values(f.bones).map((bone) =>
      bone.quaternion.toArray(),
    );
    supportRouteFootContacts(
      f.group,
      new T.Vector3(),
      { ...source, left: source.left + 0.2, right: source.right + 0.2 },
      1,
      0.75,
    );
    expect(
      Object.values(f.bones).map((bone) => bone.quaternion.toArray()),
    ).toEqual(pose);
  });
  it.each([0.1, 1, 4])(
    "keeps small ground-support changes continuous at scale %s",
    (scale) => {
      for (const clearance of [0.5e-6, 1e-6, 1.5e-6]) {
        const f = rig();
        useShoeGeometryOnly(f);
        f.group.scale.setScalar(scale);
        for (const side of ["left", "right"]) {
          f.bones[side + "Leg"].rotation.x = 0.3;
          f.bones[side + "Shin"].rotation.x = -0.6;
          f.bones[side + "Foot"].rotation.x = 0.3;
        }
        const surface = sampleFootSurfaces(f.group)!;
        f.group.position.y =
          (surface.bindFloor - surface.lowest + clearance) * scale;
        supportRouteFootContacts(
          f.group,
          new T.Vector3(),
          {
            left: surface.bindFloor,
            right: surface.bindFloor,
            bindFloor: surface.bindFloor,
          },
          1,
          0.75,
        );
        const result = sampleFootSurfaces(f.group)!;
        for (const side of ["left", "right"] as const)
          expect(
            Math.abs(
              result[side] - result.bindFloor + f.group.position.y / scale,
            ),
          ).toBeLessThan(1e-9);
      }
    },
  );
  it("removes route penetration at an elevated ground height without lowering flight or changing joints", () => {
    const f = rig(true);
    const base = new T.Vector3(2, 3, -4);
    f.group.position.copy(base);
    f.group.rotation.y = 0.7;
    f.group.scale.setScalar(1.6);
    f.body.position.y = -0.08;
    const joints = Object.values(f.bones).map((bone) => ({
      position: bone.position.toArray(),
      rotation: bone.quaternion.toArray(),
    }));
    supportRouteGround(f.group, base);
    expect(f.group.position.y - base.y).toBeCloseTo(0.08 * 1.6, 6);
    const grounded = f.group.position.clone();
    supportRouteGround(f.group, base);
    expect(f.group.position.toArray()).toEqual(grounded.toArray());
    expect(f.group.position.x).toBe(base.x);
    expect(f.group.position.z).toBe(base.z);
    Object.values(f.bones).forEach((bone, i) => {
      expect(bone.position.toArray()).toEqual(joints[i].position);
      expect(bone.quaternion.toArray()).toEqual(joints[i].rotation);
    });
    f.group.position.copy(base);
    f.body.position.y = 0.2;
    supportRouteGround(f.group, base);
    expect(f.group.position.toArray()).toEqual(base.toArray());
  });
  it("solves the visible sole directly on rigs without an ankle joint", () => {
    const group = createCharacter(characters[0]);
    captureFootSurfaces(group);
    group.userData.bones.leftLeg.rotation.x = 0.25;
    group.userData.bones.leftShin.rotation.x = -0.5;
    const endpoint = footSurfaceContact(group, "left")!;
    const desired = endpoint.clone().add(new T.Vector3(0.02, 0, 0.025));
    correctFootContact(group, "left", desired, 1, 0.1, endpoint);
    expect(footSurfaceContact(group, "left")!.distanceTo(desired)).toBeLessThan(
      1e-6,
    );
  });
  it("tracks a fixed sole material point through foot roll and actor transforms", () => {
    const f = rig(true);
    useShoeGeometryOnly(f);
    const first = footSurfaceContact(f.group, "left")!;
    const local = f.bones.leftFoot.worldToLocal(first.clone());
    f.bones.leftFoot.rotation.set(0.3, 0.5, 0.1);
    f.group.position.set(2, 0.4, -3);
    f.group.rotation.y = 0.8;
    f.group.scale.setScalar(1.6);
    f.group.updateMatrixWorld(true);
    expect(
      footSurfaceContact(f.group, "left")!.distanceTo(
        f.bones.leftFoot.localToWorld(local),
      ),
    ).toBeLessThan(1e-6);
  });

  it.each([true, false])(
    "preserves source contact displacement with a different shoe shape (source surface=%s)",
    (useSurface) => {
      const source = rig(),
        target = rig();
      useShoeGeometryOnly(source);
      useShoeGeometryOnly(target);
      const shoe = target.body.children.find(
        (node) =>
          node instanceof T.SkinnedMesh &&
          node.skeleton.bones[0] === target.bones.leftFoot,
      ) as T.SkinnedMesh;
      shoe.geometry.translate(0, 0, 0.1);
      captureFootSurfaces(target.group);
      const scene = starterScene(),
        actor = scene.entities[0];
      actor.scale = 1;
      const sourcePoint = (time: number) => {
        applyHumanoidPose(source.group, {}, true);
        source.bones.leftLeg.rotation.x = 0.2;
        source.bones.leftShin.rotation.x = -0.4;
        source.bones.leftFoot.rotation.set(0.2, time * 0.3, 0);
        return (useSurface ? footSurfaceContact : footPosition)(
          source.group,
          "left",
        )!;
      };
      const profile: LocomotionProfile = {
        distance: 1,
        duration: 1,
        startHeading: 0,
        warning: "",
        mode: "travel",
        frames: [],
        contacts: [
          {
            side: "left",
            start: 0,
            end: 0.8,
            samples: Array.from({ length: 49 }, (_, i) => {
              const point = sourcePoint(i / 60);
              return {
                time: i / 60,
                ...(useSurface ? { sole: point } : {}),
                point: footPosition(source.group, "left")!,
              };
            }),
          },
        ],
      };
      const raw = (time: number) => {
        applyHumanoidPose(target.group, {}, true);
        target.group.position.set(time * 0.02, 0, 0);
        target.bones.leftLeg.rotation.x = 0.2;
        target.bones.leftShin.rotation.x = -0.4;
        target.bones.leftFoot.rotation.set(0.2, time * 0.3, 0);
        target.group.updateMatrixWorld(true);
      };
      raw(0);
      const targetPoint = useSurface ? footSurfaceContact : footPosition;
      const anchor = targetPoint(target.group, "left")!;
      const original = sourcePoint(0);
      const sample = (time: number) => {
        raw(time);
        const orientation = target.bones.leftFoot.getWorldQuaternion(
          new T.Quaternion(),
        );
        applyRouteFootPlanting(
          target.group,
          actor,
          scene,
          time,
          {
            profile,
            sample: { time },
            ratio: 1,
            start: 0,
            duration: 1,
            sourceDuration: 1,
          },
          false,
          raw,
        );
        expect(
          target.bones.leftFoot
            .getWorldQuaternion(new T.Quaternion())
            .angleTo(orientation),
        ).toBeLessThan(1e-6);
        return targetPoint(target.group, "left")!;
      };
      for (const time of [0.2, 0.7, 0.4, 0.2]) {
        const actual = sample(time),
          expected = anchor.clone().add(sourcePoint(time).sub(original));
        expect(
          Math.hypot(actual.x - expected.x, actual.z - expected.z),
        ).toBeLessThan(0.001);
      }
    },
  );

  it("refreshes attached skin matrices when an animation moves the imported root", () => {
    const f = rig();
    const before = sampleFootSurfaces(f.group)!;
    f.body.position.y = 0.4;
    f.group.position.set(4, 3, -2);
    f.group.rotation.y = 0.7;
    f.group.scale.setScalar(1.7);
    f.group.updateWorldMatrix(true, true); // deliberately does not update skin bind inverse
    const after = sampleFootSurfaces(f.group)!;
    expect(after.lowest - before.lowest).toBeCloseTo(0.4, 6);
    expect(after.bindFloor).toBe(before.bindFloor);
  });

  it("preserves airborne clearance and target pose instead of snapping every frame to ground", () => {
    const source = rig(),
      target = rig();
    source.body.position.y = 0.35;
    target.body.position.y = -0.1;
    target.group.position.set(2, 4, -3);
    target.group.rotation.y = 0.8;
    target.group.scale.setScalar(1.5);
    const base = target.group.position.clone();
    const poses = Object.values(target.bones).map(
      (b) => [b.position.clone(), b.quaternion.clone()] as const,
    );
    transferFootClearance(source.group, target.group, base, 1.2);
    const foot = sampleFootSurfaces(target.group)!;
    const actual = foot.lowest + (target.group.position.y - base.y) / 1.5;
    expect(actual - foot.bindFloor).toBeCloseTo(0.35 * 1.2, 6);
    expect(target.group.position.x).toBe(base.x);
    expect(target.group.position.z).toBe(base.z);
    Object.values(target.bones).forEach((bone, i) => {
      expect(bone.position.toArray()).toEqual(poses[i][0].toArray());
      expect(bone.quaternion.toArray()).toEqual(poses[i][1].toArray());
    });
  });

  it("leaves a rig without usable foot geometry uncalibrated", () => {
    const group = new T.Group();
    captureFootSurfaces(group);
    expect(sampleFootSurfaces(group)).toBeUndefined();
  });
  it("recognizes rigid foot attachments outside the leg hierarchy", () => {
    const f = rig(true, true, true);
    expect(f.group.userData.detachedJointAnchors.size).toBe(2);
    const before = sampleFootSurfaces(f.group)!.lowest;
    f.body.position.y += 0.3;
    expect(sampleFootSurfaces(f.group)!.lowest - before).toBeCloseTo(0.3, 6);
  });
  it("includes animated foot morphs in the measured surface", () => {
    const f = rig();
    const mesh = f.body.children.find(
      (node) =>
        node instanceof T.SkinnedMesh &&
        node.skeleton.bones[0] === f.bones.leftFoot,
    ) as T.SkinnedMesh;
    const values = new Float32Array(
      mesh.geometry.attributes.position.count * 3,
    );
    for (let i = 0; i < values.length; i += 3) values[i + 1] = -0.08;
    mesh.geometry.morphTargetsRelative = true;
    mesh.geometry.morphAttributes.position = [
      new T.Float32BufferAttribute(values, 3),
    ];
    mesh.updateMorphTargets();
    const before = new T.Box3().setFromObject(mesh, true).min.y;
    mesh.morphTargetInfluences![0] = 1;
    expect(sampleFootSurfaces(f.group)!.lowest - before).toBeCloseTo(-0.08, 6);
  });
  it("includes soles whose skin weights are split between the ankle and shin", () => {
    const f = rig();
    for (const side of ["left", "right"]) {
      const foot = f.bones[side + "Foot"],
        shin = f.bones[side + "Shin"];
      const mesh = f.body.children.find(
        (node) =>
          node instanceof T.SkinnedMesh && node.skeleton.bones[0] === foot,
      ) as T.SkinnedMesh;
      mesh.bind(new T.Skeleton([foot, shin]));
      const indices = mesh.geometry.attributes.skinIndex,
        weights = mesh.geometry.attributes.skinWeight;
      for (let i = 0; i < weights.count; i++) {
        indices.setY(i, 1);
        weights.setX(i, 0.4);
        weights.setY(i, 0.6);
      }
    }
    captureFootSurfaces(f.group);
    const sole = sampleFootSurfaces(f.group)!;
    expect(Number.isFinite(sole.lowest)).toBe(true);
    expect(sole.lowest).toBeCloseTo(
      new T.Box3().setFromObject(f.group, true).min.y,
      6,
    );
  });
});

describe("skin joints outside the hip hierarchy", () => {
  it.each([
    [true, false],
    [false, true],
    [true, true],
  ])(
    "retargets detached feet with their leg anchors (source=%s, target=%s)",
    (sourceDetached, targetDetached) => {
      const source = rig(sourceDetached),
        target = rig(targetDetached);
      const moved = ["hips", "leftFoot", "rightFoot"];
      const tracks: T.KeyframeTrack[] = moved.map((role) => {
        const bone = source.bones[role],
          p = bone.position;
        const isDetached = role === "hips" || sourceDetached;
        return new T.VectorKeyframeTrack(
          bone.uuid + ".position",
          [0, 1],
          [
            ...p.toArray(),
            p.x + (isDetached ? 0.3 : 0),
            p.y,
            p.z + (isDetached ? 0.6 : 0),
          ],
        );
      });
      tracks.push(
        new T.QuaternionKeyframeTrack(
          source.bones.leftFoot.uuid + ".quaternion",
          [0, 1],
          [
            0,
            0,
            0,
            1,
            ...new T.Quaternion()
              .setFromEuler(new T.Euler(0.4, 0.1, 0))
              .toArray(),
          ],
        ),
      );
      const clip = new T.AnimationClip("Independent skinned feet", 1, tracks);
      source.configure([clip]);
      for (const time of [0.2, 0.7, 0.3, 0.7]) {
        target.group.position.set(0, 0, 0);
        applyHumanoidPose(target.group, {}, true);
        expect(
          applyTransferredClip(source.group, target.group, clip, time),
        ).toBe("");
        for (const side of ["left", "right"]) {
          const a = source.bones[side + "Foot"],
            b = target.bones[side + "Foot"];
          expect(
            b
              .getWorldPosition(new T.Vector3())
              .distanceTo(a.getWorldPosition(new T.Vector3())),
          ).toBeLessThan(1e-6);
          expect(
            b
              .getWorldQuaternion(new T.Quaternion())
              .normalize()
              .angleTo(a.getWorldQuaternion(new T.Quaternion()).normalize()),
          ).toBeLessThan(1e-6);
        }
        expect(target.group.userData.retargetReport.unsupported).toEqual([]);
      }
    },
  );

  it("ignores detached unweighted controls despite anatomical names", () => {
    const f = rig(true, false);
    expect(f.group.userData.bones.leftFoot).toBeUndefined();
    expect(f.group.userData.detachedJointAnchors.size).toBe(0);
  });

  it("moves a detached skin foot to a reachable contact without changing height or orientation", () => {
    const f = rig(true);
    const foot = f.bones.leftFoot;
    const q = foot.getWorldQuaternion(new T.Quaternion());
    const desired = footPosition(f.group, "left")!.add(
      // Move inside the nearly straight leg's horizontal reach circle. The
      // former outward target could only be reached by lifting the foot.
      new T.Vector3(0.01, 0.02, -0.015),
    );
    const oldHeight = footPosition(f.group, "left")!.y;
    correctFootContact(f.group, "left", desired, 1, 0.1);
    desired.y = oldHeight;
    expect(footPosition(f.group, "left")!.distanceTo(desired)).toBeLessThan(
      1e-6,
    );
    expect(foot.getWorldQuaternion(new T.Quaternion()).angleTo(q)).toBeLessThan(
      1e-6,
    );
  });
});
