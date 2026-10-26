import express from 'express';
import { createServer as createViteServer } from 'vite';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { runVtvgoUpdate, discoverVtvgoChannels } from './scripts/update-vtvgo.js';
import { runXemtvUpdate, discoverXemtvChannels as discoverXemtvChannelsHelper, extractXemtvChannelStream } from './scripts/update-xemtv.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const SLUG_TO_NAME: Record<string, string> = {
  vtv1: 'VTV1', vtv2: 'VTV2', vtv3: 'VTV3', vtv4: 'VTV4', vtv5: 'VTV5',
  vtv6: 'VTV6', vtv7: 'VTV7', vtv8: 'VTV8', vtv9: 'VTV9', vtv10: 'VTV10',
  vtv5tnb: 'VTV5 Tây Nam Bộ', vtv5tn: 'VTV5 Tây Nguyên', antv: 'ANTV', qpvn: 'QPVN',
  htv1: 'HTV1', htv2: 'HTV2', htv3: 'HTV3', htv4: 'HTV4', htv5: 'HTV5', htv7: 'HTV7', htv9: 'HTV9', htvthethao: 'HTV Thể Thao',
  lamdong1: 'Lâm Đồng 1', lamdong2: 'Lâm Đồng 2', sctv2: 'SCTV2',
  vinhlong1: 'Vĩnh Long 1', vinhlong2: 'Vĩnh Long 2', vinhlong3: 'Vĩnh Long 3', vinhlong4: 'Vĩnh Long 4', vinhlong5: 'Vĩnh Long 5',
  cantho1: 'Cần Thơ 1', cantho2: 'Cần Thơ 2', cantho3: 'Cần Thơ 3',
  hanoi1: 'Hà Nội 1', hanoi2: 'Hà Nội 2', haiphong: 'Hải Phòng', haiphong3: 'Hải Phòng 3',
  dongnai1: 'Đồng Nai 1', dongnai2: 'Đồng Nai 2', dongnai3: 'Đồng Nai 3',
  hue: 'Huế', danang1: 'Đà Nẵng 1', danang2: 'Đà Nẵng 2',
  caobang: 'Cao Bằng', hatinh: 'Hà Tĩnh', nghean: 'Nghệ An', thanhhoa: 'Thanh Hóa',
  quangninh1: 'Quảng Ninh 1', quangninh3: 'Quảng Ninh 3',
  langson: 'Lạng Sơn', sonla: 'Sơn La', dienbien: 'Điện Biên', laichau: 'Lai Châu',
  angiang1: 'An Giang 1', angiang2: 'An Giang 2', angiang3: 'An Giang 3',
  camau: 'Cà Mau', dongthap1: 'Đồng Tháp 1', dongthap2: 'Đồng Tháp 2',
  tayninh1: 'Tây Ninh 1', daklak: 'Đắk Lắk',
  khanhhoa: 'Khánh Hòa', khanhhoa1: 'Khánh Hòa 1', gialai: 'Gia Lai',
  quangngai: 'Quảng Ngãi', quangngai2: 'Quảng Ngãi 2',
  quangtri: 'Quảng Trị', ninhbinh: 'Ninh Bình', hungyen: 'Hưng Yên',
  bacninh: 'Bắc Ninh', phutho: 'Phú Thọ', thainguyen: 'Thái Nguyên',
  laocai: 'Lào Cai', tuyenquang: 'Tuyên Quang', vietnamtoday: 'Việt Nam Today',
};

const SLUG_ALIASES: Record<string, string[]> = {
  hue: ['Huế', 'Hue', 'TRT', 'Truyền hình Huế'],
danang2: ['Đà Nẵng 2', 'DN2', 'Danang 2', 'ĐÀ NẴNG 2', 'DANANGTV2', 'Truyền hình Đà Nẵng 2'],
caobang: ['Cao Bằng', 'Cao Bang', 'CBTV', 'Truyền hình Cao Bằng'],
hatinh: ['Hà Tĩnh', 'Ha Tinh', 'HTTV', 'Truyền hình Hà Tĩnh'],
quangninh3: ['Quảng Ninh 3', 'QN3', 'Truyền hình Quảng Ninh 3'],
langson: ['Lạng Sơn', 'Lang Son', 'LSTV', 'Truyền hình Lạng Sơn'],
sonla: ['Sơn La', 'Son La', 'STV', 'Truyền hình Sơn La'],
dienbien: ['Điện Biên', 'Dien Bien', 'ĐTV', 'Truyền hình Điện Biên'],
laichau: ['Lai Châu', 'Lai Chau', 'Truyền hình Lai Châu'],
camau: ['Cà Mau', 'Ca Mau', 'CMTV', 'Truyền hình Cà Mau'],
daklak: ['Đắk Lắk', 'Dak Lak', 'DakLak', 'DRT', 'Truyền hình Đắk Lắk'],
gialai: ['Gia Lai', 'Gia Lai', 'GLTV', 'Truyền hình Gia Lai'],
quangngai2: ['Quảng Ngãi 2', 'Quang Ngai 2', 'QNgai2', 'Truyền hình Quảng Ngãi 2'],
quangtri: ['Quảng Trị', 'Quang Tri', 'QRT', 'Truyền hình Quảng Trị'],
laocai: ['Lào Cai', 'Lao Cai', 'LCTV', 'Truyền hình Lào Cai'],
tuyenquang: ['Tuyên Quang', 'Tuyen Quang', 'TQTV', 'Truyền hình Tuyên Quang'],
cantho1: ['Cần Thơ 1', 'Can Tho 1', 'CT1', 'Cần Thơ', 'THTPCT1', 'Truyền hình Cần Thơ 1'],
cantho2: ['Cần Thơ 2', 'Can Tho 2', 'CT2', 'THTPCT2', 'Truyền hình Cần Thơ 2'],
cantho3: ['Cần Thơ 3', 'Can Tho 3', 'CT3', 'THTPCT3', 'Truyền hình Cần Thơ 3'],
dongnai1: ['Đồng Nai 1', 'Đồng Nai', 'DNRT1 - TRUYỀN HÌNH ĐỒNG NAI 1 TRỰC TUYẾN', 'TRUYỀN HÌNH ĐỒNG NAI 1'],
dongnai2: ['Đồng Nai 2', 'Đồng Nai',  'DNRT2 - TRUYỀN HÌNH ĐỒNG NAI 2 TRỰC TUYẾN', 'TRUYỀN HÌNH ĐỒNG NAI 2'],
dongnai3: ['Đồng Nai 3', 'Đồng Nai',  'DNRT3 - TRUYỀN HÌNH ĐỒNG NAI 3 TRỰC TUYẾN', 'TRUYỀN HÌNH ĐỒNG NAI 3'],
lamdong1: ['Lâm Đồng', 'Lâm Đồng 1', 'LTV1', 'LTV 1', 'Truyền hình Lâm Đồng 1'],
lamdong2: ['LTV2', 'LTV 2', 'Lâm Đồng 2', 'Bình Thuận', 'Truyền hình Lâm Đồng 2'],
vinhlong1: ['Vĩnh Long 1', 'THVL1', 'THVL 1', 'Truyền hình Vĩnh Long 1'],
vinhlong2: ['Vĩnh Long 2', 'THVL2', 'THVL 2', 'Truyền hình Vĩnh Long 2'],
vinhlong3: ['Vĩnh Long 3', 'THVL3', 'THVL 3', 'Truyền hình Vĩnh Long 3'],
vinhlong4: ['Vĩnh Long 4', 'THVL4', 'THVL 4', 'Truyền hình Vĩnh Long 4'],
vinhlong5: ['Vĩnh Long 5', 'THVL5', 'THVL 5', 'Truyền hình Vĩnh Long 5'],
angiang1: ['An Giang 1', 'ATV1', 'ATV 1', 'Truyền hình An Giang 1'],
angiang2: ['An Giang 2', 'ATV2', 'ATV 2', 'Truyền hình An Giang 2'],
angiang3: ['An Giang 3', 'ATV3', 'ATV 3', 'Truyền hình An Giang 3'],
hanoi1: ['Hà Nội 1', 'HN1', 'Hà Nội', 'Truyền hình Hà Nội 1'],
hanoi2: ['Hà Nội 2', 'HN2', 'Truyền hình Hà Nội 2'],
haiphong: ['Hải Phòng', 'HP', 'Hải Phòng 1', 'THP', 'Truyền hình Hải Phòng'],
haiphong3: ['Hải Phòng 3', 'HP3', 'Truyền hình Hải Phòng 3'],
danang1: ['Đà Nẵng 1', 'DN1', 'Đà Nẵng', 'DanangTV1', 'Truyền hình Đà Nẵng 1'],
quangninh1: ['Quảng Ninh 1', 'QTV1', 'Quảng Ninh', 'Truyền hình Quảng Ninh 1'],
khanhhoa: ['Khánh Hòa', 'KTV', 'Khánh Hòa 1', 'Truyền hình Khánh Hòa'],
khanhhoa1: ['Khánh Hòa 1', 'KTV1', 'Truyền hình Khánh Hòa 1'],
quangngai: ['Quảng Ngãi', 'QNgai', 'Quảng Ngãi 1', 'Truyền hình Quảng Ngãi'],
dongthap1: ['Đồng Tháp 1', 'THĐT1', 'Đồng Tháp', 'Truyền hình Đồng Tháp 1'],
dongthap2: ['Đồng Tháp 2', 'THĐT2', 'Truyền hình Đồng Tháp 2'],
tayninh1: ['Tây Ninh 1', 'TN1', 'Tây Ninh', 'Truyền hình Tây Ninh 1'],
  vtv5tnb: ['VTV5 Tây Nam Bộ', 'VTV5 TNB'],
  vtv5tn: ['VTV5 Tây Nguyên', 'VTV5 TN'],
  vtv6: ['VTV6', 'VTV Cần Thơ', 'VTV6 Cần Thơ'],
  htvthethao: ['HTV Thể Thao', 'HTV The Thao', 'HTVTT'],
  vietnamtoday: ['Việt Nam Today', 'Vietnam Today', 'VTV Vietnam Today'],
};

function getSearchKeys(slug: string, displayName: string): string[] {
  const keys = new Set<string>();
  const add = (s: string) => {
    const k = normalizeKey(s);
    if (k) keys.add(k);
  };
  add(displayName);
  add(slug);
  const aliases = SLUG_ALIASES[slug] || [];
  for (const a of aliases) add(a);
  return Array.from(keys);
}

function normalizeKey(s: string): string {
  if (!s) return '';
  let t = s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  t = t.replace(/đ/g, 'd').replace(/Đ/g, 'd');
  t = t.replace(/\b(hd|sd|fullhd|fhd|uhd|4k|8k)\b/g, '');
  t = t.replace(/[^a-z0-9]/g, '');
  return t;
}

function qualityScore(probe: { height?: number; bitrate?: number } | null | undefined): number {
  if (!probe) return 0;
  return (probe.height || 0) * 10_000_000 + (probe.bitrate || 0);
}

async function probeManifest(url: string, referer: string, timeoutMs = 5000): Promise<{ width: number; height: number; bitrate: number; resolutionStr: string; bitrateKbps: string; } | null> {
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)', 'Referer': referer },
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) return null;
    const text = await res.text();
    let bestW = 0, bestH = 0, bestBr = 0;
    const regex = /#EXT-X-STREAM-INF:([^\r\n]+)/g;
    let m;
    while ((m = regex.exec(text)) !== null) {
      const line = m[1];
      const r = line.match(/RESOLUTION=(\d+)x(\d+)/i);
      const b = line.match(/BANDWIDTH=(\d+)/i);
      const w = r ? parseInt(r[1], 10) : 0;
      const h = r ? parseInt(r[2], 10) : 0;
      const br = b ? parseInt(b[1], 10) : 0;
      if (h > bestH || (h === bestH && br > bestBr)) { bestH = h; bestW = w; }
      if (br > bestBr) bestBr = br;
    }
    if (bestH > 0 || bestBr > 0) {
      return { width: bestW, height: bestH, bitrate: bestBr, resolutionStr: bestH > 0 ? `${bestW}x${bestH}` : 'HD', bitrateKbps: bestBr > 0 ? `${Math.round(bestBr / 1000)}kbps` : '' };
    }
  } catch { /* ignore */ }
  return null;
}

async function startServer() {
  const app = express();
  const PORT = Number(process.env.PORT) || 3000;

  app.use(express.json({ limit: '15mb' }));
  app.use(express.urlencoded({ extended: true, limit: '15mb' }));

  function unpackJavaScript(code: string): string {
    const packerRegex = /eval\(function\(p,a,c,k,e,d\)\{[\s\S]*?\}\(([\s\S]*?)\)\)/g;
    let match, unpackedTotal = '';
    while ((match = packerRegex.exec(code)) !== null) {
      try {
        const parts = match[1].split(/,\s*/);
        if (parts.length >= 4) {
          const p = parts[0].replace(/^['"]|['"]$/g, ''); const a = parseInt(parts[1], 10) || 62; const c = parseInt(parts[2], 10); const kStr = parts.slice(3).join(',');
          const kMatches = kStr.match(/['"](.*?)['"]\.split/);
          if (kMatches && kMatches[1]) {
            const k = kMatches[1].split('|'); let result = p;
            for (let i = c - 1; i >= 0; i--) { if (k[i]) result = result.replace(new RegExp(`\\b${(i).toString(a)}\\b`, 'g'), k[i]); }
            unpackedTotal += '\n' + result;
          }
        }
      } catch { /* ignore */ }
    }
    return unpackedTotal;
  }

  function extractM3u8FromText(text: string, baseUrl?: string): { url: string; sourceType: string }[] {
    const results: { url: string; sourceType: string }[] = [];
    const seen = new Set<string>();
    const addStream = (url: string, sourceType: string) => {
      let clean = url.replace(/\\\//g, '/').replace(/\\"/g, '"').trim().replace(/['"<>);]+$/, '');
      if (clean && !seen.has(clean)) { seen.add(clean); results.push({ url: clean, sourceType }); }
    };
    const absRegex = /(https?:[\/\\]{1,2}[^\s"'<>\\{}|^`]+?\.m3u8(?:\?[^\s"'<>\\{}|^`]*)?)/gi;
    let match;
    while ((match = absRegex.exec(text)) !== null) addStream(match[1], 'direct-regex');
    if (baseUrl) {
      try {
        const base = new URL(baseUrl);
        const relRegex = /["']([^"'<>\s]+\.m3u8(?:\?[^"'<>\s]*)?)["']/gi;
        while ((match = relRegex.exec(text)) !== null) {
          try { addStream(new URL(match[1].replace(/\\\//g, '/'), base).toString(), 'relative-regex'); } catch { /* ignore */ }
        }
      } catch { /* ignore */ }
    }
    const encodedRegex = /(https?%3A%2F%2F[^\s"'<>]+?\.m3u8(?:%3F[^\s"'<>]*)?)/gi;
    while ((match = encodedRegex.exec(text)) !== null) { try { addStream(decodeURIComponent(match[1]), 'url-decoded'); } catch { /* ignore */ } }
    if (text.includes('\\u002f') || text.includes('\\u002F')) {
      try {
        const unescaped = text.replace(/\\u([0-9a-fA-F]{4})/g, (_, code) => String.fromCharCode(parseInt(code, 16)));
        for (const s of extractM3u8FromText(unescaped, baseUrl)) addStream(s.url, 'unicode-unescaped');
      } catch { /* ignore */ }
    }
    const b64Regex = /([A-Za-z0-9+/=]{20,})/g;
    let bMatch;
    while ((bMatch = b64Regex.exec(text)) !== null) {
      try {
        const decoded = Buffer.from(bMatch[1], 'base64').toString('utf-8');
        if (decoded.includes('.m3u8')) for (const s of extractM3u8FromText(decoded, baseUrl)) addStream(s.url, 'base64-decoded');
      } catch { /* ignore */ }
    }
    if (text.includes('eval(function(p,a,c,k,e,d)')) {
      const unpacked = unpackJavaScript(text);
      if (unpacked) for (const s of extractM3u8FromText(unpacked, baseUrl)) addStream(s.url, 'unpacked-js');
    }
    return results;
  }

  app.all('/api/extract-m3u8', async (req, res) => {
    const targetUrl = (req.method === 'POST' ? req.body.url : req.query.url) as string;
    if (!targetUrl || typeof targetUrl !== 'string') return res.status(400).json({ error: 'Vui lòng cung cấp tham số url' });
    let normalizedUrl = targetUrl.trim();
    if (!/^https?:\/\//i.test(normalizedUrl)) normalizedUrl = 'https://' + normalizedUrl;
    if (normalizedUrl.toLowerCase().includes('.m3u8')) {
      let sourceTag = 'Direct M3U8';
      if (normalizedUrl.includes('live-vtv-aws')) sourceTag = 'VTVGo Live (AWS CloudFront CDN)';
      else if (normalizedUrl.includes('akamaized.net')) sourceTag = 'VTVGo Live (Akamai CDN)';
      else if (normalizedUrl.includes('vtvgolive')) sourceTag = 'VTVGo Live (VTV Digital CDN)';
      else if (normalizedUrl.includes('vnetwork')) sourceTag = 'VTVGo Live (VNetwork CDN)';
      return res.json({ success: true, streams: [{ url: normalizedUrl, sourceType: sourceTag }], count: 1, source: normalizedUrl, message: `Đã nhận diện liên kết .m3u8 (${sourceTag})` });
    }
    if (normalizedUrl.includes('xemtv.net')) {
      const cleanRootUrl = normalizedUrl.replace(/\/+$/, '').toLowerCase();
      if (cleanRootUrl === 'https://hd1.xemtv.net' || cleanRootUrl === 'http://hd1.xemtv.net' || cleanRootUrl === 'https://xemtv.net') {
        try {
          const updateRes = await runXemtvUpdate({ limit: 120 });
          const targetPath = path.resolve(__dirname, 'tvPremium.m3u');
          let extracted: any[] = [];
          if (fs.existsSync(targetPath)) {
            const lines = fs.readFileSync(targetPath, 'utf8').split(/\r?\n/); let curName = '';
            for (const l of lines) {
              const t = l.trim();
              if (t.startsWith('#EXTINF:')) { const m = t.match(/tvg-name="([^"]+)"/) || t.match(/,(.+)$/); curName = m ? m[1].trim() : 'Kênh XemTV'; } 
              else if (t.startsWith('http')) extracted.push({ url: t, sourceType: curName, channelName: curName, pageTitle: `XemTV - ${curName}` });
            }
          }
          return res.json({ success: true, streams: extracted, count: extracted.length, totalChannelsFound: updateRes.channelsDiscovered, source: normalizedUrl, pageTitle: `XemTV Portal (${updateRes.channelsDiscovered} kênh)`, message: `Đã quét https://hd1.xemtv.net/: Phát hiện ${updateRes.channelsDiscovered} kênh và tự động dò ra ${extracted.length} luồng m3u8 chất lượng cao nhất!` });
        } catch (e: any) { console.error('Lỗi khi quét portal xemtv.net:', e.message); }
      }
      try {
        const singleRes = await extractXemtvChannelStream(normalizedUrl);
        if (singleRes && singleRes.success && singleRes.streamUrl) {
          const titleMatch = normalizedUrl.match(/kenh-([a-zA-Z0-9_-]+)\.html/i);
          const channelSlug = titleMatch ? titleMatch[1].toUpperCase() : 'Kênh XemTV';
          return res.json({ success: true, streams: [{ url: singleRes.streamUrl, sourceType: singleRes.sourceType || 'XemTV Player', channelName: channelSlug, pageTitle: `XemTV - ${channelSlug}` }], count: 1, source: normalizedUrl, pageTitle: `XemTV - ${channelSlug}`, channelName: channelSlug, message: `Đã lấy thành công luồng ${channelSlug} trên XemTV!` });
        }
      } catch (e: any) { console.error('Lỗi XemTV single:', e.message); }
    }
    if (normalizedUrl.includes('vtvgo.vn')) {
      const cleanRootUrl = normalizedUrl.replace(/\/+$/, '').toLowerCase();
      if (cleanRootUrl === 'https://vtvgo.vn' || cleanRootUrl === 'http://vtvgo.vn') {
        try {
          const updateRes = await runVtvgoUpdate();
          const targetPath = path.resolve(__dirname, 'tvPremium.m3u');
          let extracted: any[] = [];
          if (fs.existsSync(targetPath)) {
            const lines = fs.readFileSync(targetPath, 'utf8').split(/\r?\n/); let curName = '';
            for (const l of lines) {
              const t = l.trim();
              if (t.startsWith('#EXTINF:')) { const m = t.match(/tvg-name="([^"]+)"/) || t.match(/,(.+)$/); curName = m ? m[1].trim() : 'Kênh VTVGo'; } 
              else if (t.startsWith('http')) extracted.push({ url: t, sourceType: curName, channelName: curName, pageTitle: `VTVGo - ${curName}` });
            }
          }
          return res.json({ success: true, streams: extracted, count: extracted.length, totalChannelsFound: updateRes.channelsCount, source: normalizedUrl, pageTitle: `VTVGo Portal (${updateRes.channelsCount} kênh)`, message: `Đã quét https://vtvgo.vn/: Tìm thấy ${updateRes.channelsCount} kênh!` });
        } catch (e: any) { console.error('Lỗi portal vtvgo.vn:', e.message); }
      }
      try {
        let channelId = '1';
        const channelMatch = normalizedUrl.match(/\/channel\/([a-zA-Z0-9]+)/i);
        if (channelMatch) channelId = channelMatch[1];
        const deviceId = crypto.randomUUID();
        const vtvRes = await fetch('https://api.vtvdigital.org/live-channel/v21.0/playback/source', {
          method: 'POST',
          headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/124.0.0.0', 'Referer': 'https://vtvgo.vn/', 'Origin': 'https://vtvgo.vn', 'Content-Type': 'application/json', 'Accept': 'application/json' },
          body: JSON.stringify({ channelId: String(channelId), platform: 'webPC', deviceId }),
          signal: AbortSignal.timeout(10000)
        });
        if (vtvRes.ok) {
          const vtvData: any = await vtvRes.json();
          const channelName = vtvData.data?.channelName || `VTV (Kênh ${channelId})`;
          const vtvStreams: any[] = [];
          for (const mode of (vtvData.data?.sourceModes || [])) {
            for (const ms of (mode.multiSource || [])) {
              for (const s of (ms.sources || [])) {
                if (s.url && s.url.includes('.m3u8')) {
                  let cdnLabel = 'Akamai CDN';
                  if (s.url.includes('live-vtv-aws') || s.url.includes('aws')) cdnLabel = 'AWS CloudFront CDN';
                  else if (s.url.includes('vnetwork')) cdnLabel = 'VNetwork CDN';
                  else if (s.url.includes('vtvgolive')) cdnLabel = 'VTV Digital CDN';
                  vtvStreams.push({ url: s.url, sourceType: `${channelName} (${cdnLabel})` });
                }
              }
            }
          }
          if (vtvStreams.length > 0) return res.json({ success: true, streams: vtvStreams, count: vtvStreams.length, source: normalizedUrl, pageTitle: `VTVGo Trực Tiếp - ${channelName}`, channelNumber: parseInt(channelId, 10) || 1, channelName, message: `Đã lấy thành công luồng ${channelName}!` });
        }
      } catch (e: any) { console.error('VTVGo handler error:', e.message); }
    }
    try {
      const headers = { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/124.0.0.0', 'Accept': 'text/html,application/xhtml+xml', 'Accept-Language': 'vi-VN,vi;q=0.9', 'Referer': normalizedUrl };
      const response = await fetch(normalizedUrl, { headers, redirect: 'follow', signal: AbortSignal.timeout(12000) });
      const responseText = await response.text();
      const finalUrl = response.url || normalizedUrl;
      const titleMatch = responseText.match(/<title[^>]*>([^<]+)<\/title>/i);
      const pageTitle = titleMatch ? titleMatch[1].trim() : '';
      let foundStreams = extractM3u8FromText(responseText, finalUrl);
      const iframeRegex = /<iframe[^>]+src=["']([^"']+)["']/gi;
      const iframeUrls: string[] = [];
      let iMatch;
      while ((iMatch = iframeRegex.exec(responseText)) !== null) {
        try {
          const resolvedIframe = new URL(iMatch[1], finalUrl).toString();
          if (!resolvedIframe.startsWith('chrome-extension') && !resolvedIframe.includes('about:blank')) iframeUrls.push(resolvedIframe);
        } catch { /* ignore */ }
      }
      if (foundStreams.length === 0 && iframeUrls.length > 0) {
        for (const ifrUrl of iframeUrls.slice(0, 4)) {
          try {
            const ifrRes = await fetch(ifrUrl, { headers: { ...headers, Referer: finalUrl }, signal: AbortSignal.timeout(6000) });
            if (ifrRes.ok) { const ifrText = await ifrRes.text(); for (const s of extractM3u8FromText(ifrText, ifrUrl)) foundStreams.push({ ...s, sourceType: 'iframe-player' }); }
          } catch { /* ignore */ }
        }
      }
      const uniqueStreams = Array.from(new Map(foundStreams.map(s => [s.url, s])).values());
      return res.json({ success: true, streams: uniqueStreams, count: uniqueStreams.length, source: finalUrl, pageTitle, iframesFound: iframeUrls.length, httpStatus: response.status });
    } catch (err: any) {
      return res.status(500).json({ success: false, error: `Không thể kết nối: ${err.message}`, suggestion: 'Trang web có thể dùng Cloudflare chặn bot.' });
    }
  });

  app.get('/api/proxy-m3u8', async (req, res) => {
    const targetUrl = req.query.url as string;
    let referer = (req.query.referer as string) || targetUrl;
    if (targetUrl && (targetUrl.includes('akamaized.net') || targetUrl.includes('vtv') || targetUrl.includes('vtvdigital'))) referer = 'https://vtvgo.vn/';
    else if (targetUrl && (targetUrl.includes('tv360') || targetUrl.includes('viettel'))) referer = 'https://tv360.vn/';
    else if (targetUrl && (targetUrl.includes('fptplay') || targetUrl.includes('fpt'))) referer = 'https://fptplay.vn/';
    if (!targetUrl) return res.status(400).send('Missing url parameter');
    try {
      const parsedUrl = new URL(targetUrl);
      const upstreamRes = await fetch(parsedUrl.toString(), { headers: { 'User-Agent': 'Mozilla/5.0', 'Referer': referer, 'Origin': parsedUrl.origin, 'Accept': '*/*' }, signal: AbortSignal.timeout(15000) });
      const contentType = upstreamRes.headers.get('content-type') || 'application/vnd.apple.mpegurl';
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Content-Type', contentType);
      if (contentType.includes('mpegurl') || targetUrl.includes('.m3u8')) {
        const manifestText = await upstreamRes.text();
        const baseHref = parsedUrl.origin + parsedUrl.pathname.substring(0, parsedUrl.pathname.lastIndexOf('/') + 1);
        const rewritten = manifestText.split('\n').map((line) => {
          const trimmed = line.trim();
          if (!trimmed || trimmed.startsWith('#')) {
            if (trimmed.includes('URI="')) return trimmed.replace(/URI="([^"]+)"/, (_, uri) => `URI="/api/proxy-m3u8?url=${encodeURIComponent(uri.startsWith('http') ? uri : new URL(uri, baseHref).toString())}&referer=${encodeURIComponent(referer)}"`);
            return line;
          }
          return `/api/proxy-m3u8?url=${encodeURIComponent(trimmed.startsWith('http') ? trimmed : new URL(trimmed, baseHref).toString())}&referer=${encodeURIComponent(referer)}`;
        }).join('\n');
        return res.send(rewritten);
      } else {
        return res.send(Buffer.from(await upstreamRes.arrayBuffer()));
      }
    } catch (err: any) { return res.status(500).send(`Proxy Error: ${err.message}`); }
  });

  app.post('/api/save-playlist', (req, res) => {
    try {
      const { content, lines } = req.body;
      let finalContent = typeof content === 'string' ? content : (Array.isArray(lines) ? lines.join('\r\n') : null);
      if (!finalContent) return res.status(400).json({ success: false, error: 'Dữ liệu không hợp lệ' });
      if (!finalContent.startsWith('\uFEFF')) finalContent = '\uFEFF' + finalContent;
      const targetPath = path.resolve(__dirname, 'tvPremium.m3u');
      fs.writeFileSync(targetPath, finalContent, 'utf8');
      return res.json({ success: true, filename: 'tvPremium.m3u', channelCount: (finalContent.match(/#EXTINF/gi) || []).length, message: `Đã lưu!` });
    } catch (err: any) { return res.status(500).json({ success: false, error: err.message }); }
  });

  app.get('/api/discover-vtvgo-channels', async (req, res) => {
    try { const channels = await discoverVtvgoChannels(); return res.json({ success: true, count: channels.length, channels }); } 
    catch (err: any) { return res.status(500).json({ success: false, error: err.message }); }
  });

  app.post(['/api/scan-vtvgo-portal', '/api/scan-vtvgo'], async (req, res) => {
    try {
      const { startId, endId, mode } = req.body || {};
      const s = startId !== undefined ? Number(startId) : undefined;
      const e = endId !== undefined ? Number(endId) : undefined;
      const options = { mode: mode || (s !== undefined && e !== undefined ? 'range' : 'portal') };
      const updateRes = await runVtvgoUpdate(s, e, options);
      const targetPath = path.resolve(__dirname, 'tvPremium.m3u');
      let extracted: any[] = [];
      let m3uContent = '';
      if (fs.existsSync(targetPath)) {
        m3uContent = fs.readFileSync(targetPath, 'utf8');
        const lines = m3uContent.split(/\r?\n/);
        let curName = '', curLogo = '', curGroup = 'VTV';
        for (const l of lines) {
          const t = l.trim();
          if (t.startsWith('#EXTINF:')) {
            const m = t.match(/tvg-name="([^"]+)"/) || t.match(/,(.+)$/);
            curName = m ? m[1].trim() : 'Kênh VTVGo';
            const logoMatch = t.match(/tvg-logo="([^"]+)"/);
            curLogo = logoMatch ? logoMatch[1] : '';
            const groupMatch = t.match(/group-title="([^"]+)"/);
            curGroup = groupMatch ? groupMatch[1] : 'VTV';
          } else if (t.startsWith('http')) {
            extracted.push({
              url: t,
              sourceType: 'VTVGo',
              channelName: curName,
              pageTitle: `VTVGo - ${curName}`,
              logo: curLogo,
              group: curGroup,
            });
          }
        }
      }
      return res.json({
        success: true,
        scannedRange: updateRes.scannedRange,
        channelsCount: updateRes.channelsCount,
        totalStreams: updateRes.totalStreams,
        streams: extracted,
        m3uContent,
        message: options.mode === 'range'
          ? `Đã quét dải kênh ${s || 1} đến ${e || 299} thành công! Tìm thấy ${updateRes.channelsCount} kênh.`
          : `Đã quét VTVGo thành công! Tìm thấy ${updateRes.channelsCount} kênh.`
      });
    } catch (err: any) { return res.status(500).json({ success: false, error: err.message }); }
  });

  app.get('/api/discover-xemtv-channels', async (req, res) => {
    try { const channels = await discoverXemtvChannelsHelper(); return res.json({ success: true, count: channels.length, channels }); } 
    catch (err: any) { return res.status(500).json({ success: false, error: err.message }); }
  });

  app.post('/api/scan-xemtv-portal', async (req, res) => {
    try {
      const limit = Number(req.body.limit) || 120;
      const updateRes = await runXemtvUpdate({ limit });
      const targetPath = path.resolve(__dirname, 'tvPremium.m3u');
      let extracted: any[] = [];
      let m3uContent = '';
      if (fs.existsSync(targetPath)) {
        m3uContent = fs.readFileSync(targetPath, 'utf8');
        const lines = m3uContent.split(/\r?\n/);
        let curName = '', curLogo = '', curGroup = 'XemTV';
        for (const l of lines) {
          const t = l.trim();
          if (t.startsWith('#EXTINF:')) {
            const m = t.match(/tvg-name="([^"]+)"/) || t.match(/,(.+)$/);
            curName = m ? m[1].trim() : 'Kênh XemTV';
            const logoMatch = t.match(/tvg-logo="([^"]+)"/);
            curLogo = logoMatch ? logoMatch[1] : '';
            const groupMatch = t.match(/group-title="([^"]+)"/);
            curGroup = groupMatch ? groupMatch[1] : 'XemTV';
          } else if (t.startsWith('http')) {
            extracted.push({
              url: t,
              sourceType: 'XemTV',
              channelName: curName,
              pageTitle: `XemTV - ${curName}`,
              logo: curLogo,
              group: curGroup,
            });
          }
        }
      }
      return res.json({
        success: true,
        channelsDiscovered: updateRes.channelsDiscovered,
        channelsCount: updateRes.validStreamsCount,
        streams: extracted,
        m3uContent,
        message: `Đã quét XemTV thành công! Phát hiện ${updateRes.channelsDiscovered} kênh, trích xuất ${updateRes.validStreamsCount} luồng.`
      });
    } catch (err: any) { return res.status(500).json({ success: false, error: err.message }); }
  });

  app.get('/api/playlist-status', (req, res) => {
    try {
      const targetPath = path.resolve(__dirname, 'tvPremium.m3u');
      if (fs.existsSync(targetPath)) {
        const stats = fs.statSync(targetPath); const content = fs.readFileSync(targetPath, 'utf8');
        return res.json({ exists: true, filename: 'tvPremium.m3u', size: stats.size, updatedAt: stats.mtime, channelCount: (content.match(/#EXTINF/gi) || []).length });
      }
      return res.json({ exists: false, filename: 'tvPremium.m3u' });
    } catch (err: any) { return res.status(500).json({ exists: false, error: err.message }); }
  });

  app.post('/api/github-sync', async (req, res) => {
    try {
      const { token, repo = 'thanhthovn/tvPremium', branch = 'main', filePath = 'tvPremium.m3u', content, rawContent, lines, commitMessage } = req.body;
      let finalContent = typeof rawContent === 'string' ? rawContent : (typeof content === 'string' ? content : (Array.isArray(lines) ? lines.join('\r\n') : null));
      if (!finalContent) return res.status(400).json({ success: false, error: 'Dữ liệu không hợp lệ' });
      if (!finalContent.startsWith('\uFEFF')) finalContent = '\uFEFF' + finalContent;
      const targetPath = path.resolve(__dirname, 'tvPremium.m3u');
      fs.writeFileSync(targetPath, finalContent, 'utf8');
      const channelCount = (finalContent.match(/#EXTINF/gi) || []).length;
      if (!token || !token.trim()) return res.json({ success: true, localSaved: true, githubSynced: false, channelCount, message: `Đã lưu local!` });
      
      const repoFullName = repo.trim().replace(/^https?:\/\/github\.com\//i, '').replace(/\.git$/i, '');
      let existingSha: string | null = null;
      const checkRes = await fetch(`https://api.github.com/repos/${repoFullName}/contents/${filePath}?ref=${encodeURIComponent(branch)}`, { headers: { 'Authorization': `Bearer ${token.trim()}`, 'Accept': 'application/vnd.github.v3+json' } });
      if (checkRes.ok) existingSha = (await checkRes.json()).sha || null;
      
      const putBody: any = { message: commitMessage || `Auto-update (${channelCount} channels)`, content: Buffer.from(finalContent, 'utf8').toString('base64'), branch: branch.trim() };
      if (existingSha) putBody.sha = existingSha;
      const putRes = await fetch(`https://api.github.com/repos/${repoFullName}/contents/${filePath}`, { method: 'PUT', headers: { 'Authorization': `Bearer ${token.trim()}`, 'Accept': 'application/vnd.github.v3+json', 'Content-Type': 'application/json' }, body: JSON.stringify(putBody) });
      
      if (!putRes.ok) return res.status(putRes.status).json({ success: false, localSaved: true, error: `Lỗi GitHub: ${(await putRes.json()).message}` });
      const putData: any = await putRes.json();
      return res.json({ success: true, localSaved: true, githubSynced: true, channelCount, repo: repoFullName, commitUrl: putData.commit?.html_url, message: `Đã đồng bộ!` });
    } catch (err: any) { return res.status(500).json({ success: false, localSaved: true, error: err.message }); }
  });

  app.get('/api/load-iptv-ori', async (req, res) => {
    try {
      const repo = (req.query.repo as string) || 'thanhthovn/tvPremium'; const branch = (req.query.branch as string) || 'main'; const filePath = (req.query.filePath as string) || 'iptv_ori.m3u'; const wantsRaw = String(req.query.raw || '') === '1';
      const cleanRepo = repo.trim().replace(/^https?:\/\/github\.com\//i, '').replace(/\.git$/i, '');
      let content = '';
      try { const rawRes = await fetch(`https://raw.githubusercontent.com/${cleanRepo}/${branch}/${filePath}`); if (rawRes.ok) content = await rawRes.text(); } catch { /* fallback */ }
      if (!content) {
        const token = (req.query.token as string) || process.env.GH_TOKEN;
        const apiRes = await fetch(`https://api.github.com/repos/${cleanRepo}/contents/${filePath}?ref=${branch}`, { headers: { 'Accept': 'application/vnd.github.v3.raw', ...(token ? { 'Authorization': `token ${token}` } : {}) } });
        if (apiRes.ok) content = await apiRes.text();
      }
      if (!content) return res.status(404).json({ success: false, error: 'Không tìm thấy file' });
      if (wantsRaw) return res.json({ success: true, content, rawContent: content });
      
      const lines = content.split(/\r?\n/); const channels: any[] = []; let currentCh: any = null;
      for (const l of lines) {
        const line = l.trim();
        if (line.startsWith('#EXTINF:')) {
          const titleMatch = line.match(/,\s*(.+)$/); const name = titleMatch ? titleMatch[1].trim() : 'Unknown';
          const groupMatch = line.match(/group-title="([^"]+)"/i); const logoMatch = line.match(/tvg-logo="([^"]+)"/i);
          currentCh = { id: `ori-${channels.length + 1}`, name, group: groupMatch ? groupMatch[1] : 'Khác', logo: logoMatch ? logoMatch[1] : '', url: '' };
        } else if (line && !line.startsWith('#')) { if (currentCh) { currentCh.url = line; channels.push(currentCh); currentCh = null; } }
      }
      const groups: Record<string, number> = {}; for (const ch of channels) groups[ch.group] = (groups[ch.group] || 0) + 1;
      return res.json({ success: true, totalChannels: channels.length, groups, channels, rawContent: content });
    } catch (err: any) { return res.status(500).json({ success: false, error: err.message }); }
  });

   // ==========================================
  // 🆕 HELPER FUNCTIONS CHO VIỆC SO KHỚP TÊN
  // ==========================================
  function matchScoreByLength(target: string, candidate: string): number {
    if (!target || !candidate) return 0;
    if (target === candidate) return 100; // Exact match

    const tLen = target.length;
    const cLen = candidate.length;
    const diff = Math.abs(tLen - cLen);

    // 1. Candidate dài hơn Target (vd: target="vtv5", candidate="vtv5tnb")
    if (cLen > tLen && candidate.startsWith(target)) {
      const lastT = target.slice(-1);
      const nextC = candidate.charAt(tLen);
      // Chặn VTV1 vs VTV10 (số nối với số)
      if (/\d/.test(lastT) && /\d/.test(nextC)) return 0;
      if (diff <= 3) return 80 - diff * 5; // 80, 75, 70...
      return 0;
    }

    // 2. Target dài hơn Candidate (vd: target="vtv5tnb", candidate="vtv5")
    if (tLen > cLen && target.startsWith(candidate)) {
      const lastC = candidate.slice(-1);
      const nextT = target.charAt(cLen);
      // Chặn VTV10 vs VTV1 (số nối với số)
      if (/\d/.test(lastC) && /\d/.test(nextT)) return 0;
      if (diff <= 3) return 70 - diff * 5; // 70, 65, 60...
      return 0;
    }

    // 3. Suffix match (vd: target="hue", candidate="trthue")
    // Chỉ áp dụng nếu target KHÔNG chứa số để tránh nhầm lẫn
    if (!/\d/.test(target) && target.length >= 3 && candidate.endsWith(target)) {
      if (diff <= 3) return 50 - diff * 5; // 50, 45, 40...
      return 0;
    }

    return 0;
  }

  app.post('/api/smart-replace', async (req, res) => {
    try {
      const { token, repo = 'thanhthovn/tvPremium', branch = 'main', channelUrlFile = 'channel_url.txt', m3uFile = 'tvPremium.m3u' } = req.body || {};
      if (!token || !token.trim()) return res.status(400).json({ success: false, error: 'Cần GitHub Token.' });
      const cleanRepo = repo.trim().replace(/^https?:\/\/github\.com\//i, '').replace(/\.git$/i, ''); const cleanBranch = (branch || 'main').trim();

      // 1. Đọc channel_url.txt
      const chRes = await fetch(`https://raw.githubusercontent.com/${cleanRepo}/${cleanBranch}/${channelUrlFile}?t=${Date.now()}`);
      if (!chRes.ok) return res.status(404).json({ success: false, error: `Không đọc được ${channelUrlFile}` });
      const slugs: string[] = [];
      for (const raw of (await chRes.text()).split(/\r?\n/)) {
        const line = raw.trim();
        if (line.startsWith('#')) { const slug = line.replace(/^#+/, '').trim().toLowerCase(); if (slug) slugs.push(slug); }
      }
      if (slugs.length === 0) return res.status(400).json({ success: false, error: 'File không có #slug' });

      // 2. Đọc tvPremium.m3u
      const m3uRes = await fetch(`https://raw.githubusercontent.com/${cleanRepo}/${cleanBranch}/${m3uFile}?t=${Date.now()}`);
      if (!m3uRes.ok) return res.status(404).json({ success: false, error: `Không đọc được ${m3uFile}` });
      const originalText = await m3uRes.text();
      const useCRLF = /\r\n/.test(originalText); const hadBOM = originalText.charCodeAt(0) === 0xFEFF;
      let lines = originalText.split(/\r?\n/); if (hadBOM && lines.length > 0) lines[0] = lines[0].replace(/^\uFEFF/, '');

      // 3. Load cache portals
      const [vtvgoChannels, xemtvChannels] = await Promise.allSettled([discoverVtvgoChannels(), discoverXemtvChannelsHelper()]);
      const vtvgoList = vtvgoChannels.status === 'fulfilled' ? vtvgoChannels.value : [];
      const xemtvList = xemtvChannels.status === 'fulfilled' ? xemtvChannels.value : [];
      
      const vtvgoMap = new Map<string, any>(); for (const ch of vtvgoList) vtvgoMap.set(normalizeKey(ch.channelName || ''), { id: ch.channelId, name: ch.channelName });
      const xemtvMap = new Map<string, any>(); for (const ch of xemtvList) xemtvMap.set(normalizeKey(ch.channelName || ''), { url: ch.url, name: ch.channelName, logo: ch.logo || '' });

      const results: any[] = []; let replaced = 0, kept = 0, failed = 0; const vtvgoFetchCache = new Map<string, any[]>();

      for (const slug of slugs) {
        const displayName = SLUG_TO_NAME[slug];
        if (!displayName) { results.push({ slug, name: slug, status: 'error', note: 'Slug không có trong mapping' }); failed++; continue; }
        
        const searchKeys = new Set<string>(getSearchKeys(slug, displayName));

        // ==========================================
        // 4a. TÌM TRONG M3U (Dùng matchScoreByLength)
        // ==========================================
        let extinfIdx = -1;
        let bestM3uScore = 0;
        for (let i = 0; i < lines.length; i++) {
          const l = lines[i]; if (!l.startsWith('#EXTINF')) continue;
          const rawId = (l.match(/tvg-id="([^"]+)"/i) || [])[1] || '';
          const rawTvg = (l.match(/tvg-name="([^"]+)"/i) || [])[1] || '';
          let rawName = (l.match(/,\s*(.+)$/) || [])[1] || '';
          rawName = rawName.replace(/\([^)]*\)/g, '').replace(/\s+(HD|FHD|SD|4K)$/i, '').trim();
          
          const normId = normalizeKey(rawId), normTvg = normalizeKey(rawTvg), normName = normalizeKey(rawName);
          const cands = [normId, normTvg, normName].filter(Boolean);
          
          let lineBestScore = 0;
          for (const k of searchKeys) {
            if (!k) continue;
            for (const cand of cands) {
              const s = matchScoreByLength(k, cand);
              if (s > lineBestScore) lineBestScore = s;
            }
            if (lineBestScore === 100) break; // Exact match
          }

          if (lineBestScore > bestM3uScore) {
            bestM3uScore = lineBestScore;
            extinfIdx = i;
            if (bestM3uScore === 100) break; // Dừng sớm nếu đã tìm thấy kênh khớp 100%
          }
        }

        if (extinfIdx === -1) { results.push({ slug, name: displayName, status: 'error', note: 'Không thấy kênh trong tvPremium.m3u' }); failed++; continue; }
        
        let urlLineIdx = extinfIdx + 1; while (urlLineIdx < lines.length && lines[urlLineIdx].trim().startsWith('#')) urlLineIdx++;
        if (urlLineIdx >= lines.length || !lines[urlLineIdx].trim()) { results.push({ slug, name: displayName, status: 'error', note: 'Thiếu dòng URL' }); failed++; continue; }
        const oldUrl = lines[urlLineIdx].trim();

        // ==========================================
        // 4b. TÌM TRONG VTVGO (Dùng matchScoreByLength)
        // ==========================================
        const vtvgoCandidates: Array<{ url: string; source: 'VTVGo' }> = [];
        let vtvgoEntry: any = undefined;
        let bestVtvgoScore = 0;
        for (const [cacheKey, entry] of vtvgoMap.entries()) {
          for (const k of searchKeys) {
            const s = matchScoreByLength(k, cacheKey);
            if (s > bestVtvgoScore) { bestVtvgoScore = s; vtvgoEntry = entry; }
            if (bestVtvgoScore === 100) break;
          }
          if (bestVtvgoScore === 100) break;
        }

        if (vtvgoEntry) {
          try {
            let streams = vtvgoFetchCache.get(vtvgoEntry.id);
            if (!streams) {
              const apiRes = await fetch('https://api.vtvdigital.org/live-channel/v21.0/playback/source', {
                method: 'POST', headers: { 'User-Agent': 'Mozilla/5.0', 'Referer': 'https://vtvgo.vn/', 'Origin': 'https://vtvgo.vn', 'Content-Type': 'application/json' },
                body: JSON.stringify({ channelId: String(vtvgoEntry.id), platform: 'webPC', deviceId: crypto.randomUUID() }), signal: AbortSignal.timeout(8000)
              });
              streams = [];
              if (apiRes.ok) {
                const data: any = await apiRes.json();
                for (const mode of (data.data?.sourceModes || [])) for (const ms of (mode.multiSource || [])) for (const s of (ms.sources || [])) if (s.url && s.url.includes('.m3u8')) streams!.push({ url: s.url });
              }
              vtvgoFetchCache.set(vtvgoEntry.id, streams);
            }
            for (const s of (streams || [])) vtvgoCandidates.push({ url: s.url, source: 'VTVGo' });
          } catch { /* ignore */ }
        }

        // ==========================================
        // 4c. TÌM TRONG XEMTV (Dùng matchScoreByLength)
        // ==========================================
        const xemtvCandidates: Array<{ url: string; source: 'XemTV' }> = [];
        let xemtvEntry: any = undefined;
        let bestXemtvScore = 0;
        for (const [cacheKey, entry] of xemtvMap.entries()) {
          for (const k of searchKeys) {
            const s = matchScoreByLength(k, cacheKey);
            if (s > bestXemtvScore) { bestXemtvScore = s; xemtvEntry = entry; }
            if (bestXemtvScore === 100) break;
          }
          if (bestXemtvScore === 100) break;
        }

        if (xemtvEntry) {
          try {
            const res = await extractXemtvChannelStream(xemtvEntry.url);
            if (res && res.success && res.streamUrl) xemtvCandidates.push({ url: res.streamUrl, source: 'XemTV' });
          } catch { /* ignore */ }
        }

        // 5. Probe và thay thế
        const allCandidates = [...vtvgoCandidates, ...xemtvCandidates];
        if (allCandidates.length === 0) { results.push({ slug, name: displayName, status: 'kept', oldUrl, note: 'Không tìm được link mới' }); kept++; continue; }
        
        const uniqueCandidates = Array.from(new Map(allCandidates.map(c => [c.url, c])).values());
        const probed: any[] = [];
        let idx = 0;
        await Promise.all(Array.from({ length: Math.min(3, uniqueCandidates.length) }, async () => {
          while (true) {
            const myIdx = idx++; if (myIdx >= uniqueCandidates.length) return;
            const c = uniqueCandidates[myIdx];
            const probe = await probeManifest(c.url, c.source === 'VTVGo' ? 'https://vtvgo.vn/' : 'https://hd1.xemtv.net/', 5000);
            probed.push({ url: c.url, source: c.source, score: qualityScore(probe), quality: probe ? `${probe.resolutionStr}${probe.bitrateKbps ? ' - ' + probe.bitrateKbps : ''}` : undefined });
          }
        }));
        
        probed.sort((a, b) => b.score - a.score);
        const best = probed[0];

        if (!best) { results.push({ slug, name: displayName, status: 'kept', oldUrl, note: 'Probe thất bại' }); kept++; continue; }

        if (best.url === oldUrl) { 
          results.push({ slug, name: displayName, status: 'kept', oldUrl, newUrl: best.url, quality: best.quality, source: best.source, note: 'Trùng link cũ' }); 
          kept++; 
        } else { 
          lines[urlLineIdx] = best.url; 
          results.push({ slug, name: displayName, status: 'found', oldUrl, newUrl: best.url, quality: best.quality, source: best.source, note: 'Đã thay link' }); 
          replaced++; 
        }
      }

      // 6. Commit
      let commitUrl, githubSynced = false; const m3uDirty = replaced > 0;
      let newContent: string | null = null;

      if (m3uDirty) {
        newContent = '\uFEFF' + lines.join(useCRLF ? '\r\n' : '\n');
        fs.writeFileSync(path.resolve(__dirname, 'tvPremium.m3u'), newContent, 'utf8');
        const getRes = await fetch(`https://api.github.com/repos/${cleanRepo}/contents/${m3uFile}?ref=${cleanBranch}`, { headers: { 'Authorization': `Bearer ${token}`, 'Accept': 'application/vnd.github.v3+json' } });
        const sha = getRes.ok ? (await getRes.json()).sha : undefined;
        const putRes = await fetch(`https://api.github.com/repos/${cleanRepo}/contents/${m3uFile}`, {
          method: 'PUT', headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ message: `Smart Replace (${replaced} links)`, content: Buffer.from(newContent).toString('base64'), branch: cleanBranch, sha })
        });
        if (putRes.ok) { githubSynced = true; commitUrl = (await putRes.json()).commit?.html_url; }
      }

      return res.json({
        success: true,
        total: slugs.length,
        replaced,
        kept,
        failed,
        results,
        m3uDirty,
        githubSynced,
        commitUrl,
        m3uContent: newContent,
        message: m3uDirty ? `Đã thay ${replaced} link, giữ ${kept}, lỗi ${failed}.` : `Không có link thay đổi.`
      });
    } catch (err: any) { return res.status(500).json({ success: false, error: err.message }); }
  });

  app.get(['/tvPremium.m3u', '/api/playlist/tvPremium.m3u'], (req, res) => {
    const targetPath = path.resolve(__dirname, 'tvPremium.m3u');
    if (fs.existsSync(targetPath)) {
      res.setHeader('Content-Type', 'application/vnd.apple.mpegurl; charset=utf-8');
      res.setHeader('Access-Control-Allow-Origin', '*');
      return res.sendFile(targetPath);
    }
    return res.status(404).send('#EXTM3U\n# File chua duoc tao.');
  });

  

  if (process.env.NODE_ENV === 'production') {
    app.use(express.static(path.resolve(__dirname, 'dist')));
    app.get('*', (req, res) => res.sendFile(path.resolve(__dirname, 'dist', 'index.html')));
  } else {
    app.use((await createViteServer({ server: { middlewareMode: true }, appType: 'spa' })).middlewares);
  }

  app.listen(PORT, '0.0.0.0', () => console.log(`Server running on port ${PORT}`));
}

startServer();