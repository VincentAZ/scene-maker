"""Verify the browser's A connected performance export independently in Blender.

Pass scene.blend and scene.json. Rowan plays the original Turn and greet then
walks; Mila adapts that gesture then walks; Leo holds its final pose.
"""
import bpy
import hashlib
import json
import math
import sys
from pathlib import Path
from mathutils import Vector

args = sys.argv[sys.argv.index('--') + 1:]
project_path = Path(args[1])
scene = json.loads(project_path.read_text())
bpy.ops.wm.open_mainfile(filepath=str(Path(args[0]).resolve()))
actors = {e['name']: e for e in scene['entities']}
assert set(actors) == {'Rowan', 'Mila', 'Leo'}
roots = {name: bpy.data.objects['entity_' + actor['id']] for name, actor in actors.items()}


def rig_below(root):
    if root.type == 'ARMATURE':
        return root
    return next(o for o in root.children_recursive if o.type == 'ARMATURE')


rigs = {name: rig_below(root) for name, root in roots.items()}
assert len([o for o in bpy.data.objects if o.type == 'ARMATURE']) == 3


def bone(name, ending):
    return next(b for b in rigs[name].pose.bones
                if b.name.replace(':', '').replace('_', '').lower().endswith(ending.lower()))


def joint(name, ending):
    return rigs[name].matrix_world @ bone(name, ending).matrix.translation


def arm_direction(name):
    return (joint(name, 'RightForearm') - joint(name, 'RightArm')).normalized()


def angle(a, b):
    return math.acos(max(-1, min(1, a.dot(b))))


def at(time):
    frame = time * 24
    bpy.context.scene.frame_set(int(frame), subframe=frame - int(frame))


duration = actors['Rowan']['clips'][0]['duration']
motion_id = actors['Rowan']['clips'][0]['motionId']
assert all(a['clips'][0]['motionId'] == motion_id for a in actors.values())
for name in ['Rowan', 'Mila']:
    assert actors[name]['clips'][1]['motionId'] == 'walk'
    assert actors[name]['clips'][1]['transition'] == 'smooth'
assert actors['Leo']['ending'] == 'hold' and len(actors['Leo']['clips']) == 1

gaps, jumps, blend_steps, turn_errors, walk_errors = [], [], [], [], []
for name in ['Rowan', 'Mila']:
    at(duration - .0001)
    before, direction = joint(name, 'hips'), arm_direction(name)
    at(duration + .0001)
    gaps.append((joint(name, 'hips') - before).length)
    jumps.append(angle(direction, arm_direction(name)))
    assert gaps[-1] < .001, f'{name} root snapped: {gaps[-1]}'
    assert jumps[-1] < .005, f'{name} arm snapped: {jumps[-1]}'

    at(duration)
    walk_start = joint(name, 'hips')
    directions = [arm_direction(name)]
    for frame in range(1, 7):
        at(duration + frame / 24)
        directions.append(arm_direction(name))
        expected = walk_start + Vector((frame / 48, 0, 0))
        actual = joint(name, 'hips')
        # The walk deliberately bobs vertically; only horizontal travel is linear.
        walk_errors.append(math.hypot(actual.x - expected.x, actual.y - expected.y))
    steps = [angle(a, b) for a, b in zip(directions, directions[1:])]
    blend_steps.extend(steps)
    assert angle(directions[0], directions[-1]) > 1.2, f'{name} never lowered the arm'
    assert min(steps) > .04 and max(steps) < .45, f'{name} did not blend gradually: {steps}'
    at(duration + 4)
    turn_errors.append((joint(name, 'hips') - walk_start - Vector((2, 0, 0))).length)
assert max(walk_errors) < .001, f'Blend altered root speed: {walk_errors}'
assert max(turn_errors) < .001, f'Following walk lost the 90-degree turn: {turn_errors}'

# Compare every final joint in world space, including the imported gesture's
# turned hip, rather than relying on the root object or a stored scene field.
at(duration)
held = {b.name: rigs['Leo'].matrix_world @ b.matrix for b in rigs['Leo'].pose.bones}
held_arm = arm_direction('Leo')
assert abs(held_arm.z) < .001, 'The held arm is not in the authored T-pose'
hold_errors = []
for time in [3, 6, 12]:
    at(time)
    for b in rigs['Leo'].pose.bones:
        current = rigs['Leo'].matrix_world @ b.matrix
        hold_errors.append(max(abs(current[row][column] - held[b.name][row][column])
                               for row in range(4) for column in range(4)))
assert max(hold_errors) < .00001, f'Final pose drifted: {max(hold_errors)}'
print('SCENE_MAKER_TRANSITIONS_VERIFIED', json.dumps({
    'rigs': len(rigs), 'max_boundary_gap_m': max(gaps),
    'max_boundary_arm_angle_rad': max(jumps),
    'blend_step_angle_range_rad': [min(blend_steps), max(blend_steps)],
    'max_walk_speed_position_error_m': max(walk_errors),
    'max_final_walk_error_m': max(turn_errors),
    'max_final_hold_matrix_error': max(hold_errors),
    'end_frame': bpy.context.scene.frame_end,
    'glb_sha256': hashlib.sha256(project_path.with_suffix('.glb').read_bytes()).hexdigest(),
}))
