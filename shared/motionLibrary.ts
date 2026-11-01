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
