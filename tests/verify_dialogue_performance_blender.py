"""Verify the browser-created Words across the table package.
Usage: blender --background --python-exit-code 1 --python this.py -- scene.blend scene.json dialogue.srt
"""
import bpy
import json
import sys
from pathlib import Path
from mathutils import Vector

blend, source, subtitles = sys.argv[sys.argv.index('--') + 1:]
scene = json.loads(Path(source).read_text())
bpy.ops.wm.open_mainfile(filepath=str(Path(blend).resolve()))
actors = {e['name']: e for e in scene['entities'] if e['name'] in ('Mila', 'Leo')}
assert len(actors) == 2
assert [c['motionId'] for c in actors['Mila']['clips']] == ['sit', 'sip', 'stand']
assert [c['motionId'] for c in actors['Leo']['clips']] == ['idle', 'wave', 'bow']
rigs = {name: bpy.data.objects['entity_' + actor['id']] for name, actor in actors.items()}
assert all(rig.type == 'ARMATURE' for rig in rigs.values())
assert len([o for o in bpy.data.objects if o.type == 'ARMATURE']) == 2
cup_id = actors['Mila']['clips'][1]['targetId']
cup = bpy.data.objects['entity_' + cup_id]

def at(t):
    frame = t * 24
    bpy.context.scene.frame_set(int(frame), subframe=frame - int(frame))

def joint(rig, name):
    return rig.matrix_world @ rig.pose.bones[name].matrix.translation

def rotation(rig, name):
    return (rig.matrix_world @ rig.pose.bones[name].matrix).to_quaternion()

def timecode(t):
    ms = round(t * 1000)
    return f'{ms//3600000:02}:{ms//60000%60:02}:{ms//1000%60:02},{ms%1000:03}'

# Derive the two complete caption intervals independently from the saved clips.
intervals = []
for line in scene['transcript']:
    actor = next(e for e in actors.values() if e['id'] == line['characterId'])
    ids = line['clipIds']
    assert line['clipId'] in ids
    time = 0
    bounds = []
    for clip in actor['clips']:
        if clip['id'] in ids:
            bounds.append((time, time + clip['duration']))
        time += clip['duration']
    assert len(bounds) == len(ids)
    intervals.append((min(a for a, b in bounds), max(b for a, b in bounds)))
assert intervals == [(0, 8), (8, 12)], intervals
expected = '\n'.join(f'{i+1}\n{timecode(a)} --> {timecode(b)}\n{line["name"]}: {line["text"]}\n' for i, (line, (a, b)) in enumerate(zip(scene['transcript'], intervals)))
assert Path(subtitles).read_text() == expected
assert 'Let me take a sip, then we can begin.' in expected
assert 'Take your time. Your story matters.' in expected

mila, leo = rigs['Mila'], rigs['Leo']
at(0)
cup_home = cup.matrix_world.copy()
leo_idle = rotation(leo, 'rightArm')
at(3)
seated_hip = joint(mila, 'hips')
hip_drift = 0
sole_error = 0
for t in (3, 3.5, 4.5, 5.5, 6):
    at(t)
    hip_drift = max(hip_drift, (joint(mila, 'hips') - seated_hip).length)
    vertices = []
    for mesh in mila.children_recursive:
        if mesh.type != 'MESH': continue
        evaluated = mesh.evaluated_get(bpy.context.evaluated_depsgraph_get())
        vertices.extend((evaluated.matrix_world @ v.co).z for v in evaluated.data.vertices)
    sole_error = max(sole_error, abs(min(vertices)))
assert hip_drift < .0001 and sole_error < .002
at(4.5)
upper = mila.data.bones['rightArm'].matrix_local
lower = mila.data.bones['rightForearm'].matrix_local
hand_local = lower.inverted() @ (lower.translation + (lower.translation - upper.translation) * (.3 / .29))
hand = mila.matrix_world @ mila.pose.bones['rightForearm'].matrix @ hand_local
grip_error = (hand - cup.matrix_world @ Vector((.13, 0, .08))).length
rim_error = ((cup.matrix_world @ Vector((0, .04, .15))) - (joint(mila, 'head') + Vector((0, -.18, -.03)))).length
assert grip_error < .002 and rim_error < .002
assert cup.matrix_world.translation.z - cup_home.translation.z > .2
at(6)
release_error = max(abs(a-b) for x,y in zip(cup_home,cup.matrix_world) for a,b in zip(x,y))
assert release_error < .00001
at(7)
wait_angle = leo_idle.rotation_difference(rotation(leo, 'rightArm')).angle
assert wait_angle < .1
at(8)
standing_rise = joint(mila, 'hips').z - seated_hip.z
assert standing_rise > .2
leo_spine = rotation(leo, 'spine')
at(9)
wave_angle = leo_idle.rotation_difference(rotation(leo, 'rightArm')).angle
assert wave_angle > .5
at(11)
bow_angle = leo_spine.rotation_difference(rotation(leo, 'spine')).angle
assert bow_angle > .3
assert bpy.context.scene.render.fps == 24 and bpy.context.scene.frame_start == 0 and bpy.context.scene.frame_end == 288
print('SCENE_MAKER_DIRECTED_DIALOGUE_VERIFIED', json.dumps({'caption_intervals': intervals, 'rigs': len(rigs), 'hip_drift_m': hip_drift, 'sole_error_m': sole_error, 'grip_error_m': grip_error, 'rim_error_m': rim_error, 'release_error': release_error, 'standing_rise_m': standing_rise, 'waiting_arm_angle': wait_angle, 'wave_angle': wave_angle, 'bow_angle': bow_angle, 'end_frame': 288}))
