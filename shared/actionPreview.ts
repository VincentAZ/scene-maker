import {
  allAssets,
  applyCommands,
  starterScene,
  validateScene,
  allMotions,
  resolveMotionSource,
  type Scene,
  type Motion,
} from "./scene";
/** A disposable rehearsal. It never writes into the creator's scene. */
export function actionPreview(
  scene: Scene,
  motion: Motion,
  actorId?: string,
  seatScale?: number,
  view: "character" | "original" = "character",
) {
  const original = scene.entities.find(
    (e) =>
      e.id === actorId &&
      allAssets(scene).find((a) => a.id === e.assetId)?.category ===
        "characters",
  );
  let preview = {
    ...starterScene(),
    environment: "studio" as const,
    lighting: scene.lighting,
    entities: [],
    customAssets: structuredClone(scene.customAssets),
    customMotions: structuredClone(scene.customMotions),
    transcript: [],
  } as Scene;
  let performerAssetId = original?.assetId || "quaternius-casual-female";
  let performedMotion = motion;
  let sourceName: string | undefined;
  if (view === "original") {
    const source = resolveMotionSource(scene, motion.sourceAssetId);
    if (motion.kind !== "imported" || motion.path || !source?.url)
      throw Error(
        "Choose an imported take with its original file to compare performances.",
      );
    // The bundled source is intentionally absent from the cast catalogue.
    // Register a private alias in this disposable scene, and bind the take to
    // that same asset so playback uses its native skeleton, not retargeting.
    const occupied = new Set([
      ...allAssets(preview).map((a) => a.id),
      ...allMotions(preview).map((m) => m.id),
    ]);
    const unique = (base: string) => {
      let id = base;
      for (let i = 1; occupied.has(id); i++) id = `${base}-${i}`;
      occupied.add(id);
      return id;
    };
    performerAssetId = unique("preview-original-source");
    preview.customAssets.push({
      ...structuredClone(source),
      id: performerAssetId,
    });
    performedMotion = {
      ...structuredClone(motion),
      id: unique("preview-original-take"),
      sourceAssetId: performerAssetId,
    };
    preview.customMotions.push(performedMotion);
    sourceName = source.name;
  }
  preview = applyCommands(preview, [
    {
      type: "add",
      id: "preview-performer",
      assetId: performerAssetId,
      position: [0, 0, 0],
    },
  ]);
  const actor = preview.entities[0];
  actor.name = sourceName || original?.name || "Preview performer";
  actor.scale = view === "original" ? 1 : original?.scale || 1;
  if (view === "character" && original?.color) actor.color = original.color;
  let targetId: string | undefined;
  if (["sit", "stand"].includes(motion.role ?? "")) {
    preview = applyCommands(preview, [
      {
        type: "add",
        id: "preview-seat",
        assetId: "bench",
        position: [0, 0, -0.4],
      },
    ]);
    preview.entities.find((e) => e.id === "preview-seat")!.scale =
      seatScale ?? actor.scale;
    targetId = "preview-seat";
  } else if (motion.role === "climb") {
    preview = applyCommands(preview, [
      {
        type: "add",
        id: "preview-ladder",
        assetId: "ladder",
        position: [0, 0, -0.6],
      },
    ]);
    targetId = "preview-ladder";
  } else if (["pick", "sip", "place"].includes(motion.role ?? "")) {
    preview = applyCommands(preview, [
      {
        type: "add",
        id: "preview-table",
        assetId: "table",
        position: [0.55, 0, 0.3],
      },
      {
        type: "add",
        id: "preview-cup",
        assetId: "cup",
        position: [0.32, 0.985, 0.24],
      },
    ]);
    targetId = "preview-cup";
  }
  const performer = preview.entities[0];
  performer.clips = [
    ...(motion.role === "stand"
      ? [{ id: "preview-sit", motionId: "sit", duration: 3, targetId }]
      : []),
    ...(motion.role === "place"
      ? [{ id: "preview-pick", motionId: "pick", duration: 2, targetId }]
      : []),
    {
      id: "preview-action",
      motionId: performedMotion.id,
      duration: motion.duration,
      ...(motion.kind === "imported" ? { playbackRate: 1 } : {}),
      targetId: motion.role === "stand" ? undefined : targetId,
      transition: "cut",
    },
  ];
  return {
    scene: validateScene(preview),
    actor: performer,
    total: performer.clips.reduce((sum, c) => sum + c.duration, 0),
  };
}
