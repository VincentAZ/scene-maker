import type { Asset, Motion } from "./scene";
import catalogue from "./motion-catalogue.json";
import durations from "./motion-durations.json";
import capturedCatalogue from "./captured-motion-catalogue.json";
export const motionSource: Asset = {
  id: "quaternius-action-source",
  name: "Authored action source",
  category: "characters",
  style: "Motion reference",
  url: "/library/actions/quaternius-actions.glb",
  color: "#739480",
  skin: "#bf8866",
  body: "masculine",
  description: "Internal reference rig for the bundled CC0 authored actions.",
};
export const capturedMotionSources: Asset[] = capturedCatalogue.map(
  (entry) => ({
    ...motionSource,
    id: `cmu-capture-${entry.trial.replaceAll("_", "-")}`,
    name: `CMU original capture ${entry.trial}`,
    url: `/library/actions/cmu/${entry.trial}.glb`,
    description:
      "Original captured performance on its measured source skeleton. No finger or facial capture.",
    rigMapping: entry.rigMapping,
  }),
);
export const motionSources = [motionSource, ...capturedMotionSources];
export const capturedMotions: Motion[] = capturedCatalogue.map(
  (entry, index) => ({
    id: `captured-${entry.trial.replaceAll("_", "-")}`,
    name: entry.name,
    kind: "imported",
    duration: entry.duration,
    sourceAssetId: capturedMotionSources[index].id,
    animationName: entry.trial,
    distance: 0,
    poses: [],
  }),
);
/** Recorded deceleration/standing finishes are one-shot performances, not
 * repeating gaits. Match source identity so renamed copies retain that role. */
export const recordedArrivals = capturedMotions.filter(
  (motion) =>
    capturedCatalogue.find((entry) => entry.trial === motion.animationName)
      ?.routeRole === "arrival",
);
export const recordedStanding = capturedMotions.filter(
  (motion) =>
    capturedCatalogue.find((entry) => entry.trial === motion.animationName)
      ?.routeRole === "standing",
);
export function isRecordedArrival(motion: Motion) {
  return recordedArrivals.some(
    (arrival) =>
      arrival.sourceAssetId === motion.sourceAssetId &&
      arrival.animationName === motion.animationName,
  );
}
/** Alternative walking cycles from the original gradual-stop take. Automatic
 * navigation may choose one when its original cycle cannot meet a stop phase.
 * These are candidates, not receiver or clearance certificates. */
export const capturedArrivalGaits = {
  sourceAssetId: "cmu-capture-82-14",
  animationName: "82_14",
  ranges: [
    { start: 1.2, end: 2.375 },
    { start: 164 / 120, end: 312 / 120 },
    { start: 146 / 120, end: 288 / 120 },
    { start: 164 / 120, end: 311 / 120 },
    { start: 164 / 120, end: 313 / 120 },
    { start: 78 / 120, end: 208 / 120 },
    { start: 4 / 120, end: 137 / 120 },
    { start: 6 / 120, end: 139 / 120 },
  ],
};
/** Route selector presets reference original takes and saved source intervals.
 * They are not extra animations or replacements for any saved scene action. */
export const capturedRouteGaits: Motion[] = [
  {
    ...capturedMotions.find((motion) => motion.animationName === "35_01")!,
    id: "captured-walking-stride",
    name: "Captured walking stride",
    duration: 134 / 120,
    path: {
      points: [
        [0, 0, 0],
        [0, 0, 1.6394472422179711],
      ],
      smooth: false,
      sourceRange: { start: 1.1, end: 266 / 120 },
    },
  },
  {
    ...capturedMotions.find((motion) => motion.animationName === "35_18")!,
    id: "captured-running-stride",
    name: "Captured running stride",
    duration: 92 / 120,
    path: {
      points: [
        [0, 0, 0],
        [0, 0, 2.7281847433098694],
      ],
      smooth: false,
      sourceRange: { start: 0.2, end: 116 / 120 },
    },
  },
  {
    ...capturedMotions.find((motion) => motion.animationName === "82_14")!,
    id: "captured-gradual-walking-stride",
    name: "Captured gradual walking stride",
    duration: 1.175,
    path: {
      points: [
        [0, 0, 0],
        [0, 0, 1.4701022968450306],
      ],
      smooth: false,
      sourceRange: { ...capturedArrivalGaits.ranges[0] },
    },
  },
];
export const libraryMotions: Motion[] = catalogue.map(
  ([animationName, name]) => ({
    id:
      "authored-" +
      animationName
        .replace(/([a-z])([A-Z])/g, "$1-$2")
        .replaceAll("_", "-")
        .toLowerCase(),
    name,
    kind: "imported",
    duration: durations[animationName as keyof typeof durations],
    sourceAssetId: motionSource.id,
    animationName,
    distance: 0,
    poses: [],
  }),
);
export const motionCollections = [
  "All",
  "Movement",
  "Everyday",
  "Acting",
  "Stunts",
  "Interactions",
  "My actions",
];
export function motionDetails(motion: Motion) {
  const capture = capturedMotions.findIndex((m) => m.id === motion.id);
  if (capture >= 0)
    return {
      collection: "Movement",
      description:
        capturedCatalogue[capture].description +
        " Body motion capture; no finger or facial capture.",
      authored: false,
      captured: true,
    };
  const index = libraryMotions.findIndex((m) => m.id === motion.id);
  return index >= 0
    ? {
        collection: catalogue[index][2],
        description: catalogue[index][3],
        authored: true,
        captured: false,
      }
    : {
        collection: motion.path
          ? "Movement"
          : ["walk", "run", "jump", "crawl"].includes(motion.kind)
            ? "Movement"
            : ["pick", "place", "sip", "climb", "sit", "stand"].includes(
                  motion.kind,
                )
              ? "Interactions"
              : ["wave", "dance", "talk", "bow"].includes(motion.kind)
                ? "Acting"
                : ["idle"].includes(motion.kind)
                  ? "Everyday"
                  : "My actions",
        description:
          motion.kind === "sit"
            ? "Sit on a chosen chair; keep seated through gestures."
            : motion.kind === "stand"
              ? "Rise from your seat before the next full-body action."
              : motion.path
                ? "Follow your drawn route."
                : motion.kind === "imported"
                  ? "A motion from your imported character."
                  : motion.kind === "custom"
                    ? "An action created for your scene."
                    : "A studio action, ready to direct.",
        authored: false,
        captured: false,
      };
}
