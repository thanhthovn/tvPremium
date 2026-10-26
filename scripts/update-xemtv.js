import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '..');
const OUTPUT_FILE = path.resolve(ROOT_DIR, 'tvPremium.m3u');

export const XEMTV_PORTAL_URL = 'https://hd1.xemtv.net/';
const CONCURRENCY = 14;
const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

export function removeVietnameseTones(str) {
  if (!str) return '';
  str = str.replace(/à|á|ạ|ả|ã|â|ầ|ấ|ậ|ẩ|ẫ|ă|ằ|ắ|ặ|ẳ|ẵ/g, 'a').replace(/è|é|ẹ|ẻ|ẽ|ê|ề|ế|ệ|ể|ễ/g, 'e').replace(/ì|í|ị|ỉ|ĩ/g, 'i').replace(/ò|ó|ọ|ỏ|õ|ô|ồ|ố|ộ|ổ|ỗ|ơ|ờ|ớ|ợ|ở|ỡ/g, 'o').replace(/ù|ú|ụ|ủ|ũ|ư|ừ|ứ|ự|ử|ữ/g, 'u').replace(/ỳ|ý|ỵ|ỷ|ỹ/g, 'y').replace(/đ/g, 'd');
  str = str.replace(/À|Á|Ạ|Ả|Ã|Â|Ầ|Ấ|Ậ|Ẩ|Ẫ|Ă|Ằ|Ắ|Ặ|Ẳ|Ẵ/g, 'A').replace(/È|É|Ẹ|Ẻ|Ẽ|Ê|Ề|Ế|Ệ|Ể|Ễ/g, 'E').replace(/Ì|Í|Ị|Ỉ|Ĩ/g, 'I').replace(/Ò|Ó|Ọ|Ỏ|Õ|Ô|Ồ|Ố|Ộ|Ổ|Ỗ|Ơ|Ờ|Ớ|Ợ|Ở|Ỡ/g, 'O').replace(/Ù|Ú|Ụ|Ủ|Ũ|Ư|Ừ|Ứ|Ự|Ử|Ữ/g, 'U').replace(/Ỳ|Ý|Ỵ|Ỷ|Ỹ/g, 'Y').replace(/Đ/g, 'D');
  return str;
}

export function cleanXemtvTitle(rawTitle) {
  let t = (rawTitle || '').replace(/^Xem\s+/i, '').replace(/^Kênh\s+Tivi\s+/i, '').replace(/^Kênh\s+/i, '').replace(/^Tivi\s+/i, '').trim();
  if (/VTV5\s*Tây Nam Bộ/i.test(t)) return 'VTV5 Tây Nam Bộ';
  if (/VTV5\s*Tây Nguyên/i.test(t)) return 'VTV5 Tây Nguyên';
  if (/VTV\s*Cần Thơ/i.test(t)) return 'VTV Cần Thơ';
  const vtvMatch = t.match(/^(VTV\s*(?:[1-9]|10))\b/i);
  if (vtvMatch) return vtvMatch[1].toUpperCase().replace(/\s+/g, '');
  if (t.includes(' - ')) {
    const parts = t.split(' - ');
    if (parts[0].trim().length >= 2 && parts[0].trim().length <= 32) return parts[0].trim();
  }
  return t;
}

export function getChannelPriority(name) {
  const n = (name || '').trim();
  const vtvPureMatch = n.match(/^VTV\s*([1-9]|10)$/i);
  if (vtvPureMatch) return parseInt(vtvPureMatch[1], 10);
  if (/^VTV\s*6\b/i.test(n) || /VTV\s*Cần Thơ/i.test(n)) return 6;
  if (/^VTV5\s/i.test(n)) return 15;
  if (/^VTV/i.test(n)) return 20;
  if (/VTVCab/i.test(n)) return 25;
  if (/^HTV\s*7\b/i.test(n)) return 31;
  if (/^HTV\s*9\b/i.test(n)) return 32;
  if (/^HTV/i.test(n)) return 35;
  if (/^THVL/i.test(n)) return 38;
  if (/^VTC/i.test(n)) return 45;
  if (/^SCTV/i.test(n)) return 50;
  if (/OnSports|Thể Thao|Sport|Bóng Đá|K\+|ESPN|Fox Sports/i.test(n)) return 60;
  if (/Hà Nội|Đà Nẵng|Hải Phòng|Cần Thơ|Bình Dương|Đồng Nai|Lâm Đồng|Vĩnh Long|An Giang|Quảng Ninh|Khánh Hòa|Nghệ An|Thanh Hóa/i.test(n)) return 70;
  if (/HBO|Cinemax|Discovery|National|Cartoon|Disney|AXN/i.test(n)) return 85;
  return 100;
}

export async function discoverXemtvChannels() {
  console.log(`[${new Date().toISOString()}] Đang quét ${XEMTV_PORTAL_URL}...`);
  const channels = [];
  
  try {
    const res = await fetch(XEMTV_PORTAL_URL, {
      headers: { 'User-Agent': USER_AGENT, 'Referer': XEMTV_PORTAL_URL },
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const html = await res.text();

    const channelRegex = /<a[^>]*href=["'](?:\.\/)?(kenh-[^"']+\.html)["'][^>]*>([\s\S]*?)<\/a>/gi;
    let m;
    while ((m = channelRegex.exec(html)) !== null) {
      const rawHref = m[1];
      const inner = m[2];
      
      const imgMatch = inner.match(/<img[^>]*alt=["']([^"']+)["']/i) || inner.match(/<img[^>]*title=["']([^"']+)["']/i);
      const textMatch = inner.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
      const titleAttrMatch = inner.match(/title=["']([^"']+)["']/i);
      
      const title = (imgMatch ? imgMatch[1] : (titleAttrMatch ? titleAttrMatch[1] : textMatch)).trim();
      if (!title) continue;

      const logoMatch = inner.match(/src=["']([^"']+)["']/i);
      let logo = logoMatch ? logoMatch[1] : '';
      if (logo && !logo.startsWith('http')) logo = 'https://hd1.xemtv.net/' + logo.replace(/^\.\//, '');

      const cleanTitle = cleanXemtvTitle(title);
      const slug = rawHref.toLowerCase();
      const titleLower = title.toLowerCase();

      let group = 'Truyền Hình';
      if (slug.includes('vtv') || titleLower.startsWith('vtv')) group = 'VTV';
      else if (slug.includes('htv') || titleLower.includes('htv')) group = 'HTV';
      else if (slug.includes('vtc') || titleLower.includes('vtc')) group = 'VTC';
      else if (slug.includes('sctv') || titleLower.includes('sctv')) group = 'SCTV';
      else if (slug.includes('the-thao') || titleLower.includes('thể thao')) group = 'Thể Thao';
      else if (slug.includes('dia-phuong') || titleLower.includes('địa phương')) group = 'Địa Phương';
      else if (slug.includes('world') || titleLower.includes('quốc tế')) group = 'Quốc Tế';

      const channelId = rawHref.replace(/^kenh-/, '').replace(/\.html$/, '');

      channels.push({
        channelId,
        channelName: cleanTitle,
        rawTitle: title,
        url: 'https://hd1.xemtv.net/' + rawHref,
        logo,
        group,
        priority: getChannelPriority(cleanTitle),
      });
    }
  } catch (err) {
    console.error('Lỗi khi tải trang chủ XemTV:', err.message);
  }

  const uniqueMap = new Map();
  for (const c of channels) if (!uniqueMap.has(c.url)) uniqueMap.set(c.url, c);

  const list = Array.from(uniqueMap.values());
  list.sort((a, b) => a.priority !== b.priority ? a.priority - b.priority : a.channelName.localeCompare(b.channelName, 'vi'));

  console.log(`[${new Date().toISOString()}] Đã phát hiện ${list.length} kênh trên https://hd1.xemtv.net/!`);
  return list;
}

export async function extractXemtvChannelStream(channelUrl) {
  try {
    const chRes = await fetch(channelUrl, {
      headers: { 'User-Agent': USER_AGENT, 'Referer': 'https://hd1.xemtv.net/' },
      signal: AbortSignal.timeout(6000),
    });
    if (!chRes.ok) return { success: false, reason: `HTTP ${chRes.status}` };
    const chHtml = await chRes.text();

    let m3u8s = chHtml.match(/https?:\/\/[^"'\s<>]+\.m3u8[^"'\s<>]*/gi) || [];
    if (m3u8s.length > 0) {
      let finalUrl = m3u8s[0];
      const queryMatch = finalUrl.match(/[?&]url=(https?:\/\/[^&"']+)/i);
      if (queryMatch) finalUrl = decodeURIComponent(queryMatch[1]);
      return { success: true, streamUrl: finalUrl, sourceType: 'XemTV Direct' };
    }

    const iframeMatches = [...chHtml.matchAll(/<iframe[^>]+src=["']([^"']+)["']/gi)].map(x => x[1]);
    for (const ifr of iframeMatches) {
      if (ifr.includes('ads') || ifr.includes('google') || ifr.includes('facebook')) continue;
      const fullIfr = ifr.startsWith('http') ? ifr : 'https://hd1.xemtv.net/' + ifr.replace(/^\//, '');

      try {
        const ifrRes = await fetch(fullIfr, { headers: { 'User-Agent': USER_AGENT, 'Referer': channelUrl }, signal: AbortSignal.timeout(5000) });
        if (ifrRes.ok) {
          const ifrHtml = await ifrRes.text();
          const ifrM3u8s = ifrHtml.match(/https?:\/\/[^"'\s<>]+\.m3u8[^"'\s<>]*/gi) || [];
          if (ifrM3u8s.length > 0) {
            let finalUrl = ifrM3u8s[0];
            const queryMatch = finalUrl.match(/[?&]url=(https?:\/\/[^&"']+)/i);
            if (queryMatch) finalUrl = decodeURIComponent(queryMatch[1]);
            return { success: true, streamUrl: finalUrl, iframeUrl: fullIfr, sourceType: 'XemTV Iframe' };
          }
          const fileMatch = ifrHtml.match(/file\s*:\s*["'](https?:\/\/[^"']+)["']/i);
          if (fileMatch) {
            let sUrl = fileMatch[1];
            const queryMatch = sUrl.match(/[?&]url=(https?:\/\/[^&"']+)/i);
            if (queryMatch) sUrl = decodeURIComponent(queryMatch[1]);
            return { success: true, streamUrl: sUrl, iframeUrl: fullIfr, sourceType: 'XemTV JWPlayer' };
          }
        }
      } catch { /* ignore */ }
    }
    return { success: false, reason: 'Không tìm thấy m3u8' };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

export async function probeM3u8Quality(url) {
  try {
    const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT, 'Referer': 'https://hd1.xemtv.net/' }, signal: AbortSignal.timeout(4000) });
    if (!res.ok) return null;
    const text = await res.text();
    let bestWidth = 0, bestHeight = 0, bestBitrate = 0;
    const streamInfRegex = /#EXT-X-STREAM-INF:([^\r\n]+)/g;
    let match;
    while ((match = streamInfRegex.exec(text)) !== null) {
      const resMatch = match[1].match(/RESOLUTION=(\d+)x(\d+)/i);
      const brMatch = match[1].match(/BANDWIDTH=(\d+)/i);
      let w = resMatch ? parseInt(resMatch[1], 10) : 0, h = resMatch ? parseInt(resMatch[2], 10) : 0, br = brMatch ? parseInt(brMatch[1], 10) : 0;
      if (h > bestHeight || (h === bestHeight && br > bestBitrate)) { bestHeight = h; bestWidth = w; }
      if (br > bestBitrate) bestBitrate = br;
    }
    if (bestHeight > 0 || bestBitrate > 0) return { width: bestWidth, height: bestHeight, bitrate: bestBitrate, resolutionStr: bestHeight > 0 ? `${bestWidth}x${bestHeight}` : 'HD', bitrateKbps: bestBitrate > 0 ? `${Math.round(bestBitrate / 1000)}kbps` : '' };
  } catch { /* ignore */ }
  return null;
}

export async function runXemtvUpdate(options = {}) {
  const { limit = 0 } = options;
  console.log(`[${new Date().toISOString()}] Bắt đầu tiến trình quét XemTV...`);

  const discoveredChannels = await discoverXemtvChannels();
  const targetChannels = limit > 0 ? discoveredChannels.slice(0, limit) : discoveredChannels;

  console.log(`Bắt đầu tự dò link phát cho ${targetChannels.length}/${discoveredChannels.length} kênh...`);
  const validChannels = [];
  let currentIndex = 0;

  const worker = async () => {
    while (currentIndex < targetChannels.length) {
      const ch = targetChannels[currentIndex++];
      const result = await extractXemtvChannelStream(ch.url);
      if (result && result.success && result.streamUrl) {
        validChannels.push({ ...ch, streamUrl: result.streamUrl, sourceType: result.sourceType || 'XemTV' });
      }
    }
  };

  await Promise.all(Array.from({ length: CONCURRENCY }, () => worker()));
  console.log(`Đã dò được link cho ${validChannels.length}/${targetChannels.length} kênh!`);

  let probeIndex = 0;
  const probeWorker = async () => {
    while (probeIndex < validChannels.length) {
      const ch = validChannels[probeIndex++];
      if (!ch) break;
      const probe = await probeM3u8Quality(ch.streamUrl);
      ch.probe = probe;
      ch.height = probe?.height || (ch.streamUrl.includes('1080') ? 1080 : ch.streamUrl.includes('720') ? 720 : 0);
    }
  };
  await Promise.all(Array.from({ length: 12 }, () => probeWorker()));

  validChannels.sort((a, b) => {
    const prioA = getChannelPriority(a.channelName), prioB = getChannelPriority(b.channelName);
    if (prioA !== prioB) return prioA - prioB;
    return a.channelName.localeCompare(b.channelName, 'vi');
  });

  const lines = ['#EXTM3U'];
  for (const ch of validChannels) {
    const probe = ch.probe;
    const resDisplay = probe?.resolutionStr ? probe.resolutionStr : (ch.height ? `${ch.height}p` : 'HD');
    const brDisplay = probe?.bitrateKbps ? ` - ${probe.bitrateKbps}` : '';
    const qualityTag = ` (${resDisplay}${brDisplay} - XemTV)`;
    const displayName = `${ch.channelName}${qualityTag}`;
    const cleanId = removeVietnameseTones(ch.channelName).toLowerCase().replace(/[^a-z0-9]/g, '');
    const tvgId = cleanId || ch.channelId;

    lines.push(`#EXTINF:-1 tvg-id="${tvgId}" tvg-name="${ch.channelName}" tvg-logo="${ch.logo}" group-title="${ch.group}",${displayName}`);
    lines.push(ch.streamUrl);
    lines.push('');
  }

  // BẢO VỆ: Không ghi đè nếu không cào được kênh nào
  if (validChannels.length === 0) {
    console.log(`[CẢNH BÁO] Không cào được kênh nào. Giữ nguyên file tvPremium.m3u cũ!`);
    return { portalUrl: XEMTV_PORTAL_URL, channelsDiscovered: 0, validStreamsCount: 0, channels: [] };
  }

  const finalContent = '\uFEFF' + lines.join('\r\n');
  fs.writeFileSync(OUTPUT_FILE, finalContent, 'utf8');

  return {
    portalUrl: XEMTV_PORTAL_URL,
    channelsDiscovered: discoveredChannels.length,
    channelsScanned: targetChannels.length,
    validStreamsCount: validChannels.length,
    channels: validChannels.map(c => ({ name: c.channelName, priority: getChannelPriority(c.channelName), res: c.probe?.resolutionStr || 'HD', url: c.streamUrl, group: c.group, logo: c.logo })),
    outputPath: OUTPUT_FILE,
  };
}

if (process.argv[1] && process.argv[1].endsWith('update-xemtv.js')) {
  runXemtvUpdate({ limit: 200 })
    .then((res) => { console.log('Kết quả:', res.validStreamsCount, 'kênh'); process.exit(0); })
    .catch((err) => { console.error('Lỗi:', err); process.exit(1); });
}