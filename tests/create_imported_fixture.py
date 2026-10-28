"""Create an original weighted T-pose FBX/GLB fixture with namespaced bones and native travel.

blender --background --python tests/create_imported_fixture.py -- output-directory
The model is generated locally; no Adobe/Mixamo asset is downloaded or implied.
"""
import bpy
import json
import runpy
import sys
from pathlib import Path
from math import pi
from mathutils import Quaternion, Vector

directory = Path(sys.argv[sys.argv.index('--') + 1]).resolve()
directory.mkdir(parents=True, exist_ok=True)
spec_file = directory / 'fixture-spec.json'
spec_file.write_text(json.dumps({
    'name': 'Rowan — imported rig check', 'body': 'masculine',
    'style': 'Explorer', 'color': '#668c91', 'skin': '#ba8766',
}))
sys.argv = ['create_character.py', '--', str(spec_file), str(directory / 'source.glb')]
runpy.run_path(str(Path(__file__).resolve().parents[1] / 'engine/create_character.py'), run_name='__main__')
rig = next(obj for obj in bpy.data.objects if obj.type == 'ARMATURE')
body = next(obj for obj in bpy.data.objects if obj.type == 'MESH')

# Move weighted arm geometry and the matching bind joints into a T-pose.
for side, angle in [('left', -pi / 2), ('right', pi / 2)]:
    turn = Quaternion(Vector((0, 1, 0)), angle)
    shoulder = rig.data.bones[side + 'Arm'].head_local.copy()
    group_ids = {body.vertex_groups[side + name].index for name in ['Arm', 'Forearm']}
    for vertex in body.data.vertices:
        if any(group.group in group_ids and group.weight > 0.5 for group in vertex.groups):
            world = body.matrix_world @ vertex.co
            vertex.co = body.matrix_world.inverted() @ (shoulder + turn @ (world - shoulder))
    bpy.context.view_layer.objects.active = rig
    bpy.ops.object.mode_set(mode='EDIT')
    for name in ['Arm', 'Forearm']:
        bone = rig.data.edit_bones[side + name]
        bone.head = shoulder + turn @ (bone.head - shoulder)
        bone.tail = shoulder + turn @ (bone.tail - shoulder)
    bpy.ops.object.mode_set(mode='OBJECT')

bpy.ops.object.mode_set(mode='EDIT')
for index, bone in enumerate(rig.data.edit_bones):
    bone.roll += 0.15 + index * 0.07
bpy.ops.object.mode_set(mode='OBJECT')
names = {'leftLeg': 'LeftUpLeg', 'rightLeg': 'RightUpLeg', 'leftShin': 'LeftLeg', 'rightShin': 'RightLeg'}
for bone in rig.data.bones:
    old = bone.name
    new = 'mixamorig:' + names.get(old, old[0].upper() + old[1:])
    bone.name = new
    if old in body.vertex_groups:
        body.vertex_groups[old].name = new

bpy.context.scene.render.fps = 24
bpy.context.scene.frame_start = 0
bpy.context.scene.frame_end = 48
for frame, location in [(0, (0, 0, 0)), (48, (0, -2, 0))]:
    rig.location = location
    rig.keyframe_insert(data_path='location', frame=frame)
rig.animation_data.action.name = 'Original stroll'
for layer in rig.animation_data.action.layers:
    for strip in layer.strips:
        for bag in strip.channelbags:
            for curve in bag.fcurves:
                for key in curve.keyframe_points:
                    key.interpolation = 'LINEAR'
bpy.context.scene.frame_set(0)
bpy.ops.export_scene.gltf(filepath=str(directory / 'rowan.glb'), export_format='GLB', export_animations=True)
bpy.ops.export_scene.fbx(filepath=str(directory / 'rowan.fbx'), add_leaf_bones=False, bake_anim=True)
print('SCENE_MAKER_IMPORTED_FIXTURE', json.dumps({'bones': len(rig.data.bones), 'travel_m': 2, 'directory': str(directory)}))
