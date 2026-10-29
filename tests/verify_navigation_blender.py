"""Independently verify A clear way through's browser-exported route and cup contact.
Pass scene.blend and scene.json; all measurements use Blender's imported geometry.
"""
import bpy
import json
import math
import sys
from pathlib import Path
from mathutils import Vector

blend, scene_path = sys.argv[sys.argv.index('--') + 1:]
scene = json.loads(Path(scene_path).read_text())
actor = next(e for e in scene['entities'] if e['name'] == 'Mila')
assert len(actor['clips']) == 5
assert [c['motionId'] for c in actor['clips'][2:]] == ['pick', 'sip', 'place']
route = next(m for m in scene['customMotions'] if m['id'] == actor['clips'][1]['motionId'])
assert len(route['path']['points']) > 2 and 'endHeading' in route['path']
target = next(e for e in scene['entities'] if e['id'] == actor['clips'][2]['targetId'])
bpy.ops.wm.open_mainfile(filepath=str(Path(blend).resolve()))
rig = bpy.data.objects['entity_' + actor['id']]
cup = bpy.data.objects['entity_' + target['id']]
assert rig.type == 'ARMATURE'
assert len([o for o in bpy.data.objects if o.type == 'ARMATURE']) == 1
def at(t):
    frame = t * 24
    bpy.context.scene.frame_set(int(frame), subframe=frame-int(frame))

at(0)
home = cup.matrix_world.copy()
boxes = []
for entity in scene['entities']:
    if entity['assetId'] not in ['crate', 'table']:
        continue
    root = bpy.data.objects['entity_' + entity['id']]
    corners = [obj.matrix_world @ Vector(corner) for obj in [root, *root.children_recursive]
               if obj.type == 'MESH' for corner in obj.bound_box]
    boxes.append((min(p.x for p in corners), max(p.x for p in corners),
                  min(p.y for p in corners), max(p.y for p in corners)))
assert len(boxes) == 2
start = actor['clips'][0]['duration']
arrival = start + actor['clips'][1]['duration']
clearances = []
for i in range(math.ceil((arrival-start)*48)+1):
    at(min(arrival, start+i/48))
    point = rig.matrix_world.translation
    for x0,x1,y0,y1 in boxes:
        clearances.append(max(x0-point.x,point.x-x1,y0-point.y,point.y-y1))
assert min(clearances) >= .279 * actor['scale'], f'Route crosses a body-clearance footprint: {min(clearances)}'
at(arrival)
destination = home @ Vector((.13,0,.08))
direction = destination - rig.matrix_world.translation
direction.z = 0
forward = rig.matrix_world.to_quaternion() @ Vector((0,-1,0))
facing_dot = forward.normalized().dot(direction.normalized())
assert facing_dot > .9999, f'Wrong arrival facing: {facing_dot}'
upper = rig.data.bones['rightArm'].matrix_local
lower = rig.data.bones['rightForearm'].matrix_local
hand_local = lower.inverted() @ (lower.translation+(lower.translation-upper.translation)*(.3/.29))
pick_end = arrival + actor['clips'][2]['duration']
sip_end = pick_end + actor['clips'][3]['duration']
end = sip_end + actor['clips'][4]['duration']
errors = []
for t in [arrival+1,arrival+1.5,pick_end,pick_end+1.5,sip_end,sip_end+1]:
    at(t)
    hand = rig.matrix_world @ rig.pose.bones['rightForearm'].matrix @ hand_local
    grip = cup.matrix_world @ Vector((.13,0,.08))
    errors.append((hand-grip).length)
assert max(errors) < .002, f'Hand misses cup: {max(errors)}'
at(pick_end+1.5)
mouth = rig.matrix_world @ (rig.pose.bones['head'].matrix.translation + Vector((0,-.18,-.03)))
rim_error = ((cup.matrix_world @ Vector((0,.04,.15)))-mouth).length
assert rim_error < .03, f'Cup rim misses mouth: {rim_error}'
lift = cup.matrix_world.translation.z-home.translation.z
assert lift > .2
at(end)
release_error = max(abs(a-b) for x,y in zip(home,cup.matrix_world) for a,b in zip(x,y))
assert release_error < .00001
assert bpy.context.scene.render.fps == 24
assert bpy.context.scene.frame_start == 0
assert bpy.context.scene.frame_end == math.ceil(end * 24)
print('SCENE_MAKER_NAVIGATION_VERIFIED',json.dumps({
    'route_clearance_samples':len(clearances),'minimum_clearance_m':min(clearances),
    'arrival_facing_dot':facing_dot,'max_grip_error_m':max(errors),'rim_error_m':rim_error,
    'cup_lift_m':lift,'release_error':release_error,'end_frame':bpy.context.scene.frame_end,
}))
