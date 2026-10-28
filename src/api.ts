export async function api<T>(
  url: string,
  options: RequestInit = {},
): Promise<T> {
  const res = await fetch(url, {
    ...options,
    headers: {
      ...(options.body instanceof FormData
        ? {}
        : { "Content-Type": "application/json" }),
      "X-Scene-Maker": "1",
      ...options.headers,
    },
  });
  if (!res.ok) {
    let message = "The studio service is unavailable.";
    try {
      message = (await res.json()).error || message;
    } catch {}
    throw Object.assign(Error(message), { status: res.status });
  }
  return res.json();
}
export function download(
  data: BlobPart,
  name: string,
  type = "application/json",
) {
  const url = URL.createObjectURL(new Blob([data], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
