export type DiffLine = { kind: "add" | "del" | "hunk" | "ctx" | "meta"; text: string };
export type DiffFile = {
  path: string;
  status: "added" | "deleted" | "modified" | "renamed" | "binary";
  additions: number;
  deletions: number;
  lines: DiffLine[];
};
/** Split a unified git diff into per-file sections for display. */
export function parseDiff(diff: string): DiffFile[] {
  const files: DiffFile[] = [];
  let current: DiffFile | undefined;
  for (const line of diff.split("\n")) {
    const header = /^diff --git a\/(.+?) b\/(.+)$/.exec(line);
    if (header) {
      current = { path: header[2], status: "modified", additions: 0, deletions: 0, lines: [] };
      files.push(current);
      continue;
    }
    if (!current) continue;
    if (line.startsWith("new file mode")) current.status = "added";
    else if (line.startsWith("deleted file mode")) current.status = "deleted";
    else if (line.startsWith("rename to ")) current.status = "renamed";
    else if (line.startsWith("Binary files")) current.status = "binary";
    if (/^(index |new file mode|deleted file mode|similarity index|rename (from|to) |old mode|new mode|--- |\+\+\+ )/.test(line))
      continue;
    if (line.startsWith("@@")) current.lines.push({ kind: "hunk", text: line });
    else if (line.startsWith("+")) {
      current.additions++;
      current.lines.push({ kind: "add", text: line.slice(1) });
    } else if (line.startsWith("-")) {
      current.deletions++;
      current.lines.push({ kind: "del", text: line.slice(1) });
    } else if (line.startsWith("\\")) current.lines.push({ kind: "meta", text: line });
    else if (line.startsWith("Binary files")) current.lines.push({ kind: "meta", text: line });
    else current.lines.push({ kind: "ctx", text: line.slice(1) });
  }
  return files;
}
