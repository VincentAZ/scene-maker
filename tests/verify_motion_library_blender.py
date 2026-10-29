"""Compare the browser's A wider performance export against studio pose samples.

Pass scene.blend, scene.json and expected.json from sample-motion-library.ts.
Blender reads the actual exported GLB; it does not reuse the studio sampler.
"""
import bpy
import json
import sys
from pathlib import Path
from mathutils import Vector

blend, scene_path, expected_path = sys.argv[sys.argv.index('--') + 1:]
scene = json.loads(Path(scene_path).read_text())
expected = json.loads(Path(expected_path).read_text())
assert expected['sceneId'] == scene['id']
bpy.ops.wm.open_mainfile(filepath=str(Path(blend).resolve()))
assert {e['name'] for e in scene['entities']} == {'Harper', 'Sage', 'Mila'}
assert len([o for o in bpy.data.objects if o.type == 'ARMATURE']) == 3, 'Hidden source rig leaked'
errors = []
movement = {}
for actor in expected['actors']:
    root = bpy.data.objects['entity_' + actor['id']]
    rig = root if root.type == 'ARMATURE' else next(o for o in root.children_recursive if o.type == 'ARMATURE')
    poses = []
    for sample in actor['samples']:
        frame = sample['time'] * 24
        bpy.context.scene.frame_set(int(frame), subframe=frame-int(frame))
        pose = []
        for name, position in sample['bones'].items():
            bone = next(b for b in rig.pose.bones if b.name == name or b.name.startswith(name + '.'))
            actual = rig.matrix_world @ bone.matrix.translation
            errors.append((actual - Vector(position)).length)
            pose.append(actual.copy())
        poses.append(pose)
    movement[actor['name']] = max((point-origin).length for pose in poses for point, origin in zip(pose, poses[0]))
    assert movement[actor['name']] > .2, f"Missing animation: {actor['name']}"
    assert max((a-b).length for a,b in zip(poses[-1], poses[-2])) < .0001, 'Final pose did not hold'
assert max(errors) < .0001, f'Export pose mismatch: {max(errors)} m'
assert bpy.context.scene.render.fps == 24
assert bpy.context.scene.frame_end == 288
print('SCENE_MAKER_ACTION_LIBRARY_VERIFIED', json.dumps({
    'rigs': 3, 'joint_samples': len(errors), 'max_joint_error_m': max(errors),
    'max_joint_movement_m': movement, 'end_frame': bpy.context.scene.frame_end,
}))
