"""Convert a user-owned FBX (including Mixamo downloads) to portable GLB."""
import bpy
import sys
source, destination = sys.argv[sys.argv.index('--') + 1:]
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.fbx(
    filepath=source, use_anim=True, ignore_leaf_bones=False,
    automatic_bone_orientation=False,
)
# Preserve every action's authored range and full joint hierarchy, regardless
# of provider or the factory scene's playback range. Keep these explicit so a
# Blender default change cannot silently trim takes or remove helper joints.
bpy.ops.export_scene.gltf(
    filepath=destination, export_format='GLB', export_animations=True,
    export_animation_mode='ACTIONS', export_frame_range=False,
    export_skins=True, export_def_bones=False, export_force_sampling=True,
    export_frame_step=1, export_optimize_animation_size=False, export_apply=False,
)
