"""blender --background --python blender_import.py -- scene.glb scene.blend"""
import bpy
import sys
import math
from pathlib import Path
args = sys.argv[sys.argv.index('--') + 1:]
source = str(Path(args[0]).resolve())
destination = str(Path(args[1]).resolve()) if len(args) > 1 else str(Path(source).with_suffix('.blend'))
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=source)
bpy.context.scene.render.fps = 24
ends = [action.frame_range[1] for action in bpy.data.actions]
bpy.context.scene.frame_start = 0
bpy.context.scene.frame_end = math.ceil(max(ends, default=288))
bpy.ops.wm.save_as_mainfile(filepath=destination)
print('SCENE_MAKER_SAVED', destination)
