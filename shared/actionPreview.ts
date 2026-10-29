import {
  allAssets,
  applyCommands,
  starterScene,
  validateScene,
  type Scene,
  type Motion,
} from "./scene";
/** A disposable rehearsal. It never writes into the creator's scene. */
export function actionPreview(
  scene: Scene,
  motion: Motion,
  actorId?: string,
  seatScale?: number,
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
  preview = applyCommands(preview, [
    {
      type: "add",
      id: "preview-performer",
      assetId: original?.assetId || "quaternius-casual-female",
      position: [0, 0, 0],
    },
  ]);
  const actor = preview.entities[0];
  actor.name = original?.name || "Preview performer";
  actor.scale = original?.scale || 1;
  if (original?.color) actor.color = original.color;
  let targetId: string | undefined;
  if (["sit", "stand"].includes(motion.kind)) {
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
  } else if (motion.kind === "climb") {
    preview = applyCommands(preview, [
      {
        type: "add",
        id: "preview-ladder",
        assetId: "ladder",
        position: [0, 0, -0.6],
      },
    ]);
    targetId = "preview-ladder";
  } else if (["pick", "sip", "place"].includes(motion.kind)) {
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
    ...(motion.kind === "stand"
      ? [{ id: "preview-sit", motionId: "sit", duration: 3, targetId }]
      : []),
    ...(motion.kind === "place"
      ? [{ id: "preview-pick", motionId: "pick", duration: 2, targetId }]
      : []),
    {
      id: "preview-action",
      motionId: motion.id,
      duration: motion.duration,
      targetId: motion.kind === "stand" ? undefined : targetId,
      transition: "cut",
    },
  ];
  return {
    scene: validateScene(preview),
    actor: performer,
    total: performer.clips.reduce((sum, c) => sum + c.duration, 0),
  };
}
