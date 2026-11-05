// Sets: the places a scene is played in. Real 3D sets (sets/models.mjs) come
// first in the library; the photographic backdrops (sets/photo.mjs) follow.
// SETS_ONLY=set-classroom,photo-corner-cafe limits a rebuild to those ids;
// `deferModels` keeps the 3D sets as listed without building them.
import * as models from "./sets/models.mjs";
import * as photo from "./sets/photo.mjs";

export async function build(options) {
  const only = process.env.SETS_ONLY?.split(",").map((id) => id.trim());
  const context = { ...options, only: only?.length ? only : undefined };
  return [...(await models.build(context)), ...(await photo.build(context))];
}
