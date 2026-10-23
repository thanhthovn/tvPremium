import express from 'express';
import { createServer as createViteServer } from 'vite';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { runVtvgoUpdate } from './scripts/update-vtvgo.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function startServer() {
  const app = express();
  const PORT = Number(process.env.PORT) || 3000;

  app.use(express.json({ limit: '15mb' }));
  app.use(express.urlencoded({ extended: true, limit: '15mb' }));

  // Helper: Dean Edwards P.A.C.K.E.R unpacker
  function unpackJavaScript(code: string): string {
    const packerRegex = /eval\(function\(p,a,c,k,e,d\)\{[\s\S]*?\}\(([\s\S]*?)\)\)/g;
    let match;
    let unpackedTotal = '';

    while ((match = packerRegex.exec(code)) !== null) {
      try {
        const payload = match[1];
        // Split args: p, a, c, k, e, d
        // We use a safe regex-based evaluation without running arbitrary untrusted code
        const parts = payload.split(/,\s*/);
        if (parts.length >= 4) {
          // Extract dictionary and replace keywords
          const p = parts[0].replace(/^['"]|['"]$/g, '');
          const a = parseInt(parts[1], 10) || 62;
          const c = parseInt(parts[2], 10);
          const kStr = parts.slice(3).join(',');
          const kMatches = kStr.match(/['"](.*?)['"]\.split/);
          if (kMatches && kMatches[1]) {
            const k = kMatches[1].split('|');
            let result = p;
            for (let i = c - 1; i >= 0; i--) {
              if (k[i]) {
                const word = (i).toString(a);
                result = result.replace(new RegExp(`\\b${word}\\b`, 'g'), k[i]);
              }
            }
            unpackedTotal += '\n' + result;
          }
        }
      } catch {
        // Ignore unpack failure
      }
    }
    return unpackedTotal;
  }

  // Helper: Deep extract all m3u8 occurrences from text
  function extractM3u8FromText(text: string, baseUrl?: string): { url: string; sourceType: string }[] {
    const results: { url: string; sourceType: string }[] = [];
    const seen = new Set<string>();

    const addStream = (url: string, sourceType: string) => {
      let clean = url.replace(/\\\//g, '/').replace(/\\"/g, '"').trim();
      // Remove trailing quotes or brackets if matched greedily
      clean = clean.replace(/['"<>);]+$/, '');
      if (clean && !seen.has(clean)) {
        seen.add(clean);
        results.push({ url: clean, sourceType });
      }
    };

    // 1. Direct and escaped absolute URLs
    const absRegex = /(https?:[\/\\]{1,2}[^\s"'<>\\{}|^`]+?\.m3u8(?:\?[^\s"'<>\\{}|^`]*)?)/gi;
    let match;
    while ((match = absRegex.exec(text)) !== null) {
      addStream(match[1], 'direct-regex');
    }

    // 2. Relative URLs
    if (baseUrl) {
      try {
        const base = new URL(baseUrl);
        const relRegex = /["']([^"'<>\s]+\.m3u8(?:\?[^"'<>\s]*)?)["']/gi;
        while ((match = relRegex.exec(text)) !== null) {
          const rawRel = match[1].replace(/\\\//g, '/');
          try {
            const resolved = new URL(rawRel, base).toString();
            addStream(resolved, 'relative-regex');
          } catch {
            // Ignore
          }
        }
      } catch {
        // Base parsing failed
      }
    }

    // 3. URL-encoded m3u8 (e.g. %2F%2F...m3u8 or https%3A%2F%2F...%2Fmaster.m3u8)
    const encodedRegex = /(https?%3A%2F%2F[^\s"'<>]+?\.m3u8(?:%3F[^\s"'<>]*)?)/gi;
    while ((match = encodedRegex.exec(text)) !== null) {
      try {
        const decoded = decodeURIComponent(match[1]);
        addStream(decoded, 'url-decoded');
      } catch {
        // Ignore
      }
    }

    // 4. Unicode escapes (\u0068\u0074\u0074\u0070...)
    if (text.includes('\\u002f') || text.includes('\\u002F') || text.includes('\\u006d\\u0033\\u0075\\u0038')) {
      try {
        const unescaped = text.replace(/\\u([0-9a-fA-F]{4})/g, (_, code) => 
          String.fromCharCode(parseInt(code, 16))
        );
        const unescapedFound = extractM3u8FromText(unescaped, baseUrl);
        for (const s of unescapedFound) {
          addStream(s.url, 'unicode-unescaped');
        }
      } catch {
        // Ignore
      }
    }

    // 5. Look for base64 encoded m3u8
    const b64Regex = /([A-Za-z0-9+/=]{20,})/g;
    let bMatch;
    while ((bMatch = b64Regex.exec(text)) !== null) {
      try {
        const decoded = Buffer.from(bMatch[1], 'base64').toString('utf-8');
        if (decoded.includes('.m3u8')) {
          const subFound = extractM3u8FromText(decoded, baseUrl);
          for (const s of subFound) {
            addStream(s.url, 'base64-decoded');
          }
        }
      } catch {
        // Not valid base64
      }
    }

    // 6. Dean Edwards Packed JavaScript
    if (text.includes('eval(function(p,a,c,k,e,d)')) {
      const unpacked = unpackJavaScript(text);
      if (unpacked) {
        const unpackedFound = extractM3u8FromText(unpacked, baseUrl);
        for (const s of unpackedFound) {
          addStream(s.url, 'unpacked-js');
        }
      }
    }

    return results;
  }

  // API: Deep Server-side M3U8 extraction
  app.all('/api/extract-m3u8', async (req, res) => {
    const targetUrl = (req.method === 'POST' ? req.body.url : req.query.url) as string;

    if (!targetUrl || typeof targetUrl !== 'string') {
      return res.status(400).json({ error: 'Vui lòng cung cấp tham số url' });
    }

    let normalizedUrl = targetUrl.trim();
    if (!/^https?:\/\//i.test(normalizedUrl)) {
      normalizedUrl = 'https://' + normalizedUrl;
    }

    // Direct m3u8 URL entered
    if (normalizedUrl.toLowerCase().includes('.m3u8')) {
      let sourceTag = 'Direct M3U8';
      if (normalizedUrl.includes('live-vtv-aws')) sourceTag = 'VTVGo Live (AWS CloudFront CDN)';
      else if (normalizedUrl.includes('akamaized.net')) sourceTag = 'VTVGo Live (Akamai CDN)';
      else if (normalizedUrl.includes('vtvgolive')) sourceTag = 'VTVGo Live (VTV Digital CDN)';
      else if (normalizedUrl.includes('vnetwork')) sourceTag = 'VTVGo Live (VNetwork CDN)';

      return res.json({
        success: true,
        streams: [{ url: normalizedUrl, sourceType: sourceTag }],
        count: 1,
        source: normalizedUrl,
        message: `Đã nhận diện liên kết .m3u8 (${sourceTag})`
      });
    }

    // Special Platform: VTVGo (https://vtvgo.vn/channel/13, vtvgo.vn/channel/...)
    if (normalizedUrl.includes('vtvgo.vn')) {
      try {
        let channelId = '13';
        const channelMatch = normalizedUrl.match(/\/channel\/([a-zA-Z0-9]+)/i);
        if (channelMatch) {
          channelId = channelMatch[1];
        } else {
          const idMatch = normalizedUrl.match(/[-_](\d+)\.html/i);
          if (idMatch) channelId = idMatch[1];
        }

        const deviceId = crypto.randomUUID();
        const vtvApiUrl = 'https://api.vtvdigital.org/live-channel/v21.0/playback/source';
        const vtvRes = await fetch(vtvApiUrl, {
          method: 'POST',
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
            'Referer': 'https://vtvgo.vn/',
            'Origin': 'https://vtvgo.vn',
            'Content-Type': 'application/json',
            'Accept': 'application/json'
          },
          body: JSON.stringify({
            channelId: String(channelId),
            platform: 'webPC',
            deviceId: deviceId
          }),
          signal: AbortSignal.timeout(10000)
        });

        if (vtvRes.ok) {
          const vtvData: any = await vtvRes.json();
          const channelName = vtvData.data?.channelName || `VTV (Kênh ${channelId})`;
          const vtvStreams: { url: string; sourceType: string }[] = [];

          const sourceModes = vtvData.data?.sourceModes || [];
          for (const mode of sourceModes) {
            const multiSource = mode.multiSource || [];
            for (const ms of multiSource) {
              const sources = ms.sources || [];
              for (const s of sources) {
                if (s.url && s.url.includes('.m3u8')) {
                  let cdnLabel = 'Akamai CDN';
                  if (s.url.includes('live-vtv-aws') || s.url.includes('aws')) cdnLabel = 'AWS CloudFront CDN';
                  else if (s.url.includes('vnetwork')) cdnLabel = 'VNetwork CDN';
                  else if (s.url.includes('vtvgolive')) cdnLabel = 'VTV Digital CDN';

                  vtvStreams.push({
                    url: s.url,
                    sourceType: `${channelName} (${cdnLabel})`
                  });
                }
              }
            }
          }

          if (vtvStreams.length > 0) {
            return res.json({
              success: true,
              streams: vtvStreams,
              count: vtvStreams.length,
              source: normalizedUrl,
              pageTitle: `VTVGo Trực Tiếp - ${channelName}`,
              channelNumber: parseInt(channelId, 10) || 1,
              channelName: channelName,
              message: `Đã kết nối và lấy thành công luồng phát trực tiếp của ${channelName}!`
            });
          }
        }
      } catch (vtvErr: any) {
        console.error('VTVGo custom handler error:', vtvErr.message);
      }
    }

    // Special Platform: TV360 (https://tv360.vn/tv/..., tv360.vn/...)
    if (normalizedUrl.includes('tv360.vn')) {
      try {
        let channelId = '2';
        let channelName = '';
        let channelSlug = '';
        let seoTitle = '';
        let displayNumber = 1;

        // Parse query params if available (e.g. ?ch=2)
        try {
          const parsedTvUrl = new URL(normalizedUrl);
          const qCh = parsedTvUrl.searchParams.get('ch') || parsedTvUrl.searchParams.get('id');
          if (qCh) channelId = qCh;
          const segments = parsedTvUrl.pathname.split('/').filter(Boolean);
          if (segments.length > 0) {
            channelSlug = segments[segments.length - 1].toLowerCase();
          }
        } catch {}

        // Fetch TV360 page to extract SSR metadata in __NEXT_DATA__
        try {
          const tvPageRes = await fetch(normalizedUrl, {
            headers: {
              'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
              'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
              'Accept-Language': 'vi-VN,vi;q=0.9,en-US;q=0.8,en;q=0.7',
              'Referer': 'https://tv360.vn/'
            },
            signal: AbortSignal.timeout(10000)
          });

          if (tvPageRes.ok) {
            const html = await tvPageRes.text();
            const nextMatch = html.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
            if (nextMatch) {
              const nextData = JSON.parse(nextMatch[1]);
              const detail = nextData.props?.pageProps?.liveDetail?.detail;
              if (detail) {
                channelName = detail.name || '';
                if (detail.slug) channelSlug = detail.slug.toLowerCase();
                if (detail.id) channelId = String(detail.id);
                seoTitle = detail.seoTitle || detail.description || '';
                if (detail.shortcutKeyboard) {
                  const sk = parseInt(detail.shortcutKeyboard, 10);
                  if (!isNaN(sk)) displayNumber = sk;
                } else if (detail.id) {
                  const idNum = parseInt(detail.id, 10);
                  if (!isNaN(idNum)) displayNumber = idNum;
                }
              }
            }
          }
        } catch (fetchErr: any) {
          console.error('TV360 page fetch error:', fetchErr.message);
        }

        if (!channelName && channelSlug) {
          channelName = channelSlug.toUpperCase();
        }

        const tv360Streams: {
          url: string;
          sourceType: string;
          channelNumber?: number;
          channelName?: string;
          pageTitle?: string;
        }[] = [];

        // 1. Attempt TV360 Direct Stream API (Viettel CDN)
        try {
          const tSec = Math.floor(Date.now() / 1000);
          const tv360ApiUrl = `https://tv360.vn/public/v1/composite/get-link?id=${channelId}&type=LIVE&t=${tSec}&secured=true`;
          const apiRes = await fetch(tv360ApiUrl, {
            headers: {
              'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
              'Referer': normalizedUrl,
              'Origin': 'https://tv360.vn',
              'Accept': 'application/json, text/plain, */*'
            },
            signal: AbortSignal.timeout(5000)
          });
          if (apiRes.ok) {
            const apiData: any = await apiRes.json();
            if (apiData?.data) {
              const directUrl = apiData.data.urlStreaming || apiData.data.url || apiData.data.streamUrl;
              if (directUrl && typeof directUrl === 'string' && directUrl.includes('.m3u8')) {
                tv360Streams.push({
                  url: directUrl,
                  sourceType: `${channelName || 'TV360'} (TV360 Viettel CDN)`,
                  channelNumber: displayNumber,
                  channelName: channelName || 'TV360 Live',
                  pageTitle: `TV360 - ${channelName || 'Trực Tiếp'}`
                });
              }
            }
          }
        } catch (apiErr: any) {
          console.error('TV360 direct API error:', apiErr.message);
        }

        // 2. High-availability resolver for VTV / National Channels
        const slugLower = (channelSlug || '').toLowerCase();
        const nameLower = (channelName || '').toLowerCase();
        let mappedVtvChannelId: string | null = null;

        if (slugLower === 'vtv1' || nameLower.includes('vtv1')) mappedVtvChannelId = '1';
        else if (slugLower === 'vtv2' || nameLower.includes('vtv2')) mappedVtvChannelId = '2';
        else if (slugLower === 'vtv3' || nameLower.includes('vtv3')) mappedVtvChannelId = '3';
        else if (slugLower === 'vtv4' || nameLower.includes('vtv4')) mappedVtvChannelId = '4';
        else if (slugLower === 'vtv5' || nameLower.includes('vtv5')) mappedVtvChannelId = '5';
        else if (slugLower === 'vtv6' || slugLower.includes('can-tho') || nameLower.includes('vtv6') || nameLower.includes('cần thơ')) mappedVtvChannelId = '13';
        else if (slugLower === 'vtv7' || nameLower.includes('vtv7')) mappedVtvChannelId = '7';
        else if (slugLower === 'vtv8' || nameLower.includes('vtv8')) mappedVtvChannelId = '8';
        else if (slugLower === 'vtv9' || nameLower.includes('vtv9')) mappedVtvChannelId = '9';
        else if (slugLower.includes('tay-nam-bo') || nameLower.includes('tây nam bộ')) mappedVtvChannelId = '7';
        else if (slugLower.includes('tay-nguyen') || nameLower.includes('tây nguyên')) mappedVtvChannelId = '11';
        else if (slugLower === 'vtv10' || nameLower.includes('vtv10')) mappedVtvChannelId = '6';
        else if (slugLower.includes('ha-noi-2') || nameLower.includes('hà nội 2')) mappedVtvChannelId = '17';

        if (mappedVtvChannelId) {
          try {
            const vtvRes = await fetch('https://api.vtvdigital.org/live-channel/v21.0/playback/source', {
              method: 'POST',
              headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
                'Referer': 'https://vtvgo.vn/',
                'Origin': 'https://vtvgo.vn',
                'Content-Type': 'application/json',
                'Accept': 'application/json'
              },
              body: JSON.stringify({
                channelId: mappedVtvChannelId,
                platform: 'webPC',
                deviceId: crypto.randomUUID()
              }),
              signal: AbortSignal.timeout(10000)
            });

            if (vtvRes.ok) {
              const vtvData: any = await vtvRes.json();
              const vtvName = vtvData.data?.channelName || channelName || `VTV (${channelSlug.toUpperCase()})`;
              const sourceModes = vtvData.data?.sourceModes || [];
              for (const mode of sourceModes) {
                const multiSource = mode.multiSource || [];
                for (const ms of multiSource) {
                  const sources = ms.sources || [];
                  for (const s of sources) {
                    if (s.url && s.url.includes('.m3u8')) {
                      let cdnLabel = 'Akamai CDN';
                      if (s.url.includes('live-vtv-aws') || s.url.includes('aws') || s.url.includes('cloudfront')) cdnLabel = 'AWS CloudFront CDN';
                      else if (s.url.includes('vnetwork')) cdnLabel = 'VNetwork CDN';
                      else if (s.url.includes('vtvgolive') || s.url.includes('vtvdigital')) cdnLabel = 'VTV Digital CDN';

                      tv360Streams.push({
                        url: s.url,
                        sourceType: `${vtvName} (${cdnLabel})`,
                        channelNumber: displayNumber,
                        channelName: vtvName,
                        pageTitle: `TV360 - ${vtvName}`
                      });
                    }
                  }
                }
              }
            }
          } catch (vtvErr: any) {
            console.error('TV360 VTV resolver error:', vtvErr.message);
          }
        }

        // Deduplicate streams by url
        const uniqueTv360Streams = Array.from(new Map(tv360Streams.map(s => [s.url, s])).values());

        if (uniqueTv360Streams.length > 0) {
          return res.json({
            success: true,
            streams: uniqueTv360Streams,
            count: uniqueTv360Streams.length,
            source: normalizedUrl,
            pageTitle: `TV360 - ${channelName || 'Trực Tiếp'}`,
            channelNumber: displayNumber,
            channelName: channelName || 'TV360 Live',
            message: `Đã kết nối và lấy thành công ${uniqueTv360Streams.length} luồng phát trực tiếp của ${channelName} trên TV360!`
          });
        }
      } catch (tv360OverallErr: any) {
        console.error('TV360 custom handler overall error:', tv360OverallErr.message);
      }
    }

    // Special Platform: FPT Play (https://fptplay.vn/xem-truyen-hinh/..., fptplay.vn/...)
    if (normalizedUrl.includes('fptplay.vn')) {
      try {
        let channelSlug = '';
        let channelName = '';
        let seoTitle = '';
        let displayNumber = 1;

        try {
          const parsedFptUrl = new URL(normalizedUrl);
          const segments = parsedFptUrl.pathname.split('/').filter(Boolean);
          if (segments.length > 0) {
            channelSlug = segments[segments.length - 1].toLowerCase();
          }
        } catch {}

        // Fetch FPT Play page to extract Next.js SSR metadata in __NEXT_DATA__
        try {
          const fptPageRes = await fetch(normalizedUrl, {
            headers: {
              'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
              'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
              'Accept-Language': 'vi-VN,vi;q=0.9,en-US;q=0.8,en;q=0.7',
              'Referer': 'https://fptplay.vn/'
            },
            signal: AbortSignal.timeout(10000)
          });

          if (fptPageRes.ok) {
            const html = await fptPageRes.text();
            const nextMatch = html.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
            if (nextMatch) {
              const nextData = JSON.parse(nextMatch[1]);
              const seoProps = nextData.props?.pageProps?.seoProps;
              if (seoProps) {
                seoTitle = seoProps.title || '';
                if (seoTitle) {
                  channelName = seoTitle
                    .replace(/\s*[-|–].*$/i, '')
                    .replace(/\s*(?:Online|Trực Tiếp).*$/i, '')
                    .trim();
                }
              }
              const queryId = nextData.query?.id;
              if (queryId && typeof queryId === 'string') {
                channelSlug = queryId.toLowerCase();
              }
            }
          }
        } catch (fetchErr: any) {
          console.error('FPT Play page fetch error:', fetchErr.message);
        }

        const slugClean = channelSlug.replace(/-hd$/i, '').toLowerCase();

        // Detect displayNumber
        const vtvMatch = slugClean.match(/vtv(\d+)/i) || channelSlug.match(/vtv(\d+)/i);
        if (vtvMatch) {
          displayNumber = parseInt(vtvMatch[1], 10);
          if (!channelName) channelName = `VTV${displayNumber}`;
        } else {
          const numMatch = channelName.match(/\d+/);
          if (numMatch) displayNumber = parseInt(numMatch[0], 10);
        }

        if (!channelName) {
          channelName = slugClean.toUpperCase();
        }

        const fptStreams: {
          url: string;
          sourceType: string;
          channelNumber?: number;
          channelName?: string;
          pageTitle?: string;
        }[] = [];

        // High-availability resolver for VTV / National Channels
        const nameLower = channelName.toLowerCase();
        let mappedVtvChannelId: string | null = null;

        if (slugClean === 'vtv1' || nameLower.includes('vtv1')) mappedVtvChannelId = '1';
        else if (slugClean === 'vtv2' || nameLower.includes('vtv2')) mappedVtvChannelId = '2';
        else if (slugClean === 'vtv3' || nameLower.includes('vtv3')) mappedVtvChannelId = '3';
        else if (slugClean === 'vtv4' || nameLower.includes('vtv4')) mappedVtvChannelId = '4';
        else if (slugClean === 'vtv5' || nameLower.includes('vtv5')) mappedVtvChannelId = '5';
        else if (slugClean === 'vtv6' || slugClean.includes('can-tho') || nameLower.includes('vtv6') || nameLower.includes('cần thơ')) mappedVtvChannelId = '13';
        else if (slugClean === 'vtv7' || nameLower.includes('vtv7')) mappedVtvChannelId = '7';
        else if (slugClean === 'vtv8' || nameLower.includes('vtv8')) mappedVtvChannelId = '8';
        else if (slugClean === 'vtv9' || nameLower.includes('vtv9')) mappedVtvChannelId = '9';
        else if (slugClean.includes('tay-nam-bo') || nameLower.includes('tây nam bộ')) mappedVtvChannelId = '7';
        else if (slugClean.includes('tay-nguyen') || nameLower.includes('tây nguyên')) mappedVtvChannelId = '11';
        else if (slugClean === 'vtv10' || nameLower.includes('vtv10')) mappedVtvChannelId = '6';
        else if (slugClean.includes('ha-noi-2') || nameLower.includes('hà nội 2')) mappedVtvChannelId = '17';

        if (mappedVtvChannelId) {
          try {
            const vtvRes = await fetch('https://api.vtvdigital.org/live-channel/v21.0/playback/source', {
              method: 'POST',
              headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
                'Referer': 'https://vtvgo.vn/',
                'Origin': 'https://vtvgo.vn',
                'Content-Type': 'application/json',
                'Accept': 'application/json'
              },
              body: JSON.stringify({
                channelId: mappedVtvChannelId,
                platform: 'webPC',
                deviceId: crypto.randomUUID()
              }),
              signal: AbortSignal.timeout(10000)
            });

            if (vtvRes.ok) {
              const vtvData: any = await vtvRes.json();
              const vtvName = vtvData.data?.channelName || channelName || `VTV${displayNumber}`;
              const sourceModes = vtvData.data?.sourceModes || [];
              for (const mode of sourceModes) {
                const multiSource = mode.multiSource || [];
                for (const ms of multiSource) {
                  const sources = ms.sources || [];
                  for (const s of sources) {
                    if (s.url && s.url.includes('.m3u8')) {
                      let cdnLabel = 'Akamai CDN';
                      if (s.url.includes('live-vtv-aws') || s.url.includes('aws') || s.url.includes('cloudfront')) cdnLabel = 'AWS CloudFront CDN';
                      else if (s.url.includes('vnetwork')) cdnLabel = 'VNetwork CDN';
                      else if (s.url.includes('vtvgolive') || s.url.includes('vtvdigital')) cdnLabel = 'VTV Digital CDN';

                      fptStreams.push({
                        url: s.url,
                        sourceType: `${vtvName} (${cdnLabel})`,
                        channelNumber: displayNumber,
                        channelName: vtvName,
                        pageTitle: `FPT Play - ${vtvName}`
                      });
                    }
                  }
                }
              }
            }
          } catch (vtvErr: any) {
            console.error('FPT Play VTV resolver error:', vtvErr.message);
          }
        }

        // Deduplicate streams by url
        const uniqueFptStreams = Array.from(new Map(fptStreams.map(s => [s.url, s])).values());

        if (uniqueFptStreams.length > 0) {
          return res.json({
            success: true,
            streams: uniqueFptStreams,
            count: uniqueFptStreams.length,
            source: normalizedUrl,
            pageTitle: `FPT Play - ${channelName || 'Trực Tiếp'}`,
            channelNumber: displayNumber,
            channelName: channelName || `Kênh ${displayNumber}`,
            message: `Đã kết nối và lấy thành công ${uniqueFptStreams.length} luồng phát trực tiếp của ${channelName} trên FPT Play!`
          });
        }
      } catch (fptOverallErr: any) {
        console.error('FPT Play custom handler overall error:', fptOverallErr.message);
      }
    }

    try {
      const headers = {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
        'Accept-Language': 'vi-VN,vi;q=0.9,en-US;q=0.8,en;q=0.7',
        'Referer': normalizedUrl,
        'Cache-Control': 'no-cache',
        'Sec-Ch-Ua': '"Chromium";v="124", "Google Chrome";v="124"',
        'Sec-Ch-Ua-Mobile': '?0',
        'Sec-Ch-Ua-Platform': '"Windows"',
        'Sec-Fetch-Dest': 'document',
        'Sec-Fetch-Mode': 'navigate',
        'Sec-Fetch-Site': 'none',
        'Sec-Fetch-User': '?1',
        'Upgrade-Insecure-Requests': '1',
      };

      const response = await fetch(normalizedUrl, {
        headers,
        redirect: 'follow',
        signal: AbortSignal.timeout(12000),
      });

      const responseText = await response.text();
      const finalUrl = response.url || normalizedUrl;

      // Extract title
      const titleMatch = responseText.match(/<title[^>]*>([^<]+)<\/title>/i);
      const pageTitle = titleMatch ? titleMatch[1].trim() : '';

      // 1. Extract from main HTML
      let foundStreams = extractM3u8FromText(responseText, finalUrl);

      // 2. Scan for embedded video player iframes
      const iframeRegex = /<iframe[^>]+src=["']([^"']+)["']/gi;
      const iframeUrls: string[] = [];
      let iMatch;
      while ((iMatch = iframeRegex.exec(responseText)) !== null) {
        try {
          const resolvedIframe = new URL(iMatch[1], finalUrl).toString();
          if (!resolvedIframe.startsWith('chrome-extension') && !resolvedIframe.includes('about:blank')) {
            iframeUrls.push(resolvedIframe);
          }
        } catch {
          // Ignore
        }
      }

      // If needed, fetch top embedded iframes
      if (foundStreams.length === 0 && iframeUrls.length > 0) {
        const topIframes = iframeUrls.slice(0, 4);
        for (const ifrUrl of topIframes) {
          try {
            const ifrRes = await fetch(ifrUrl, {
              headers: { ...headers, Referer: finalUrl },
              signal: AbortSignal.timeout(6000)
            });
            if (ifrRes.ok) {
              const ifrText = await ifrRes.text();
              const subFound = extractM3u8FromText(ifrText, ifrUrl);
              for (const s of subFound) {
                foundStreams.push({ ...s, sourceType: 'iframe-player' });
              }
            }
          } catch {
            // Ignore
          }
        }
      }

      // 3. Scan for linked internal scripts (e.g. player config scripts) if still not found
      if (foundStreams.length === 0) {
        const scriptSrcRegex = /<script[^>]+src=["']([^"']+\.js(?:\?[^"']*)?)["']/gi;
        const scriptUrls: string[] = [];
        let sMatch;
        const parsedBase = new URL(finalUrl);
        while ((sMatch = scriptSrcRegex.exec(responseText)) !== null) {
          try {
            const resolved = new URL(sMatch[1], finalUrl);
            // Only fetch scripts from same origin or player CDNs
            if (resolved.origin === parsedBase.origin || resolved.pathname.includes('player')) {
              scriptUrls.push(resolved.toString());
            }
          } catch {
            // Ignore
          }
        }

        // Fetch top relevant scripts
        const topScripts = scriptUrls.slice(0, 3);
        for (const sUrl of topScripts) {
          try {
            const sRes = await fetch(sUrl, {
              headers: { ...headers, Referer: finalUrl },
              signal: AbortSignal.timeout(5000)
            });
            if (sRes.ok) {
              const sText = await sRes.text();
              const scriptFound = extractM3u8FromText(sText, sUrl);
              for (const sf of scriptFound) {
                foundStreams.push({ ...sf, sourceType: 'external-script' });
              }
            }
          } catch {
            // Ignore
          }
        }
      }

      // Deduplicate
      const uniqueStreams = Array.from(new Map(foundStreams.map(s => [s.url, s])).values());

      return res.json({
        success: true,
        streams: uniqueStreams,
        count: uniqueStreams.length,
        source: finalUrl,
        pageTitle,
        iframesFound: iframeUrls.length,
        httpStatus: response.status,
      });

    } catch (err: any) {
      return res.status(500).json({
        success: false,
        error: `Không thể kết nối đến máy chủ: ${err.message || 'Lỗi không xác định'}`,
        suggestion: 'Trang web có thể dùng Cloudflare chặn bot hoặc yêu cầu xác thực.'
      });
    }
  });

  // API: Proxy M3U8 Manifest & Video Segments
  app.get('/api/proxy-m3u8', async (req, res) => {
    const targetUrl = req.query.url as string;
    let referer = (req.query.referer as string) || targetUrl;
    if (targetUrl && (targetUrl.includes('akamaized.net') || targetUrl.includes('vtv') || targetUrl.includes('vtvdigital'))) {
      referer = 'https://vtvgo.vn/';
    } else if (targetUrl && (targetUrl.includes('tv360') || targetUrl.includes('viettel'))) {
      referer = 'https://tv360.vn/';
    } else if (targetUrl && (targetUrl.includes('fptplay') || targetUrl.includes('fpt'))) {
      referer = 'https://fptplay.vn/';
    }

    if (!targetUrl) {
      return res.status(400).send('Missing url parameter');
    }

    try {
      const parsedUrl = new URL(targetUrl);
      const upstreamRes = await fetch(parsedUrl.toString(), {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
          'Referer': referer,
          'Origin': parsedUrl.origin,
          'Accept': '*/*',
        },
        signal: AbortSignal.timeout(15000),
      });

      const contentType = upstreamRes.headers.get('content-type') || 'application/vnd.apple.mpegurl';
      
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', '*');
      res.setHeader('Content-Type', contentType);

      if (contentType.includes('mpegurl') || targetUrl.includes('.m3u8')) {
        const manifestText = await upstreamRes.text();
        const baseHref = parsedUrl.origin + parsedUrl.pathname.substring(0, parsedUrl.pathname.lastIndexOf('/') + 1);

        const lines = manifestText.split('\n');
        const rewritten = lines.map((line) => {
          const trimmed = line.trim();
          if (!trimmed || trimmed.startsWith('#')) {
            if (trimmed.includes('URI="')) {
              return trimmed.replace(/URI="([^"]+)"/, (_, uri) => {
                const fullKeyUrl = uri.startsWith('http') ? uri : new URL(uri, baseHref).toString();
                return `URI="/api/proxy-m3u8?url=${encodeURIComponent(fullKeyUrl)}&referer=${encodeURIComponent(referer)}"`;
              });
            }
            return line;
          }
          const fullSegmentUrl = trimmed.startsWith('http') ? trimmed : new URL(trimmed, baseHref).toString();
          return `/api/proxy-m3u8?url=${encodeURIComponent(fullSegmentUrl)}&referer=${encodeURIComponent(referer)}`;
        }).join('\n');

        return res.send(rewritten);
      } else {
        const arrayBuffer = await upstreamRes.arrayBuffer();
        return res.send(Buffer.from(arrayBuffer));
      }

    } catch (err: any) {
      return res.status(500).send(`Proxy Error: ${err.message}`);
    }
  });

  // API: Save M3U Playlist to project root (e.g. tvPremium.m3u)
  app.post('/api/save-playlist', (req, res) => {
    try {
      const { filename = 'tvPremium.m3u', content, lines } = req.body;
      let finalContent = '';
      if (typeof content === 'string') {
        finalContent = content;
      } else if (Array.isArray(lines)) {
        finalContent = lines.join('\r\n');
      } else {
        return res.status(400).json({ success: false, error: 'Dữ liệu danh sách phát không hợp lệ' });
      }

      // Ensure UTF-8 BOM
      if (!finalContent.startsWith('\uFEFF')) {
        finalContent = '\uFEFF' + finalContent;
      }

      const safeFilename = 'tvPremium.m3u';
      const targetPath = path.resolve(__dirname, safeFilename);
      fs.writeFileSync(targetPath, finalContent, 'utf8');

      const stats = fs.statSync(targetPath);
      const channelCount = (finalContent.match(/#EXTINF/gi) || []).length;

      return res.json({
        success: true,
        filename: safeFilename,
        size: stats.size,
        updatedAt: stats.mtime,
        channelCount,
        message: `Đã lưu thành công ${channelCount} kênh vào file ${safeFilename} trong thư mục dự án!`
      });
    } catch (err: any) {
      return res.status(500).json({ success: false, error: err.message || 'Lỗi khi lưu file' });
    }
  });

  // API: Get tvPremium.m3u status
  app.get('/api/playlist-status', (req, res) => {
    try {
      const targetPath = path.resolve(__dirname, 'tvPremium.m3u');
      if (fs.existsSync(targetPath)) {
        const stats = fs.statSync(targetPath);
        const content = fs.readFileSync(targetPath, 'utf8');
        const channelCount = (content.match(/#EXTINF/gi) || []).length;
        return res.json({
          exists: true,
          filename: 'tvPremium.m3u',
          size: stats.size,
          updatedAt: stats.mtime,
          channelCount,
        });
      }
      return res.json({ exists: false, filename: 'tvPremium.m3u' });
    } catch (err: any) {
      return res.status(500).json({ exists: false, error: err.message });
    }
  });

  // API: Auto-Save local tvPremium.m3u & Sync to GitHub (create or replace)
  app.post('/api/github-sync', async (req, res) => {
    try {
      const {
        token,
        repo = 'thanhthovn/tvPremium',
        branch = 'main',
        filePath = 'tvPremium.m3u',
        content,
        lines,
        commitMessage,
      } = req.body;

      // 1. Prepare UTF-8 BOM M3U content
      let finalContent = '';
      if (typeof content === 'string') {
        finalContent = content;
      } else if (Array.isArray(lines)) {
        finalContent = lines.join('\r\n');
      } else {
        return res.status(400).json({ success: false, error: 'Dữ liệu danh sách phát không hợp lệ' });
      }

      if (!finalContent.startsWith('\uFEFF')) {
        finalContent = '\uFEFF' + finalContent;
      }

      // 2. Always auto-save to local workspace first
      const targetPath = path.resolve(__dirname, 'tvPremium.m3u');
      fs.writeFileSync(targetPath, finalContent, 'utf8');
      const stats = fs.statSync(targetPath);
      const channelCount = (finalContent.match(/#EXTINF/gi) || []).length;

      // 3. If no GitHub token provided, return local save success
      if (!token || typeof token !== 'string' || !token.trim()) {
        return res.json({
          success: true,
          localSaved: true,
          githubSynced: false,
          channelCount,
          updatedAt: stats.mtime,
          message: `Đã tự động lưu ${channelCount} kênh vào file tvPremium.m3u trong dự án!`,
        });
      }

      // 4. Clean repo string (handles "user/repo" or "https://github.com/user/repo")
      const repoFullName = repo.trim().replace(/^https?:\/\/github\.com\//i, '').replace(/\.git$/i, '');
      if (!repoFullName.includes('/')) {
        return res.status(400).json({
          success: false,
          localSaved: true,
          error: 'Tên repository không hợp lệ. Định dạng chuẩn: username/repo-name (ví dụ: thanhthovn/tvPremium)',
        });
      }

      const cleanBranch = (branch || 'main').trim();
      const targetFilePath = (filePath || 'tvPremium.m3u').trim();

      // 5. Fetch existing file SHA on GitHub (if it exists) to allow replacement / update
      let existingSha: string | null = null;
      const getFileUrl = `https://api.github.com/repos/${repoFullName}/contents/${targetFilePath}?ref=${encodeURIComponent(cleanBranch)}`;

      const checkRes = await fetch(getFileUrl, {
        headers: {
          'Authorization': `Bearer ${token.trim()}`,
          'Accept': 'application/vnd.github.v3+json',
          'User-Agent': 'AIStudio-M3U-AutoSync',
        },
      });

      if (checkRes.ok) {
        const fileInfo: any = await checkRes.json();
        existingSha = fileInfo.sha || null;
      } else if (checkRes.status !== 404) {
        const errData: any = await checkRes.json().catch(() => ({}));
        const errMsg = errData.message || checkRes.statusText;
        return res.status(checkRes.status).json({
          success: false,
          localSaved: true,
          error: `GitHub API error (${checkRes.status}): ${errMsg}. Vui lòng kiểm tra lại Token hoặc quyền truy cập Repository.`,
        });
      }

      // 6. Push to GitHub using PUT /repos/:owner/:repo/contents/:path
      const putFileUrl = `https://api.github.com/repos/${repoFullName}/contents/${targetFilePath}`;
      const base64Content = Buffer.from(finalContent, 'utf8').toString('base64');
      const finalMsg = commitMessage || `Auto-update ${targetFilePath} (${channelCount} channels)`;

      const putBody: any = {
        message: finalMsg,
        content: base64Content,
        branch: cleanBranch,
      };
      if (existingSha) {
        putBody.sha = existingSha;
      }

      const putRes = await fetch(putFileUrl, {
        method: 'PUT',
        headers: {
          'Authorization': `Bearer ${token.trim()}`,
          'Accept': 'application/vnd.github.v3+json',
          'Content-Type': 'application/json',
          'User-Agent': 'AIStudio-M3U-AutoSync',
        },
        body: JSON.stringify(putBody),
      });

      if (!putRes.ok) {
        const errData: any = await putRes.json().catch(() => ({}));
        return res.status(putRes.status).json({
          success: false,
          localSaved: true,
          githubSynced: false,
          error: `Không thể đẩy lên GitHub (${putRes.status}): ${errData.message || putRes.statusText}`,
        });
      }

      const putData: any = await putRes.json();

      return res.json({
        success: true,
        localSaved: true,
        githubSynced: true,
        channelCount,
        repo: repoFullName,
        branch: cleanBranch,
        sha: putData.content?.sha,
        commitUrl: putData.commit?.html_url,
        downloadUrl: putData.content?.download_url,
        message: `Đã tự động lưu & đồng bộ ${channelCount} kênh lên GitHub (${repoFullName}/${targetFilePath}) thành công!`,
      });

    } catch (err: any) {
      return res.status(500).json({
        success: false,
        localSaved: true,
        error: `Lỗi khi đồng bộ GitHub: ${err.message || 'Lỗi không xác định'}`,
      });
    }
  });

  // API & Static: Serve tvPremium.m3u directly (IPTV stream format)
  app.get(['/tvPremium.m3u', '/api/playlist/tvPremium.m3u'], (req, res) => {
    const targetPath = path.resolve(__dirname, 'tvPremium.m3u');
    if (fs.existsSync(targetPath)) {
      res.setHeader('Content-Type', 'application/vnd.apple.mpegurl; charset=utf-8');
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Content-Disposition', 'inline; filename="tvPremium.m3u"');
      return res.sendFile(targetPath);
    }
    return res.status(404).send('#EXTM3U\n# File tvPremium.m3u chua duoc tao. Vui long scan va luu tu giao dien.');
  });

  // ===== BACKGROUND SCHEDULER: 01:00 AM & 13:00 PM (Asia/Ho_Chi_Minh) =====
  let lastScheduleRunDate: string = '';
  let isScheduleScanning: boolean = false;
  let scheduleLogs: Array<{ time: string; message: string; success: boolean }> = [];

  function addScheduleLog(message: string, success = true) {
    const vnTime = new Date().toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' });
    scheduleLogs.unshift({ time: vnTime, message, success });
    if (scheduleLogs.length > 20) scheduleLogs.pop();
    console.log(`[Scheduler ${vnTime}] ${message}`);
  }

  async function triggerScheduledVtvgoScan(source: string = 'Schedule') {
    if (isScheduleScanning) {
      return { success: false, message: 'Đang có một tiến trình quét VTVGo chạy ngầm.' };
    }
    isScheduleScanning = true;
    addScheduleLog(`Bắt đầu tiến trình quét tự động VTVGo (${source})...`);
    try {
      const scanResult = await runVtvgoUpdate();
      addScheduleLog(`Quét VTVGo thành công: ${scanResult.totalStreams} luồng được cập nhật vào tvPremium.m3u.`);

      // Check if GitHub auto-sync config exists
      const configPath = path.resolve(__dirname, 'server-config.json');
      let ghToken = process.env.GITHUB_TOKEN || '';
      let ghRepo = 'thanhthovn/tvPremium';
      let ghBranch = 'main';

      if (fs.existsSync(configPath)) {
        try {
          const cfg = JSON.parse(fs.readFileSync(configPath, 'utf8'));
          if (cfg.ghToken) ghToken = cfg.ghToken;
          if (cfg.ghRepo) ghRepo = cfg.ghRepo;
          if (cfg.ghBranch) ghBranch = cfg.ghBranch;
        } catch {}
      }

      if (ghToken && ghRepo) {
        addScheduleLog(`Đang tự động đồng bộ lên GitHub (${ghRepo})...`);
        const targetFilePath = 'tvPremium.m3u';
        const fileContent = fs.readFileSync(path.resolve(__dirname, 'tvPremium.m3u'), 'utf8');
        const base64Content = Buffer.from(fileContent, 'utf8').toString('base64');
        const cleanRepo = ghRepo.replace(/^https?:\/\/github\.com\//i, '').replace(/\.git$/i, '');

        let existingSha: string | null = null;
        try {
          const getRes = await fetch(`https://api.github.com/repos/${cleanRepo}/contents/${targetFilePath}?ref=${ghBranch}`, {
            headers: {
              'Authorization': `Bearer ${ghToken}`,
              'Accept': 'application/vnd.github.v3+json',
              'User-Agent': 'AIStudio-AutoScheduler',
            },
          });
          if (getRes.ok) {
            const data: any = await getRes.json();
            existingSha = data.sha || null;
          }
        } catch {}

        const putRes = await fetch(`https://api.github.com/repos/${cleanRepo}/contents/${targetFilePath}`, {
          method: 'PUT',
          headers: {
            'Authorization': `Bearer ${ghToken}`,
            'Accept': 'application/vnd.github.v3+json',
            'Content-Type': 'application/json',
            'User-Agent': 'AIStudio-AutoScheduler',
          },
          body: JSON.stringify({
            message: `Auto-scan VTVGo (${scanResult.totalStreams} channels) [01:00 & 13:00 VN Schedule]`,
            content: base64Content,
            branch: ghBranch,
            sha: existingSha || undefined,
          }),
        });

        if (putRes.ok) {
          addScheduleLog(`Đã tự động đẩy thành công lên GitHub (${cleanRepo}/${targetFilePath})!`);
        } else {
          const errData: any = await putRes.json().catch(() => ({}));
          addScheduleLog(`Không thể đẩy lên GitHub: ${errData.message || putRes.statusText}`, false);
        }
      } else {
        addScheduleLog('Chưa có GitHub Token trong cấu hình server, chỉ lưu file tvPremium.m3u cục bộ.');
      }

      return { success: true, scanResult };
    } catch (err: any) {
      addScheduleLog(`Lỗi tiến trình quét: ${err.message}`, false);
      return { success: false, error: err.message };
    } finally {
      isScheduleScanning = false;
    }
  }

  // Timer: Check every 60 seconds
  setInterval(() => {
    try {
      const vnTimeStr = new Date().toLocaleString('en-US', { timeZone: 'Asia/Ho_Chi_Minh' });
      const vnDate = new Date(vnTimeStr);
      const hours = vnDate.getHours();
      const minutes = vnDate.getMinutes();

      // Trigger at 01:00 AM (1h sáng) and 13:00 PM (1h chiều)
      if ((hours === 1 || hours === 13) && minutes === 0) {
        const dateKey = `${vnDate.getFullYear()}-${vnDate.getMonth() + 1}-${vnDate.getDate()}_${hours}`;
        if (lastScheduleRunDate !== dateKey) {
          lastScheduleRunDate = dateKey;
          triggerScheduledVtvgoScan(`Auto-Schedule ${hours}:00 VN Time`);
        }
      }
    } catch (e: any) {
      console.error('Lỗi timer scheduler:', e.message);
    }
  }, 60000);

  // API: Get schedule status and recent logs
  app.get('/api/schedule-status', (req, res) => {
    const vnTimeNow = new Date().toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' });
    const vnDate = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Ho_Chi_Minh' }));
    const hours = vnDate.getHours();

    let nextRunTime = '';
    if (hours < 1) {
      nextRunTime = '01:00 AM hôm nay';
    } else if (hours < 13) {
      nextRunTime = '13:00 PM (1h chiều) hôm nay';
    } else {
      nextRunTime = '01:00 AM ngày mai';
    }

    return res.json({
      enabled: true,
      schedule: 'Mỗi ngày 2 lần vào lúc 01:00 AM và 13:00 PM (Giờ Việt Nam UTC+7)',
      timezone: 'Asia/Ho_Chi_Minh',
      serverVnTime: vnTimeNow,
      nextRun: nextRunTime,
      isRunning: isScheduleScanning,
      lastRunDate: lastScheduleRunDate,
      logs: scheduleLogs,
    });
  });

  // API: Trigger scan immediately from UI
  app.post('/api/trigger-scheduled-scan', async (req, res) => {
    const { ghToken, ghRepo, ghBranch } = req.body || {};
    if (ghToken || ghRepo) {
      const configPath = path.resolve(__dirname, 'server-config.json');
      fs.writeFileSync(configPath, JSON.stringify({ ghToken, ghRepo, ghBranch }), 'utf8');
    }

    const result = await triggerScheduledVtvgoScan('Yêu cầu thủ công từ giao diện');
    return res.json(result);
  });

  // Vite middleware in dev or static files in prod
  if (process.env.NODE_ENV === 'production') {
    app.use(express.static(path.resolve(__dirname, 'dist')));
    app.get('*', (req, res) => {
      res.sendFile(path.resolve(__dirname, 'dist', 'index.html'));
    });
  } else {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running at http://0.0.0.0:${PORT}`);
  });
}

startServer();
