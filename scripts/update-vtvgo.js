import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '..');
const OUTPUT_FILE = path.resolve(ROOT_DIR, 'tvPremium.m3u');

// Cấu hình quét từ ID 1 đến 99 theo yêu cầu
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

    // Lọc trùng lặp URL
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

      if (resMatch) {
        const w = parseInt(resMatch[1], 10);
        const h = parseInt(resMatch[2], 10);
        if (h > bestHeight) {
          bestHeight = h;
          bestWidth = w;
        }
      }
      if (brMatch) {
        const br = parseInt(brMatch[1], 10);
        if (br > bestBitrate) {
          bestBitrate = br;
        }
      }
    }

    if (bestHeight > 0) {
      const kbps = bestBitrate > 0 ? `${Math.round(bestBitrate / 1000)}kbps` : '';
      const resStr = `${bestWidth}x${bestHeight}`;
      return { resolution: resStr, bitrate: kbps };
    }
  } catch {
    // Timeout hoặc lỗi manifest
  }
  return null;
}

/**
 * Tiến trình chính: Tự động quét từ SCAN_START_ID đến SCAN_END_ID (1 -> 99)
 */
export async function runVtvgoUpdate(startId = SCAN_START_ID, endId = SCAN_END_ID) {
  console.log(`[${new Date().toISOString()}] Bắt đầu tự động quét VTVGo từ ID ${startId} đến ID ${endId}...`);

  const ids = [];
  for (let i = startId; i <= endId; i++) {
    ids.push(i);
  }

  const validChannels = [];
  let currentIndex = 0;

  // Quét đa luồng (concurrency) để hoàn thành nhanh chóng trong vài giây
  const worker = async () => {
    while (currentIndex < ids.length) {
      const id = ids[currentIndex++];
      const result = await fetchVtvgoChannel(id);
      if (result && result.streams.length > 0) {
        console.log(`[ID ${id}] Tìm thấy kênh: ${result.channelName} (${result.streams.length} luồng m3u8)`);
        validChannels.push(result);
      }
    }
  };

  await Promise.all(Array.from({ length: CONCURRENCY }, () => worker()));

  // Sắp xếp các kênh theo số ID tăng dần
  validChannels.sort((a, b) => a.channelId - b.channelId);

  const lines = ['#EXTM3U'];
  let totalStreamsCount = 0;

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

  for (const ch of validChannels) {
    for (const st of ch.streams) {
      const probe = await probeM3u8Quality(st.url);
      const resDisplay = probe?.resolution ? probe.resolution : 'HD';
      const brDisplay = probe?.bitrate ? ` - ${probe.bitrate}` : '';
      const qualityTag = ` (${resDisplay}${brDisplay} - ${st.cdn})`;
      const displayName = `${ch.channelName}${qualityTag}`;
      const cleanName = removeVietnameseTones(ch.channelName).toLowerCase().replace(/[^a-z0-9]/g, '');
      const tvgId = cleanName || `vtv${ch.channelId}`;

      lines.push(
        `#EXTINF:-1 tvg-id="${tvgId}" tvg-name="${ch.channelName}" tvg-logo="${ch.logo}" group-title="${ch.group}",${displayName}`
      );
      lines.push(st.url);
      lines.push('');
      totalStreamsCount++;
    }
  }

  const finalContent = '\uFEFF' + lines.join('\r\n');
  fs.writeFileSync(OUTPUT_FILE, finalContent, 'utf8');

  console.log(
    `[${new Date().toISOString()}] Hoàn tất quét! Tìm thấy ${validChannels.length} kênh với ${totalStreamsCount} luồng m3u8. Đã ghi vào: ${OUTPUT_FILE}`
  );

  return {
    scannedRange: `${startId} - ${endId}`,
    channelsCount: validChannels.length,
    totalStreams: totalStreamsCount,
    channels: validChannels.map((c) => ({ id: c.channelId, name: c.channelName, streams: c.streams.length })),
    outputPath: OUTPUT_FILE,
  };
}

// Chạy trực tiếp nếu script được gọi qua command line
if (process.argv[1] && process.argv[1].endsWith('update-vtvgo.js')) {
  runVtvgoUpdate()
    .then((res) => {
      console.log('Kết quả quét VTVGo 1-99:', res);
      process.exit(0);
    })
    .catch((err) => {
      console.error('Lỗi khi quét VTVGo 1-99:', err);
      process.exit(1);
    });
}
