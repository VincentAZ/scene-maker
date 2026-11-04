import fs from "node:fs";

/** FBX version stored in the file header (7400 = FBX 7.4), if readable. */
export function fbxVersion(file: string): number | undefined {
  const fd = fs.openSync(file, "r"),
    head = Buffer.alloc(4096);
  const size = fs.readSync(fd, head, 0, head.length, 0);
  fs.closeSync(fd);
  if (head.toString("latin1", 0, 18) === "Kaydara FBX Binary")
    return size >= 27 ? head.readUInt32LE(23) : undefined;
  const ascii = /FBXVersion:\s*(\d+)/.exec(head.toString("latin1", 0, size));
  return ascii ? Number(ascii[1]) : undefined;
}

/** Blender reads FBX 7.1 (2011) and newer only; say so instead of failing
 * inside Blender with a command line the creator cannot act on. */
export function unsupportedFbxMessage(file: string, name: string) {
  const version = fbxVersion(file);
  if (version === undefined || version >= 7100) return undefined;
  const label = `${Math.floor(version / 1000)}.${Math.floor(version / 100) % 10}`;
  return `${name} is an FBX ${label} file, an older format Blender cannot read (it needs FBX 7.1/2011 or newer). Re-export it as FBX 2013 or newer (Autodesk's free FBX Converter can do this), GLB or BVH, then import it again.`;
}

/** The reason Blender printed ("Error: …"), without the command line. */
export function blenderFailure(error: unknown) {
  const output = String((error as { stderr?: string }).stderr || "");
  const reason = [...output.matchAll(/^(?:Error|RuntimeError): (.+)$/gm)]
    .map((match) => match[1].replace(/^Error: /, "").trim())
    .at(-1);
  return reason
    ? `Blender could not convert this FBX: ${reason}`
    : "Blender could not convert this FBX. Re-export it as FBX 2013 or newer, or as GLB, and import it again.";
}
