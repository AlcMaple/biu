// PCDN/MCDN 节点对第三方播放器限速严重，代理（Clash 等）下常卡死或握手失败，
// 播放表现为几秒后卡住或 MediaError code 4。B 站经常把这类节点放在 baseUrl，稳定的 upos 源在 backupUrl 里。
// 域名不可靠：实测有 *.edge.mountaintoys.cn:4483 这类不带 mcdn 字样的节点，只有查询参数 os=mcdn / mcdnid 能看出来。
const PCDN_HOST_SUFFIXES = [".mcdn.bilivideo.cn", ".szbdyd.com"];

export const isPcdnUrl = (url: string) => {
  try {
    const { hostname, searchParams } = new URL(url);
    if (PCDN_HOST_SUFFIXES.some(suffix => hostname.endsWith(suffix))) return true;
    return searchParams.get("os")?.toLowerCase() === "mcdn" || searchParams.has("mcdnid");
  } catch {
    return false;
  }
};

export const collectStreamUrls = (baseUrl?: string, backupUrl?: string[]) => {
  const candidates = [...new Set([baseUrl, ...(backupUrl || [])].filter((url): url is string => Boolean(url)))];
  return [...candidates.filter(url => !isPcdnUrl(url)), ...candidates.filter(url => isPcdnUrl(url))];
};
