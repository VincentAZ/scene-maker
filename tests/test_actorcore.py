"""ActorCore converter regression tests (synthetic, unlicensed fixtures only).

python3 -m unittest discover -s tests -p test_actorcore.py -v
Blender integration tests skip if BLENDER_PATH / the local studio copy is absent.
The real user-download verification is separate: ignored prepared/*.json reports.
"""
import importlib.util
import json
import os
import shutil
import struct
import subprocess
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
BLENDER = Path(os.environ.get("BLENDER_PATH") or shutil.which("blender") or ROOT / ".data/tools/blender/blender")
SCRIPT = ROOT / "engine/prepare_actorcore.py"
spec = importlib.util.spec_from_file_location("prepare_actorcore", SCRIPT)
actorcore = importlib.util.module_from_spec(spec)
spec.loader.exec_module(actorcore)

FIXTURE = r'''
import bpy, json, sys
from pathlib import Path
from math import radians
root = Path(sys.argv[sys.argv.index('--') + 1])
bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene
scene.render.fps = 30
scene.frame_start, scene.frame_end = 1, 31
arm = bpy.data.armatures.new('ActorCore')
rig = bpy.data.objects.new('Armature', arm)
scene.collection.objects.link(rig)
bpy.context.view_layer.objects.active = rig
bpy.ops.object.mode_set(mode='EDIT')
chain = [
 ('Hip', None, (0,0,1), (0,0,1.1)),
 ('Spine01', 'Hip', (0,0,1.1), (0,0,1.5)),
 ('Head', 'Spine01', (0,0,1.5), (0,0,1.9)),
]
for side, x in [('L',1),('R',-1)]:
 chain += [
  (side+'_Upperarm','Spine01',(x*.1,0,1.5),(x*.4,0,1.5)),
  (side+'_Forearm',side+'_Upperarm',(x*.4,0,1.5),(x*.6,0,1.5)),
  (side+'_Hand',side+'_Forearm',(x*.6,0,1.5),(x*.7,0,1.5)),
  (side+'_Thigh','Hip',(x*.1,0,1),(x*.1,0,.6)),
  (side+'_Calf',side+'_Thigh',(x*.1,0,.6),(x*.1,0,.1)),
  (side+'_Foot',side+'_Calf',(x*.1,0,.1),(x*.1,-.15,.05)),
 ]
for name,parent,head,tail in chain:
 b=arm.edit_bones.new('CC_Base_'+name); b.head=head; b.tail=tail
 if parent:b.parent=arm.edit_bones['CC_Base_'+parent]
bpy.ops.object.mode_set(mode='OBJECT')
bpy.ops.mesh.primitive_cube_add(size=1,location=(0,0,1))
body=bpy.context.object;body.name='Body';body.scale=(.4,.25,1.8)
bpy.ops.object.transform_apply(location=True,rotation=True,scale=True)
for name, indices in [('CC_Base_Hip',[0,1,2,3]),('CC_Base_Spine01',[4,5,6,7])]:
 group=body.vertex_groups.new(name=name);group.add(indices,1.0,'REPLACE')
body.parent=rig
body.modifiers.new('Armature','ARMATURE').object=rig
body.shape_key_add(name='Basis')
smile=body.shape_key_add(name='Smile')
smile.data[7].co.x += .1
# Real files, as found next to an FBX in an ActorCore Unity download.
(root/'body.fbm').mkdir()
for name, color in [('Diffuse',(.7,.3,.1,1)),('Normal',(.5,.5,1,1)),('MetallicAlpha',(.25,.25,.25,.75)),('ao',(.8,.8,.8,1))]:
 im=bpy.data.images.new(name,512,256,alpha=True)
 im.generated_color=color
 im.colorspace_settings.name='Non-Color' if name!='Diffuse' else 'sRGB'
 im.filepath_raw=str(root/'body.fbm'/(name+'.png'));im.file_format='PNG';im.save()
mat=bpy.data.materials.new('Character_Pbr');mat.use_nodes=True
tex=mat.node_tree.nodes.new('ShaderNodeTexImage');tex.image=bpy.data.images['Diffuse']
mat.node_tree.links.new(tex.outputs['Color'],mat.node_tree.nodes['Principled BSDF'].inputs['Base Color'])
body.data.materials.append(mat)
# Body has an accidental one-frame default take: converter must not export it.
hips=rig.pose.bones['CC_Base_Hip']
hips.keyframe_insert('location',frame=1)
rig.animation_data.action.name='0_T-Pose'
bpy.ops.export_scene.fbx(filepath=str(root/'body.fbx'),object_types={'ARMATURE','MESH'},
 add_leaf_bones=False,bake_anim=True,bake_anim_use_all_actions=False,bake_anim_use_nla_strips=False)
rig.animation_data_clear()
# One actual motion plus an inactive rest action. It uses the same authored bind.
for frame,x in [(1,0),(16,.2),(31,0)]:
 hips.location=(x,0,0);hips.keyframe_insert('location',frame=frame)
 upper=rig.pose.bones['CC_Base_L_Upperarm'];upper.rotation_mode='XYZ'
 upper.rotation_euler=(0,radians(x*100),0);upper.keyframe_insert('rotation_euler',frame=frame)
rig.animation_data.action.name='Motion'
bpy.ops.export_scene.fbx(filepath=str(root/'motion.fbx'),object_types={'ARMATURE'},
 add_leaf_bones=False,bake_anim=True,bake_anim_use_all_actions=True,bake_anim_use_nla_strips=False)
settings={'Two Side':True,'Diffuse Color':[255,255,255],'Opacity':1,'Textures':{}}
# Affected ActorCore assets list the same RGBA image for Base Color and
# Opacity, even for entirely opaque skin/clothing. Keep this realistic case in
# the full FBX -> sidecar reconstruction -> GLB -> reimport regression.
for channel,name in [('Base Color','Diffuse'),('Opacity','Diffuse'),('Normal','Normal'),('MetallicAlpha','MetallicAlpha'),('AO','ao')]:
 settings['Textures'][channel]={'Texture Path':'./body.fbm/'+name+'.png','Strength':100,'Offset':[0,0],'Tiling':[1,1]}
# Empty maps must NOT make the material black metallic.
settings['Textures']['Metallic']={'Texture Path':'','Strength':100}
settings['Textures']['Roughness']={'Texture Path':'','Strength':100}
(root/'body.json').write_text(json.dumps({'body':{'Object':{'body':{'Meshes':{'Body':{'Materials':{'Character_Pbr':settings}}}}}}}))

# Mimic the ActorCore importer failure without licensed data: the armature
# object's animated frame differs from its unchanged authoritative BindPose.
from io_scene_fbx import parse_fbx, encode_bin
parsed, version = parse_fbx.parse(str(root/'body.fbx'))
objects = next(e for e in parsed.elems if e.id == b'Objects')
arm_model = next(e for e in objects.elems if e.id == b'Model' and e.props[1].split(b'\0')[0] == b'Armature')
props = next(e for e in arm_model.elems if e.id == b'Properties70')
rotation = next(e for e in props.elems if e.props[0] == b'Lcl Rotation')
rotation.props[-3:] = [0., 0., 0.]
methods = {'Z':'int8','Y':'int16','B':'bool','C':'char','I':'int32','F':'float32','D':'float64','L':'int64',
           'R':'bytes','S':'string','f':'float32_array','i':'int32_array','d':'float64_array','l':'int64_array',
           'b':'bool_array','c':'byte_array'}
def encode(element):
    out = encode_bin.FBXElem(element.id)
    for kind, value in zip(element.props_type, element.props):
        getattr(out, 'add_' + methods[chr(kind)])(value)
    out.elems = [encode(child) for child in element.elems]
    return out
encode_bin.write(str(root/'mismatched.fbx'), encode(parsed), version)
(root/'mismatched.json').write_bytes((root/'body.json').read_bytes())
'''

MATERIAL_ALPHA_CHECK = r'''
import bpy, importlib.util, sys
from pathlib import Path
args = sys.argv[sys.argv.index('--') + 1:]
spec = importlib.util.spec_from_file_location('converter', args[0])
mod = importlib.util.module_from_spec(spec); spec.loader.exec_module(mod)
root = Path(args[1])
bpy.ops.wm.read_factory_settings(use_empty=True)

def image_file(name, color, transparent_texel=False):
    image = bpy.data.images.new(name, 16, 16, alpha=True)
    image.generated_color = color
    image.colorspace_settings.name = 'Non-Color'
    if transparent_texel:
        pixels = list(image.pixels[:])
        pixels[3] = 0
        image.pixels[:] = pixels
    image.filepath_raw = str(root / (name + '.png'))
    image.file_format = 'PNG'
    image.save()
    return name + '.png'

opaque = image_file('opaque', (.7, .3, .1, 1))
fractional = image_file('fractional', (.7, .3, .1, .5))
hair = image_file('hair', (.7, .3, .1, 1), transparent_texel=True)
white = image_file('white', (1, 1, 1, 1))
gray = image_file('gray', (.5, .5, .5, 1))
black = image_file('black', (0, 0, 0, 1))
# name, opacity image, shared with base color, scalar opacity, texture limit,
# expected alpha texture link, expected glTF alpha mode.
cases = [
    ('shared_opaque', opaque, True, 1, 16, False, 'OPAQUE'),
    ('shared_fractional', fractional, True, 1, 16, True, 'BLEND'),
    ('hair_cutout', hair, True, 1, 16, True, 'BLEND'),
    ('source_alpha_before_downscale', hair, True, 1, 1, True, 'BLEND'),
    ('scalar_only', None, False, .4, 16, False, 'BLEND'),
    ('scalar_with_opaque_map', opaque, True, .4, 16, False, 'BLEND'),
    ('scalar_with_fractional_map', fractional, True, .4, 16, True, 'BLEND'),
    ('separate_white_map', white, False, 1, 16, False, 'OPAQUE'),
    ('separate_gray_map', gray, False, 1, 16, True, 'BLEND'),
    ('separate_black_map', black, False, 1, 16, True, 'BLEND'),
]
for i, (name, opacity, shared, scalar, limit, linked, mode) in enumerate(cases):
    base = opacity if shared else opaque
    settings = {'Opacity': scalar, 'Textures': {'Base Color': {'Texture Path': base}}}
    if opacity:
        settings['Textures']['Opacity'] = {'Texture Path': opacity}
    material = mod.build_material(settings, root, name, limit, {}, set())
    shader = material.node_tree.nodes.get('Principled BSDF')
    assert shader.inputs['Alpha'].is_linked == linked, (name, 'redundant or missing alpha link')
    if not linked:
        assert abs(shader.inputs['Alpha'].default_value - scalar) < .001, name
    bpy.ops.mesh.primitive_cube_add(location=(i * 2, 0, 0))
    bpy.context.object.data.materials.append(material)

output = root / 'material_alpha.glb'
bpy.ops.export_scene.gltf(filepath=str(output), export_format='GLB', export_animations=False)
document, binary = mod.read_glb(output)
materials = {m['name']: m for m in document['materials']}
for name, opacity, shared, scalar, limit, linked, mode in cases:
    material = materials[name]
    assert material.get('alphaMode', 'OPAQUE') == mode, (name, material)
    factor = material['pbrMetallicRoughness'].get('baseColorFactor', [1, 1, 1, 1])[3]
    assert abs(factor - scalar) < .001, (name, 'scalar opacity lost', factor, scalar)

# Verify actual exported fractional alpha, not only a BLEND flag. Opaque
# source RGB must not be mistaken for opacity in a shared Base/Opacity map.
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=str(output))
for name in ('shared_fractional', 'scalar_with_fractional_map'):
    material = bpy.data.materials[name]
    images = [n.image for n in material.node_tree.nodes if n.type == 'TEX_IMAGE']
    assert any(abs(image.pixels[3] - .5) < .01 for image in images), name
print('MATERIAL_ALPHA_CHECK_PASSED')
'''


NORMALIZATION_CHECK = r'''
import importlib.util,json,struct,sys
from pathlib import Path
spec=importlib.util.spec_from_file_location('converter',sys.argv[sys.argv.index('--')+1]);mod=importlib.util.module_from_spec(spec);spec.loader.exec_module(mod)
# A centimeter root (meaningful), near-unit noisy joints, and meaningful animated
# scale. Shared inverse binds test the correction is applied only once.
identity=[1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1]
binary=bytearray(struct.pack('<32f',*(identity+identity))+struct.pack('<6f',1.000002,1,1,1,1.000003,1))
doc={'nodes':[{'name':'Armature','scale':[.01,.01,.01],'children':[1]},
 {'name':'CC_Base_Hip','scale':[1.000002,.999999,1],'translation':[0,100,0],'children':[2]},
 {'name':'CC_Base_Spine01','translation':[0,20,0],'scale':[1,1.000003,1]}],
 'bufferViews':[{'byteOffset':0,'byteLength':128},{'byteOffset':128,'byteLength':24}],
 'accessors':[{'bufferView':0,'componentType':5126,'count':2,'type':'MAT4'},
 {'bufferView':1,'componentType':5126,'count':2,'type':'VEC3'}],
 'skins':[{'joints':[1,2],'inverseBindMatrices':0},{'joints':[1,2],'inverseBindMatrices':0}],
 'animations':[{'samplers':[{'output':1}],'channels':[{'sampler':0,'target':{'node':2,'path':'scale'}}]}]}
result=mod.normalize_joints(doc,binary)
assert result['maximumRestSkinMatrixError']<1e-5,result
assert 'scale' not in doc['nodes'][1] and 'scale' not in doc['nodes'][2]
assert doc['nodes'][0]['scale']==[.01,.01,.01]
assert struct.unpack_from('<6f',binary,128)==(1,1,1,1,1,1)
# A nontrivial animated scale must never be snapped.
struct.pack_into('<6f',binary,128,1,1,1,1.2,1,1)
doc['nodes'][2]['scale']=[1.000002,1,1]
result=mod.normalize_joints(doc,binary)
assert 'CC_Base_Spine01' in result['preservedScaledJoints']
assert doc['nodes'][2]['scale']==[1.000002,1,1]
# Translation roundoff is measured in metres, not local FBX centimetres.
# A real offset above that budget must never be silently erased.
for delta, should_collapse in [(1e-4, True), (.01, False)]:
    baseline=doc['nodes'][1]['translation']
    struct.pack_into('<6f',binary,128,*baseline,baseline[0]+delta,*baseline[1:])
    doc['animations']=[{'name':'Translation','samplers':[{'output':1}],
                        'channels':[{'sampler':0,'target':{'node':1,'path':'translation'}}]}]
    result=mod.normalize_translation_noise(doc,binary)
    assert bool(result['collapsedChannels']) == should_collapse,result
print('NORMALIZATION_CHECK_PASSED')
'''


class ActorCoreParsingTests(unittest.TestCase):
    def test_paths_are_explicit_local_existing_files(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / 'ok.png').write_bytes(b'fixture')
            self.assertEqual(actorcore.local_texture(root, './ok.png'), root / 'ok.png')
            for bad in ['../escape.png', '/tmp/ok.png', 'C:\\temp\\ok.png', 'https://example.com/map.png', 'missing.png']:
                with self.subTest(path=bad), self.assertRaises(ValueError):
                    actorcore.local_texture(root, bad)
            (root / 'escape').symlink_to(root.parent, target_is_directory=True)
            with self.assertRaises(ValueError):
                actorcore.local_texture(root, 'escape/anything.png')

    def test_canonical_names_only_touch_joints(self):
        document = {'nodes': [{'name': 'CC_Base_Hip'}, {'name': 'CC_Base_L_Upperarm'}, {'name': 'CC_Base_Head'}],
                    'skins': [{'joints': [0, 1]}]}
        renamed = actorcore.canonical_names(document)
        self.assertEqual(renamed, {'CC_Base_Hip': 'hips', 'CC_Base_L_Upperarm': 'leftArm'})
        self.assertEqual(document['nodes'][2]['name'], 'CC_Base_Head')
        with self.assertRaises(ValueError):
            actorcore.canonical_names({'nodes': [{'name': 'hips'}, {'name': 'CC_Base_Hip'}], 'skins': [{'joints': [1]}]})

    def test_unverified_joint_names_are_not_guessed_or_reparented(self):
        document = {'nodes': [{'name': 'RL_Hip', 'children': [1]}, {'name': 'RL_L_Calf'}], 'skins': [{'joints': [0, 1]}]}
        self.assertEqual(actorcore.canonical_names(document), {})
        self.assertEqual(document['nodes'], [{'name': 'RL_Hip', 'children': [1]}, {'name': 'RL_L_Calf'}])

    def test_glb_read_write_and_reject_bad_header(self):
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / 'fixture.glb'
            actorcore.write_glb(path, {'asset': {'version': '2.0'}}, bytearray(b'\x01\x02\x03\x04'))
            doc, data = actorcore.read_glb(path)
            self.assertEqual(doc['asset']['version'], '2.0')
            self.assertEqual(data, b'\x01\x02\x03\x04')
            path.write_bytes(b'invalid')
            with self.assertRaises(ValueError):
                actorcore.read_glb(path)


@unittest.skipUnless(BLENDER.is_file(), 'Blender binary not available')
class ActorCoreBlenderTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.folder = tempfile.TemporaryDirectory()
        cls.directory = Path(cls.folder.name)
        fixture = cls.directory / 'fixture.py'
        fixture.write_text(FIXTURE)
        cls.run_blender(fixture, [str(cls.directory)])
        cls.source_hashes = {str(p): actorcore.sha256(p) for p in cls.directory.rglob('*') if p.is_file()}
        cls.output = cls.directory / 'prepared/actor.glb'
        cls.result = cls.run_blender(SCRIPT, ['--source', str(cls.directory / 'body.fbx'), '--output', str(cls.output),
                                             '--max-texture', '128', '--preview-size', '128', '--samples', '2',
                                             '--motion', 'Gesture=' + str(cls.directory / 'motion.fbx'),
                                             '--motion', 'Duplicate gesture=' + str(cls.directory / 'motion.fbx')])
        cls.report = json.loads(cls.output.with_suffix('.json').read_text())
        cls.document, cls.binary = actorcore.read_glb(cls.output)

    @classmethod
    def tearDownClass(cls):
        cls.folder.cleanup()

    @classmethod
    def run_blender(cls, script, arguments):
        result = subprocess.run([str(BLENDER), '-b', '-t', '2', '--factory-startup', '--disable-autoexec',
                                 '--python-exit-code', '1', '--python', str(script), '--', *arguments],
                                capture_output=True, text=True, timeout=180, cwd=ROOT)
        if result.returncode:
            raise AssertionError(result.stdout[-12000:] + result.stderr[-6000:])
        return result.stdout

    def test_skins_morphs_canonical_names_and_world_meters_survive_reimport(self):
        self.assertTrue(self.report['verification']['glbReimported'])
        self.assertTrue(self.report['geometryWeightsMorphsUnchanged'])
        self.assertEqual(self.report['triangles'], 12)
        self.assertEqual(self.report['morphTargets'], 1)
        self.assertEqual(self.report['skinnedMeshes'], 1)
        self.assertLess(self.report['verification']['maximumRestBoundsErrorMeters'], .001)
        self.assertAlmostEqual(self.report['bounds']['dimensions'][1], 1.8, places=3)
        names = {self.document['nodes'][i]['name'] for skin in self.document['skins'] for i in skin['joints']}
        self.assertTrue(set(actorcore.CORE_BONES.values()).issubset(names))
        self.assertTrue(all('JOINTS_0' in p['attributes'] and 'WEIGHTS_0' in p['attributes']
                            for m in self.document['meshes'] for p in m['primitives']))
        self.assertTrue(all(len(p['targets']) == 1 for m in self.document['meshes'] for p in m['primitives']))

    def test_raw_gltf_joint_origins_and_skinned_mesh_are_both_y_up(self):
        raw = self.report['verification']['rawGLTF']
        joints = raw['rest']['joints']
        self.assertGreater(joints['hips'][1] - min(joints['leftFoot'][1], joints['rightFoot'][1]), .5)
        self.assertGreater(joints['head'][1], joints['hips'][1] + .2)
        self.assertAlmostEqual(raw['rest']['bounds']['dimensions'][1], self.report['bounds']['dimensions'][1], places=3)
        self.assertLess(raw['maximumRestBoundsErrorMeters'], .001)
        self.assertGreater(raw['rest']['verticesChecked'], 0)
        self.assertEqual([c['name'] for c in raw['motionChecks']], ['Gesture'])
        for check in raw['motionChecks']:
            self.assertLess(check['maximumBoundsErrorMeters'], .003)
            self.assertLess(check['maximumJointPositionErrorMeters'], .003)

    def test_mismatched_fbx_object_frame_is_repaired_from_bind_pose(self):
        output = self.directory / 'prepared/repaired.glb'
        self.run_blender(SCRIPT, ['--source', str(self.directory / 'mismatched.fbx'), '--output', str(output),
                                  '--max-texture', '128', '--preview-size', '64', '--samples', '1',
                                  '--motion', 'Gesture=' + str(self.directory / 'motion.fbx')])
        report = json.loads(output.with_suffix('.json').read_text())
        bind = report['fbxBindCanonicalization']
        self.assertTrue(bind['rebasedRootActions'])
        self.assertLess(bind['maximumOriginalAnimatedJointErrorMeters'], .0001)
        self.assertNotEqual(bind['originalArmatureWorld'], bind['bindArmatureWorld'])
        self.assertTrue(report['sourceFilesUnchanged'])
        for edge in ['min', 'max']:
            for a, b in zip(report['bounds'][edge], self.report['bounds'][edge]):
                self.assertAlmostEqual(a, b, places=3)
        self.assertGreater(report['verification']['rawGLTF']['rest']['joints']['hips'][1], .9)
        self.assertLess(report['verification']['rawGLTF']['motionChecks'][0]['maximumJointPositionErrorMeters'], .003)

    def test_raw_check_rejects_horizontal_joints_even_when_inverse_binds_hide_it(self):
        script = self.directory / 'reject_horizontal.py'
        script.write_text(r"""
import importlib.util,json,struct,sys,math
from mathutils import Matrix
spec=importlib.util.spec_from_file_location('converter',sys.argv[sys.argv.index('--')+1]);m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
path=sys.argv[sys.argv.index('--')+2]
doc,binary=m.read_glb(path)
report=json.loads(__import__('pathlib').Path(path).with_suffix('.json').read_text())
before=m.node_worlds(doc)
# Rotate all joint worlds, then repair inverse binds to preserve the upright
# mesh. This is exactly why a bounds/re-import-only check missed the defect.
root=len(doc['nodes']);doc['nodes'].append({'rotation':[math.sqrt(.5),0,0,math.sqrt(.5)],'children':doc['scenes'][doc.get('scene',0)]['nodes']})
doc['scenes'][doc.get('scene',0)]['nodes']=[root]
after=m.node_worlds(doc)
for skin in doc['skins']:
    _,rows=m.float_accessor(doc,binary,skin['inverseBindMatrices'],16)
    for joint,(offset,row) in zip(skin['joints'],rows):
        old=Matrix([row[i:i+4] for i in range(0,16,4)]).transposed()
        fixed=after[joint].inverted()@before[joint]@old
        struct.pack_into('<16f',binary,offset,*[fixed[r][c] for c in range(4) for r in range(4)])
sample=m.raw_gltf_sample(doc,binary)
assert abs(sample['bounds']['dimensions'][1]-report['bounds']['dimensions'][1])<.001
try:
    m.verify_raw_gltf(doc,binary,report,{})
except ValueError as error:
    assert 'not upright Y-up' in str(error),error
    print('HORIZONTAL_JOINTS_REJECTED')
else:
    raise AssertionError('Upright mesh masked horizontal raw glTF joints')
""")
        self.assertIn('HORIZONTAL_JOINTS_REJECTED', self.run_blender(script, [str(SCRIPT), str(self.output)]))

    def test_full_motion_not_default_take_no_duplicates_and_real_deformation(self):
        self.assertEqual([a['name'] for a in self.report['animations']], ['Gesture'])
        self.assertAlmostEqual(self.report['animations'][0]['duration'], 1, places=3)
        check = self.report['verification']['motionChecks'][0]
        self.assertLess(check['maximumBoundsErrorMeters'], .003)
        self.assertLess(check['maximumJointPositionErrorMeters'], .003)
        start, middle, end = check['samples']
        self.assertGreater(abs(start['joints']['hips'][0] - middle['joints']['hips'][0]), .1)
        self.assertLess(abs(start['joints']['hips'][0] - end['joints']['hips'][0]), .001)

    def test_embedded_pbr_images_limits_and_cpu_rendered_png(self):
        self.assertGreaterEqual(self.report['embeddedImageCount'], 3)
        self.assertTrue(all('uri' not in im and 'bufferView' in im for im in self.document['images']))
        self.assertTrue(all(max(im['width'], im['height']) <= 128 for im in self.report['images']))
        material = self.document['materials'][0]
        pbr = material['pbrMetallicRoughness']
        self.assertIn('baseColorTexture', pbr)
        self.assertIn('metallicRoughnessTexture', pbr)
        self.assertIn('normalTexture', material)
        self.assertIn('occlusionTexture', material)
        data = self.output.with_suffix('.png').read_bytes()
        self.assertEqual(data[:8], b'\x89PNG\r\n\x1a\n')
        self.assertEqual(struct.unpack_from('>II', data, 16), (128, 128))
        self.assertGreater(len(data), 500)
        self.assertEqual(self.report['previewRender']['device'], 'CPU')
        # Decode the embedded ORM with Blender, verifying Unity alpha was inverted
        # into roughness and red was copied into metallic (not treated as sRGB).
        script = self.directory / 'inspect_orm.py'
        script.write_text("import bpy,sys\nfrom pathlib import Path\n"
                          "bpy.ops.wm.read_factory_settings(use_empty=True)\n"
                          "bpy.ops.import_scene.gltf(filepath=sys.argv[sys.argv.index('--')+1])\n"
                          "mat=next(m for m in bpy.data.materials if m.use_nodes)\n"
                          "shader=next(n for n in mat.node_tree.nodes if n.type=='BSDF_PRINCIPLED')\n"
                          "sep=shader.inputs['Roughness'].links[0].from_node\n"
                          "image=sep.inputs[0].links[0].from_node.image\n"
                          "p=list(image.pixels[:4]); print('ORM_PIXEL',p)\n"
                          "assert abs(p[1]-.25)<.02 and abs(p[2]-.25)<.02,p\n")
        self.assertIn('ORM_PIXEL', self.run_blender(script, [str(self.output)]))

    def test_shared_opaque_base_and_opacity_map_exports_as_opaque(self):
        material = self.document['materials'][0]
        self.assertEqual(material.get('alphaMode', 'OPAQUE'), 'OPAQUE')
        self.assertEqual(material['pbrMetallicRoughness'].get('baseColorFactor', [1, 1, 1, 1])[3], 1)

    def test_material_alpha_preserves_transparency_and_scalar_opacity(self):
        script = self.directory / 'material_alpha.py'
        script.write_text(MATERIAL_ALPHA_CHECK)
        self.assertIn('MATERIAL_ALPHA_CHECK_PASSED', self.run_blender(script, [str(SCRIPT), str(self.directory)]))

    def test_original_fbx_sidecar_and_images_are_unchanged(self):
        for path, digest in self.source_hashes.items():
            self.assertEqual(actorcore.sha256(path), digest)
        self.assertTrue(self.report['sourceFilesUnchanged'])

    def test_scale_noise_corrects_inverse_binds_and_preserves_meaningful_scale(self):
        script = self.directory / 'normalization.py'
        script.write_text(NORMALIZATION_CHECK)
        self.assertIn('NORMALIZATION_CHECK_PASSED', self.run_blender(script, [str(SCRIPT)]))

    def test_output_cannot_overwrite_source_texture(self):
        with self.assertRaisesRegex(AssertionError, 'Output would overwrite a source asset'):
            self.run_blender(SCRIPT, ['--source', str(self.directory / 'body.fbx'),
                                      '--output', str(self.directory / 'body.fbm/Diffuse.glb')])
        self.assertFalse((self.directory / 'body.fbm/Diffuse.glb').exists())
        self.assertEqual(actorcore.sha256(self.directory / 'body.fbm/Diffuse.png'),
                         self.source_hashes[str(self.directory / 'body.fbm/Diffuse.png')])

    def test_missing_referenced_texture_fails_without_output(self):
        sidecar = json.loads((self.directory / 'body.json').read_text())
        sidecar['body']['Object']['body']['Meshes']['Body']['Materials']['Character_Pbr']['Textures']['Normal']['Texture Path'] = './absent.png'
        bad = self.directory / 'missing.json'
        bad.write_text(json.dumps(sidecar))
        out = self.directory / 'bad.glb'
        with self.assertRaisesRegex(AssertionError, 'Missing texture'):
            self.run_blender(SCRIPT, ['--source', str(self.directory / 'body.fbx'), '--sidecar', str(bad), '--output', str(out)])
        self.assertFalse(out.exists())


if __name__ == '__main__':
    unittest.main()
