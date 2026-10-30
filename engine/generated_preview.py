"""Render an honest clay preview of actual generated geometry, never its reference image."""
import bpy
import sys
from pathlib import Path
from mathutils import Vector
args=sys.argv[sys.argv.index('--')+1:]
source=Path(args[0]).resolve()
output=Path(args[1]).resolve()
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=str(source))
meshes=[obj for obj in bpy.context.scene.objects if obj.type=='MESH']
if not meshes:
    raise RuntimeError('GLB has no mesh objects')
points=[obj.matrix_world@Vector(corner) for obj in meshes for corner in obj.bound_box]
lo=Vector(tuple(min(p[i] for p in points) for i in range(3)))
hi=Vector(tuple(max(p[i] for p in points) for i in range(3)))
center=(lo+hi)/2
size=max(hi-lo)
bpy.ops.object.camera_add(location=center+Vector((0,-3*size,0.15*size)))
cam=bpy.context.object
cam.rotation_euler=(center-cam.location).to_track_quat('-Z','Y').to_euler()
cam.data.type='ORTHO'
cam.data.ortho_scale=size*1.15
scene=bpy.context.scene
scene.camera=cam
scene.render.engine='BLENDER_WORKBENCH'
scene.display.shading.light='STUDIO'
scene.display.shading.studio_light='paint.sl'
scene.display.shading.color_type='SINGLE'
scene.display.shading.single_color=(0.6,0.62,0.65)
scene.display.shading.show_shadows=True
scene.display.shading.show_cavity=True
scene.display.shading.background_type='WORLD'
scene.world=bpy.data.worlds.new('Inspection background')
scene.world.color=(0.15,0.15,0.15)
scene.render.resolution_x=512
scene.render.resolution_y=512
scene.render.resolution_percentage=100
scene.render.image_settings.file_format='PNG'
scene.render.filepath=str(output)
bpy.ops.render.render(write_still=True)
print({'source':str(source),'render':str(output),'meshes':len(meshes),'vertices':sum(len(o.data.vertices) for o in meshes),'triangles':sum(len(o.data.polygons) for o in meshes),'armatures':sum(o.type=='ARMATURE' for o in scene.objects)})
