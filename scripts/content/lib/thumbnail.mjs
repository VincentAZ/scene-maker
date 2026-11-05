// Library thumbnails rendered by Blender. The renderer itself is Python
// (blender_thumbnail.py beside this file): a converter script adds `lib` to
// its sys.path and calls render_thumbnail(scene, camera, path). Converters
// get the folder through their job file so the Python stays importable from
// wherever Blender is started.
import path from "node:path";
import { fileURLToPath } from "node:url";

export const blenderLib = path.dirname(fileURLToPath(import.meta.url));
