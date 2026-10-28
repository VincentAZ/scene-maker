"""Verify a browser-exported Rowan fixture independently in Blender.

Pass scene.blend and scene.json from the production package. Keep its assets/
folder alongside scene.json. The fixture sequence is native, native, wave, walk.
"""
import bpy
import json
import sys
from pathlib import Path
from mathutils import Vector, Quaternion

args = sys.argv[sys.argv.index('--') + 1:]
blend, project = Path(args[0]).resolve(), Path(args[1]).resolve()
scene = json.loads(project.read_text())
actor = next(entity for entity in scene['entities'] if entity['name'] == 'Rowan')
asset = next(asset for asset in scene['customAssets'] if asset['id'] == actor['assetId'])
original = project.parent / 'assets' / Path(asset['url']).name

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.context.scene.render.fps = 24
bpy.ops.import_scene.gltf(filepath=str(original))
bpy.context.scene.frame_set(0)
graph = bpy.context.evaluated_depsgraph_get()
points = []
for obj in bpy.data.objects:
    # Blender adds a mesh widget for imported bones; it is not character geometry.
    if obj.type == 'MESH' and any(mod.type == 'ARMATURE' for mod in obj.modifiers):
        evaluated = obj.evaluated_get(graph)
        mesh = evaluated.to_mesh()
        points.extend(evaluated.matrix_world @ vertex.co for vertex in mesh.vertices)
        evaluated.to_mesh_clear()
height = max(p.z for p in points) - min(p.z for p in points)
normalization = 1.85 / height
source_rig = next(obj for obj in bpy.data.objects if obj.type == 'ARMATURE')

def bone(rig, ending):
    return next(bone for bone in rig.pose.bones if bone.name.replace(':', '').replace('_', '').lower().endswith(ending.lower()))

def joint(rig, ending):
    return rig.matrix_world @ bone(rig, ending).matrix.translation

start = joint(source_rig, 'Hips')
source_end = max(action.frame_range[1] for action in bpy.data.actions)
bpy.context.scene.frame_set(int(source_end), subframe=source_end - int(source_end))
source_travel = joint(source_rig, 'Hips') - start
assert abs(source_travel.length - 2) < 0.001, f'Fixture must travel two source meters: {source_travel}'

bpy.ops.wm.open_mainfile(filepath=str(blend))
rig = next(obj for obj in bpy.data.objects if obj.type == 'ARMATURE')
assert len(rig.data.bones) == 11
clips = actor['clips']
assert len(clips) == 4 and clips[0]['motionId'] == clips[1]['motionId']
assert [clip['motionId'] for clip in clips[2:]] == ['wave', 'walk']
first = clips[0]['duration']
second = first + clips[1]['duration']
end = sum(clip['duration'] for clip in clips)
rotation = Quaternion(Vector((0, 0, 1)), actor['rotation'])
native_step = rotation @ source_travel * normalization * actor['scale']
walk_step = rotation @ Vector((0, -2 * actor['scale'], 0))

def at(seconds):
    frame = seconds * 24
    bpy.context.scene.frame_set(int(frame), subframe=frame - int(frame))

at(0)
origin = joint(rig, 'Hips')
errors = []
for time, expected in [(first, native_step), (second, native_step * 2), (end, native_step * 2 + walk_step)]:
    at(time)
    actual = joint(rig, 'Hips') - origin
    error = Vector((actual.x - expected.x, actual.y - expected.y)).length
    errors.append(error)
    assert error < 0.001, f'Travel changed during export at {time}: {actual} vs {expected}'
at(first - 0.0001)
before = joint(rig, 'Hips')
at(first + 0.0001)
boundary_gap = (joint(rig, 'Hips') - before).length
assert boundary_gap < 0.001, f'Native clips snap at their boundary: {boundary_gap}'
at(second + clips[2]['duration'] / 2)
wave_lift = joint(rig, 'RightForeArm').z - joint(rig, 'RightArm').z
assert wave_lift > 0.1, f'Calibrated wave did not raise the arm: {wave_lift}'
at(end)
assert joint(rig, 'RightForeArm').z < joint(rig, 'RightArm').z - 0.2
print('SCENE_MAKER_IMPORTED_VERIFIED', json.dumps({
    'bones': len(rig.data.bones), 'source_travel_m': source_travel.length,
    'normalization': normalization, 'native_step_m': native_step.length,
    'final_travel_m': (joint(rig, 'Hips') - origin).length,
    'max_travel_error_m': max(errors), 'boundary_gap_m': boundary_gap,
    'wave_elbow_lift_m': wave_lift, 'end_frame': bpy.context.scene.frame_end,
}))
