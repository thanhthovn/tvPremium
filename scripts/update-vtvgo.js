import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '..');
const OUTPUT_FILE = path.resolve(ROOT_DIR, 'tvPremium.m3u');

// Cấu hình quét từ ID 1 đến 299 theo yêu cầu
export const SCAN_START_ID = 1;
export const SCAN_END_ID = 299;
const CONCURRENCY = 10;

/**
 * Lấy danh sách stream m3u8 cho một channelId từ API VTVGo
 */
async function fetchVtvgoChannel(channelId) {
  try {
    const vtvApiUrl = 'https://api.vtvdigital.org/live-channel/v21.0/playback/source';
    const res = await fetch(vtvApiUrl, {
      method: 'POST',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        'Referer': 'https://vtvgo.vn/',
        'Origin': 'https://vtvgo.vn',
        'Content-Type': 'application/json',
        'Accept': 'application/json',
      },
      body: JSON.stringify({
        channelId: String(channelId),
        platform: 'webPC',
        deviceId: crypto.randomUUID(),
      }),
      signal: AbortSignal.timeout(6000),
    });

    if (!res.ok) return null;

    const json = await res.json();
    const data = json.data;
    if (!data) return null;

    const streams = [];
    const sourceModes = data.sourceModes || [];

    for (const mode of sourceModes) {
      for (const ms of mode.multiSource || []) {
        for (const s of ms.sources || []) {
          if (s.url && s.url.includes('.m3u8')) {
            let cdnLabel = 'Akamai CDN';
            if (s.url.includes('live-vtv-aws') || s.url.includes('aws') || s.url.includes('cloudfront')) {
              cdnLabel = 'AWS CloudFront CDN';
            } else if (s.url.includes('vnetwork')) {
              cdnLabel = 'VNetwork CDN';
            } else if (s.url.includes('vtvgolive') || s.url.includes('vtvdigital')) {
              cdnLabel = 'VTV Digital CDN';
            }

            streams.push({
              url: s.url,
              cdn: cdnLabel,
            });
          }
        }
      }
    }

    if (streams.length === 0) return null;

    // Lọc trùng lặp URL trong cùng 1 kênh
    const uniqueStreams = [];
    const seen = new Set();
    for (const st of streams) {
      if (!seen.has(st.url)) {
        seen.add(st.url);
        uniqueStreams.push(st);
      }
    }

    const channelName = data.channelName?.trim() || `Kênh ${channelId}`;
    let logo = data.logo || data.thumbnail || 'https://vtvgo.vn/assets/images/channel_default.png';
    let group = 'VTV';
    if (channelName.includes('Hà Nội') || channelName.includes('Địa Phương') || channelName.includes('An Ninh') || channelName.includes('Công an')) {
      group = 'Truyền Hình';
    }

    // Dò thêm các link trực tiếp / VIP pre-origin theo yêu cầu (vtvgolivepre)
    const directStreams = await probeDirectVtvStream(channelName, channelId);
    for (const ds of directStreams) {
      if (!seen.has(ds.url)) {
        seen.add(ds.url);
        uniqueStreams.push(ds);
      }
    }

    return {
      channelId,
      channelName,
      logo,
      group,
      streams: uniqueStreams,
    };
  } catch {
    return null;
  }
}

/**
 * Thăm dò các luồng gốc trực tiếp VIP/Premium (như vtvgolivepre)
 * Nếu máy chủ mở và trả về HTTP 200 thì ưu tiên nạp vào danh sách
 */
async function probeDirectVtvStream(channelName, channelId) {
  const n = (channelName || '').toLowerCase().trim();
  const vtvMatch = n.match(/^vtv\s*([1-9]|10)$/i);
  if (!vtvMatch) return [];

  const num = vtvMatch[1];
  const candidates = [
    `https://vtvgolivepre-vtv02.vtvdigital.vn/hls/vtv/live/vtv${num}__vtv1080p-h264/index.m3u8`,
    `https://vtvgolivepre-vtv01.vtvdigital.vn/hls/vtv/live/vtv${num}__vtv1080p-h264/index.m3u8`,
    `https://vtvgolive-vtv02.vtvdigital.vn/hls/vtv/live/vtv${num}__vtv1080p-h264/index.m3u8`,
    `https://live-vtv-aws.vtvgo.vn/ch${channelId}.m3u8`,
  ];

  const found = [];
  for (const url of candidates) {
    try {
      const res = await fetch(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko)',
          'Referer': 'https://vtvgo.vn/',
          'Origin': 'https://vtvgo.vn',
        },
        signal: AbortSignal.timeout(2500),
      });
      if (res.ok) {
        const text = await res.text();
        if (text.includes('#EXTM3U')) {
          found.push({
            url,
            cdn: url.includes('vtvgolivepre')
              ? 'VTVgo Pre-Origin 1080p'
              : url.includes('live-vtv-aws')
              ? 'AWS CloudFront CDN'
              : 'VTV Digital Direct',
            isDirectOrigin: true,
          });
        }
      }
    } catch {
      // Bỏ qua nếu timeout hoặc lỗi 403
    }
  }
  return found;
}

/**
 * Thăm dò độ phân giải và bitrate từ Master Manifest
 */
async function probeM3u8Quality(url) {
  try {
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
        'Referer': 'https://vtvgo.vn/',
      },
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) return null;
    const text = await res.text();
    let bestWidth = 0;
    let bestHeight = 0;
    let bestBitrate = 0;

    const streamInfRegex = /#EXT-X-STREAM-INF:([^\r\n]+)/g;
    let match;
    while ((match = streamInfRegex.exec(text)) !== null) {
      const line = match[1];
      const resMatch = line.match(/RESOLUTION=(\d+)x(\d+)/i);
      const brMatch = line.match(/BANDWIDTH=(\d+)/i);

      let w = 0;
      let h = 0;
      let br = 0;

      if (resMatch) {
        w = parseInt(resMatch[1], 10);
        h = parseInt(resMatch[2], 10);
      }
      if (brMatch) {
        br = parseInt(brMatch[1], 10);
      }

      if (h > bestHeight || (h === bestHeight && br > bestBitrate)) {
        bestHeight = h;
        bestWidth = w;
      }
      if (br > bestBitrate) {
        bestBitrate = br;
      }
    }

    if (bestHeight > 0 || bestBitrate > 0) {
      return {
        width: bestWidth,
        height: bestHeight,
        bitrate: bestBitrate,
        resolutionStr: bestHeight > 0 ? `${bestWidth}x${bestHeight}` : 'HD',
        bitrateKbps: bestBitrate > 0 ? `${Math.round(bestBitrate / 1000)}kbps` : '',
      };
    }
  } catch {
    // Timeout hoặc lỗi manifest
  }
  return null;
}

/**
 * Xóa dấu tiếng Việt phục vụ chuẩn hóa tvg-id
 */
function removeVietnameseTones(str) {
  str = str.replace(/à|á|ạ|ả|ã|â|ầ|ấ|ậ|ẩ|ẫ|ă|ằ|ắ|ặ|ẳ|ẵ/g, 'a');
  str = str.replace(/è|é|ẹ|ẻ|ẽ|ê|ề|ế|ệ|ể|ễ/g, 'e');
  str = str.replace(/ì|í|ị|ỉ|ĩ/g, 'i');
  str = str.replace(/ò|ó|ọ|ỏ|õ|ô|ồ|ố|ộ|ổ|ỗ|ơ|ờ|ớ|ợ|ở|ỡ/g, 'o');
  str = str.replace(/ù|ú|ụ|ủ|ũ|ư|ừ|ứ|ự|ử|ữ/g, 'u');
  str = str.replace(/ỳ|ý|ỵ|ỷ|ỹ/g, 'y');
  str = str.replace(/đ/g, 'd');
  str = str.replace(/À|Á|Ạ|Ả|Ã|Â|Ầ|Ấ|Ậ|Ẩ|Ẫ|Ă|Ằ|Ắ|Ặ|Ẳ|Ẵ/g, 'A');
  str = str.replace(/È|É|Ẹ|Ẻ|Ẽ|Ê|Ề|Ế|Ệ|Ể|Ễ/g, 'E');
  str = str.replace(/Ì|Í|Ị|Ỉ|Ĩ/g, 'I');
  str = str.replace(/Ò|Ó|Ọ|Ỏ|Õ|Ô|Ồ|Ố|Ộ|Ổ|Ỗ|Ơ|Ờ|Ớ|Ợ|Ở|Ỡ/g, 'O');
  str = str.replace(/Ù|Ú|Ụ|Ủ|Ũ|Ư|Ừ|Ứ|Ự|Ử|Ữ/g, 'U');
  str = str.replace(/Ỳ|Ý|Ỵ|Ỷ|Ỹ/g, 'Y');
  str = str.replace(/Đ/g, 'D');
  return str;
}

/**
 * Xác định thứ tự ưu tiên sắp xếp:
 * Ưu tiên các kênh VTV từ 1 đến 10 trước (1 -> 10), tiếp theo là các kênh VTV phụ/khu vực, sau đó là các kênh khác
 */
function getChannelPriority(name) {
  const n = (name || '').trim();
  const vtvPureMatch = n.match(/^VTV\s*([1-9]|10)$/i);
  if (vtvPureMatch) {
    return parseInt(vtvPureMatch[1], 10); // 1 -> 10
  }
  if (/^VTV\s*6\b/i.test(n) || /VTV\s*Cần Thơ/i.test(n)) {
    return 6;
  }
  if (/^VTV5\s/i.test(n)) {
    return 15;
  }
  if (/^VTV/i.test(n)) {
    return 30;
  }
  return 100;
}

/**
 * Tự động quét vtvgo.vn để xác định danh mục và tổng số kênh đang phát sóng
 */
export async function discoverVtvgoChannels() {
  console.log(`[${new Date().toISOString()}] Đang quét vtvgo.vn để khám phá danh sách kênh trực tuyến...`);
  const base = 'https://api.vtvdigital.org';
  const chunks = [];
  for (let i = 1; i <= 260; i += 20) {
    const batch = [];
    for (let j = i; j < i + 20 && j <= 260; j++) batch.push(j);
    chunks.push(batch);
  }

  const allActiveChannels = [];
  await Promise.all(
    chunks.map(async (batch) => {
      try {
        const url = `${base}/display/v21.0/channels/details?channelIDs=${batch.join(',')}`;
        const res = await fetch(url, {
          headers: { 'Referer': 'https://vtvgo.vn/' },
          signal: AbortSignal.timeout(6000),
        });
        if (res.ok) {
          const json = await res.json();
          const data = json.data || {};
          for (const k of Object.keys(data)) {
            const item = data[k];
            if (item && item.enabled !== false && item.name) {
              allActiveChannels.push({
                channelId: String(item.id || k),
                channelName: String(item.name).trim(),
                logo: item.logo || item.thumbnail || 'https://vtvgo.vn/assets/images/channel_default.png',
                group: String(item.name).startsWith('VTV') ? 'VTV' : 'Truyền Hình',
              });
            }
          }
        }
      } catch {}
    })
  );

  console.log(`[${new Date().toISOString()}] Đã phát hiện tổng cộng ${allActiveChannels.length} kênh trên vtvgo.vn!`);
  return allActiveChannels;
}

/**
 * Tiến trình chính: Tự động quét từ SCAN_START_ID đến SCAN_END_ID (hoặc tự động phát hiện toàn bộ kênh vtvgo.vn)
 */
export async function runVtvgoUpdate(startId = SCAN_START_ID, endId = SCAN_END_ID) {
  console.log(`[${new Date().toISOString()}] Bắt đầu tự động quét VTVGo...`);

  // Bước 1: Quét trang vtvgo.vn để phát hiện danh sách kênh trực tiếp
  let targetChannels = await discoverVtvgoChannels();

  // Dự phòng nếu không lấy được danh sách động
  if (targetChannels.length === 0) {
    console.log('Không lấy được danh sách động từ portal, dùng dải ID dự phòng:', startId, '->', endId);
    for (let i = startId; i <= endId; i++) {
      targetChannels.push({ channelId: String(i), channelName: `Kênh ${i}` });
    }
  }

  const validChannels = [];
  let currentIndex = 0;

  // Bước 2: Tự động dò ra link m3u8 của các kênh vừa phát hiện được
  const worker = async () => {
    while (currentIndex < targetChannels.length) {
      const ch = targetChannels[currentIndex++];
      const result = await fetchVtvgoChannel(ch.channelId);
      if (result && result.streams.length > 0) {
        console.log(`[ID ${ch.channelId}] Đã dò được link: ${result.channelName} (${result.streams.length} luồng)`);
        validChannels.push(result);
      }
    }
  };

  await Promise.all(Array.from({ length: CONCURRENCY }, () => worker()));

  // 1. Thăm dò và chọn duy nhất 1 link chất lượng cao nhất cho mỗi kênh
  for (const ch of validChannels) {
    for (const st of ch.streams) {
      const probe = await probeM3u8Quality(st.url);
      const height = probe?.height || (st.url.includes('1080') ? 1080 : st.url.includes('720') ? 720 : 0);
      const bitrate = probe?.bitrate || 0;
      // Trọng số: Độ phân giải cao nhất (1080 > 720 > ...) -> Bitrate cao nhất -> Ưu tiên Direct Pre-Origin / Akamai / VTV
      let cdnBonus = 0;
      if (st.isDirectOrigin) cdnBonus = 100000;
      else if (st.cdn.includes('Akamai')) cdnBonus = 50000;
      else if (st.cdn.includes('VTV Digital')) cdnBonus = 30000;

      st.probe = probe;
      st.score = height * 10000000 + bitrate + cdnBonus;
    }

    // Sắp xếp các luồng của kênh này từ cao xuống thấp và CHỈ giữ lại 1 luồng tốt nhất
    ch.streams.sort((a, b) => b.score - a.score);
    ch.bestStream = ch.streams[0];
  }

  // 2. Sắp xếp thứ tự các kênh: Ưu tiên VTV từ 1 đến 10 trước, sau đó là các kênh khác
  validChannels.sort((a, b) => {
    const prioA = getChannelPriority(a.channelName);
    const prioB = getChannelPriority(b.channelName);
    if (prioA !== prioB) {
      return prioA - prioB;
    }
    // Nếu cùng thứ bậc ưu tiên, sắp xếp theo tên hoặc ID
    return a.channelName.localeCompare(b.channelName, 'vi');
  });

  // 3. Tạo nội dung file tvPremium.m3u
  const lines = ['#EXTM3U'];

  for (const ch of validChannels) {
    const st = ch.bestStream;
    if (!st) continue;

    const probe = st.probe;
    const resDisplay = probe?.resolutionStr ? probe.resolutionStr : '1080p';
    const brDisplay = probe?.bitrateKbps ? ` - ${probe.bitrateKbps}` : '';
    const qualityTag = ` (${resDisplay}${brDisplay} - ${st.cdn})`;
    const displayName = `${ch.channelName}${qualityTag}`;
    const cleanName = removeVietnameseTones(ch.channelName).toLowerCase().replace(/[^a-z0-9]/g, '');
    const tvgId = cleanName || `vtv${ch.channelId}`;

    lines.push(
      `#EXTINF:-1 tvg-id="${tvgId}" tvg-name="${ch.channelName}" tvg-logo="${ch.logo}" group-title="${ch.group}",${displayName}`
    );
    lines.push(st.url);
    lines.push('');
  }

    // BẢO VỆ: Không ghi đè nếu không cào được kênh nào
  if (validChannels.length === 0) {
    console.log(`[CẢNH BÁO] Không cào được kênh nào. Giữ nguyên file tvPremium.m3u cũ!`);
    return { scannedRange: '', channelsCount: 0, totalStreams: 0, channels: [] };
  }

  const finalContent = '\uFEFF' + lines.join('\r\n');
  fs.writeFileSync(OUTPUT_FILE, finalContent, 'utf8');

  console.log(
    `[${new Date().toISOString()}] Hoàn tất! Đã xuất ${validChannels.length} kênh (mỗi kênh 1 luồng cao nhất, ưu tiên VTV 1-10) vào: ${OUTPUT_FILE}`
  );

  return {
    scannedRange: `${startId} - ${endId}`,
    channelsCount: validChannels.length,
    totalStreams: validChannels.length,
    channels: validChannels.map((c) => ({
      name: c.channelName,
      priority: getChannelPriority(c.channelName),
      res: c.bestStream?.probe?.resolutionStr || 'HD',
      url: c.bestStream?.url,
    })),
    outputPath: OUTPUT_FILE,
  };
}

// Chạy trực tiếp nếu script được gọi qua command line
if (process.argv[1] && process.argv[1].endsWith('update-vtvgo.js')) {
  runVtvgoUpdate()
    .then((res) => {
      console.log('Kết quả xuất file tvPremium.m3u:', res);
      process.exit(0);
    })
    .catch((err) => {
      console.error('Lỗi khi quét VTVGo:', err);
      process.exit(1);
    });
}
