"""Verify a built-in ladder climb in the actual browser-exported Blender scene.

Usage: blender --background --python tests/verify_ladder_blender.py -- scene.blend scene.json
Checks planted hands/feet independently against physical rung coordinates at
24fps, then checks the final held stance. The fixture has one climb, no follow-up.
"""
import bpy
import json
import math
import sys
from pathlib import Path
from mathutils import Vector

args = sys.argv[sys.argv.index('--') + 1:]
scene = json.loads(Path(args[1]).read_text())
actor = next(e for e in scene['entities']
             if len(e['clips']) == 1 and e['clips'][0]['motionId'] == 'climb')
clip = actor['clips'][0]
target = next(e for e in scene['entities'] if e['id'] == clip['targetId'])
assert target['assetId'] == 'ladder' and actor['scale'] == target['scale'] == 1
bpy.ops.wm.open_mainfile(filepath=str(Path(args[0]).resolve()))
rig = bpy.data.objects['entity_' + actor['id']]
ladder = bpy.data.objects['entity_' + target['id']]
assert rig.type == 'ARMATURE' and len(rig.data.bones) == 11

endpoints = {}
for side in ['left', 'right']:
    for hand in [True, False]:
        upper_name = side + ('Arm' if hand else 'Leg')
        lower_name = side + ('Forearm' if hand else 'Shin')
        upper = rig.data.bones[upper_name].matrix_local
        lower = rig.data.bones[lower_name].matrix_local
        ratio = 0.3 / 0.29 if hand else 0.35 / 0.4
        endpoint = lower.translation + (lower.translation - upper.translation) * ratio
        endpoints[side + ('Hand' if hand else 'Foot')] = (lower_name, lower.inverted() @ endpoint)

def point(limb):
    bone, endpoint = endpoints[limb]
    return ladder.matrix_world.inverted() @ (rig.matrix_world @ rig.pose.bones[bone].matrix @ endpoint)

starts = {'leftHand': 0, 'rightFoot': 0.25, 'rightHand': 0.5, 'leftFoot': 0.75}
errors = []
for frame in range(math.ceil(clip['duration'] * 24 * 0.3), round(clip['duration'] * 24) + 1):
    bpy.context.scene.frame_set(frame)
    progress = frame / (clip['duration'] * 24)
    travel = max(0, min(1, (progress - 0.3) / 0.6)) * 3
    cycle = min(2, math.floor(travel))
    phase = travel - cycle
    for limb, start in starts.items():
        if start + 1e-8 < phase < start + 0.25 - 1e-8:
            continue  # This contact is airborne. Verify the other three.
        hand = limb.endswith('Hand')
        rung = cycle + (1 if phase >= start + 0.25 - 1e-8 else 0) + (3 if hand else 0)
        side = -1 if limb.startswith('left') else 1
        expected = Vector((side * (0.204 if hand else 0.12), -0.0325,
                           0.2 + rung * 0.35 + (0 if hand else 0.0975)))
        errors.append((point(limb) - expected).length)
assert max(errors) < 0.002, f'Baked planted contacts drift from rungs: {max(errors)}'

bpy.context.scene.frame_set(round(clip['duration'] * 24))
end = rig.matrix_world.translation.copy()
assert abs(end.z - (target['position'][1] + 1.2175)) < 1e-5, end
held = {limb: point(limb) for limb in starts}
bpy.context.scene.frame_set(bpy.context.scene.frame_end)
hold_error = max((point(limb) - previous).length for limb, previous in held.items())
assert hold_error < 1e-5
assert (rig.matrix_world.translation - end).length < 1e-5
print('SCENE_MAKER_LADDER_VERIFIED', json.dumps({
    'planted_contact_samples': len(errors), 'max_rung_error_m': max(errors),
    'final_root_height_m': end.z, 'hold_error_m': hold_error,
    'end_frame': bpy.context.scene.frame_end,
}))
