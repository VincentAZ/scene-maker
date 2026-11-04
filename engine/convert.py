"""Convert a user-owned FBX (including Mixamo downloads) to portable GLB."""
import bpy
import sys
from pathlib import Path
source, destination = sys.argv[sys.argv.index('--') + 1:]
sys.path.insert(0, str(Path(__file__).resolve().parent))
from prepare_actorcore import canonicalize_fbx_bind  # noqa: E402


def load():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    actions = set(bpy.data.actions)
    bpy.ops.import_scene.fbx(
        filepath=source, use_anim=True, ignore_leaf_bones=False,
        automatic_bone_orientation=False,
    )
    bpy.context.view_layer.update()
    return list(bpy.data.objects), [a for a in bpy.data.actions if a not in actions]


# Blender can place the armature object in the take's root frame while bone
# rests use the FBX bind frame (e.g. Y-up exports): the skin then renders upright
# around horizontal joints. Restore the declared bind frame and rebase root
# keys so animated joints stay where the file puts them. Files this cannot
# verify (no bind pose, several armatures, animated objects), or whose bind
# data cannot be read, are converted as Blender imports them.
try:
    objects, actions = load()
    # The correction clears the armature's take; the exporter only finds
    # actions through an assigned one, so reassign what the importer set.
    assigned = [(o, o.animation_data.action, o.animation_data.action_slot)
                for o in objects if o.animation_data and o.animation_data.action]
    canonicalize_fbx_bind(objects, actions, source, allow_missing_bind=True)
    for obj, action, slot in assigned:
        obj.animation_data_create()
        obj.animation_data.action = action
        obj.animation_data.action_slot = slot
except Exception as error:  # noqa: BLE001 — never worse than a plain import
    print("FBX bind frame kept as imported:", error)
    load()

# Exporters add takes without a single key (ActorCore shape-key "0_T-Pose"):
# they would appear as motionless actions. One-frame poses are kept.
for action in list(bpy.data.actions):
    if not any(curve.keyframe_points for layer in action.layers
               for strip in layer.strips for bag in strip.channelbags
               for curve in bag.fcurves):
        bpy.data.actions.remove(action)
# Preserve every action's authored range and full joint hierarchy, regardless
# of provider or the factory scene's playback range. Keep these explicit so a
# Blender default change cannot silently trim takes or remove helper joints.
# FBX keys land from frame 1: start each take at 0 so it neither plays a frame
# late nor holds its first pose when it loops.
bpy.ops.export_scene.gltf(
    filepath=destination, export_format='GLB', export_animations=True,
    export_animation_mode='ACTIONS', export_frame_range=False,
    export_anim_slide_to_zero=True,
    export_skins=True, export_def_bones=False, export_force_sampling=True,
    export_frame_step=1, export_optimize_animation_size=False, export_apply=False,
)
