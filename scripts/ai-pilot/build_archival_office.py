"""Original AI-authored archival office; no downloaded meshes or diffusion textures.
Run: blender -b --python scripts/ai-pilot/build_archival_office.py -- --output-dir .data/ai-pilot/generated
Coordinates in public helpers/metadata are glTF metres (Y up, front +Z).
All bitmap patterns are deterministic mathematical authored textures, NOT AI diffusion.
License: original project contribution, usable under the host project's license.
"""
import argparse
import json
import math
import random
import sys
from pathlib import Path

import bpy
import numpy as np
from mathutils import Vector

SEED = 82741
rng = random.Random(SEED)
args = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
parser = argparse.ArgumentParser()
parser.add_argument('--output-dir', default='.data/ai-pilot/generated')
opts = parser.parse_args(args)
OUT = Path(opts.output_dir).resolve()
OUT.mkdir(parents=True, exist_ok=True)
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.context.preferences.filepaths.save_version = 0


def p(v):
    return Vector((v[0], -v[2], v[1]))


def material(name, color, roughness=.5, metal=0, texture=None):
    m = bpy.data.materials.new(name)
    m.diffuse_color = (*color, 1)
    m.use_nodes = True
    bs = m.node_tree.nodes.get('Principled BSDF')
    bs.inputs['Base Color'].default_value = (*color, 1)
    bs.inputs['Roughness'].default_value = roughness
    bs.inputs['Metallic'].default_value = metal
    if texture:
        tex = m.node_tree.nodes.new('ShaderNodeTexImage')
        tex.image = texture
        m.node_tree.links.new(tex.outputs['Color'], bs.inputs['Base Color'])
    return m


def image(name, kind, base, width=512, height=256):
    # Small packed PNGs, explicitly connected to glTF-compatible Base Color inputs.
    x, y = np.meshgrid(np.linspace(0, 1, width), np.linspace(0, 1, height))
    noise = np.random.default_rng(SEED + len(bpy.data.images)).random((height, width))
    if kind == 'wood':
        bend = y + .019*np.sin(x*12) + .009*np.sin(x*31+y*15)
        val = .85 + .10*np.sin(bend*180) + .035*np.sin(bend*540) + .055*noise
        # Sparse thin, flowing pores; not photographic or diffusion-generated.
        val -= .08*np.maximum(0, np.sin(bend*930+x*4))**14
    elif kind == 'cloth':
        val = .89 + .07*noise + .025*np.sin(x*width*math.pi)*np.cos(y*height*math.pi)
    else:
        val = .95 + .045*noise + .018*np.sin(x*30)*np.cos(y*23)
    rgba = np.ones((height, width, 4), dtype=np.float32)
    for c in range(3):
        rgba[:, :, c] = np.clip(base[c]*val, 0, 1)
    im = bpy.data.images.new(name, width=width, height=height, alpha=False)
    im.pixels.foreach_set(rgba.ravel())
    im.file_format = 'PNG'
    im.filepath_raw = str(OUT / (name + '.png'))
    im.save()
    im.pack()
    return im


walnut = material('Walnut • satin oiled grain', (.28,.135,.065), .36,
                  texture=image('authored-walnut', 'wood', (.39,.225,.115)))
oak = material('Floor • smoked honey oak', (.35,.23,.12), .48,
               texture=image('authored-oak', 'wood', (.43,.31,.19)))
plaster = material('Warm lime plaster', (.74,.70,.60), .93,
                   texture=image('authored-plaster', 'plaster', (.79,.76,.68),256,256))
cloth = material('Bottle green woven upholstery', (.075,.13,.115), .84,
                 texture=image('authored-upholstery', 'cloth', (.115,.19,.165),256,256))
paint = material('Wainscot • muted olive grey', (.22,.265,.235), .62)
inset = material('Panel recessed field', (.19,.228,.20), .68)
brass = material('Aged brass hardware', (.48,.32,.12), .3, .76)
dark = material('Darkened metal', (.045,.052,.05), .37, .65)
paper = material('Ivory paper edges', (.70,.65,.52), .9)
cream = material('Ivory painted radiator', (.65,.64,.55), .51, .15)
black = material('Desk leather oxblood', (.10,.035,.027), .64)
books = [material('Binding '+n,c,.68) for n,c in [
    ('oxblood',(.22,.055,.045)), ('umber',(.19,.12,.065)),
    ('olive',(.18,.22,.13)), ('navy',(.07,.12,.16)),
    ('ochre',(.39,.26,.105)), ('sage',(.30,.34,.26))]]
boxmat = material('Archive linen board', (.48,.43,.32), .91)


def finish(obj, name, mat):
    obj.name = name
    obj.data.materials.append(mat)
    return obj


def cube(name, loc, size, mat, bevel=.01):
    bpy.ops.mesh.primitive_cube_add(size=1, location=p(loc))
    obj = bpy.context.object
    obj.dimensions = (size[0], size[2], size[1])
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    # Continuous planar UVs on each face, longest face dimension runs along grain.
    mesh = obj.data
    uv = mesh.uv_layers.active or mesh.uv_layers.new()
    for face in mesh.polygons:
        axes = sorted(range(3), key=lambda a: abs(face.normal[a]))[:2]
        axes.sort(key=lambda a: obj.dimensions[a], reverse=True)
        for li in face.loop_indices:
            co = mesh.vertices[mesh.loops[li].vertex_index].co
            uv.data[li].uv = (co[axes[0]]/max(obj.dimensions[axes[0]],.001)+.5,
                              co[axes[1]]/max(obj.dimensions[axes[1]],.001)+.5)
    if bevel:
        mod = obj.modifiers.new('Soft manufactured edges', 'BEVEL')
        mod.width = bevel
        mod.segments = 2
        mod.affect = 'EDGES'
        mod = obj.modifiers.new('Weighted corner normals', 'WEIGHTED_NORMAL')
    return finish(obj,name,mat)


def tube(name, points, radius, mat):
    curve = bpy.data.curves.new(name,'CURVE')
    curve.dimensions = '3D'
    curve.resolution_u = 8
    curve.bevel_depth = radius
    curve.bevel_resolution = 2
    sp = curve.splines.new('BEZIER')
    sp.bezier_points.add(len(points)-1)
    for bp, co in zip(sp.bezier_points, points):
        bp.co = p(co)
        bp.handle_left_type = bp.handle_right_type = 'AUTO'
    obj = bpy.data.objects.new(name,curve)
    bpy.context.collection.objects.link(obj)
    curve.materials.append(mat)
    return obj


def cylinder(name, loc, radius, depth, mat, vertices=20):
    bpy.ops.mesh.primitive_cylinder_add(vertices=vertices, radius=radius, depth=depth, location=p(loc))
    obj = bpy.context.object
    finish(obj,name,mat)
    be = obj.modifiers.new('Turned edge','BEVEL'); be.width=.004; be.segments=2
    obj.modifiers.new('Weighted normals','WEIGHTED_NORMAL')
    return obj


def text(name, body, loc, size, mat, facing='front'):
    # Blender text is in XY plane; +90deg X makes its normal face glTF +Z.
    bpy.ops.object.text_add(location=p(loc))
    obj = bpy.context.object
    obj.name = name
    obj.data.body = body
    obj.data.size = size
    obj.data.align_x = 'CENTER'
    obj.data.extrude = .0005
    obj.rotation_euler = (math.pi/2,0,0)
    obj.data.materials.append(mat)
    bpy.ops.object.convert(target='MESH')
    return bpy.context.object


# Structure: slab top is exactly y=0. No roof and no front wall.
cube('Floor shadow substrate',(0,-.065,0),(7,.13,6),dark,.007)
for row in range(25):
    x = -3.5 + (row+.5)*.28
    offset = -.6 if row%2 else 0
    boundaries = sorted(set([-3,3] + [v for v in [-3+offset+i*1.2 for i in range(7)] if -3<v<3]))
    for start,end in zip(boundaries[:-1],boundaries[1:]):
        cube('Individual oak plank', (x,-.014,(start+end)/2),(.277,.028,end-start-.003), oak,.002)
# Left wall with actual window opening: z -1.2 .. +1.2, y1.15 .. 2.65.
cube('Rear plaster wall',(0,1.65,-3.045),(7.15,3.3,.12),plaster)
cube('Left wall rear pier',(-3.545,1.65,-2.1),(.12,3.3,1.8),plaster)
cube('Left wall front pier',(-3.545,1.65,2.1),(.12,3.3,1.8),plaster)
cube('Below window plaster',(-3.545,.575,0),(.12,1.15,2.4),plaster)
cube('Above window plaster',(-3.545,2.975,0),(.12,.65,2.4),plaster)
# Camera-side wall intentionally cut back/down to keep the stage readable.
cube('Right rear return',(3.545,1.65,-2.2),(.12,3.3,1.6),plaster)
cube('Right cutaway parapet',(3.545,.44,.8),(.12,.88,4.4),paint)
# Rear wall panelling with actual relief rails/stiles.
cube('Rear wainscot field',(0,.47,-2.969),(7,.94,.035),inset,.003)
for x in [-3.45,-2.3,-1.15,0,1.15,2.3,3.45]:
    cube('Rear panel stile',(x,.47,-2.93),(.055,.84,.035),paint,.003)
for h,t in [(.08,.12),(.9,.065),(.96,.035)]:
    cube('Rear horizontal moulding',(0,h,-2.92),(7,t,.065),paint,.004)
for side in [-1,1]:
    x=side*3.46
    cube('Side wainscot field',(x,.44,0),(.035,.88,6),inset,.003)
    for z in [-2.9,-1.75,-.6,.55,1.7,2.9]:
        cube('Side panel stile',(x-side*.025,.44,z),(.04,.77,.05),paint,.003)
    for h,t in [(.08,.12),(.85,.055),(.91,.035)]:
        cube('Side horizontal moulding',(x-side*.025,h,0),(.065,t,6),paint,.004)
cube('Rear crown lower',(0,3.15,-2.93),(7,.065,.12),cream)
cube('Rear crown upper',(0,3.24,-2.95),(7,.10,.15),cream)
# Window: pale blue opaque glazing gives a readable opening in GLB without transmission pitfalls.
glass = material('Cool softly frosted window',(.39,.53,.59),.24)
bs=glass.node_tree.nodes.get('Principled BSDF')
bs.inputs['Emission Color'].default_value=(.22,.32,.39,1)
bs.inputs['Emission Strength'].default_value=.27
cube('Window panes',(-3.55,1.90,0),(.018,1.48,2.38),glass,.001)
for z in [-1.22,0,1.22]:
    cube('Window vertical mullion',(-3.46,1.9,z),(.11,1.60,.065),cream,.005)
for h in [1.12,1.90,2.68]:
    cube('Window horizontal sash',(-3.46,h,0),(.11,.065,2.50),cream,.005)
cube('Deep window sill',(-3.35,1.08,0),(.42,.075,2.68),walnut,.014)
# Old radiator under window, softly rounded individual ribs and connecting pipe.
for z in [i*.11-.66 for i in range(13)]:
    cube('Cast radiator rib',(-3.19,.51,z),(.23,.67,.075),cream,.032)
for y in [.24,.77]:
    tube('Radiator manifold',[(-3.20,y,-.79),(-3.20,y,.79)],.033,cream)
for z in [-.82,.82]:
    tube('Radiator pipe',[(-3.22,.05,z),(-3.22,.22,z),(-3.20,.29,z)],.018,brass)

# Built-in rear bookcases flanking the office identity plate.
def binding(x,y,z,w,h,depth, index):
    mat=books[index%len(books)]
    cube('Bound archival volume',(x,y+h/2,z),(w,h,depth),mat,.004)
    # Spine faces front, with paper label and two subtle gold tooling strips.
    face=z+depth/2+.001
    cube('Spine label',(x,y+h*.60,face),(w*.69,h*.19,.003),paper,.001)
    for yy in [y+.027,y+h-.027]:
        cube('Spine gilt rule',(x,yy,face),(w*.78,.004,.003),brass,.0005)


def archive_box(x,y,z,w=.36):
    cube('Linen document box',(x,y+.13,z),(w,.26,.32),boxmat,.006)
    cube('Box lid',(x,y+.265,z),(w+.014,.028,.334),boxmat,.004)
    cube('Index label',(x,y+.15,z+.164),(.15,.065,.005),paper,.001)
    cube('Label holder',(x,y+.15,z+.169),(.11,.004,.005),brass,.001)


def bookcase(cx, width):
    cube('Bookcase back',(cx,1.67,-2.88),(width,2.8,.065),walnut,.006)
    for x in [cx-width/2,cx+width/2]:
        cube('Bookcase upright',(x,1.67,-2.68),(.075,2.8,.46),walnut,.01)
        cube('Bookcase face pilaster',(x,1.67,-2.42),(.10,2.8,.065),walnut,.008)
    for yy in [.28,.87,1.40,1.93,2.46,3.07]:
        cube('Bookcase shelf',(cx,yy,-2.66),(width,.055,.49),walnut,.007)
        cube('Shelf lip',(cx,yy,-2.395),(width,.065,.035),walnut,.004)
    cube('Bookcase crown',(cx,3.10,-2.66),(width+.14,.10,.60),walnut,.012)
    cube('Bookcase plinth',(cx,.17,-2.66),(width+.10,.20,.56),walnut,.009)
    for level, y in enumerate([.31,.90,1.43,1.96,2.49]):
        if level in [0,3]:
            for x in [cx-width*.26,cx+width*.22]: archive_box(x,y,-2.63,width*.37)
        else:
            x=cx-width/2+.10
            while x<cx+width/2-.14:
                w=rng.uniform(.055,.095)
                binding(x+w/2,y,-2.61,w,rng.uniform(.31,.43),.31,rng.randrange(6))
                x+=w+.008

bookcase(-2.22,1.7)
bookcase(2.22,1.7)
# The middle wall gets a custom typographic archive plaque, not stock art.
cube('Wall plaque walnut frame',(0,2.20,-2.935),(2.32,.73,.065),walnut,.014)
cube('Wall plaque inset',(0,2.20,-2.895),(2.23,.64,.018),inset,.006)
text('Archive sign','CITY ARCHIVE',(0,2.27,-2.879),.205,cream)
text('Archive subtitle','RECORDS  /  INQUIRIES',(0,2.06,-2.878),.083,brass)

# Desk: 2.55m executive pedestal desk, top y .78, viewer-facing field panels.
cube('Solid walnut desktop',(0,.745,-1.65),(2.55,.07,1.04),walnut,.022)
cube('Desktop lower bead',(0,.699,-1.65),(2.48,.026,.98),walnut,.008)
for x in [-.94,.94]:
    cube('Desk pedestal carcass',(x,.36,-1.67),(.54,.65,.87),walnut,.012)
    cube('Desk pedestal plinth',(x,.055,-1.67),(.58,.09,.90),walnut,.009)
    # Inset raised panels face the visitors.
    cube('Desk pedestal front field',(x,.38,-1.224),(.41,.46,.018),inset,.006)
    for xx in [x-.226,x+.226]:
        cube('Pedestal panel frame',(xx,.38,-1.207),(.034,.54,.025),walnut,.003)
    for yy in [.11,.65]:
        cube('Pedestal cross frame',(x,yy,-1.207),(.47,.035,.025),walnut,.003)
    # Functional-looking drawers behind the desk.
    for yy in [.21,.42,.61]:
        cube('Drawer front',(x,yy,-2.112),(.46,.16,.025),walnut,.007)
        tube('Drawer brass pull',[(x-.07,yy,-2.136),(x-.06,yy,-2.17),(x+.06,yy,-2.17),(x+.07,yy,-2.136)],.008,brass)
cube('Desk modesty panel',(0,.42,-1.43),(1.36,.48,.045),walnut,.008)
cube('Writing leather inset',(.08,.785,-1.54),(1.02,.012,.55),black,.015)
# Deliberately no lamp: separately generated lamp can be placed at (-.90,.79,-1.60).
for i in range(3):
    cube('Loose case folder',(.78+i*.012,.793+i*.022,-1.59),(.34,.017,.44),books[4 if i==2 else 5],.003)
for i in range(4):
    cube('Correspondence paper',(.12-i*.007,.797+i*.003,-1.47),(.23,.002,.30),paper,.001)
cube('Brass letter tray',(.79,.80,-1.94),(.38,.025,.22),brass,.008)
cube('Letter tray contents',(.79,.816,-1.94),(.33,.008,.18),paper,.002)
cube('Desk nameplate base',(.15,.81,-1.19),(.38,.045,.085),walnut,.009)
cube('Desk nameplate brass',(.15,.838,-1.164),(.31,.035,.007),brass,.002)

# Carefully proportioned curved timber-frame upholstered chairs.
seats=[]
def chair(name,cx,cz,rotation=0,office=False):
    created_before=set(bpy.data.objects)
    width=.61 if office else .56
    cube(name+' seat frame',(0,.425,0),(width,.075,.55),walnut,.035)
    cube(name+' seat cushion',(0,.485,-.005),(width-.045,.095,.51),cloth,.04)
    # Back is a gently curved upholstered ribbon with rounded top profile.
    verts=[]; faces=[]
    for y in [.64,1.035 if office else .97]:
        for i in range(13):
            x=(i/12-.5)*(width-.035)
            z=-.235-.075*(1-(2*x/width)**2)
            verts.append(tuple(p((x,y,z))))
    for i in range(12): faces.append((i,i+1,i+14,i+13))
    mesh=bpy.data.meshes.new(name+' curved back mesh');mesh.from_pydata(verts,[],faces);mesh.update()
    ob=bpy.data.objects.new(name+' curved padded back',mesh);bpy.context.collection.objects.link(ob);mesh.materials.append(cloth)
    so=ob.modifiers.new('Cushion thickness','SOLIDIFY');so.thickness=.065
    be=ob.modifiers.new('Soft cushion edge','BEVEL');be.width=.023;be.segments=3
    ob.modifiers.new('Back normals','WEIGHTED_NORMAL')
    for poly in mesh.polygons:poly.use_smooth=True
    for side in [-1,1]:
        x=side*(width/2-.045)
        tube(name+' rear swept leg',[(x,.035,-.35),(x,.40,-.22),(x,.70,-.28),(x,.99 if office else .95,-.28)],.025,walnut)
        tube(name+' front swept leg',[(x,.035,.31),(x,.25,.25),(x,.43,.20)],.026,walnut)
        tube(name+' side stretcher',[(x,.23,-.25),(x,.21,0),(x,.23,.26)],.016,walnut)
        if office:
            tube(name+' armrest',[(x,.52,.19),(x,.69,.15),(x,.70,-.16),(x,.68,-.27)],.023,walnut)
        for z in [-.35,.31]:
            cylinder(name+' brass shoe',(x,.055,z),.026,.06,brass,16)
    created=set(bpy.data.objects)-created_before
    # Transform all chair elements together, preserving exported scene origins.
    from mathutils import Matrix
    rot=Matrix.Rotation(rotation,4,'Z')
    for ob in created:
        ob.matrix_world = Matrix.Translation(p((cx,0,cz))) @ rot @ ob.matrix_world
    seats.append({'name':name,'position':[cx,.53,cz],'facingYawRadians':rotation,'note':'Static authored chair; placement suggestion only, not runtime seating support.'})

chair('Archivist chair',0,-2.53,0,True)
chair('Visitor left',-.88,-.36,math.pi+.09)
chair('Visitor right',.88,-.36,math.pi-.09)
# Neutral stacks by rear corner: not occupying the actor performance area.
for i in range(2): archive_box(3.01,.03+i*.295,-1.70,.42)
# Side console, with open staging floor in front.
cube('Low left filing console',(-2.92,.41,-1.99),(.69,.78,1.05),walnut,.018)
cube('Console top',(-2.92,.82,-1.99),(.75,.055,1.12),walnut,.016)
for i in range(3):
    cube('Console filed folio',(-2.92,.865+i*.045,-1.95),(.43,.04,.56),books[i],.005)

# Lighting and camera exist for review only; no lamp replacement geometry.
def area(name,loc,target,power,color,size):
    bpy.ops.object.light_add(type='AREA',location=p(loc))
    obj=bpy.context.object;obj.name=name;obj.data.energy=power;obj.data.color=color;obj.data.shape='DISK';obj.data.size=size
    obj.rotation_euler=(p(target)-obj.location).to_track_quat('-Z','Y').to_euler()

area('Warm room bounce',(0,3.8,-.1),(0,.3,-1),650,(1,.79,.57),4.5)
area('Cool window daylight',(-3.15,2.3,.1),(0,.7,-.6),420,(.66,.80,1),2.1)
area('Front softbox review fill',(2.0,4.8,5),(0,1,-1),550,(1,.90,.78),5)
area('Shelf warm rake',(-1.2,2.9,-1.5),(-2,1.6,-2.7),70,(1,.67,.38),1.1)
scene=bpy.context.scene
scene.world=bpy.data.worlds.new('Low cool ambient')
scene.world.use_nodes=True
scene.world.node_tree.nodes['Background'].inputs[0].default_value=(.20,.25,.30,1)
scene.world.node_tree.nodes['Background'].inputs[1].default_value=.28
bpy.ops.object.camera_add(location=p((7,5,9)))
cam=bpy.context.object;cam.name='Review camera • glTF 7,5,9'
cam.rotation_euler=(p((0,1.05,-.55))-cam.location).to_track_quat('-Z','Y').to_euler()
cam.data.type='ORTHO';cam.data.ortho_scale=10.6;cam.data.lens=46
scene.camera=cam
scene.render.engine='CYCLES';scene.cycles.device='CPU';scene.cycles.samples=24;scene.cycles.use_denoising=True
scene.render.threads_mode='FIXED';scene.render.threads=12
scene.render.resolution_x=1500;scene.render.resolution_y=1200;scene.render.resolution_percentage=100
scene.render.image_settings.file_format='PNG'
scene.render.filepath=str(OUT/'archival-office-preview.png')
scene.view_settings.view_transform='AgX'

# Export curves as real geometry so chair legs and hardware are included.
bpy.ops.object.select_all(action='DESELECT')
for ob in list(scene.objects):
    if ob.type=='CURVE':
        bpy.context.view_layer.objects.active=ob;ob.select_set(True)
        bpy.ops.object.convert(target='MESH');ob.select_set(False)
bpy.context.view_layer.update()
mesh_objects=[o for o in scene.objects if o.type=='MESH']
deps=bpy.context.evaluated_depsgraph_get()
triangles=0
points=[]
for ob in mesh_objects:
    ev=ob.evaluated_get(deps);mesh=ev.to_mesh();mesh.calc_loop_triangles()
    triangles+=len(mesh.loop_triangles)
    points.extend([ob.matrix_world@Vector(c) for c in ob.bound_box])
    ev.to_mesh_clear()
lo=[min(v[i] for v in points) for i in range(3)];hi=[max(v[i] for v in points) for i in range(3)]
bounds={'min':[lo[0],lo[2],-hi[1]],'max':[hi[0],hi[2],-lo[1]]}
if triangles>150000:raise RuntimeError(f'Triangle budget exceeded: {triangles}')
# Batch static geometry by material for a small number of viewport draw calls.
# Bake WORLD coordinates, never normalize/recenter: exported origin remains the room origin.
# Editable individual furniture and all modifiers remain untouched in the saved .blend.
batches={}
for ob in mesh_objects:
    ev=ob.evaluated_get(deps); me=ev.to_mesh()
    key=ob.data.materials[0].name
    batch=batches.setdefault(key,{'verts':[],'faces':[],'uv':[],'normals':[],'smooth':[]})
    offset=len(batch['verts']); world=ob.matrix_world; normal_matrix=world.to_3x3().inverted().transposed()
    batch['verts'].extend([tuple(world@v.co) for v in me.vertices])
    for face in me.polygons:
        batch['faces'].append(tuple(offset+i for i in face.vertices))
        batch['smooth'].append(face.use_smooth)
        for li in face.loop_indices:
            batch['uv'].append(tuple(me.uv_layers.active.data[li].uv) if me.uv_layers.active else (0,0))
            batch['normals'].append(tuple((normal_matrix@me.corner_normals[li].vector).normalized()))
    ev.to_mesh_clear()
bpy.ops.object.select_all(action='DESELECT')
export_objects=[]
for name,batch in batches.items():
    me=bpy.data.meshes.new('Export • '+name)
    me.from_pydata(batch['verts'],[],batch['faces']);me.update()
    me.materials.append(bpy.data.materials[name])
    uv=me.uv_layers.new()
    for i,co in enumerate(batch['uv']):uv.data[i].uv=co
    for face,smooth in zip(me.polygons,batch['smooth']):face.use_smooth=smooth
    me.normals_split_custom_set(batch['normals'])
    ob=bpy.data.objects.new('Office • '+name,me);bpy.context.collection.objects.link(ob)
    ob.select_set(True);export_objects.append(ob)
# Lights are intentionally not exported: review lighting may be reapplied in the studio.
bpy.ops.export_scene.gltf(filepath=str(OUT/'archival-office.glb'),export_format='GLB',
    use_selection=True,export_apply=True,export_yup=True,export_cameras=False,export_lights=False,
    export_materials='EXPORT',export_texcoords=True,export_normals=True)
for ob in export_objects:
    me=ob.data;bpy.data.objects.remove(ob,do_unlink=True);bpy.data.meshes.remove(me)
bpy.ops.wm.save_as_mainfile(filepath=str(OUT/'archival-office.blend'))
bpy.ops.render.render(write_still=True)
meta={
    'title':'City Archive — Records & Inquiries',
    'generator':'AI-authored Blender Python, executed with Blender '+bpy.app.version_string,
    'script':'scripts/ai-pilot/build_archival_office.py','seed':SEED,
    'provenance':{'geometry':'Original scripted architectural/furniture geometry; no external meshes.',
        'textures':'Original deterministic NumPy/math wood grain, plaster, upholstery patterns; NOT diffusion-generated.',
        'license':'Original project contribution; no third-party art or textures.',
        'externalAssets':[], 'aiRole':'Composition, Blender code and material authorship; not a trained 3D diffusion output.'},
    'coordinates':{'units':'metres','up':'+Y','front':'+Z','blenderMapping':'(x, -z, y)','floorHeight':0,'preserveAuthoredOrigin':True},
    'roomInteriorDimensions':[7,3.3,6], 'geometryBounds':bounds,
    'desk':{'topHeight':.78,'center':[0,.745,-1.65],'width':2.55,'depth':1.04},
    'lampPlacement':{'position':[-.90,.79,-1.60],'surfaceY':.78,'note':'Separate generated lamp; adjust its pivot/base offset to rest on desktop. No lamp included.'},
    'actorSuggestions':[{'position':[-1,0,.55],'facingYawRadians':math.pi},{'position':[1,0,.55],'facingYawRadians':math.pi}],
    'walkableBoundsSuggested':{'x':[-2.2,2.2],'z':[-.5,1.8], 'note':'Suggestion, not navmesh; avoid visitor chairs centered at z=-.36. Clear main stage is z .20 to 1.8.'},
    'seatingAnchors':seats,
    'stats':{'editableMeshObjects':len(mesh_objects),'exportMeshObjects':len(batches),'evaluatedTriangles':triangles,'materials':len(bpy.data.materials),'packedTextureImages':4},
    'exportOptimization':'Static meshes batched by material with world-space geometry; room origin unchanged. Editable per-object geometry retained in blend.',
    'preview':{'cameraGltf':[7,5,9],'renderer':'Cycles CPU','samples':24,'resolution':[1500,1200],'visuallyReviewed':False},
    'limitations':['Static furniture, no working drawers or runtime seating system.','Open front and camera-side cutaway wall; no ceiling.','Lighting/camera saved in blend but excluded from GLB; studio lighting governs imported appearance.','Small mathematical color textures, no photographed or diffusion PBR maps.'],
    'outputs':['archival-office.glb','archival-office.blend','archival-office-preview.png','archival-office.json']}
for f in ['archival-office.glb','archival-office.blend','archival-office-preview.png']:
    meta.setdefault('fileSizesBytes',{})[f]=(OUT/f).stat().st_size
(OUT/'archival-office.json').write_text(json.dumps(meta,indent=2)+'\n')
print('STATS '+json.dumps(meta['stats']))
print('BOUNDS '+json.dumps(bounds))
print('OUTPUT '+str(OUT))
