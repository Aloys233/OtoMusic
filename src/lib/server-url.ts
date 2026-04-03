const URL_SCHEME_PATTERN = /^[a-z][a-z\d+\-.]*:\/\//i;

function shouldDefaultToHttp(input: string) {
  const host = input.toLowerCase();
  if (host.startsWith("localhost")) return true;
  if (host.startsWith("127.")) return true;
  if (host.startsWith("10.")) return true;
  if (host.startsWith("192.168.")) return true;
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(host)) return true;
  if (host.startsWith("[::1]") || host.startsWith("::1")) return true;
  return false;
}

function normalizeFullWidthPunctuation(input: string) {
  return input.replace(/[：]/g, ":").replace(/\s+/g, "");
}

function wrapBareIpv6Host(authority: string) {
  if (authority.includes("[") || authority.includes("]")) {
    return authority;
  }

  const colonCount = (authority.match(/:/g) ?? []).length;
  if (colonCount < 2) {
    return authority;
  }

  const lastColonIndex = authority.lastIndexOf(":");
  const possiblePort = authority.slice(lastColonIndex + 1);
  const hostPart = authority.slice(0, lastColonIndex);

  if (/^\d{1,5}$/.test(possiblePort) && hostPart.includes(":")) {
    return `[${hostPart}]:${possiblePort}`;
  }

  return `[${authority}]`;
}

function normalizeAuthorityForIpv6(input: string) {
  const slashIndex = input.indexOf("/");
  if (slashIndex < 0) {
    return wrapBareIpv6Host(input);
  }

  const authority = input.slice(0, slashIndex);
  const rest = input.slice(slashIndex);
  return `${wrapBareIpv6Host(authority)}${rest}`;
}

function normalizePathname(pathname: string) {
  if (pathname === "/") {
    return "";
  }
  return pathname.replace(/\/+$/, "");
}

export function normalizeServerBaseUrl(raw: string) {
  const cleaned = normalizeFullWidthPunctuation(raw.trim());
  if (!cleaned) {
    throw new Error("请输入服务器地址");
  }

  let candidate = cleaned;
  if (!URL_SCHEME_PATTERN.test(candidate)) {
    const withIpv6Normalized = normalizeAuthorityForIpv6(candidate);
    const scheme = shouldDefaultToHttp(withIpv6Normalized) ? "http://" : "https://";
    candidate = `${scheme}${withIpv6Normalized}`;
  }

  let parsed: URL;
  try {
    parsed = new URL(candidate);
  } catch {
    throw new Error("服务器地址格式不正确，请使用 域名/IP[:端口]，例如 https://music.example.com:4533");
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error("服务器地址仅支持 http 或 https");
  }

  if (!parsed.hostname) {
    throw new Error("服务器地址缺少主机名");
  }

  parsed.hash = "";
  parsed.search = "";

  return `${parsed.protocol}//${parsed.host}${normalizePathname(parsed.pathname)}`;
}
