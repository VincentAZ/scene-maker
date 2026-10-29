import type { Asset, Motion } from "./scene";
import catalogue from "./motion-catalogue.json";
import durations from "./motion-durations.json";
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
  const index = libraryMotions.findIndex((m) => m.id === motion.id);
  return index >= 0
    ? {
        collection: catalogue[index][2],
        description: catalogue[index][3],
        authored: true,
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
      };
}
