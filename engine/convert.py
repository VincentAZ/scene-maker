"""Convert a user-owned FBX (including Mixamo downloads) to portable GLB."""
import bpy
import sys
source, destination = sys.argv[sys.argv.index('--') + 1:]
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.fbx(filepath=source)
bpy.ops.export_scene.gltf(filepath=destination, export_format='GLB', export_animations=True)
