"""Verify a browser-exported scene in Blender; no external credentials required."""
import bpy
import json
import sys
from pathlib import Path
source = Path(sys.argv[sys.argv.index('--') + 1]).resolve()
bpy.ops.wm.open_mainfile(filepath=str(source))
rigs = [obj for obj in bpy.data.objects if obj.type == 'ARMATURE']
assert len(rigs) == 2, f'Expected 2 rigs, found {len(rigs)}'
assert all(len(rig.data.bones) == 11 for rig in rigs)
assert len(bpy.data.actions) > 0
bpy.context.scene.frame_set(0)
start = [tuple(value for row in rig.pose.bones['rightArm'].matrix for value in row) for rig in rigs]
bpy.context.scene.frame_set(24)
end = [tuple(value for row in rig.pose.bones['rightArm'].matrix for value in row) for rig in rigs]
assert any(a != b for a, b in zip(start, end)), 'Exported poses must animate'
print('SCENE_MAKER_VERIFIED', json.dumps({'rigs': len(rigs), 'bones': sum(len(rig.data.bones) for rig in rigs), 'actions': len(bpy.data.actions), 'end_frame': bpy.context.scene.frame_end}))
# Generate a real FBX fixture to exercise the user-owned asset conversion path.
bpy.ops.object.select_all(action='DESELECT')
rig = rigs[0]
rig.select_set(True)
for obj in bpy.data.objects:
    if any(mod.type == 'ARMATURE' and mod.object == rig for mod in obj.modifiers):
        obj.select_set(True)
bpy.context.view_layer.objects.active = rig
bpy.ops.export_scene.fbx(filepath=str(source.with_name('character.fbx')),use_selection=True,add_leaf_bones=False)
