"""Verify the browser-authored symmetric route fixture in its Blender export.

The character chains Walk (2m) → a smooth [0,0,0], [2,0,2], [4,0,0]
route → Wave → Walk (2m). Pass the exported .blend and matching scene.json.
Expected waypoints, tangent directions, and chained endpoints are independent
of the JavaScript sampler; this script inspects the destination animation.
"""
import bpy
import json
import math
import sys
from pathlib import Path
from mathutils import Vector

args = sys.argv[sys.argv.index('--') + 1:]
scene = json.loads(Path(args[1]).read_text())
motions = {m['id']: m for m in scene['customMotions']}
actor = next(e for e in scene['entities'] if any(c['motionId'] in motions and motions[c['motionId']].get('path') for c in e['clips']))
clips = actor['clips']
assert len(clips) == 4 and [clips[i]['motionId'] for i in [0, 2, 3]] == ['walk', 'wave', 'walk']
path = motions[clips[1]['motionId']]['path']
assert path['smooth'] and path['points'] == [[0, 0, 0], [2, 0, 2], [4, 0, 0]]
bpy.ops.wm.open_mainfile(filepath=str(Path(args[0]).resolve()))
rig = bpy.data.objects['entity_' + actor['id']]
assert rig.type == 'ARMATURE'
start = clips[0]['duration']
end = start + clips[1]['duration']
departure = end + clips[2]['duration']
finish = departure + clips[3]['duration']
heading = actor['rotation']
scale = actor['scale']

def at(seconds):
    frame = seconds * 24
    bpy.context.scene.frame_set(int(frame), subframe=frame - int(frame))

def position():
    p = rig.matrix_world.translation
    return Vector((p.x, -p.y))

def world(x, z):
    return Vector((actor['position'][0] + scale * (x * math.cos(heading) + z * math.sin(heading)),
                   actor['position'][2] + scale * (-x * math.sin(heading) + z * math.cos(heading))))

def direction():
    forward = rig.matrix_world.to_3x3() @ Vector((0, -1, 0))
    return Vector((forward.x, -forward.y)).normalized()

expected = [(start, world(0, 2), heading),
            (start + clips[1]['duration'] / 2, world(2, 4), heading + math.pi / 2),
            (end, world(4, 2), heading + math.pi * 0.75),
            (departure, world(4, 2), heading + math.pi * 0.75),
            (finish, world(4 + math.sqrt(2), 2 - math.sqrt(2)), heading + math.pi * 0.75)]
position_errors, heading_errors = [], []
for seconds, point, angle in expected:
    at(seconds)
    position_errors.append((position() - point).length)
    heading_errors.append((direction() - Vector((math.sin(angle), math.cos(angle)))).length)
assert max(position_errors) < 0.002, position_errors
assert max(heading_errors) < 0.002, heading_errors

steps = []
previous = None
for frame in range(round(start * 24), round(end * 24) + 1):
    bpy.context.scene.frame_set(frame)
    point = position()
    if previous is not None:
        steps.append((point - previous).length)
    previous = point
assert max(steps) / min(steps) < 1.02, 'Route speed varies unexpectedly'

gaps = []
for boundary in [start, end, departure]:
    at(boundary - 0.001)
    before = position()
    at(boundary + 0.001)
    gaps.append((position() - before).length)
assert max(gaps) < 0.01, gaps
at(start)
rest_leg = rig.pose.bones['rightLeg'].matrix.copy()
at(start + 0.8)
gait_change = max(abs(a - b) for x, y in zip(rest_leg, rig.pose.bones['rightLeg'].matrix) for a, b in zip(x, y))
assert gait_change > 0.02, 'Leg animation is missing from the baked route'
print('SCENE_MAKER_PATH_VERIFIED', json.dumps({
    'endpoint_samples': len(expected), 'max_position_error_m': max(position_errors),
    'max_facing_vector_error': max(heading_errors), 'speed_ratio': max(steps) / min(steps),
    'max_boundary_gap_m': max(gaps), 'gait_change': gait_change,
    'end_frame': bpy.context.scene.frame_end,
}))
