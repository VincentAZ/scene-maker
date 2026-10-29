"""Blender: --background --python scripts/render-character-library.py -- <previews> <output>.
Render generated standing GLBs; no downloaded Python or embedded scripts run.
"""
import bpy
import sys
from pathlib import Path
from mathutils import Vector

source, output = map(Path, sys.argv[sys.argv.index("--") + 1:])
for file in sorted(source.glob("*.glb")):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=str(file.resolve()))
    # The glTF importer creates a hidden Icosphere as a bone display widget.
    # Exclude that editor-only helper from framing the visible character.
    mesh_objects = [o for o in bpy.context.scene.objects if o.type == "MESH" and not o.hide_render and o.visible_get()]
    depsgraph = bpy.context.evaluated_depsgraph_get()
    points = []
    for original in mesh_objects:
        evaluated = original.evaluated_get(depsgraph)
        mesh = evaluated.to_mesh()
        points.extend(evaluated.matrix_world @ vertex.co for vertex in mesh.vertices)
        evaluated.to_mesh_clear()
    lo = Vector(tuple(min(p[i] for p in points) for i in range(3)))
    hi = Vector(tuple(max(p[i] for p in points) for i in range(3)))
    height = hi.z - lo.z
    center = (hi + lo) / 2
    bpy.ops.object.camera_add(location=center + Vector((0.65, -2.7, 0.4)) * height)
    camera = bpy.context.object
    camera.rotation_euler = (center - camera.location).to_track_quat("-Z", "Y").to_euler()
    camera.data.type = "ORTHO"
    camera.data.ortho_scale = height * 1.14
    bpy.context.scene.camera = camera
    for offset, energy, size in [((2, -3, 4), 650, 4), ((-3, -1, 2), 350, 4), ((1, 2, 3), 500, 3)]:
        bpy.ops.object.light_add(type="AREA", location=center + Vector(offset) * height / 2)
        light = bpy.context.object
        light.data.energy = energy * height * height / 4
        light.data.shape = "DISK"
        light.data.size = size * height / 2
        light.rotation_euler = (center - light.location).to_track_quat("-Z", "Y").to_euler()
    scene = bpy.context.scene
    scene.world = bpy.data.worlds.new("World")
    scene.world.use_nodes = True
    scene.world.node_tree.nodes["Background"].inputs[0].default_value = (0.75, 0.8, 0.9, 1)
    scene.world.node_tree.nodes["Background"].inputs[1].default_value = 0.4
    scene.render.engine = "CYCLES"
    scene.cycles.samples = 16
    scene.cycles.use_denoising = True
    scene.render.film_transparent = True
    scene.render.resolution_x = scene.render.resolution_y = 320
    scene.render.resolution_percentage = 100
    scene.view_settings.view_transform = "AgX"
    scene.render.image_settings.file_format = "PNG"
    scene.render.image_settings.color_mode = "RGBA"
    scene.render.filepath = str((output / (file.stem.lower().replace("_", "-") + ".png")).resolve())
    bpy.ops.render.render(write_still=True)
    print("THUMBNAIL", file.stem, flush=True)
