"""Check a built-in character's pick → sip → place browser export in Blender.

Pass scene.blend and its matching scene.json. The fixture should have a reachable
cup and a built-in character whose first three clips are pick, sip, and place.
This checks the baked destination file, independently of the preview renderer.
"""
import bpy
import json
import sys
from pathlib import Path
from mathutils import Vector

args = sys.argv[sys.argv.index('--') + 1:]
source = Path(args[0]).resolve()
scene = json.loads(Path(args[1]).read_text())
actor = next(entity for entity in scene['entities']
             if [clip['motionId'] for clip in entity['clips'][:3]] == ['pick', 'sip', 'place'])
clips = actor['clips'][:3]
assert len({clip['targetId'] for clip in clips}) == 1
target = next(entity for entity in scene['entities'] if entity['id'] == clips[0]['targetId'])
assert target['assetId'] == 'cup', 'This fixture checks the built-in cup contact points'
bpy.ops.wm.open_mainfile(filepath=str(source))
rig = bpy.data.objects['entity_' + actor['id']]
cup = bpy.data.objects['entity_' + target['id']]
assert rig.type == 'ARMATURE' and len(rig.data.bones) == 11

# Recover the terminal hand point from the built-in rig's rest proportions.
# Blender's importer changes bone axes, so a hard-coded local offset is wrong.
rest_upper = rig.data.bones['rightArm'].matrix_local
rest_lower = rig.data.bones['rightForearm'].matrix_local
rest_hand = rest_lower.translation + (rest_lower.translation - rest_upper.translation) * (0.3 / 0.29)
hand_local = rest_lower.inverted() @ rest_hand
grip_local = Vector((0.13, 0, 0.08))  # glTF Y-up → Blender Z-up
rim_local = Vector((0, 0.04, 0.15))

def at(seconds):
    frame = seconds * 24
    bpy.context.scene.frame_set(int(frame), subframe=frame - int(frame))

at(0)
home = cup.matrix_world.copy()
pick_end = clips[0]['duration']
sip_end = pick_end + clips[1]['duration']
end = sip_end + clips[2]['duration']
samples = [pick_end * 0.5, pick_end * 0.75, pick_end,
           pick_end + clips[1]['duration'] * 0.5, sip_end,
           sip_end + clips[2]['duration'] * 0.5]
errors = []
for seconds in samples:
    at(seconds)
    hand = rig.matrix_world @ rig.pose.bones['rightForearm'].matrix @ hand_local
    grip = cup.matrix_world @ grip_local
    errors.append((hand - grip).length)
assert max(errors) < 0.002, f'Baked hand/grip separation: {errors}'

at(pick_end + clips[1]['duration'] * 0.5)
mouth = rig.matrix_world @ (rig.pose.bones['head'].matrix.translation + Vector((0, -0.18, -0.03)))
rim_error = ((cup.matrix_world @ rim_local) - mouth).length
assert rim_error < 0.03, f'Cup rim misses the mouth: {rim_error}'
lift = cup.matrix_world.translation.z - home.translation.z
assert lift > 0.2, f'Cup did not rise to drink: {lift}'

at(end)
release_error = max(abs(a - b) for row_a, row_b in zip(cup.matrix_world, home)
                    for a, b in zip(row_a, row_b))
assert release_error < 0.00001, f'Cup did not return to its original transform: {release_error}'
print('SCENE_MAKER_INTERACTION_VERIFIED', json.dumps({
    'contact_samples': len(samples), 'max_grip_error_m': max(errors),
    'mouth_error_m': rim_error, 'cup_lift_m': lift, 'release_error': release_error,
    'end_frame': bpy.context.scene.frame_end,
}))
