const configuredOrigin = (import.meta.env.VITE_API_ORIGIN as string | undefined)?.trim();

export function apiOrigin(): string {
  if (!configuredOrigin) return "";
  let url: URL;
  try {
    url = new URL(configuredOrigin);
  } catch {
    throw new Error("VITE_API_ORIGIN must be an absolute http(s) URL");
  }
  if (!["http:", "https:"].includes(url.protocol) || url.pathname !== "/" || url.search || url.hash) {
    throw new Error("VITE_API_ORIGIN must contain only an http(s) origin");
  }
  if (import.meta.env.PROD && window.location.protocol === "https:" && url.protocol !== "https:") {
    throw new Error("VITE_API_ORIGIN must use HTTPS for a production Pages build");
  }
  return url.origin;
}

export function apiUrl(path: string): string {
  return `${apiOrigin()}${path}`;
}

export function websocketUrl(roomId: string): string {
  const url = new URL("/ws", apiOrigin() || window.location.origin);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  url.searchParams.set("roomId", roomId);
  return url.toString();
}

export function assetUrl(path: string): string {
  return `${import.meta.env.BASE_URL}${path.replace(/^\//, "")}`;
}
