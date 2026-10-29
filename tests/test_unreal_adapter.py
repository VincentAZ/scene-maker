"""Adapter orchestration contracts with a fake engine, NOT Unreal integration tests."""
import hashlib
import importlib.util
import json
import struct
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import Mock

spec = importlib.util.spec_from_file_location('adapter', Path(__file__).parents[1] / 'engine/unreal/scene_maker_startup.py')
adapter = importlib.util.module_from_spec(spec)
spec.loader.exec_module(adapter)


class LevelSequence:
    pass


class AnimSequence:
    pass


class AdapterTests(unittest.TestCase):
    def setUp(self):
        self.folder = tempfile.TemporaryDirectory()
        self.addCleanup(self.folder.cleanup)
        self.project = Path(self.folder.name)
        scene = {'id': 'project-1', 'name': 'A studio scene'}
        metadata = {'asset': {'version': '2.0'}, 'nodes': [{}], 'skins': [{'joints': [0]}], 'animations': [{}]}
        block = json.dumps(metadata).encode()
        block += b' ' * (-len(block) % 4)
        glb = struct.pack('<4sIIII', b'glTF', 2, 20 + len(block), len(block), 0x4E4F534A) + block
        (self.project / 'scene.glb').write_bytes(glb)
        (self.project / 'scene.json').write_text(json.dumps(scene))
        self.manifest = {'version': 1, 'projectId': scene['id'], 'sha256': {
            name: hashlib.sha256((self.project / name).read_bytes()).hexdigest()
            for name in ['scene.json', 'scene.glb']}}
        self.save_manifest()
        self.level = Mock()
        self.level.new_level.return_value = True
        self.level.load_level.return_value = True
        self.level.save_current_level.return_value = True
        self.manager = Mock()
        self.manager.can_translate_source_data.return_value = True
        self.manager.import_scene.return_value = True
        self.actor = Mock()
        self.actor.get_components_by_class.return_value = [object()]
        self.actors = Mock()
        self.actors.get_all_level_actors.return_value = [self.actor]
        self.library = Mock()
        self.library.list_assets.return_value = ['/Game/sequence', '/Game/animation']
        self.library.save_directory.return_value = True
        self.unreal = SimpleNamespace(
            LevelEditorSubsystem=object(), EditorActorSubsystem=object(),
            SkeletalMeshComponent=object(), DirectionalLight=object(),
            Vector=lambda *args: args, Rotator=lambda *args: args,
            LevelSequence=LevelSequence, AnimSequence=AnimSequence,
            SystemLibrary=SimpleNamespace(get_engine_version=lambda: '5.6.1-test'),
            InterchangeManager=SimpleNamespace(
                get_interchange_manager_scripted=lambda: self.manager,
                create_source_data=lambda path: path),
            ImportAssetParameters=SimpleNamespace,
            EditorAssetLibrary=self.library,
            load_asset=lambda path: LevelSequence() if path.endswith('sequence') else AnimSequence(),
            log=Mock(), log_warning=Mock(),
        )
        self.unreal.get_editor_subsystem = lambda kind: self.level if kind is self.unreal.LevelEditorSubsystem else self.actors

    def save_manifest(self):
        (self.project / 'unreal-manifest.json').write_text(json.dumps(self.manifest))

    def report(self):
        return json.loads((self.project / 'Saved/SceneMaker/import-report.json').read_text())

    def test_import_save_and_reopen_preserves_creator_edits(self):
        report = adapter.import_project(self.unreal, self.project)
        self.assertEqual(report['status'], 'imported')
        self.assertEqual(report['skeletalComponents'], 1)
        self.assertEqual(report['levelSequences'], ['/Game/sequence'])
        self.assertFalse(report['playbackVerified'])
        self.assertFalse(self.manager.import_scene.call_args.args[2].replace_existing)
        self.level.save_current_level.assert_called_once()
        self.assertEqual(self.actors.spawn_actor_from_class.call_count, 2)
        adapter.import_project(self.unreal, self.project)
        self.manager.import_scene.assert_called_once()
        self.level.load_level.assert_called_once_with(report['level'])

    def test_corrupt_source_stops_before_world_mutation(self):
        (self.project / 'scene.glb').write_bytes(b'broken')
        with self.assertRaisesRegex(ValueError, 'changed or is incomplete'):
            adapter.import_project(self.unreal, self.project)
        self.level.new_level.assert_not_called()
        self.manager.import_scene.assert_not_called()

    def test_failed_import_records_failure_and_retry_uses_another_namespace(self):
        self.manager.import_scene.return_value = False
        with self.assertRaisesRegex(RuntimeError, 'could not import'):
            adapter.import_project(self.unreal, self.project)
        failed = self.report()
        self.assertEqual(failed['status'], 'failed')
        self.level.save_current_level.assert_not_called()
        self.manager.import_scene.return_value = True
        completed = adapter.import_project(self.unreal, self.project)
        self.assertNotEqual(completed['level'], failed['level'])

    def test_missing_skin_or_failed_save_cannot_report_success(self):
        self.actor.get_components_by_class.return_value = []
        with self.assertRaisesRegex(RuntimeError, 'fewer character'):
            adapter.import_project(self.unreal, self.project)
        self.assertEqual(self.report()['status'], 'failed')
        self.actor.get_components_by_class.return_value = [object()]
        self.level.save_current_level.return_value = False
        with self.assertRaisesRegex(RuntimeError, 'could not save'):
            adapter.import_project(self.unreal, self.project)
        self.assertEqual(self.report()['status'], 'failed')

    def test_missing_playback_is_reported_as_unverified(self):
        self.library.list_assets.return_value = ['/Game/animation']
        report = adapter.import_project(self.unreal, self.project)
        self.assertEqual(len(report['warnings']), 1)
        self.assertFalse(report['playbackVerified'])
        self.unreal.log_warning.assert_called_once()

    def test_missing_saved_level_does_not_trigger_reimport(self):
        adapter.import_project(self.unreal, self.project)
        self.level.load_level.return_value = False
        with self.assertRaisesRegex(RuntimeError, 'could not be opened'):
            adapter.import_project(self.unreal, self.project)
        self.manager.import_scene.assert_called_once()

    def test_unsupported_engine_or_translator_does_not_create_level(self):
        self.unreal.SystemLibrary.get_engine_version = lambda: '5.4.0'
        with self.assertRaisesRegex(RuntimeError, '5.6 or later'):
            adapter.import_project(self.unreal, self.project)
        self.unreal.SystemLibrary.get_engine_version = lambda: '5.6.1'
        self.manager.can_translate_source_data.return_value = False
        with self.assertRaisesRegex(RuntimeError, 'cannot import'):
            adapter.import_project(self.unreal, self.project)
        self.level.new_level.assert_not_called()

    def test_multiple_body_meshes_share_one_expected_rig(self):
        metadata = {'nodes': [{'children': [1, 2]}, {'children': [3]}, {}, {}],
                    'skins': [{'joints': [1, 3]}, {'joints': [3]}, {'joints': [2]}]}
        self.assertEqual(adapter.source_rig_count(metadata), 2)
        metadata['nodes'][3]['children'] = [1]
        with self.assertRaisesRegex(ValueError, 'cyclic'):
            adapter.source_rig_count(metadata)


if __name__ == '__main__':
    unittest.main()
