"""Run in Unreal Editor's Python console: exec(open('/path/unreal_import.py').read()).
Place this script beside scene.glb. Requires Python Editor Script and Interchange plugins.
Uses the Interchange scene importer to preserve scene hierarchy and transforms.
"""
import os
import unreal
source_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'scene.glb')
manager = unreal.InterchangeManager.get_interchange_manager_scripted()
source = unreal.InterchangeManager.create_source_data(source_path)
parameters = unreal.ImportAssetParameters()
parameters.is_automated = True
success = manager.import_scene('/Game/SceneMaker', source, parameters)
if not success:
    raise RuntimeError('Scene import failed. Check Interchange plugins and the Unreal Output Log.')
unreal.log('Scene Maker: imported scene. Save your level to keep the placed actors.')
