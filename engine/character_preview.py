"""Render a small transparent thumbnail from the current trusted character scene."""
import bpy
from mathutils import Vector, Matrix


def render_character_preview(filepath, rig):
    # Match the studio's neutral, arms-down calibration without changing the GLB.
    for side in ("left", "right"):
        for upper_name, end_name in [(side + "Arm", side + "Forearm"), (side + "Forearm", side + "Hand")]:
            upper, end = rig.pose.bones[upper_name], rig.pose.bones[end_name]
            start = rig.matrix_world @ upper.matrix.translation
            target = rig.matrix_world @ end.matrix.translation
            delta = (target - start).normalized().rotation_difference(Vector((0, 0, -1))).to_matrix().to_4x4()
            upper.matrix = rig.matrix_world.inverted() @ Matrix.Translation(start) @ delta @ Matrix.Translation(-start) @ rig.matrix_world @ upper.matrix
            bpy.context.view_layer.update()
    depsgraph = bpy.context.evaluated_depsgraph_get()
    points = []
    for original in list(bpy.context.scene.objects):
        if original.type != "MESH" or original.hide_render or not original.visible_get():
            continue
        evaluated = original.evaluated_get(depsgraph)
        mesh = evaluated.to_mesh()
        points.extend(evaluated.matrix_world @ vertex.co for vertex in mesh.vertices)
        evaluated.to_mesh_clear()
    low = Vector(tuple(min(point[i] for point in points) for i in range(3)))
    high = Vector(tuple(max(point[i] for point in points) for i in range(3)))
    height, center = high.z - low.z, (high + low) / 2
    bpy.ops.object.camera_add(location=center + Vector((.85, -2.7, .4)) * height)
    camera = bpy.context.object
    camera.rotation_euler = (center - camera.location).to_track_quat("-Z", "Y").to_euler()
    camera.data.type = "ORTHO"
    camera.data.ortho_scale = height * 1.15
    scene = bpy.context.scene
    scene.camera = camera
    for offset, energy in [((2, -3, 4), 650), ((-3, -1, 2), 350), ((1, 2, 3), 500)]:
        bpy.ops.object.light_add(type="AREA", location=center + Vector(offset) * height / 2)
        light = bpy.context.object
        light.data.energy = energy * height * height / 4
        light.data.shape = "DISK"
        light.data.size = height * 2
        light.rotation_euler = (center - light.location).to_track_quat("-Z", "Y").to_euler()
    scene.world = bpy.data.worlds.new("Preview light")
    scene.world.use_nodes = True
    scene.world.node_tree.nodes["Background"].inputs[0].default_value = (.75, .8, .9, 1)
    scene.world.node_tree.nodes["Background"].inputs[1].default_value = .4
    scene.render.engine = "CYCLES"
    scene.cycles.samples = 16
    scene.cycles.use_denoising = True
    scene.render.film_transparent = True
    scene.render.resolution_x = scene.render.resolution_y = 320
    scene.render.resolution_percentage = 100
    scene.view_settings.view_transform = "AgX"
    scene.render.image_settings.file_format = "PNG"
    scene.render.image_settings.color_mode = "RGBA"
    scene.render.filepath = filepath
    bpy.ops.render.render(write_still=True)
