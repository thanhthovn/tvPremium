import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '..');
const OUTPUT_FILE = path.resolve(ROOT_DIR, 'tvPremium.m3u');

const CHANNELS = [
  { id: '1', name: 'VTV1', logo: 'https://vtvgo.vn/assets/images/logo-vtv1.png', group: 'VTV', defaultRes: '1080p' },
  { id: '2', name: 'VTV2', logo: 'https://vtvgo.vn/assets/images/logo-vtv2.png', group: 'VTV', defaultRes: '1080p' },
  { id: '3', name: 'VTV3', logo: 'https://vtvgo.vn/assets/images/logo-vtv3.png', group: 'VTV', defaultRes: '1080p' },
  { id: '4', name: 'VTV4', logo: 'https://vtvgo.vn/assets/images/logo-vtv4.png', group: 'VTV', defaultRes: '1080p' },
  { id: '5', name: 'VTV5', logo: 'https://vtvgo.vn/assets/images/logo-vtv5.png', group: 'VTV', defaultRes: '1080p' },
  { id: '13', name: 'VTV Cần Thơ', logo: 'https://vtvgo.vn/assets/images/logo-vtv6.png', group: 'VTV', defaultRes: '1080p' },
  { id: '7', name: 'VTV7', logo: 'https://vtvgo.vn/assets/images/logo-vtv7.png', group: 'VTV', defaultRes: '1080p' },
  { id: '8', name: 'VTV8', logo: 'https://vtvgo.vn/assets/images/logo-vtv8.png', group: 'VTV', defaultRes: '1080p' },
  { id: '9', name: 'VTV9', logo: 'https://vtvgo.vn/assets/images/logo-vtv9.png', group: 'VTV', defaultRes: '1080p' },
  { id: '6', name: 'VTV5 Tây Nam Bộ', logo: 'https://vtvgo.vn/assets/images/logo-vtv5.png', group: 'VTV', defaultRes: '720p' },
  { id: '11', name: 'VTV5 Tây Nguyên', logo: 'https://vtvgo.vn/assets/images/logo-vtv5.png', group: 'VTV', defaultRes: '720p' },
  { id: '17', name: 'Hà Nội 1', logo: 'https://vtvgo.vn/assets/images/channel_default.png', group: 'Truyền Hình Địa Phương', defaultRes: '720p' },
];

async function fetchVtvgoStreams(channelId) {
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
      signal: AbortSignal.timeout(10000),
    });

    if (!res.ok) return [];

    const json = await res.json();
    const streams = [];
    const sourceModes = json.data?.sourceModes || [];

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

    // Deduplicate by url
    const unique = [];
    const seen = new Set();
    for (const st of streams) {
      if (!seen.has(st.url)) {
        seen.add(st.url);
        unique.push(st);
      }
    }

    return unique;
  } catch (err) {
    console.warn(`Lỗi khi lấy kênh ${channelId}:`, err.message);
    return [];
  }
}

async function probeM3u8Quality(url) {
  try {
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
        'Referer': 'https://vtvgo.vn/',
      },
      signal: AbortSignal.timeout(6000),
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
    // Probe timeout or network issue
  }
  return null;
}

export async function runVtvgoUpdate() {
  console.log(`[${new Date().toISOString()}] Bắt đầu quét các kênh VTVGo...`);

  const lines = ['#EXTM3U'];
  let totalStreamsCount = 0;

  for (const ch of CHANNELS) {
    console.log(`Đang quét kênh ${ch.name} (id: ${ch.id})...`);
    let streams = await fetchVtvgoStreams(ch.id);

    // Fallback direct URL if API is busy
    if (streams.length === 0) {
      streams = [
        {
          url: `https://live-vtv-aws.vtvgo.vn/ch${ch.id}.m3u8`,
          cdn: 'AWS CloudFront CDN',
        },
      ];
    }

    for (const st of streams) {
      const probe = await probeM3u8Quality(st.url);
      const resDisplay = probe?.resolution ? probe.resolution : ch.defaultRes;
      const brDisplay = probe?.bitrate ? ` - ${probe.bitrate}` : '';
      const qualityTag = ` (${resDisplay}${brDisplay} - ${st.cdn})`;
      const displayName = `${ch.name} HD${qualityTag}`;

      lines.push(
        `#EXTINF:-1 tvg-id="${ch.name.toLowerCase().replace(/\s+/g, '')}" tvg-name="${ch.name}" tvg-logo="${ch.logo}" group-title="${ch.group}",${displayName}`
      );
      lines.push(st.url);
      lines.push('');
      totalStreamsCount++;
    }
  }

  const finalContent = '\uFEFF' + lines.join('\r\n');
  fs.writeFileSync(OUTPUT_FILE, finalContent, 'utf8');

  console.log(`[${new Date().toISOString()}] Đã cập nhật thành công ${totalStreamsCount} luồng vào file: ${OUTPUT_FILE}`);
  return {
    totalStreams: totalStreamsCount,
    channelsCount: CHANNELS.length,
    outputPath: OUTPUT_FILE,
  };
}

// Chạy trực tiếp nếu script được gọi qua command line
if (process.argv[1] && process.argv[1].endsWith('update-vtvgo.js')) {
  runVtvgoUpdate()
    .then((res) => {
      console.log('Quá trình quét hoàn tất thành công:', res);
      process.exit(0);
    })
    .catch((err) => {
      console.error('Lỗi khi quét VTVGo:', err);
      process.exit(1);
    });
}
