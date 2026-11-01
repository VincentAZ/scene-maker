import * as T from "three";
import { afterEach, expect, it, vi } from "vitest";
import { characters, starterScene } from "../shared/scene";
import { createCharacter } from "../src/world";
import { configureImportedRig, setMotionSources } from "../src/rig";
import * as locomotion from "../src/locomotion";
import { sampleWithTransitions } from "../src/transitions";
import {
  captureTransitionContacts,
  transitionContactTargets,
} from "../src/transitionContacts";
import { footContactPosition } from "../src/routeContacts";
import { sampleFootSurfaces } from "../src/footSurface";

afterEach(() => vi.restoreAllMocks());

function fixture() {
  const scene = starterScene(),
    actor = scene.entities[0];
  actor.position = [0, 0, 0];
  actor.scale = 1;
  actor.rotation = 0;
  actor.clips = [
    { id: "before", motionId: "walk", duration: 1 },
    {
      id: "after",
      motionId: "captured",
      duration: 1,
      sourceStart: 1,
      playbackRate: 1,
      transition: "smooth",
    },
  ];
  scene.entities = [actor];
  const body = createCharacter(characters[0]),
    group = new T.Group();
  group.add(body);
  const take = new T.AnimationClip("Captured stance", 3, []);
  configureImportedRig(group, body, [take]);
  scene.customMotions.push({
    id: "captured",
    name: take.name,
    kind: "imported",
    animationName: take.name,
    sourceAssetId: actor.assetId,
    duration: 3,
    distance: 1,
    poses: [],
  });
  const profile: locomotion.LocomotionProfile = {
    frames: [],
    distance: 1,
    duration: 3,
    startHeading: 0,
    mode: "travel",
    // A loop warning must not reject an interior captured stance.
    warning: "This take does not repeat seamlessly.",
    contacts: [{ side: "right", start: 0.5, end: 1.6, samples: [] }],
    nativeContacts: [{ side: "right", start: 0.5, end: 1.6, samples: [] }],
  };
  vi.spyOn(locomotion, "locomotionProfile").mockReturnValue(profile);
  const saved: {
    node: T.Object3D;
    p: T.Vector3;
    q: T.Quaternion;
    s: T.Vector3;
  }[] = [];
  group.traverse((node) =>
    saved.push({
      node,
      p: node.position.clone(),
      q: node.quaternion.clone(),
      s: node.scale.clone(),
    }),
  );
  const raw = (time: number) => {
    for (const { node, p, q, s } of saved) {
      node.position.copy(p);
      node.quaternion.copy(q);
      node.scale.copy(s);
    }
    for (const side of ["left", "right"]) {
      body.userData.bones[side + "Leg"].rotation.x = -0.3;
      body.userData.bones[side + "Shin"].rotation.x = 0.6;
    }
    group.updateMatrixWorld(true);
    body.position.y -= sampleFootSurfaces(group)!.lowest;
    body.position.x = time < 1 ? 0 : 0.04;
    group.updateMatrixWorld(true);
  };
  const sample = (time: number) => {
    sampleWithTransitions(group, actor, scene, time, raw);
    return footContactPosition(group, "right")!;
  };
  return { scene, actor, group, body, profile, raw, sample };
}

it("keeps the visible sole planted beyond the pose blend and releases continuously", () => {
  const f = fixture(),
    anchor = f.sample(1 - 1e-7);
  for (const time of [1, 1.1, 1.25, 1.4, 1.6]) {
    const actual = f.sample(time);
    expect(Math.hypot(actual.x - anchor.x, actual.z - anchor.z)).toBeLessThan(
      1e-5,
    );
  }
  const middle = f.sample(1.7);
  expect(middle.x - anchor.x).toBeCloseTo(0.02, 5);
  f.raw(1.8);
  const released = footContactPosition(f.group, "right")!;
  expect(f.sample(1.8).distanceTo(released)).toBeLessThan(1e-8);
  for (const boundary of [1.6, 1.8]) {
    const at = f.sample(boundary),
      step = 1e-5;
    const incoming = at
      .clone()
      .sub(f.sample(boundary - step))
      .divideScalar(step);
    const outgoing = f
      .sample(boundary + step)
      .sub(at)
      .divideScalar(step);
    expect(incoming.distanceTo(outgoing)).toBeLessThan(0.001);
  }
});

it("warms a contact on a late first seek and preserves it in the held final pose", () => {
  const f = fixture();
  f.actor.clips[1].duration = 0.5;
  const expected = f.sample(1.4);
  for (const time of [7, 0, 1.1, 3, 1.4]) {
    const actual = f.sample(time);
    if (time >= 1.4) expect(actual.distanceTo(expected)).toBeLessThan(1e-8);
  }
  const rest = { ...f.actor, ending: "rest" as const };
  sampleWithTransitions(f.group, rest, f.scene, 3, f.raw);
  expect(footContactPosition(f.group, "right")!.x - expected.x).toBeCloseTo(
    0.04,
    5,
  );
});

it("maps source stance and release to explicit playback speed", () => {
  const f = fixture();
  f.actor.clips[1].playbackRate = 2;
  const contacts = captureTransitionContacts(
    f.group,
    f.actor,
    f.scene,
    1,
    f.raw,
    f.raw,
  );
  expect(contacts).toHaveLength(1);
  expect(contacts[0].end).toBeCloseTo(1.3);
  expect(contacts[0].releaseEnd).toBeCloseTo(1.4);
  const anchor = f.sample(0.99);
  expect(f.sample(1.3).x).toBeCloseTo(anchor.x, 5);
  expect(f.sample(1.4).x - anchor.x).toBeCloseTo(0.04, 5);
});

it("does not anchor a sliding or airborne outgoing foot or an in-place virtual contact", () => {
  const f = fixture();
  const capture = (before = f.raw) =>
    captureTransitionContacts(f.group, f.actor, f.scene, 1, before, f.raw);
  expect(capture()).toHaveLength(1);
  expect(
    capture((time) => {
      f.raw(time);
      f.body.position.x += time;
    }),
  ).toEqual([]);
  expect(
    capture((time) => {
      f.raw(time);
      f.body.position.y += 0.2;
    }),
  ).toEqual([]);
  f.profile.mode = "in-place";
  f.profile.nativeContacts = undefined;
  expect(capture()).toEqual([]);
  f.profile.mode = "travel";
  expect(capture()).toEqual([]);
  f.profile.nativeContacts = f.profile.contacts;
  f.actor.clips[1].sourceStart = 2;
  expect(capture()).toEqual([]);
});

it("retains measured native stance during a turn with little root travel without using its virtual gait contacts", () => {
  const f = fixture();
  f.profile.mode = "in-place";
  f.profile.nativeContacts = f.profile.contacts;
  // Deliberately disagree: a reconstructed gait would hold the left foot and
  // miss the original right-foot stance. Standalone playback must use the latter.
  f.profile.contacts = [{ side: "left", start: 0, end: 3, samples: [] }];
  const contacts = captureTransitionContacts(
    f.group,
    f.actor,
    f.scene,
    1,
    f.raw,
    f.raw,
  );
  expect(contacts.map((c) => c.side)).toEqual(["right"]);
  expect(contacts[0].end).toBeCloseTo(1.6);
  const anchor = f.sample(0.99);
  for (const time of [1.4, 1.1, 1.6, 1.25])
    expect(f.sample(time).distanceTo(anchor)).toBeLessThan(1e-5);
  f.profile.nativeContacts = [];
  expect(
    captureTransitionContacts(f.group, f.actor, f.scene, 1, f.raw, f.raw),
  ).toEqual([]);
});

it("invalidates anchors after scene edits and retains only the actual common support", () => {
  const f = fixture();
  const original = f.sample(1.4);
  const scene = structuredClone(f.scene),
    actor = scene.entities[0];
  actor.position[0] = 2;
  const raw = (time: number) => {
    f.raw(time);
    f.group.position.x += 2;
  };
  sampleWithTransitions(f.group, actor, scene, 1.4, raw);
  expect(footContactPosition(f.group, "right")!.x - original.x).toBeCloseTo(
    2,
    5,
  );
  raw(1.4);
  const left = footContactPosition(f.group, "left")!;
  sampleWithTransitions(f.group, actor, scene, 1.4, raw);
  expect(footContactPosition(f.group, "left")!.distanceTo(left)).toBeLessThan(
    1e-8,
  );
});

it("follows captured sole motion instead of added receiver drift and releases with continuous velocity", () => {
  const f = fixture(),
    source = fixture();
  f.scene.customMotions[0].sourceAssetId = "other-source";
  setMotionSources(f.group, new Map([["other-source", source.group]]));
  // The source rolls its sole forward 2 mm/s; receiver proportions introduce
  // another 15 mm/s. Neither a frozen foot nor a constant offset is correct.
  f.profile.nativeContacts![0].samples = Array.from({ length: 67 }, (_, i) => {
    const time = 0.5 + i / 60;
    return {
      time,
      point: new T.Vector3(),
      sole: new T.Vector3(0.002 * time, 0, 0),
    };
  });
  vi.mocked(locomotion.locomotionProfile).mockReturnValue(f.profile);
  const raw = (time: number) => {
    f.raw(time);
    if (time >= 1) f.body.position.x += 0.015 * (time - 1);
    f.group.updateMatrixWorld(true);
  };
  const sample = (time: number) => {
    sampleWithTransitions(f.group, f.actor, f.scene, time, raw);
    return footContactPosition(f.group, "right")!;
  };
  const anchor = sample(0.99);
  for (const time of [1.4, 1.1, 1.6, 1.25])
    expect(sample(time).x - anchor.x).toBeCloseTo(0.002 * (time - 1), 5);
  for (const boundary of [1.6, 1.8]) {
    const at = sample(boundary),
      step = 1e-5;
    const incoming = at
      .clone()
      .sub(sample(boundary - step))
      .divideScalar(step);
    const outgoing = sample(boundary + step)
      .sub(at)
      .divideScalar(step);
    expect(incoming.distanceTo(outgoing)).toBeLessThan(0.001);
  }
  raw(1.9);
  const released = footContactPosition(f.group, "right")!;
  expect(sample(1.9).distanceTo(released)).toBeLessThan(1e-8);
});

it("maps source-trim headings, actor scale and explicit speed onto the sole trajectory", () => {
  const f = fixture(),
    source = fixture();
  f.scene.customMotions[0].sourceAssetId = "other-source";
  setMotionSources(f.group, new Map([["other-source", source.group]]));
  const take = source.group.userData.animations[0] as T.AnimationClip;
  const heading = 0.6;
  const q = new T.Quaternion().setFromAxisAngle(
    new T.Vector3(0, 1, 0),
    heading,
  );
  take.tracks = [
    new T.QuaternionKeyframeTrack(
      source.body.userData.bones.hips.uuid + ".quaternion",
      [0, 3],
      [...q.toArray(), ...q.toArray()],
    ),
  ];
  f.profile.nativeContacts![0].samples = [0.5, 1, 1.6].map((time) => ({
    time,
    point: new T.Vector3(),
    sole: new T.Vector3(0.002 * time, 0, 0),
  }));
  vi.mocked(locomotion.locomotionProfile).mockReturnValue(f.profile);
  f.actor.clips[1].playbackRate = 2;
  const raw = (time: number) => {
    f.raw(time);
    f.group.scale.setScalar(2);
    f.group.rotation.y = Math.PI / 2;
    f.group.updateMatrixWorld(true);
  };
  raw(0.99);
  const anchor = footContactPosition(f.group, "right")!;
  const contacts = captureTransitionContacts(
    f.group,
    f.actor,
    f.scene,
    1,
    raw,
    raw,
  );
  expect(contacts).toHaveLength(1);
  raw(1.2);
  const target = transitionContactTargets(f.group, contacts, 1.2)[0].point;
  const expected = new T.Vector3(0.002 * 0.4 * 2, 0, 0)
    .applyAxisAngle(new T.Vector3(0, 1, 0), Math.PI / 2 - heading)
    .add(anchor);
  expect(target.distanceTo(expected)).toBeLessThan(1e-7);
  expect(contacts[0].end).toBeCloseTo(1.3);
});

it("holds the last captured sole position when the scheduled clip outlasts its source", () => {
  const f = fixture(),
    source = fixture();
  f.scene.customMotions[0].sourceAssetId = "other-source";
  f.actor.clips[1].duration = 8;
  setMotionSources(f.group, new Map([["other-source", source.group]]));
  f.profile.nativeContacts![0].end = 3;
  f.profile.nativeContacts![0].samples = [0.5, 1, 2, 3].map((time) => ({
    time,
    point: new T.Vector3(),
    sole: new T.Vector3(0.002 * time, 0, 0),
  }));
  vi.mocked(locomotion.locomotionProfile).mockReturnValue(f.profile);
  const contacts = captureTransitionContacts(
    f.group,
    f.actor,
    f.scene,
    1,
    f.raw,
    f.raw,
  );
  expect(contacts[0].end).toBe(9);
  expect(contacts[0].trajectory?.hold).toBe(3);
  const final = transitionContactTargets(f.group, contacts, 3)[0].point;
  for (const time of [8, 4, 9]) {
    expect(
      transitionContactTargets(f.group, contacts, time)[0].point.distanceTo(
        final,
      ),
    ).toBeLessThan(1e-10);
  }
});

it("retains native evaluated foot movement instead of resampling a source trajectory", () => {
  const f = fixture();
  f.profile.nativeContacts![0].samples = [0.5, 1, 1.6].map((time) => ({
    time,
    point: new T.Vector3(),
    sole: new T.Vector3(time, 0, 0),
  }));
  const contacts = captureTransitionContacts(
    f.group,
    f.actor,
    f.scene,
    1,
    f.raw,
    f.raw,
  );
  expect(contacts[0].trajectory).toBeUndefined();
  const before = transitionContactTargets(f.group, contacts, 1.2)[0].point;
  f.body.position.x += 0.003;
  f.group.updateMatrixWorld(true);
  const after = transitionContactTargets(f.group, contacts, 1.2)[0].point;
  expect(after.x - before.x).toBeCloseTo(0.003, 10);
});
