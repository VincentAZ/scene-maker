"""Render the actual set previews prepared by prepare-set-previews.ts."""
import bpy
from pathlib import Path
from mathutils import Vector

output = Path('public/library/sets')
output.mkdir(parents=True, exist_ok=True)
for file in sorted(Path('.data/qa/set-previews').glob('*.glb')):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=str(file.resolve()))
    center = Vector((0, 0.4, 0.5))
    bpy.ops.object.camera_add(location=(10, -14, 12))
    camera = bpy.context.object
    camera.rotation_euler = (center-camera.location).to_track_quat('-Z', 'Y').to_euler()
    camera.data.type = 'ORTHO'
    camera.data.ortho_scale = 15.5
    scene = bpy.context.scene
    scene.camera = camera
    for position, energy, size in [((1,-3,10),1800,8), ((-4,-1,6),900,6), ((3,4,7),1100,6)]:
        bpy.ops.object.light_add(type='AREA', location=position)
        light = bpy.context.object
        light.data.energy = energy
        light.data.shape = 'DISK'
        light.data.size = size
        light.rotation_euler = (center-light.location).to_track_quat('-Z','Y').to_euler()
    scene.world = bpy.data.worlds.new('World')
    scene.world.use_nodes = True
    scene.world.node_tree.nodes['Background'].inputs[0].default_value = (0.8,0.85,0.9,1)
    scene.world.node_tree.nodes['Background'].inputs[1].default_value = .4
    scene.render.engine = 'CYCLES'
    scene.cycles.samples = 24
    scene.cycles.use_denoising = True
    scene.render.film_transparent = True
    scene.render.resolution_x = scene.render.resolution_y = 400
    scene.render.resolution_percentage = 100
    scene.view_settings.view_transform = 'AgX'
    scene.render.image_settings.file_format = 'PNG'
    scene.render.image_settings.color_mode = 'RGBA'
    scene.render.filepath = str((output/(file.stem+'.png')).resolve())
    bpy.ops.render.render(write_still=True)
    print('SET_PREVIEW',file.stem,flush=True)
