"""Blender: --background --factory-startup --python-exit-code 1
--python scripts/content/blender/character_thumbnail.py -- <character.glb> <card.png>

Render a library card for a converted character: the figure framed from the
front like the Rocketbox previews, on a transparent background, 384 x 384.
Only the GLB is read; no script inside any downloaded file runs.
"""
import sys

import bpy
from mathutils import Vector

source, destination = sys.argv[sys.argv.index("--") + 1:]
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=source)

# The glTF importer adds a hidden icosphere as a bone display widget; frame the
# visible character only.
depsgraph = bpy.context.evaluated_depsgraph_get()
points = []
for original in bpy.context.scene.objects:
    if original.type != "MESH" or original.hide_render or not original.visible_get():
        continue
    evaluated = original.evaluated_get(depsgraph)
    mesh = evaluated.to_mesh()
    points.extend(evaluated.matrix_world @ vertex.co for vertex in mesh.vertices)
    evaluated.to_mesh_clear()
low = Vector(tuple(min(p[i] for p in points) for i in range(3)))
high = Vector(tuple(max(p[i] for p in points) for i in range(3)))
height, center = high.z - low.z, (high + low) / 2

bpy.ops.object.camera_add(location=center + Vector((0.65, -2.7, 0.4)) * height)
camera = bpy.context.object
camera.rotation_euler = (center - camera.location).to_track_quat("-Z", "Y").to_euler()
camera.data.type = "ORTHO"
camera.data.ortho_scale = height * 1.14
scene = bpy.context.scene
scene.camera = camera
for offset, energy, size in [((2, -3, 4), 650, 4), ((-3, -1, 2), 350, 4), ((1, 2, 3), 500, 3)]:
    bpy.ops.object.light_add(type="AREA", location=center + Vector(offset) * height / 2)
    light = bpy.context.object
    light.data.energy = energy * height * height / 4
    light.data.shape = "DISK"
    light.data.size = size * height / 2
    light.rotation_euler = (center - light.location).to_track_quat("-Z", "Y").to_euler()
scene.world = bpy.data.worlds.new("World")
scene.world.use_nodes = True
scene.world.node_tree.nodes["Background"].inputs[0].default_value = (0.75, 0.8, 0.9, 1)
scene.world.node_tree.nodes["Background"].inputs[1].default_value = 0.4

# EEVEE's identifier is BLENDER_EEVEE_NEXT in Blender 4.2-4.5 and
# BLENDER_EEVEE again from 5.0.
engines = {e.identifier for e in type(scene.render).bl_rna.properties["engine"].enum_items}
scene.render.engine = "BLENDER_EEVEE_NEXT" if "BLENDER_EEVEE_NEXT" in engines else "BLENDER_EEVEE"
scene.eevee.taa_render_samples = 32
scene.render.film_transparent = True
scene.render.resolution_x = scene.render.resolution_y = 384
scene.render.resolution_percentage = 100
scene.view_settings.view_transform = "AgX"
scene.render.image_settings.file_format = "PNG"
scene.render.image_settings.color_mode = "RGBA"
scene.render.filepath = destination
bpy.ops.render.render(write_still=True)
