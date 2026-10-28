# Integration references

Consulted during implementation on 2026-10-28. API SDK call shapes were checked against the installed `ai` and `@ai-sdk/*` package documentation and source; package-lock.json pins the versions.

- [Blender import operators](https://docs.blender.org/api/main/bpy.ops.import_scene.html) — FBX and glTF import entry points.
- [Unreal Interchange scene import](https://dev.epicgames.com/documentation/en-us/unreal-engine/python-api/class/InterchangeManager?application_version=5.4) — `create_source_data`, `get_interchange_manager_scripted`, and `import_scene`.
- [Unreal Interchange workflow](https://dev.epicgames.com/documentation/unreal-engine/importing-assets-using-interchange-in-unreal-engine?lang=en-US) — scene import and plugin requirements.
- [Adobe Mixamo FAQ](https://helpx.adobe.com/be_en/creative-cloud/faq/mixamo-faq.html) — humanoid rigging and user-owned downloaded characters. The implementation uses file interchange; this reference does not establish a supported public generation API.
- [AI SDK structured output](https://ai-sdk.dev/docs/ai-sdk-core/generating-structured-data) — schema-validated assistant instructions.
- [Moonshot API](https://platform.moonshot.ai/docs/api/chat), [xAI API](https://docs.x.ai/docs/api-reference), [OpenRouter API](https://openrouter.ai/docs/api-reference/overview) — provider endpoints.
- [Three.js Quaternion](https://threejs.org/docs/pages/Quaternion.html) and [Object3D](https://threejs.org/docs/pages/Object3D.html) — world/local transform conversion and quaternion rotation for reach solving; checked against installed Three.js 0.180 source.
