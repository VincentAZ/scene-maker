// Downloads for the content build: resumable, retried, cached on disk.
// A finished file is never fetched again; an interrupted one continues from
// its .part file with an HTTP Range request. Redirects are followed, so the
// stable publisher URLs (NVIDIA, Intel) that bounce to signed, short-lived
// links keep working from a rebuild.
import fs from "node:fs";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";

// casual-effects.com (the McGuire archive) refuses curl-like clients and
// HEAD requests, so every request looks like a browser GET.
export const browserHeaders = {
  "User-Agent":
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36",
  Accept: "*/*",
};

export async function fetchJSON(url, file, headers = browserHeaders) {
  if (file && fs.existsSync(file))
    return JSON.parse(fs.readFileSync(file, "utf8"));
  const response = await fetch(url, { headers });
  if (!response.ok) throw Error(`${url}: HTTP ${response.status}`);
  const data = await response.json();
  if (file) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(data, null, 1));
  }
  return data;
}

/** Downloads `url` to `file` unless it already exists. Returns true when
 * something was fetched. `log` is told about every download and resume. */
export async function download(url, file, { log, headers, attempts = 5 } = {}) {
  if (fs.existsSync(file) && fs.statSync(file).size > 0) return false;
  const partial = `${file}.part`;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  for (let attempt = 1; ; attempt++) {
    try {
      const have = fs.existsSync(partial) ? fs.statSync(partial).size : 0;
      log?.(
        `${have ? "resuming" : "downloading"} ${path.basename(file)}${have ? ` from ${mb(have)}` : ""}`,
      );
      const response = await fetch(url, {
        headers: {
          ...browserHeaders,
          ...headers,
          ...(have ? { Range: `bytes=${have}-` } : {}),
        },
      });
      // A server that ignores the range sends the whole file again.
      const append = have > 0 && response.status === 206;
      if (!response.ok && !(have > 0 && response.status === 416))
        throw Error(`HTTP ${response.status}`);
      if (response.status === 416) {
        fs.renameSync(partial, file);
        return true;
      }
      if (!response.body) throw Error("empty response");
      await pipeline(
        Readable.fromWeb(response.body),
        fs.createWriteStream(partial, { flags: append ? "a" : "w" }),
      );
      const expected = Number(response.headers.get("content-length") ?? NaN);
      const size = fs.statSync(partial).size;
      if (!Number.isNaN(expected) && size !== (append ? have : 0) + expected)
        throw Error(`got ${size} bytes, expected ${expected}`);
      if (!looksLikeData(partial)) {
        fs.rmSync(partial, { force: true });
        throw Error("the server answered with a web page, not the file");
      }
      fs.renameSync(partial, file);
      return true;
    } catch (error) {
      if (attempt >= attempts) throw Error(`${url}: ${error.message}`);
      log?.(`retrying ${path.basename(file)}: ${error.message}`);
      await new Promise((r) => setTimeout(r, 2000 * attempt));
    }
  }
}

// blender.org answers a wrong download path with a "Thanks!" HTML page.
function looksLikeData(file) {
  const head = Buffer.alloc(64);
  const fd = fs.openSync(file, "r");
  const read = fs.readSync(fd, head, 0, 64, 0);
  fs.closeSync(fd);
  const text = head.subarray(0, read).toString("latin1").trimStart();
  return !/^<(!doctype|html)/i.test(text);
}

export const mb = (bytes) => `${(bytes / 1e6).toFixed(1)} MB`;
