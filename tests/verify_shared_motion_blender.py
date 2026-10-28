"""Independently verify the browser's A shared gesture export.

Pass scene.blend and scene.json. Rowan plays the original Turn and greet clip;
Mila shares it then walks, while Leo shares it then waves.
"""
import bpy
import json
import sys
from pathlib import Path
from mathutils import Vector

args = sys.argv[sys.argv.index('--') + 1:]
scene = json.loads(Path(args[1]).read_text())
bpy.ops.wm.open_mainfile(filepath=str(Path(args[0]).resolve()))
actors = {e['name']: e for e in scene['entities']}
assert set(actors) == {'Rowan', 'Mila', 'Leo'}
roots = {name: bpy.data.objects['entity_' + actor['id']] for name, actor in actors.items()}

def rig_below(root):
    if root.type == 'ARMATURE':
        return root
    return next(o for o in root.children_recursive if o.type == 'ARMATURE')

rigs = {name: rig_below(root) for name, root in roots.items()}
assert len([o for o in bpy.data.objects if o.type == 'ARMATURE']) == 3, 'Hidden source rig leaked into the export'

def bone(rig, ending):
    return next(b for b in rig.pose.bones if b.name.replace(':', '').replace('_', '').lower().endswith(ending.lower()))

def joint(name, ending):
    rig = rigs[name]
    return rig.matrix_world @ bone(rig, ending).matrix.translation

def at(time):
    frame = time * 24
    bpy.context.scene.frame_set(int(frame), subframe=frame - int(frame))

shared_id = actors['Rowan']['clips'][0]['motionId']
shared_duration = actors['Rowan']['clips'][0]['duration']
assert all(actor['clips'][0]['motionId'] == shared_id for actor in actors.values())
assert actors['Mila']['clips'][1]['motionId'] == 'walk'
assert actors['Leo']['clips'][1]['motionId'] == 'wave'
at(0)
origins = {name: joint(name, 'hips') for name in actors}
errors = []
pairs = [('RightArm', 'RightForearm', 'RightArm', 'RightForearm'),
         ('LeftArm', 'LeftForearm', 'LeftArm', 'LeftForearm'),
         ('RightUpLeg', 'RightLeg', 'RightLeg', 'RightShin'),
         ('LeftUpLeg', 'LeftLeg', 'LeftLeg', 'LeftShin'),
         ('Spine', 'Head', 'Spine', 'Head')]
for frame in range(int(shared_duration * 24)):
    at(frame / 24)
    for source_parent, source_child, target_parent, target_child in pairs:
        original = (joint('Rowan', source_child) - joint('Rowan', source_parent)).normalized()
        for target in ['Mila', 'Leo']:
            direction = (joint(target, target_child) - joint(target, target_parent)).normalized()
            errors.append((direction - original).length)
assert max(errors) < 0.0001, f'Anatomical pose transfer changed: {max(errors)}'
at(1)
lift = joint('Mila', 'RightForearm').z - joint('Mila', 'RightArm').z
assert lift > .27, f'The authored overhead gesture is missing: {lift}'
travel_errors, facing_errors, gaps = [], [], []
for name in ['Mila', 'Leo']:
    actor = actors[name]
    at(shared_duration - .0001)
    before = joint(name, 'hips')
    at(shared_duration + .0001)
    gaps.append((joint(name, 'hips') - before).length)
    at(shared_duration)
    step = joint(name, 'hips') - origins[name]
    # This fixture travels 2 source meters and both receiving studio bodies have
    # the same .79 m anatomical hip-to-ankle measure as the original Blender rig.
    expected = Vector((0, -2 * actor['scale'], 0))
    travel_errors.append((step - expected).length)
    forward = roots[name].matrix_world.to_quaternion() @ Vector((0, -1, 0))
    facing_errors.append((forward - Vector((1, 0, 0))).length)
assert max(travel_errors) < .001, f'Shared root travel changed: {travel_errors}'
assert max(facing_errors) < .0001, f'Final facing did not carry: {facing_errors}'
assert max(gaps) < .001, f'Shared action boundary snapped: {gaps}'
at(shared_duration + 4)
final = joint('Mila', 'hips') - origins['Mila']
assert (final - Vector((2, -2, 0))).length < .001, f'The next walk ignored the final turn: {final}'
print('SCENE_MAKER_SHARED_MOTION_VERIFIED', json.dumps({
    'rigs': len(rigs), 'direction_samples': len(errors), 'max_direction_error': max(errors),
    'max_travel_error_m': max(travel_errors), 'max_facing_vector_error': max(facing_errors),
    'max_boundary_gap_m': max(gaps), 'overhead_elbow_lift_m': lift,
    'mila_final_displacement': list(final), 'end_frame': bpy.context.scene.frame_end,
}))
