"""Project startup adapter. Only trusted packaged code runs; scene JSON is data.

Unreal runs this after the initial level has loaded. This module also has a
normal-Python contract test, which cannot establish Unreal runtime compatibility.
"""
import hashlib
import json
import re
import struct
import uuid
from pathlib import Path


def read_source(project):
    """Validate the exact portable scene before changing the Unreal world."""
    manifest = json.loads((project / 'unreal-manifest.json').read_text(encoding='utf-8'))
    if manifest.get('version') != 1:
        raise ValueError('This scene package needs a newer Scene Maker exporter.')
    for name in ('scene.json', 'scene.glb'):
        data = (project / name).read_bytes()
        if hashlib.sha256(data).hexdigest() != manifest['sha256'].get(name):
            raise ValueError(f'{name} changed or is incomplete. Export a fresh package from Scene Maker.')
    scene = json.loads((project / 'scene.json').read_text(encoding='utf-8'))
    if scene['id'] != manifest['projectId']:
        raise ValueError('The scene does not match this package.')
    glb = (project / 'scene.glb').read_bytes()
    magic, version, length = struct.unpack_from('<4sII', glb)
    if magic != b'glTF' or version != 2 or length != len(glb):
        raise ValueError('The exported animation is not a complete GLB file.')
    json_length, chunk_type = struct.unpack_from('<II', glb, 12)
    if chunk_type != 0x4E4F534A or 20 + json_length > len(glb):
        raise ValueError('The exported animation has no valid scene metadata.')
    metadata = json.loads(glb[20:20 + json_length])
    if any(item.get('uri') and not item['uri'].startswith('data:')
           for item in metadata.get('buffers', []) + metadata.get('images', [])):
        raise ValueError('The production scene must contain its own geometry and textures.')
    return manifest, scene, metadata


def write_report(path, report):
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix('.tmp')
    temporary.write_text(json.dumps(report, indent=2), encoding='utf-8')
    temporary.replace(path)


def source_rig_count(metadata):
    """Several glTF skins can share one rig (for example body and outfit meshes)."""
    skins = metadata.get('skins', [])
    joints = {joint for skin in skins for joint in skin.get('joints', [])}
    parents = {child: index for index, node in enumerate(metadata.get('nodes', []))
               for child in node.get('children', [])}
    groups = []
    for skin in skins:
        roots = set()
        for joint in skin.get('joints', []):
            root, current, visited = joint, joint, set()
            while current in parents:
                if current in visited:
                    raise ValueError('The exported skeleton contains a cyclic hierarchy.')
                visited.add(current)
                current = parents[current]
                if current in joints:
                    root = current
            roots.add(root)
        if not roots:
            raise ValueError('The exported character has no skeleton joints.')
        overlapping = [group for group in groups if group & roots]
        for group in overlapping:
            roots.update(group)
            groups.remove(group)
        groups.append(roots)
    return len(groups)


def import_project(unreal, project):
    manifest, scene, metadata = read_source(project)
    state_path = project / 'Saved' / 'SceneMaker' / 'import-report.json'
    level = unreal.get_editor_subsystem(unreal.LevelEditorSubsystem)
    previous = json.loads(state_path.read_text()) if state_path.exists() else {}
    if previous.get('status') == 'imported':
        if previous.get('sourceSha256') != manifest['sha256']['scene.glb']:
            raise ValueError('This Unreal project already contains another export. Unpack the new package into a new folder.')
        # Reopen the saved work; never import over subsequent creator edits.
        if not level.load_level(previous['level']):
            raise RuntimeError('The saved Unreal level could not be opened. Your imported files have been preserved.')
        return previous

    version = unreal.SystemLibrary.get_engine_version()
    match = re.match(r'(\d+)\.(\d+)', version)
    if not match or tuple(map(int, match.groups())) < (5, 6):
        raise RuntimeError('Open this package with Unreal Engine 5.6 or later.')
    manager = unreal.InterchangeManager.get_interchange_manager_scripted()
    source = unreal.InterchangeManager.create_source_data(str(project / 'scene.glb'))
    if not manager.can_translate_source_data(source, True):
        raise RuntimeError('The Unreal installation cannot import this scene. Check that its Interchange plugin is available.')

    # A failed attempt remains available for inspection. Retries use a fresh
    # namespace and cannot replace existing assets or a creator's edited level.
    destination = '/Game/SceneMaker/Take_' + uuid.uuid4().hex[:12]
    level_path = destination + '/Scene'
    report = {
        'version': 1, 'status': 'importing', 'sceneName': scene['name'],
        'projectId': scene['id'], 'sourceSha256': manifest['sha256']['scene.glb'],
        'engineVersion': version, 'level': level_path,
        'expectedRigs': source_rig_count(metadata),
        'sourceSkins': len(metadata.get('skins', [])),
        'sourceAnimations': len(metadata.get('animations', [])),
    }
    write_report(state_path, report)
    try:
        if not level.new_level(level_path):
            raise RuntimeError('Unreal could not create a level for this scene.')
        parameters = unreal.ImportAssetParameters()
        parameters.is_automated = True
        parameters.replace_existing = False
        parameters.import_level = level.get_current_level()
        if not manager.import_scene(destination + '/Assets', source, parameters):
            raise RuntimeError('Unreal could not import the scene. See its Output Log for the import details.')

        actor_system = unreal.get_editor_subsystem(unreal.EditorActorSubsystem)
        actors = actor_system.get_all_level_actors()
        components = [component for actor in actors
                      for component in actor.get_components_by_class(unreal.SkeletalMeshComponent)]
        assets = unreal.EditorAssetLibrary.list_assets(destination + '/Assets', recursive=True, include_folder=False)
        sequences, animations = [], []
        for path in assets:
            asset = unreal.load_asset(path)
            if isinstance(asset, unreal.LevelSequence):
                sequences.append(path)
            elif isinstance(asset, unreal.AnimSequence):
                animations.append(path)
        if len(components) < report['expectedRigs']:
            raise RuntimeError('Unreal imported fewer character bodies than the source scene. The partial import is preserved for inspection.')
        if not actors:
            raise RuntimeError('Unreal returned an empty scene.')
        # The portable GLB intentionally contains scene content, not the
        # browser's preview lights. Supply editable light actors in the level.
        for rotation, label in [((-40, -30, 0), 'Scene Maker key'),
                                ((-25, 150, 0), 'Scene Maker fill')]:
            light = actor_system.spawn_actor_from_class(
                unreal.DirectionalLight, unreal.Vector(0, 0, 400), unreal.Rotator(*rotation))
            if light is None:
                raise RuntimeError('Unreal could not create the scene lighting.')
            light.set_actor_label(label)
        if not unreal.EditorAssetLibrary.save_directory(destination + '/Assets'):
            raise RuntimeError('Unreal could not save the imported assets.')
        if not level.save_current_level():
            raise RuntimeError('Unreal could not save the imported level.')

        warnings = []
        if metadata.get('animations') and not sequences:
            warnings.append('The scene was imported, but Unreal did not create a playable level sequence. Animation setup still needs review in Unreal.')
        report.update(status='imported', actors=len(actors), skeletalComponents=len(components),
                      levelSequences=sequences, animationAssets=animations, warnings=warnings,
                      playbackVerified=False)
        write_report(state_path, report)
        unreal.log('Scene Maker: scene imported and saved. ' + level_path)
        for warning in warnings:
            unreal.log_warning('Scene Maker: ' + warning)
        if sequences:
            try:
                unreal.EditorAssetLibrary.sync_browser_to_objects(sequences)
            except Exception:
                unreal.log_warning('Scene Maker: the scene is saved; open its sequence from the Content Browser.')
        return report
    except Exception as error:
        report.update(status='failed', error=str(error), playbackVerified=False)
        write_report(state_path, report)
        raise


def run():
    import unreal
    project = Path(unreal.Paths.project_dir()).resolve()
    try:
        return import_project(unreal, project)
    except Exception as error:
        unreal.log_error('Scene Maker: ' + str(error))
        raise


if __name__ == '__main__':
    run()
