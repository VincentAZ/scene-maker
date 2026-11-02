/** Rigify's standard human torso is one numbered chain (three.js drops the dot
 * when it loads the file: "DEF-spine.004" arrives as "DEF-spine004"). */
const rigifySpine = [
  "hips",
  "spine",
  "chest",
  "upperChest",
  "neck",
  "upperNeck",
  "head",
];

/** A bone name without the deform-layer prefix of a standard convention:
 * Rigify "DEF-", VRM/VRoid "J_Bip_<C|L|R>_", 3ds Max Biped "Bip01 ". Rigify's
 * numbered torso chain resolves to its anatomical names. Control and
 * mechanism layers keep their prefixes and therefore never match a joint. */
export function withoutConventionPrefix(short: string) {
  const rigify = short.match(/^DEF[-_]spine\.?(\d{3})?$/i);
  if (rigify) return rigifySpine[Number(rigify[1] ?? 0)] ?? short;
  const vrm = short.match(/^J_Bip_([CLR])_(.+)$/i);
  if (vrm) return vrm[1].toUpperCase() === "C" ? vrm[2] : `${vrm[1]}_${vrm[2]}`;
  return short.replace(/^DEF[-_]/i, "").replace(/^Bip0*1[_ ]/i, "");
}
