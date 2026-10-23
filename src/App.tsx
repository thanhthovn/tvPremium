import React, { useState, useEffect, useRef, useCallback } from 'react';
import Hls from 'hls.js';
import {
  Globe, Play, Pause, Volume2, VolumeX, Maximize, Copy, Check,
  Search, ExternalLink, Film, Layers, Radio, AlertCircle, CheckCircle2,
  Sparkles, RotateCw, Code2, Smartphone, Tablet, Monitor, X, Tv,
  ListVideo, FileCode, ShieldCheck, Zap, Bookmark, Activity, Terminal,
  MousePointer, HelpCircle, Share2, FolderPlus, Upload, Download,
  FileText, Trash2, Loader2, CheckSquare, Square, Filter, Save,
  Settings, Key, Eye, EyeOff, RefreshCw, Clock, Calendar,
} from 'lucide-react';

interface ExtractedStream {
  url: string;
  sourceType: string;
  pageTitle?: string;
  quality?: string;
  resolution?: string;
  channelNumber?: number;
  channelName?: string;
  // Probe fields
  probeStatus?: 'pending' | 'probing' | 'done' | 'error';
  probeLevels?: { height?: number; width?: number; bitrate?: number }[];
  probeBest?: { resolution?: string; bitrate?: string };
  probeError?: string;
}

interface SampleStream {
  name: string;
  url: string;
  description: string;
  type: string;
}

const SAMPLE_STREAMS: SampleStream[] = [
  {
    name: 'VTV2 HD - FPT Play',
    url: 'https://fptplay.vn/xem-truyen-hinh/vtv2-hd',
    description: 'Trực tiếp VTV2 HD trên FPT Play',
    type: 'FPT Play HLS',
  },
  {
    name: 'VTV1 - TV360',
    url: 'https://tv360.vn/tv/vtv1?ch=2&col=recommend_live&sect=RECOMMEND&page=home_live&c=0',
    description: 'Trực tiếp VTV1 HD trên TV360',
    type: 'TV360 HLS',
  },
  {
    name: 'VTV6 Cần Thơ - VTVGo',
    url: 'https://vtvgo.vn/channel/13',
    description: 'Kênh VTV Cần Thơ (VTV6 cũ)',
    type: 'VTVGo HLS',
  },
  {
    name: 'VTV1 - VTV Go',
    url: 'https://vtvgo.vn/channel/1',
    description: 'Xem Kênh VTV1 - Đài THVN',
    type: 'VTVGo HLS',
  },
];

/* =========================================================
   HELPER: Tải file text với CRLF + BOM UTF-8
   ========================================================= */
const downloadTextFile = (filename: string, lines: string[]) => {
  const content = '\uFEFF' + lines.join('\r\n');
  const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
  const objectUrl = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = objectUrl;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
};

/* =========================================================
   HELPER: Tính điểm chất lượng để sắp xếp
   ========================================================= */
const getQualityScore = (
  best?: { resolution?: string; bitrate?: string }
): number => {
  if (!best) return -1;
  let score = 0;

  // Resolution: "1920x1080" hoặc "1080p"
  const res = best.resolution || '';
  const heightMatch = res.match(/(\d+)\s*p?$/i) || res.match(/x(\d+)$/i);
  const height = heightMatch ? parseInt(heightMatch[1], 10) : 0;
  score += (isNaN(height) ? 0 : height) * 1_000_000;

  // Bitrate: "5000 kbps"
  const brMatch = (best.bitrate || '').match(/(\d+)/);
  const kbps = brMatch ? parseInt(brMatch[1], 10) : 0;
  score += isNaN(kbps) ? 0 : kbps * 1000;

  return score;
};

// So sánh 2 stream: chất lượng cao đứng trước
const compareStreamQuality = (a: ExtractedStream, b: ExtractedStream): number => {
  const sa = getQualityScore(a.probeBest);
  const sb = getQualityScore(b.probeBest);

  // Cả 2 đều chưa có probeBest → giữ nguyên thứ tự gốc
  if (sa === -1 && sb === -1) return 0;

  // Stream đã probe chất lượng cao hơn đứng trước
  if (sa !== sb) return sb - sa;

  // Cùng chất lượng → ưu tiên stream probe done hơn error/pending
  const rank = (s: ExtractedStream) =>
    s.probeStatus === 'done' ? 2 : s.probeStatus === 'error' ? 0 : 1;
  return rank(b) - rank(a);
};

const getHostname = (url: string): string => {
  try {
    return new URL(url).hostname;
  } catch {
    return '';
  }
};

const buildM3uLines = (streams: ExtractedStream[]): string[] => {
  const groups = new Map<string, ExtractedStream[]>();

  streams.forEach((stream) => {
    let rawTitle =
      stream.channelName ||
      stream.pageTitle ||
      (typeof stream.channelNumber === 'number'
        ? `Kênh ${stream.channelNumber}`
        : getHostname(stream.url)) ||
      'Kênh không tên';

    const channelTitle = rawTitle
      .replace(/^(?:VTVgo|TV360|FPT Play)\s*(?:Trực Tiếp\s*)?[-:]\s*/i, '')
      .replace(/\s*[-:]\s*(?:TV360|VTVgo|FPT Play).*$/i, '')
      .replace(/[\r\n]+/g, ' ')
      .trim() || 'Kênh không tên';

    if (!groups.has(channelTitle)) groups.set(channelTitle, []);
    const arr = groups.get(channelTitle)!;
    if (!arr.some((s) => s.url === stream.url)) arr.push(stream);
  });

  const lines: string[] = ['#EXTM3U'];

  groups.forEach((groupStreams, channelTitle) => {
    const sorted = [...groupStreams].sort(compareStreamQuality);

    sorted.forEach((s) => {
      const q = s.probeBest;
      const res = q?.resolution || '';
      const kbps = q?.bitrate ? q.bitrate.replace(' kbps', '') + 'kbps' : '';
      const qualityText = [res, kbps].filter(Boolean).join(' - ');
      const displayQuality = qualityText ? ` (${qualityText})` : '';

      const finalName = `${channelTitle}${displayQuality}`;

      lines.push(`#EXTINF:-1 tvg-name="${channelTitle}",${finalName}`);
      lines.push(s.url);
      lines.push('');
    });
  });

  return lines;
};

export default function App() {
  const [inputUrl, setInputUrl] = useState('https://vtvgo.vn/channel/1');
  const [isScanning, setIsScanning] = useState(false);
  const [extractedStreams, setExtractedStreams] = useState<ExtractedStream[]>([]);
  const [activeStreamUrl, setActiveStreamUrl] = useState<string>('');
  const [useProxyForPlayback, setUseProxyForPlayback] = useState(false);
  const [scanStatus, setScanStatus] = useState<string | null>(null);
  const [scanError, setScanError] = useState<string | null>(null);
  const [pageMeta, setPageMeta] = useState<{
    title?: string;
    iframes?: number;
    source?: string;
  } | null>(null);

  // Player state
  const [isPlaying, setIsPlaying] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  const [volume, setVolume] = useState(1);
  const [qualityLevels, setQualityLevels] = useState<{ id: number; name: string }[]>([]);
  const [currentLevel, setCurrentLevel] = useState<number>(-1);
  const [playbackError, setPlaybackError] = useState<string | null>(null);
  const [streamInfo, setStreamInfo] = useState<{ resolution?: string; bitrate?: string } | null>(
    null
  );
  const [copiedUrl, setCopiedUrl] = useState<string | null>(null);

  // Probe state
  const [isProbing, setIsProbing] = useState(false);
  const [autoProbeEnabled, setAutoProbeEnabled] = useState(true);
  const probeSessionRef = useRef(0);

  // Raw paste modal
  const [isRawModalOpen, setIsRawModalOpen] = useState(false);
  const [rawHtmlInput, setRawHtmlInput] = useState('');

  // ===== BATCH EXTRACT STATE =====
  const [batchResults, setBatchResults] = useState<
    Array<{
      inputUrl: string;
      status: 'pending' | 'scanning' | 'success' | 'error';
      streams: ExtractedStream[];
      error?: string;
      pageTitle?: string;
    }>
  >([]);
  const [isBatchRunning, setIsBatchRunning] = useState(false);
  const [batchProgress, setBatchProgress] = useState({ done: 0, total: 0 });
  const batchCancelRef = useRef(false);

  // ===== VTVGO SCAN STATE =====
  const [vtvgoStart, setVtvgoStart] = useState('1');
  const [vtvgoEnd, setVtvgoEnd] = useState('99');
  const [isVtvgoScanning, setIsVtvgoScanning] = useState(false);
  const [vtvgoProgress, setVtvgoProgress] = useState({ done: 0, total: 0 });
  const vtvgoCancelRef = useRef(false);

  // Playlist workspace sync state (tvPremium.m3u)
  const [playlistFileStatus, setPlaylistFileStatus] = useState<{
    exists: boolean;
    filename: string;
    size?: number;
    updatedAt?: string;
    channelCount?: number;
  } | null>(null);
  const [isSavingPlaylist, setIsSavingPlaylist] = useState(false);
  const [saveSuccessNotice, setSaveSuccessNotice] = useState<string | null>(null);

  // GitHub Integration State
  const [ghToken, setGhToken] = useState(() => localStorage.getItem('gh_token') || '');
  const [ghRepo, setGhRepo] = useState(() => localStorage.getItem('gh_repo') || 'thanhthovn/tvPremium');
  const [ghBranch, setGhBranch] = useState(() => localStorage.getItem('gh_branch') || 'main');
  const [autoSaveAndSync, setAutoSaveAndSync] = useState(() => localStorage.getItem('gh_auto_sync') !== 'false');
  const [isGhModalOpen, setIsGhModalOpen] = useState(false);
  const [showGhToken, setShowGhToken] = useState(false);
  const [lastSyncStatus, setLastSyncStatus] = useState<{
    time: string;
    success: boolean;
    message: string;
    commitUrl?: string;
  } | null>(null);

  const [tempToken, setTempToken] = useState(ghToken);
  const [tempRepo, setTempRepo] = useState(ghRepo);
  const [tempBranch, setTempBranch] = useState(ghBranch);
  const [tempAutoSync, setTempAutoSync] = useState(autoSaveAndSync);

  const openGhModal = () => {
    setTempToken(ghToken);
    setTempRepo(ghRepo);
    setTempBranch(ghBranch);
    setTempAutoSync(autoSaveAndSync);
    setIsGhModalOpen(true);
  };

  const saveGhSettings = (token: string, repo: string, branch: string, autoSync: boolean) => {
    setGhToken(token);
    setGhRepo(repo);
    setGhBranch(branch);
    setAutoSaveAndSync(autoSync);
    localStorage.setItem('gh_token', token.trim());
    localStorage.setItem('gh_repo', repo.trim());
    localStorage.setItem('gh_branch', branch.trim());
    localStorage.setItem('gh_auto_sync', String(autoSync));
    setIsGhModalOpen(false);
  };

  const fetchPlaylistStatus = useCallback(async () => {
    try {
      const res = await fetch('/api/playlist-status');
      if (res.ok) {
        const data = await res.json();
        setPlaylistFileStatus(data);
      }
    } catch {}
  }, []);

  // Schedule state (01:00 AM & 13:00 PM VN)
  const [scheduleStatus, setScheduleStatus] = useState<{
    enabled: boolean;
    schedule: string;
    serverVnTime: string;
    nextRun: string;
    isRunning: boolean;
    logs: Array<{ time: string; message: string; success: boolean }>;
  } | null>(null);
  const [isTriggeringSchedule, setIsTriggeringSchedule] = useState(false);

  const fetchScheduleStatus = useCallback(async () => {
    try {
      const res = await fetch('/api/schedule-status');
      if (res.ok) {
        const data = await res.json();
        setScheduleStatus(data);
      }
    } catch {}
  }, []);

  useEffect(() => {
    fetchPlaylistStatus();
    fetchScheduleStatus();
    const interval = setInterval(fetchScheduleStatus, 30000);
    return () => clearInterval(interval);
  }, [fetchPlaylistStatus, fetchScheduleStatus]);

  const triggerScheduleScanNow = async () => {
    setIsTriggeringSchedule(true);
    try {
      const res = await fetch('/api/trigger-scheduled-scan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ghToken: (localStorage.getItem('gh_token') || ghToken).trim(),
          ghRepo: (localStorage.getItem('gh_repo') || ghRepo || 'thanhthovn/tvPremium').trim(),
          ghBranch: (localStorage.getItem('gh_branch') || ghBranch || 'main').trim(),
        }),
      });
      const data = await res.json();
      fetchPlaylistStatus();
      fetchScheduleStatus();
      if (data.success) {
        setSaveSuccessNotice(
          `⚡ Tiến trình quét VTVGo định kỳ đã chạy thành công (${data.scanResult?.totalStreams || 0} luồng)! File tvPremium.m3u đã được lưu và đồng bộ.`
        );
        setTimeout(() => setSaveSuccessNotice(null), 8000);
      } else {
        alert(data.message || data.error || 'Có lỗi khi chạy tiến trình quét.');
      }
    } catch (e: any) {
      alert('Lỗi kết nối máy chủ: ' + e.message);
    } finally {
      setIsTriggeringSchedule(false);
    }
  };

  const executeAutoSaveAndSync = useCallback(
    async (
      streamsToSave: ExtractedStream[],
      showNotification = true,
      customMsg?: string
    ) => {
      if (!streamsToSave || streamsToSave.length === 0) return;

      const lines = buildM3uLines(streamsToSave);
      setIsSavingPlaylist(true);

      const targetRepo = (localStorage.getItem('gh_repo') || ghRepo || 'thanhthovn/tvPremium').trim();
      const targetToken = (localStorage.getItem('gh_token') || ghToken).trim();
      const targetBranch = (localStorage.getItem('gh_branch') || ghBranch || 'main').trim();

      try {
        const res = await fetch('/api/github-sync', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            token: targetToken || undefined,
            repo: targetRepo,
            branch: targetBranch,
            filePath: 'tvPremium.m3u',
            lines,
            commitMessage: customMsg || `Auto-sync tvPremium.m3u (${streamsToSave.length} channels)`,
          }),
        });

        const data = await res.json();
        fetchPlaylistStatus();

        const nowTime = new Date().toLocaleTimeString('vi-VN');

        if (res.ok && data.success) {
          if (data.githubSynced) {
            setLastSyncStatus({
              time: nowTime,
              success: true,
              message: `Đã tự động lưu & đồng bộ đè lên GitHub (${data.repo}/tvPremium.m3u)`,
              commitUrl: data.commitUrl,
            });
            if (showNotification) {
              setSaveSuccessNotice(
                `⚡ Hoàn tất: Đã tự động lưu & đồng bộ đè lên GitHub (${data.repo}/tvPremium.m3u)!`
              );
              setTimeout(() => setSaveSuccessNotice(null), 8000);
            }
          } else {
            setLastSyncStatus({
              time: nowTime,
              success: true,
              message: `Đã lưu file tvPremium.m3u vào dự án (${data.channelCount} kênh). Hãy nhập GitHub Token để tự động đẩy lên repo.`,
            });
            if (showNotification) {
              setSaveSuccessNotice(
                `💾 Đã tự động lưu ${data.channelCount} kênh vào file "tvPremium.m3u" trong dự án! (Nhấp Cài đặt GitHub để tự động đồng bộ thẳng lên repo không cần bấm tay).`
              );
              setTimeout(() => setSaveSuccessNotice(null), 8000);
            }
          }
        } else {
          setLastSyncStatus({
            time: nowTime,
            success: false,
            message: data.error || 'Lỗi khi đồng bộ lên GitHub',
          });
        }
      } catch (err: any) {
        setLastSyncStatus({
          time: new Date().toLocaleTimeString('vi-VN'),
          success: false,
          message: 'Lỗi mạng: ' + err.message,
        });
      } finally {
        setIsSavingPlaylist(false);
      }
    },
    [ghToken, ghRepo, ghBranch, fetchPlaylistStatus]
  );

  const videoRef = useRef<HTMLVideoElement>(null);
  const hlsRef = useRef<Hls | null>(null);
  const playerRef = useRef<HTMLDivElement>(null);

  // Session counter
  const scanSessionRef = useRef(0);

  // Helper: Copy to clipboard
  const copyText = (text: string) => {
    navigator.clipboard.writeText(text);
    setCopiedUrl(text);
    setTimeout(() => setCopiedUrl(null), 2500);
  };

  // Helper: Normalize URL
  const normalizeTargetUrl = (url: string): string => {
    let trimmed = url.trim();
    if (!/^https?:\/\//i.test(trimmed)) {
      trimmed = 'https://' + trimmed;
    }
    return trimmed;
  };

  // Helper: hostname
  const getHostname = (url: string): string => {
    try {
      return new URL(url).hostname;
    } catch {
      return '';
    }
  };

  // Helper: số kênh từ URL
  const extractChannelNumberFromUrl = (url: string): number | undefined => {
    const m = url.match(/\/channel\/(\d+)(?:[/?#]|$)/i);
    if (m) {
      const n = parseInt(m[1], 10);
      return isNaN(n) ? undefined : n;
    }
    const chMatch = url.match(/[?&](?:ch|id)=(\d+)/i);
    if (chMatch) {
      const n = parseInt(chMatch[1], 10);
      return isNaN(n) ? undefined : n;
    }
    const vtvMatch = url.match(/vtv(\d+)/i);
    if (vtvMatch) {
      const n = parseInt(vtvMatch[1], 10);
      return isNaN(n) ? undefined : n;
    }
    return undefined;
  };

  // ===== RESET =====
  const resetAllResults = useCallback(() => {
    scanSessionRef.current += 1;
    probeSessionRef.current += 1; // hủy mọi probe đang chạy
    setExtractedStreams([]);
    setBatchResults([]);
    setScanStatus(null);
    setScanError(null);
    setPageMeta(null);
    setBatchProgress({ done: 0, total: 0 });
    setVtvgoProgress({ done: 0, total: 0 });
    setIsProbing(false);
  }, []);

  // ===== STOP PLAYER =====
  const stopPlayer = useCallback(() => {
    if (hlsRef.current) {
      hlsRef.current.destroy();
      hlsRef.current = null;
    }
    const video = videoRef.current;
    if (video) {
      try {
        video.pause();
        video.removeAttribute('src');
        video.load();
      } catch {}
    }
    setIsPlaying(false);
    setPlaybackError(null);
    setStreamInfo(null);
    setQualityLevels([]);
    setCurrentLevel(-1);
    setActiveStreamUrl('');
  }, []);

  // Play stream
  const playStream = (url: string) => {
    setActiveStreamUrl(url);
    loadStreamInPlayer(url, useProxyForPlayback);
    setTimeout(() => {
      playerRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 100);
  };

  // Extract from plain text
  const findM3u8LinksInClientText = (text: string): ExtractedStream[] => {
    const results: ExtractedStream[] = [];
    const seen = new Set<string>();
    const absRegex = /(https?:[\/\\]{1,2}[^\s"'<>\\{}|^`]+?\.m3u8(?:\?[^\s"'<>\\{}|^`]*)?)/gi;
    let match;
    while ((match = absRegex.exec(text)) !== null) {
      const cleanUrl = match[1].replace(/\\\//g, '/');
      if (!seen.has(cleanUrl)) {
        seen.add(cleanUrl);
        results.push({
          url: cleanUrl,
          sourceType: 'manual-paste',
          pageTitle: getHostname(cleanUrl),
        });
      }
    }
    return results;
  };

  // Parse batch input
  const parseBatchInput = (text: string): string[] => {
    return text
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter((l) => l && !l.startsWith('#') && !l.startsWith('//'));
  };

  /* =========================================================
     PROBE HLS QUALITY (không attach DOM)
     ========================================================= */
  const probeHlsQuality = useCallback(
    (
      streamUrl: string,
      timeoutMs = 12000
    ): Promise<{
      levels: { height?: number; width?: number; bitrate?: number }[];
      best?: { resolution?: string; bitrate?: string };
      error?: string;
    }> => {
      return new Promise((resolve) => {
        if (!Hls.isSupported()) {
          resolve({ levels: [], error: 'Hls.js không hỗ trợ trên trình duyệt này' });
          return;
        }

        let settled = false;
        let hls: Hls | null = null;

        const cleanup = () => {
          if (hls) {
            try {
              hls.destroy();
            } catch {}
            hls = null;
          }
        };

        const finish = (result: {
          levels: { height?: number; width?: number; bitrate?: number }[];
          best?: { resolution?: string; bitrate?: string };
          error?: string;
        }) => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          cleanup();
          resolve(result);
        };

        const timer = setTimeout(() => {
          finish({ levels: [], error: 'Timeout khi tải manifest' });
        }, timeoutMs);

        hls = new Hls({
          enableWorker: true,
          autoStartLoad: false, // Chỉ cần manifest
          manifestLoadingTimeOut: timeoutMs,
          manifestLoadingMaxRetry: 1,
          levelLoadingTimeOut: timeoutMs,
          fragLoadingTimeOut: timeoutMs,
        });

        hls.on(Hls.Events.MANIFEST_PARSED, (_, data) => {
          const levels = (data.levels || []).map((lvl) => ({
            height: lvl.height,
            width: lvl.width,
            bitrate: lvl.bitrate,
          }));

          if (levels.length === 0) {
            finish({ levels, error: 'Manifest không có level nào' });
            return;
          }

          // Chọn level cao nhất
          const best = [...levels].sort((a, b) => {
            const ah = a.height ?? 0;
            const bh = b.height ?? 0;
            if (bh !== ah) return bh - ah;
            return (b.bitrate ?? 0) - (a.bitrate ?? 0);
          })[0];

          finish({
            levels,
            best: {
              resolution:
                best.height && best.width
                  ? `${best.width}x${best.height}`
                  : best.height
                  ? `${best.height}p`
                  : undefined,
              bitrate: best.bitrate
                ? `${Math.round(best.bitrate / 1000)} kbps`
                : undefined,
            },
          });
        });

        hls.on(Hls.Events.ERROR, (_, data) => {
          if (data.fatal) {
            finish({ levels: [], error: data.details || 'Lỗi tải manifest' });
          }
        });

        try {
          hls.loadSource(streamUrl);
        } catch (e: any) {
          finish({ levels: [], error: e?.message || 'Không tải được manifest' });
        }
      });
    },
    []
  );

  /* =========================================================
     PROBE NHIỀU STREAM (concurrency giới hạn)
     ========================================================= */
  const probeStreamsInParallel = useCallback(
    async (
      streams: ExtractedStream[],
      setter: React.Dispatch<React.SetStateAction<ExtractedStream[]>>,
      concurrency = 3,
      myScanSession?: number,
      myProbeSession?: number
    ) => {
      let idx = 0;
      const total = streams.length;
      if (total === 0) return;

      setIsProbing(true);

      const worker = async () => {
        while (true) {
          if (myScanSession !== undefined && myScanSession !== scanSessionRef.current) return;
          if (myProbeSession !== undefined && myProbeSession !== probeSessionRef.current) return;

          const myIdx = idx++;
          if (myIdx >= total) return;

          const s = streams[myIdx];

          // Đánh dấu probing
          setter((prev) => {
            if (myProbeSession !== undefined && myProbeSession !== probeSessionRef.current) {
              return prev;
            }
            const next = [...prev];
            if (next[myIdx]) next[myIdx] = { ...next[myIdx], probeStatus: 'probing' };
            return next;
          });

          // Không phải m3u8 → error ngay
          if (!/\.m3u8(\?|$)/i.test(s.url)) {
            setter((prev) => {
              if (myProbeSession !== undefined && myProbeSession !== probeSessionRef.current) {
                return prev;
              }
              const next = [...prev];
              if (next[myIdx]) {
                next[myIdx] = {
                  ...next[myIdx],
                  probeStatus: 'error',
                  probeError: 'Không phải .m3u8',
                };
              }
              return next;
            });
            continue;
          }

          const result = await probeHlsQuality(s.url);

          if (myScanSession !== undefined && myScanSession !== scanSessionRef.current) return;
          if (myProbeSession !== undefined && myProbeSession !== probeSessionRef.current) return;

          setter((prev) => {
            if (myProbeSession !== undefined && myProbeSession !== probeSessionRef.current) {
              return prev;
            }
            const next = [...prev];
            if (next[myIdx]) {
              if (result.error && result.levels.length === 0) {
                next[myIdx] = {
                  ...next[myIdx],
                  probeStatus: 'error',
                  probeError: result.error,
                };
              } else {
                next[myIdx] = {
                  ...next[myIdx],
                  probeStatus: 'done',
                  probeLevels: result.levels,
                  probeBest: result.best,
                  probeError: result.error,
                };
              }
            }
            return next;
          });
        }
      };

      await Promise.all(
        Array.from({ length: Math.min(concurrency, total) }, () => worker())
      );

      if (myProbeSession !== undefined && myProbeSession !== probeSessionRef.current) return;
      setIsProbing(false);

      // Tự động lưu & đồng bộ lên GitHub khi hoàn thành dò kênh
      if (autoSaveAndSync) {
        setter((finalProbed) => {
          if (finalProbed.length > 0) {
            setTimeout(() => {
              executeAutoSaveAndSync(
                finalProbed,
                true,
                `Auto-sync tvPremium.m3u after probing (${finalProbed.length} channels)`
              );
            }, 60);
          }
          return finalProbed;
        });
      }
    },
    [probeHlsQuality, autoSaveAndSync, executeAutoSaveAndSync]
  );

  // ===== MAIN SCAN (single URL) =====
  const scanForM3u8 = async (target: string) => {
    const cleanUrl = target.trim();
    if (!cleanUrl) return;

    resetAllResults();
    const mySession = scanSessionRef.current;

    setIsScanning(true);
    setScanStatus('Máy chủ đang phân tích mã nguồn HTML, giải mã JavaScript đóng gói & quét iframe...');
    setScanError(null);
    setPageMeta(null);

    const normalized = normalizeTargetUrl(cleanUrl);
    const pageChannelNumber = extractChannelNumberFromUrl(normalized);

    try {
      const response = await fetch('/api/extract-m3u8', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: normalized }),
      });

      const data = await response.json();

      if (mySession !== scanSessionRef.current) return;

      if (!response.ok || !data.success) {
        throw new Error(data.error || 'Máy chủ không thể kết nối đến trang web này.');
      }

      setPageMeta({
        title: data.pageTitle,
        iframes: data.iframesFound,
        source: data.source,
      });

      if (data.streams && data.streams.length > 0) {
        const titledStreams: ExtractedStream[] = data.streams.map((s: ExtractedStream) => ({
          ...s,
          pageTitle: s.pageTitle || data.pageTitle || getHostname(s.url),
          channelNumber: s.channelNumber ?? data.channelNumber ?? pageChannelNumber,
          channelName: s.channelName || data.channelName,
          probeStatus: autoProbeEnabled ? 'pending' : undefined,
        }));

        setExtractedStreams(titledStreams);
        setActiveStreamUrl(data.streams[0].url);
        setScanStatus(`Tìm thấy thành công ${data.streams.length} luồng M3U8 từ trang web!`);

        // Auto probe
        if (autoProbeEnabled && titledStreams.length > 0) {
          probeSessionRef.current += 1;
          const myProbe = probeSessionRef.current;
          // Delay nhẹ để React commit xong state
          setTimeout(() => {
            if (mySession !== scanSessionRef.current) return;
            if (myProbe !== probeSessionRef.current) return;
            probeStreamsInParallel(
              titledStreams,
              setExtractedStreams,
              3,
              mySession,
              myProbe
            );
          }, 50);
        } else if (!autoProbeEnabled && autoSaveAndSync && titledStreams.length > 0) {
          setTimeout(() => {
            executeAutoSaveAndSync(titledStreams, true);
          }, 100);
        }
      } else {
        setScanError(
          'Trang web này sinh link động qua JavaScript khi người dùng bấm nút Play trên giao diện (hoặc tải qua API mạng bảo mật).'
        );
      }
    } catch (err: any) {
      if (mySession !== scanSessionRef.current) return;
      setScanError(
        `${err.message || 'Lỗi kết nối'}. Trang web có thể yêu cầu đăng nhập hoặc chặn kết nối bot.`
      );
    } finally {
      if (mySession === scanSessionRef.current) setIsScanning(false);
    }
  };

  // Parse Raw HTML
  const handleParseRawHtml = () => {
    if (!rawHtmlInput.trim()) return;
    const found = findM3u8LinksInClientText(rawHtmlInput);
    if (found.length > 0) {
      resetAllResults();
      const withProbe = found.map((s) => ({
        ...s,
        probeStatus: autoProbeEnabled ? ('pending' as const) : undefined,
      }));
      setExtractedStreams(withProbe);
      setActiveStreamUrl(found[0].url);
      setScanStatus(`Đã trích xuất thành công ${found.length} luồng M3U8!`);
      setIsRawModalOpen(false);
      setRawHtmlInput('');

      if (autoProbeEnabled) {
        const mySession = scanSessionRef.current;
        probeSessionRef.current += 1;
        const myProbe = probeSessionRef.current;
        setTimeout(() => {
          if (mySession !== scanSessionRef.current) return;
          if (myProbe !== probeSessionRef.current) return;
          probeStreamsInParallel(withProbe, setExtractedStreams, 3, mySession, myProbe);
        }, 50);
      }
    } else {
      alert(
        'Không tìm thấy link .m3u8 trong đoạn mã vừa dán. Bạn có thể mở F12 > Network > lọc m3u8 để copy trực tiếp!'
      );
    }
  };

  // Load HLS Player
  const loadStreamInPlayer = useCallback((streamUrl: string, forceProxy = false) => {
    const video = videoRef.current;
    if (!video) return;

    setPlaybackError(null);
    setQualityLevels([]);
    setCurrentLevel(-1);

    if (hlsRef.current) {
      hlsRef.current.destroy();
      hlsRef.current = null;
    }

    const finalPlaybackUrl = forceProxy
      ? `/api/proxy-m3u8?url=${encodeURIComponent(streamUrl)}`
      : streamUrl;

    if (Hls.isSupported()) {
      const hls = new Hls({
        enableWorker: true,
        lowLatencyMode: true,
        backBufferLength: 90,
      });

      hlsRef.current = hls;
      hls.loadSource(finalPlaybackUrl);
      hls.attachMedia(video);

      hls.on(Hls.Events.MANIFEST_PARSED, (_, data) => {
        setPlaybackError(null);
        if (data.levels && data.levels.length > 0) {
          const levels = data.levels.map((lvl, index) => ({
            id: index,
            name: lvl.height
              ? `${lvl.height}p (${Math.round(lvl.bitrate / 1000)}kbps)`
              : `Mức ${index + 1}`,
          }));
          setQualityLevels(levels);
          const firstLevel = data.levels[0];
          setStreamInfo({
            resolution: firstLevel.height
              ? `${firstLevel.width}x${firstLevel.height}`
              : undefined,
            bitrate: `${Math.round(firstLevel.bitrate / 1000)} kbps`,
          });
        }
        video
          .play()
          .then(() => setIsPlaying(true))
          .catch(() => setIsPlaying(false));
      });

      hls.on(Hls.Events.LEVEL_SWITCHED, (_, data) => {
        setCurrentLevel(data.level);
        if (hls.levels[data.level]) {
          const lvl = hls.levels[data.level];
          setStreamInfo({
            resolution: lvl.height ? `${lvl.width}x${lvl.height}` : undefined,
            bitrate: `${Math.round(lvl.bitrate / 1000)} kbps`,
          });
        }
      });

      hls.on(Hls.Events.ERROR, (_, data) => {
        if (data.fatal) {
          switch (data.type) {
            case Hls.ErrorTypes.NETWORK_ERROR:
              setPlaybackError('Lỗi mạng hoặc máy chủ video chặn CORS trình duyệt.');
              if (!forceProxy) {
                setUseProxyForPlayback(true);
              }
              break;
            case Hls.ErrorTypes.MEDIA_ERROR:
              setPlaybackError('Lỗi mã hóa luồng media. Đang thử phục hồi...');
              hls.recoverMediaError();
              break;
            default:
              setPlaybackError('Không thể phát luồng này: ' + data.details);
              hls.destroy();
              break;
          }
        }
      });
    } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
      video.src = finalPlaybackUrl;
      video
        .play()
        .then(() => setIsPlaying(true))
        .catch(() => setIsPlaying(false));
    } else {
      setPlaybackError('Trình duyệt của bạn không hỗ trợ công nghệ HLS.');
    }
  }, []);

  useEffect(() => {
    if (activeStreamUrl) {
      loadStreamInPlayer(activeStreamUrl, useProxyForPlayback);
    }
  }, [activeStreamUrl, useProxyForPlayback, loadStreamInPlayer]);

  // Player controls
  const togglePlay = () => {
    const video = videoRef.current;
    if (!video) return;
    if (video.paused) {
      video.play().then(() => setIsPlaying(true));
    } else {
      video.pause();
      setIsPlaying(false);
    }
  };

  const toggleMute = () => {
    const video = videoRef.current;
    if (!video) return;
    video.muted = !video.muted;
    setIsMuted(video.muted);
  };

  const handleVolumeChange = (newVol: number) => {
    const video = videoRef.current;
    if (!video) return;
    video.volume = newVol;
    setVolume(newVol);
    setIsMuted(newVol === 0);
  };

  // ===== BATCH EXTRACT =====

  const scanSingleUrl = async (
    url: string
  ): Promise<{
    streams: ExtractedStream[];
    pageTitle?: string;
    error?: string;
  }> => {
    const normalized = normalizeTargetUrl(url);
    const pageChannelNumber = extractChannelNumberFromUrl(normalized);
    try {
      const response = await fetch('/api/extract-m3u8', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: normalized }),
      });
      const data = await response.json();

      if (!response.ok || !data.success) {
        if (/\.m3u8(\?|$)/i.test(url)) {
          return {
            streams: [
              { url, sourceType: 'direct-input', pageTitle: getHostname(url) },
            ],
          };
        }
        return { streams: [], error: data.error || 'Server error' };
      }

      const streamsWithChannel: ExtractedStream[] = (data.streams || []).map(
        (s: ExtractedStream) => ({
          ...s,
          channelNumber: s.channelNumber ?? pageChannelNumber,
        })
      );

      return {
        streams: streamsWithChannel,
        pageTitle: data.pageTitle,
        error: streamsWithChannel.length === 0 ? 'Không tìm thấy .m3u8' : undefined,
      };
    } catch (err: any) {
      if (/\.m3u8(\?|$)/i.test(url)) {
        return {
          streams: [
            { url, sourceType: 'direct-input', pageTitle: getHostname(url) },
          ],
        };
      }
      return { streams: [], error: err.message || 'Network error' };
    }
  };

  const rebuildStreamsFromBatch = (
    results: Array<{
      inputUrl: string;
      status: 'pending' | 'scanning' | 'success' | 'error';
      streams: ExtractedStream[];
      error?: string;
      pageTitle?: string;
    }>
  ): ExtractedStream[] => {
    const fromBatch: ExtractedStream[] = [];
    const seen = new Set<string>();
    results.forEach((r) => {
      r.streams.forEach((s) => {
        if (!seen.has(s.url)) {
          seen.add(s.url);
          fromBatch.push({
            ...s,
            pageTitle: s.pageTitle || r.pageTitle || getHostname(s.url),
          });
        }
      });
    });
    return fromBatch;
  };

  // Probe toàn bộ extractedStreams hiện tại
  const probeAllCurrentStreams = useCallback(() => {
    const mySession = scanSessionRef.current;
    probeSessionRef.current += 1;
    const myProbe = probeSessionRef.current;

    setExtractedStreams((prev) => {
      if (prev.length === 0) return prev;
      const initial = prev.map((s) => ({
        ...s,
        probeStatus: 'pending' as const,
        probeBest: undefined,
        probeLevels: undefined,
        probeError: undefined,
      }));

      // Delay để state commit
      setTimeout(() => {
        if (mySession !== scanSessionRef.current) return;
        if (myProbe !== probeSessionRef.current) return;
        probeStreamsInParallel(initial, setExtractedStreams, 3, mySession, myProbe);
      }, 50);

      return initial;
    });
  }, [probeStreamsInParallel]);

  const runBatchScan = async () => {
    const urls = parseBatchInput(inputUrl);
    if (urls.length === 0) {
      alert('Chưa có URL nào. Hãy dán danh sách URL (mỗi dòng 1 link).');
      return;
    }

    resetAllResults();
    const mySession = scanSessionRef.current;

    batchCancelRef.current = false;
    setIsBatchRunning(true);
    setBatchProgress({ done: 0, total: urls.length });
    setScanError(null);

    const initial = urls.map((u) => ({
      inputUrl: u,
      status: 'pending' as const,
      streams: [] as ExtractedStream[],
    }));
    setBatchResults(initial);

    const CONCURRENCY = 3;
    let idx = 0;

    const worker = async () => {
      while (true) {
        if (batchCancelRef.current) return;
        if (mySession !== scanSessionRef.current) return;

        const myIdx = idx++;
        if (myIdx >= urls.length) return;

        setBatchResults((prev) => {
          if (mySession !== scanSessionRef.current) return prev;
          const next = [...prev];
          next[myIdx] = { ...next[myIdx], status: 'scanning' };
          return next;
        });

        const res = await scanSingleUrl(urls[myIdx]);
        if (batchCancelRef.current) return;
        if (mySession !== scanSessionRef.current) return;

        setBatchResults((prev) => {
          if (mySession !== scanSessionRef.current) return prev;
          const next = [...prev];
          next[myIdx] = {
            ...next[myIdx],
            status: res.streams.length > 0 ? 'success' : 'error',
            streams: res.streams,
            pageTitle: res.pageTitle,
            error: res.error,
          };
          setExtractedStreams(rebuildStreamsFromBatch(next));
          return next;
        });

        setBatchProgress((p) => ({ ...p, done: p.done + 1 }));
      }
    };

    await Promise.all(
      Array.from({ length: Math.min(CONCURRENCY, urls.length) }, () => worker())
    );

    if (mySession !== scanSessionRef.current) return;
    setIsBatchRunning(false);

    // ===== PROBE SAU KHI BATCH XONG =====
    if (autoProbeEnabled) {
      // Lấy snapshot mới nhất từ batchResults
      setBatchResults((prev) => {
        const allStreams = rebuildStreamsFromBatch(prev);
        if (allStreams.length === 0) return prev;

        const initialProbe = allStreams.map((s) => ({
          ...s,
          probeStatus: 'pending' as const,
        }));

        probeSessionRef.current += 1;
        const myProbe = probeSessionRef.current;

        setTimeout(() => {
          if (mySession !== scanSessionRef.current) return;
          if (myProbe !== probeSessionRef.current) return;
          setExtractedStreams(initialProbe);
          probeStreamsInParallel(
            initialProbe,
            setExtractedStreams,
            3,
            mySession,
            myProbe
          );
        }, 50);

        return prev;
      });
    } else if (autoSaveAndSync) {
      setBatchResults((prev) => {
        const allStreams = rebuildStreamsFromBatch(prev);
        if (allStreams.length > 0) {
          setTimeout(() => {
            executeAutoSaveAndSync(allStreams, true);
          }, 60);
        }
        return prev;
      });
    }
  };

  // ===== TẢI FILE M3U VỀ MÁY TÍNH =====
  const exportFoundLinks = () => {
    if (extractedStreams.length === 0) {
      alert('Chưa có link nào để xuất.');
      return;
    }
    const lines = buildM3uLines(extractedStreams);
    downloadTextFile(`tvPremium.m3u`, lines);
  };

  // ===== THỦ CÔNG: LƯU TRỰC TIẾP VÀO FILE tvPremium.m3u & ĐỒNG BỘ LÊN GITHUB =====
  const savePlaylistToTvPremium = async () => {
    if (extractedStreams.length === 0) {
      alert('Chưa có luồng nào để lưu vào file tvPremium.m3u!');
      return;
    }
    await executeAutoSaveAndSync(
      extractedStreams,
      true,
      `Manual sync tvPremium.m3u (${extractedStreams.length} channels)`
    );
  };

  const exportDetailedReport = () => {
    const lines: string[] = [
      '# M3U8 Batch Extract Report',
      `# Generated: ${new Date().toISOString()}`,
      '',
    ];
    batchResults.forEach((r, i) => {
      lines.push(`## [${i + 1}] ${r.inputUrl}`);
      if (r.pageTitle) lines.push(`# Title: ${r.pageTitle}`);
      if (r.status === 'error') {
        lines.push(`# STATUS: ERROR - ${r.error || 'unknown'}`);
      } else {
        lines.push(`# STATUS: ${r.streams.length} stream(s) found`);

        // Ghép stream gốc với thông tin probe hiện tại rồi sắp xếp
        const merged = r.streams.map((s) => {
          const found = extractedStreams.find((x) => x.url === s.url);
          return found ? { ...s, ...found } : s;
        });
        const sorted = merged.sort(compareStreamQuality);

        sorted.forEach((s) => {
          const q = s.probeBest;
          if (q?.resolution || q?.bitrate) {
            const parts = [q.resolution, q.bitrate].filter(Boolean).join(' • ');
            lines.push(`#  Chất lượng: ${parts}`);
          }
          lines.push(s.url);
        });
      }
      lines.push('');
    });

    downloadTextFile(`m3u8-report-${Date.now()}.txt`, lines);
  };

  const handleBatchFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (evt) => {
      const text = evt.target?.result as string;
      setInputUrl((prev) => (prev.trim() ? prev + '\n' + text : text));
    };
    reader.readAsText(file);
    e.target.value = '';
  };

  const toggleFullscreen = () => {
    const video = videoRef.current;
    if (!video) return;
    if (document.fullscreenElement) {
      document.exitFullscreen();
    } else {
      video.requestFullscreen().catch(() => {});
    }
  };

  // ===== VTVGO SCAN =====

  const buildVtvgoUrl = (num: number): string => {
    return `https://vtvgo.vn/channel/${num}`;
  };

  const scanSingleVtvgo = async (
    num: number
  ): Promise<{ streams: ExtractedStream[]; error?: string; pageTitle?: string }> => {
    const url = buildVtvgoUrl(num);
    try {
      const res = await fetch('/api/extract-m3u8', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) return { streams: [], error: data.error || 'failed' };
      return { streams: data.streams || [], pageTitle: data.pageTitle };
    } catch (e: any) {
      return { streams: [], error: e.message };
    }
  };

  const runVtvgoScan = async () => {
    const start = parseInt(vtvgoStart, 10);
    const end = parseInt(vtvgoEnd, 10);
    if (isNaN(start) || isNaN(end) || start > end || start < 1) {
      alert('Vui lòng nhập khoảng hợp lệ (start ≤ end, start ≥ 1)');
      return;
    }

    resetAllResults();
    const mySession = scanSessionRef.current;

    vtvgoCancelRef.current = false;
    setIsVtvgoScanning(true);
    const total = end - start + 1;
    setVtvgoProgress({ done: 0, total });

    for (let num = start; num <= end; num++) {
      if (vtvgoCancelRef.current) break;
      if (mySession !== scanSessionRef.current) break;

      const res = await scanSingleVtvgo(num);
      if (vtvgoCancelRef.current) break;
      if (mySession !== scanSessionRef.current) break;

      if (res.streams.length > 0) {
        setExtractedStreams((prev) => {
          if (mySession !== scanSessionRef.current) return prev;
          const map = new Map<string, ExtractedStream>();
          const newItems: ExtractedStream[] = res.streams.map((s) => ({
            ...s,
            sourceType: `vtvgo-${num}`,
            channelNumber: num,
            pageTitle: s.pageTitle || res.pageTitle || `VTVgo kênh ${num}`,
            probeStatus: autoProbeEnabled ? ('pending' as const) : undefined,
          }));
          [...newItems, ...prev].forEach((s) => map.set(s.url, s));
          return Array.from(map.values());
        });
      }

      setVtvgoProgress((prev) => ({ ...prev, done: prev.done + 1 }));
    }

    if (mySession === scanSessionRef.current) {
      setIsVtvgoScanning(false);

      // ===== PROBE SAU KHI VTVGO SCAN XONG =====
      if (autoProbeEnabled) {
        probeSessionRef.current += 1;
        const myProbe = probeSessionRef.current;
        setTimeout(() => {
          if (mySession !== scanSessionRef.current) return;
          if (myProbe !== probeSessionRef.current) return;
          setExtractedStreams((prev) => {
            if (mySession !== scanSessionRef.current) return prev;
            const initial = prev.map((s) => ({
              ...s,
              probeStatus: 'pending' as const,
              probeBest: undefined,
              probeLevels: undefined,
              probeError: undefined,
            }));
            setTimeout(() => {
              if (mySession !== scanSessionRef.current) return;
              if (myProbe !== probeSessionRef.current) return;
              probeStreamsInParallel(initial, setExtractedStreams, 3, mySession, myProbe);
            }, 50);
            return initial;
          });
        }, 50);
      } else if (autoSaveAndSync) {
        setExtractedStreams((finalVtv) => {
          if (finalVtv.length > 0) {
            setTimeout(() => {
              executeAutoSaveAndSync(finalVtv, true);
            }, 60);
          }
          return finalVtv;
        });
      }
    }
  };

  // ===== CLEAR ALL =====
  const clearAllStreams = () => {
    resetAllResults();
    setIsScanning(false);
    setIsBatchRunning(false);
    setIsVtvgoScanning(false);
    batchCancelRef.current = true;
    vtvgoCancelRef.current = true;
    stopPlayer();
  };

  // ===== Smart submit =====
  const inputLines = parseBatchInput(inputUrl);
  const isBatchMode = inputLines.length > 1;

  const handleSmartSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (isBatchMode) {
      runBatchScan();
    } else if (inputLines.length === 1) {
      if (/\.m3u8(\?|$)/i.test(inputLines[0])) {
        const url = normalizeTargetUrl(inputLines[0]);
        const host = getHostname(url);
        resetAllResults();
        setActiveStreamUrl(url);
        loadStreamInPlayer(url, useProxyForPlayback);

        const directStream: ExtractedStream = {
          url,
          sourceType: 'direct-input',
          pageTitle: host,
          probeStatus: autoProbeEnabled ? 'pending' : undefined,
        };
        setExtractedStreams([directStream]);
        setScanStatus('Đã nạp luồng .m3u8 trực tiếp vào player!');
        setScanError(null);

        if (autoProbeEnabled) {
          const mySession = scanSessionRef.current;
          probeSessionRef.current += 1;
          const myProbe = probeSessionRef.current;
          setTimeout(() => {
            if (mySession !== scanSessionRef.current) return;
            if (myProbe !== probeSessionRef.current) return;
            probeStreamsInParallel(
              [directStream],
              setExtractedStreams,
              1,
              mySession,
              myProbe
            );
          }, 50);
        }

        setTimeout(() => {
          playerRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }, 100);
      } else {
        scanForM3u8(inputLines[0]);
      }
    }
  };

  // Đếm số stream đã probe xong
  const probeDoneCount = extractedStreams.filter(
    (s) => s.probeStatus === 'done' || s.probeStatus === 'error'
  ).length;

  // ===== SẮP XẾP UI: Chất lượng cao nhất lên đầu =====
  const sortedStreams = [...extractedStreams].sort(compareStreamQuality);

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col font-sans selection:bg-indigo-500 selection:text-white pb-12">
      {/* Background Glow */}
      <div className="fixed inset-0 pointer-events-none overflow-hidden">
        <div className="absolute -top-40 left-1/2 -translate-x-1/2 w-[750px] h-[400px] bg-gradient-to-b from-indigo-600/20 via-purple-600/10 to-transparent blur-3xl rounded-full" />
        <div className="absolute bottom-10 -right-20 w-[450px] h-[300px] bg-cyan-600/10 blur-3xl rounded-full" />
      </div>

      {/* Header */}
      <header className="relative border-b border-slate-800/80 bg-slate-900/70 backdrop-blur-md sticky top-0 z-30 px-4 sm:px-6 py-3">
        <div className="max-w-7xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-3">
          <div className="flex items-center gap-3 w-full sm:w-auto">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-indigo-500 via-purple-500 to-pink-500 flex items-center justify-center shadow-lg shadow-indigo-500/25 shrink-0">
              <Film className="w-5 h-5 text-white" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="font-bold text-base text-white tracking-tight">
                  HLS M3U8 TUNNING & Player
                </h1>
                <span className="px-2 py-0.5 text-[10px] font-semibold bg-emerald-500/15 text-emerald-400 border border-emerald-500/30 rounded-full flex items-center gap-1">
                  <Radio className="w-3 h-3 text-emerald-400 animate-pulse" />
                  Live Tool
                </span>
              </div>
              <p className="text-xs text-slate-400">
                Trích xuất & phát luồng M3U8 đơn lẻ hoặc hàng loạt từ file .txt
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            <button
              onClick={openGhModal}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-slate-900 hover:bg-slate-800 border border-slate-700 hover:border-indigo-500/60 text-xs text-slate-200 transition cursor-pointer shadow-sm"
              title="Cài đặt tự động lưu & đồng bộ file tvPremium.m3u lên GitHub"
            >
              <Settings className="w-3.5 h-3.5 text-indigo-400" />
              <span>Đồng bộ GitHub</span>
              {ghToken ? (
                <span className="px-1.5 py-0.2 rounded text-[10px] bg-emerald-500/20 text-emerald-400 border border-emerald-500/40">
                  Auto ON
                </span>
              ) : (
                <span className="px-1.5 py-0.2 rounded text-[10px] bg-amber-500/20 text-amber-300 border border-amber-500/40">
                  Cần Token
                </span>
              )}
            </button>

            <span className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-slate-950/80 border border-slate-800 text-xs text-slate-300">
              <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
              <span>Trình phát M3U8</span>
            </span>
          </div>
        </div>
      </header>

      {/* Main Container */}
      <main className="relative flex-1 max-w-7xl w-full mx-auto p-4 sm:p-6 space-y-6">
        {/* ================= HÀNG TRÊN ================= */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {/* KHỐI NHẬP LIỆU */}
          <div className="bg-emerald-900/60 border border-emerald-700/60 rounded-2xl p-5 shadow-xl relative overflow-hidden space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
              <label className="text-sm font-semibold text-white flex items-center gap-2">
                <Search className="w-4 h-4 text-emerald-300" />
                Nhập URL
                <span className="text-[10px] font-normal text-emerald-200 bg-emerald-950/60 px-2 py-0.5 rounded-full border border-emerald-600/40">
                  {isBatchMode ? `Hàng loạt: ${inputLines.length} link` : 'Đơn lẻ'}
                </span>
              </label>
              <div className="flex items-center gap-2 text-xs">
                <label className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-emerald-500/20 hover:bg-emerald-500/30 text-emerald-100 border border-emerald-500/40 transition cursor-pointer">
                  <Upload className="w-3.5 h-3.5" />
                  <span>Tải .txt</span>
                  <input
                    type="file"
                    accept=".txt,text/plain"
                    onChange={handleBatchFileUpload}
                    className="hidden"
                  />
                </label>
                <button
                  onClick={() => setIsRawModalOpen(true)}
                  className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-indigo-500/20 hover:bg-indigo-500/30 text-indigo-100 border border-indigo-500/40 transition cursor-pointer"
                >
                  <Code2 className="w-3.5 h-3.5" />
                  <span>HTML</span>
                </button>
              </div>
            </div>

            <form onSubmit={handleSmartSubmit} className="space-y-3">
              <div className="flex items-stretch gap-2">
                <div className="relative flex-1">
                  <textarea
                    value={inputUrl}
                    onChange={(e) => setInputUrl(e.target.value)}
                    rows={isBatchMode ? Math.min(Math.max(inputLines.length + 1, 3), 12) : 1}
                    placeholder={`Dán 1 link .m3u8 hoặc URL trang web để phát ngay...
Hoặc dán NHIỀU dòng (mỗi dòng 1 link) để quét hàng loạt.
# Dòng bắt đầu bằng # sẽ bị bỏ qua`}
                    className="w-full bg-emerald-950/80 border border-emerald-700/60 hover:border-emerald-600 focus:border-emerald-400 rounded-xl px-4 py-2.5 pr-10 text-sm text-emerald-50 placeholder:text-emerald-300/50 focus:outline-none focus:ring-2 focus:ring-emerald-400/20 font-mono shadow-inner resize-y leading-relaxed"
                  />
                  {inputUrl && (
                    <button
                      type="button"
                      onClick={() => setInputUrl('')}
                      className="absolute right-3 top-2.5 text-emerald-300/70 hover:text-white transition cursor-pointer"
                      title="Xóa hết"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  )}
                </div>

                <button
                  type="submit"
                  disabled={isScanning || isBatchRunning || inputLines.length === 0}
                  className={`px-5 py-2.5 disabled:opacity-50 text-white font-medium text-sm rounded-xl flex items-center justify-center gap-2 transition shadow-lg shrink-0 cursor-pointer ${
                    isBatchMode
                      ? 'bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 shadow-emerald-600/25'
                      : 'bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-500 hover:to-purple-500 shadow-indigo-600/25'
                  }`}
                >
                  {isScanning || isBatchRunning ? (
                    <>
                      <RotateCw className="w-4 h-4 animate-spin" />
                      <span>
                        {isBatchRunning
                          ? `Quét ${batchProgress.done}/${batchProgress.total}...`
                          : 'Đang quét...'}
                      </span>
                    </>
                  ) : isBatchMode ? (
                    <>
                      <Zap className="w-4 h-4" />
                      <span>Quét hàng loạt ({inputLines.length})</span>
                    </>
                  ) : (
                    <>
                      <Zap className="w-4 h-4" />
                      <span>Trích xuất & Phát</span>
                    </>
                  )}
                </button>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                {isBatchRunning && (
                  <button
                    type="button"
                    onClick={() => {
                      batchCancelRef.current = true;
                    }}
                    className="px-4 py-2.5 bg-red-600/20 hover:bg-red-600/30 border border-red-500/40 text-red-300 text-sm rounded-xl flex items-center gap-2 transition cursor-pointer"
                  >
                    <X className="w-4 h-4" />
                    Hủy
                  </button>
                )}

                {extractedStreams.length > 0 && !isBatchRunning && batchResults.length > 0 && (
                  <button
                    type="button"
                    onClick={exportDetailedReport}
                    className="px-4 py-2.5 bg-slate-800/80 hover:bg-slate-700 text-slate-200 text-sm rounded-xl flex items-center gap-2 transition cursor-pointer"
                  >
                    <FileText className="w-4 h-4" />
                    <span>Báo cáo</span>
                  </button>
                )}

                {/* Toggle auto probe */}
                <label className="flex items-center gap-2 px-3 py-2 rounded-xl bg-emerald-950/60 border border-emerald-700/60 text-xs text-emerald-200 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={autoProbeEnabled}
                    onChange={(e) => setAutoProbeEnabled(e.target.checked)}
                    className="accent-emerald-500 w-3.5 h-3.5"
                  />
                  <Activity className="w-3.5 h-3.5" />
                  Tự dò chất lượng
                </label>
              </div>
            </form>

            {isBatchRunning && batchProgress.total > 0 && (
              <div className="space-y-1.5">
                <div className="w-full bg-emerald-950 rounded-full h-2 overflow-hidden border border-emerald-700/60">
                  <div
                    className="bg-gradient-to-r from-emerald-500 to-teal-500 h-full transition-all duration-300"
                    style={{
                      width: `${(batchProgress.done / batchProgress.total) * 100}%`,
                    }}
                  />
                </div>
                <p className="text-[11px] text-emerald-200 text-right font-mono">
                  {Math.round((batchProgress.done / batchProgress.total) * 100)}% •{' '}
                  {batchProgress.done}/{batchProgress.total}
                </p>
              </div>
            )}

            {pageMeta?.title && (
              <div className="text-xs text-emerald-200 bg-emerald-950/60 p-2.5 rounded-lg border border-emerald-700/60 flex items-center justify-between">
                <span className="truncate">
                  Trang web: <strong className="text-white">{pageMeta.title}</strong>
                </span>
                {pageMeta.iframes !== undefined && (
                  <span className="text-[11px] font-mono text-purple-300 shrink-0 ml-2">
                    {pageMeta.iframes} iframe
                  </span>
                )}
              </div>
            )}

            {scanStatus && (
              <div className="flex items-center gap-2 text-xs text-emerald-200 bg-emerald-950/60 border border-emerald-500/50 px-3.5 py-2.5 rounded-xl">
                <CheckCircle2 className="w-4 h-4 shrink-0" />
                <span>{scanStatus}</span>
              </div>
            )}

            {scanError && (
              <div className="flex items-center gap-2 text-xs text-amber-300 bg-amber-950/60 border border-amber-500/40 px-3.5 py-2.5 rounded-xl">
                <AlertCircle className="w-4 h-4 shrink-0" />
                <span>{scanError}</span>
              </div>
            )}
          </div>

          {/* VTVGO QUICK SCAN */}
          <div className="bg-red-900/60 border border-red-700/60 rounded-2xl p-5 shadow-xl space-y-4">
            <div className="flex items-center gap-2">
              <Tv className="w-4 h-4 text-red-200" />
              <h3 className="text-sm font-semibold text-white">VTVgo Quick Scan</h3>
              <span className="text-[10px] text-red-200">Quét theo số kênh (1–99)</span>
            </div>

            <div className="space-y-2">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-xs text-red-200 shrink-0">Từ:</span>
                <input
                  type="number"
                  min="1"
                  max="99"
                  value={vtvgoStart}
                  onChange={(e) => setVtvgoStart(e.target.value)}
                  className="w-16 bg-red-950/80 border border-red-700/60 rounded-lg px-2 py-2 text-sm text-red-50 focus:border-red-400 focus:outline-none"
                />
                <span className="text-xs text-red-200">đến</span>
                <input
                  type="number"
                  min="1"
                  max="99"
                  value={vtvgoEnd}
                  onChange={(e) => setVtvgoEnd(e.target.value)}
                  className="w-16 bg-red-950/80 border border-red-700/60 rounded-lg px-2 py-2 text-sm text-red-50 focus:border-red-400 focus:outline-none"
                />
                <button
                  onClick={runVtvgoScan}
                  disabled={isVtvgoScanning}
                  className="px-4 py-2 bg-gradient-to-r from-red-600 to-rose-600 hover:from-red-500 hover:to-rose-500 disabled:opacity-50 text-white text-sm font-medium rounded-lg flex items-center gap-1.5 transition cursor-pointer shadow-lg shadow-red-600/25"
                >
                  {isVtvgoScanning ? (
                    <RotateCw className="w-3 h-3 animate-spin" />
                  ) : (
                    <Zap className="w-3 h-3" />
                  )}
                  {isVtvgoScanning ? `${vtvgoProgress.done}/${vtvgoProgress.total}` : 'Quét'}
                </button>
                {isVtvgoScanning && (
                  <button
                    onClick={() => {
                      vtvgoCancelRef.current = true;
                    }}
                    className="px-3 py-2 bg-red-950/80 hover:bg-red-900 border border-red-500/60 text-red-100 text-xs rounded-lg transition cursor-pointer"
                  >
                    <X className="w-3 h-3 inline mr-1" />
                    Dừng
                  </button>
                )}
              </div>
            </div>

            {isVtvgoScanning && vtvgoProgress.total > 0 && (
              <div className="w-full bg-red-950 rounded-full h-1.5 overflow-hidden border border-red-700/60">
                <div
                  className="bg-red-400 h-full transition-all"
                  style={{
                    width: `${(vtvgoProgress.done / vtvgoProgress.total) * 100}%`,
                  }}
                />
              </div>
            )}

            {isProbing && extractedStreams.length > 0 && (
              <div className="flex items-center gap-2 text-[11px] text-amber-200 bg-amber-950/50 border border-amber-500/40 px-3 py-2 rounded-lg">
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                <span>
                  Đang dò chất lượng: {probeDoneCount}/{extractedStreams.length}
                </span>
              </div>
            )}
          </div>
        </div>

        {/* ================= LỊCH QUÉT TỰ ĐỘNG VTVGO (01:00 & 13:00) ================= */}
        <div className="bg-gradient-to-r from-slate-900 via-indigo-950/40 to-slate-900 border border-indigo-500/30 rounded-2xl p-4 shadow-xl flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
          <div className="flex items-start gap-3">
            <div className="w-10 h-10 rounded-xl bg-indigo-600/20 border border-indigo-500/40 flex items-center justify-center text-indigo-400 shrink-0">
              <Clock className="w-5 h-5" />
            </div>
            <div className="space-y-1">
              <div className="flex items-center gap-2 flex-wrap">
                <h3 className="text-sm font-bold text-white">
                  Lịch Quét Tự Động VTVGo (Mỗi ngày 2 lần: 01:00 & 13:00 Giờ VN)
                </h3>
                <span className="px-2 py-0.5 rounded-full bg-emerald-500/15 text-emerald-400 border border-emerald-500/30 text-[10px] font-semibold flex items-center gap-1">
                  <CheckCircle2 className="w-3 h-3 text-emerald-400" />
                  Đã kích hoạt
                </span>
                <span className="px-2 py-0.5 rounded-full bg-indigo-500/15 text-indigo-300 border border-indigo-500/30 text-[10px] font-mono">
                  GitHub Actions 24/7
                </span>
              </div>
              <p className="text-xs text-slate-300 leading-relaxed">
                Tự động cào lại toàn bộ kênh VTVGo, dò chuẩn phân giải & bitrate cao nhất, lưu vào <code className="text-indigo-300 font-mono">tvPremium.m3u</code> và đẩy đè lên repo <strong className="text-white font-mono">{ghRepo}</strong>.
              </p>
              <div className="flex items-center gap-3 text-[11px] text-slate-400 pt-0.5 flex-wrap">
                <span>Giờ máy chủ VN: <strong className="text-slate-200">{scheduleStatus?.serverVnTime || 'Đang cập nhật...'}</strong></span>
                <span>•</span>
                <span>Lần chạy tới: <strong className="text-emerald-300">{scheduleStatus?.nextRun || '01:00 AM / 13:00 PM'}</strong></span>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0 self-end md:self-center">
            <button
              onClick={triggerScheduleScanNow}
              disabled={isTriggeringSchedule || scheduleStatus?.isRunning}
              className="px-3.5 py-2 bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-500 hover:to-purple-500 disabled:opacity-50 text-white text-xs font-semibold rounded-xl flex items-center gap-1.5 transition cursor-pointer shadow-lg shadow-indigo-600/25"
              title="Kích hoạt chạy quét toàn bộ VTVGo và đồng bộ lên GitHub ngay lúc này"
            >
              {isTriggeringSchedule || scheduleStatus?.isRunning ? (
                <>
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  <span>Đang chạy quét...</span>
                </>
              ) : (
                <>
                  <Zap className="w-3.5 h-3.5" />
                  <span>Chạy quét thử ngay</span>
                </>
              )}
            </button>
            <button
              onClick={openGhModal}
              className="p-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700 text-xs transition cursor-pointer"
              title="Cài đặt thông tin GitHub"
            >
              <Settings className="w-4 h-4 text-indigo-400" />
            </button>
          </div>
        </div>

        {/* ================= PLAYER (FULL WIDTH) ================= */}
        <div
          ref={playerRef}
          className="bg-slate-900/90 border border-slate-800 rounded-2xl overflow-hidden shadow-2xl flex flex-col scroll-mt-24"
        >
          <div className="bg-slate-950 px-4 py-3 border-b border-slate-800 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Radio className="w-4 h-4 text-emerald-400 animate-pulse" />
              <span className="text-xs font-semibold text-white">
                Màn hình phát luồng HLS trực tiếp
              </span>
              {useProxyForPlayback && (
                <span className="px-1.5 py-0.5 rounded text-[10px] bg-purple-500/20 text-purple-300 border border-purple-500/40">
                  Qua Proxy CORS
                </span>
              )}
            </div>

            {streamInfo?.resolution && (
              <div className="flex items-center gap-2 text-[11px] font-mono text-slate-400">
                <span className="px-2 py-0.5 rounded bg-slate-800 border border-slate-700 text-indigo-300">
                  {streamInfo.resolution}
                </span>
                {streamInfo.bitrate && (
                  <span className="px-2 py-0.5 rounded bg-slate-800 border border-slate-700">
                    {streamInfo.bitrate}
                  </span>
                )}
              </div>
            )}
          </div>

          <div className="relative aspect-video bg-black flex items-center justify-center overflow-hidden group">
            <video
              ref={videoRef}
              className="w-full h-full object-contain"
              playsInline
              onClick={togglePlay}
            />

            {!activeStreamUrl && !playbackError && (
              <div className="absolute inset-0 flex flex-col items-center justify-center text-slate-500 space-y-2 pointer-events-none">
                <Film className="w-10 h-10" />
                <p className="text-xs">Chưa có luồng nào được chọn</p>
              </div>
            )}

            {playbackError && (
              <div className="absolute inset-0 bg-black/90 flex flex-col items-center justify-center p-6 text-center space-y-3 z-10">
                <AlertCircle className="w-10 h-10 text-amber-400" />
                <div className="max-w-md space-y-1">
                  <h4 className="text-sm font-semibold text-white">
                    Không thể phát trực tiếp trên trình duyệt
                  </h4>
                  <p className="text-xs text-slate-400 leading-relaxed">{playbackError}</p>
                </div>
                <div className="flex flex-wrap items-center justify-center gap-2 pt-2">
                  <button
                    onClick={() => {
                      setUseProxyForPlayback(!useProxyForPlayback);
                      if (activeStreamUrl) {
                        loadStreamInPlayer(activeStreamUrl, !useProxyForPlayback);
                      }
                    }}
                    className="px-3.5 py-1.5 bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-medium rounded-lg flex items-center gap-1.5 transition cursor-pointer"
                  >
                    <Zap className="w-3.5 h-3.5" />
                    <span>
                      {useProxyForPlayback ? 'Tắt Proxy CORS' : 'Bật Proxy CORS Server'}
                    </span>
                  </button>
                  <button
                    onClick={() => activeStreamUrl && copyText(activeStreamUrl)}
                    className="px-3.5 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-medium rounded-lg flex items-center gap-1.5 transition cursor-pointer"
                  >
                    <Copy className="w-3.5 h-3.5" />
                    <span>Sao chép mở trên VLC / PotPlayer</span>
                  </button>
                </div>
              </div>
            )}

            {!playbackError && activeStreamUrl && (
              <button
                onClick={togglePlay}
                className="absolute w-16 h-16 rounded-full bg-slate-900/70 hover:bg-indigo-600 text-white flex items-center justify-center backdrop-blur-md border border-white/20 opacity-0 group-hover:opacity-100 transition-all duration-200 cursor-pointer shadow-xl"
              >
                {isPlaying ? (
                  <Pause className="w-7 h-7" />
                ) : (
                  <Play className="w-7 h-7 ml-1" />
                )}
              </button>
            )}
          </div>

          <div className="p-3 bg-slate-950 border-t border-slate-800 flex flex-wrap items-center justify-between gap-3 text-xs">
            <div className="flex items-center gap-3">
              <button
                onClick={togglePlay}
                disabled={!activeStreamUrl}
                className="p-2 rounded-lg bg-slate-800 hover:bg-slate-700 disabled:opacity-40 text-white transition cursor-pointer"
                title={isPlaying ? 'Tạm dừng' : 'Phát'}
              >
                {isPlaying ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4" />}
              </button>

              <div className="flex items-center gap-2">
                <button
                  onClick={toggleMute}
                  disabled={!activeStreamUrl}
                  className="p-2 rounded-lg bg-slate-800 hover:bg-slate-700 disabled:opacity-40 text-white transition cursor-pointer"
                  title={isMuted ? 'Bật âm' : 'Tắt âm'}
                >
                  {isMuted ? (
                    <VolumeX className="w-4 h-4 text-red-400" />
                  ) : (
                    <Volume2 className="w-4 h-4" />
                  )}
                </button>
                <input
                  type="range"
                  min="0"
                  max="1"
                  step="0.05"
                  value={isMuted ? 0 : volume}
                  onChange={(e) => handleVolumeChange(parseFloat(e.target.value))}
                  disabled={!activeStreamUrl}
                  className="w-16 sm:w-20 accent-indigo-500 cursor-pointer disabled:opacity-40"
                />
              </div>
            </div>

            <div className="flex items-center gap-2">
              {qualityLevels.length > 0 && (
                <div className="flex items-center gap-1.5 bg-slate-900 px-2 py-1 rounded-lg border border-slate-800">
                  <Layers className="w-3.5 h-3.5 text-indigo-400" />
                  <select
                    value={currentLevel}
                    onChange={(e) => {
                      if (hlsRef.current) {
                        hlsRef.current.currentLevel = parseInt(e.target.value);
                        setCurrentLevel(parseInt(e.target.value));
                      }
                    }}
                    className="bg-transparent text-slate-200 text-xs focus:outline-none cursor-pointer"
                  >
                    <option value={-1} className="bg-slate-900">
                      Tự động (Auto)
                    </option>
                    {qualityLevels.map((lvl) => (
                      <option key={lvl.id} value={lvl.id} className="bg-slate-900">
                        {lvl.name}
                      </option>
                    ))}
                  </select>
                </div>
              )}

              <button
                onClick={toggleFullscreen}
                disabled={!activeStreamUrl}
                className="p-2 rounded-lg bg-slate-800 hover:bg-slate-700 disabled:opacity-40 text-white transition cursor-pointer"
                title="Toàn màn hình"
              >
                <Maximize className="w-4 h-4" />
              </button>
            </div>
          </div>
        </div>

        {/* ================= DANH SÁCH KẾT QUẢ ================= */}
        <div className="bg-slate-900/90 border border-slate-800 rounded-2xl p-5 shadow-2xl">
          <div className="flex items-center justify-between pb-3 border-b border-slate-800">
            <div className="flex items-center gap-2">
              <ListVideo className="w-4 h-4 text-purple-400" />
              <h3 className="font-semibold text-sm text-white">KẾT QUẢ M3U8:</h3>
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              <span className="px-2 py-0.5 rounded-full bg-purple-500/20 text-purple-300 text-[10px] font-bold">
                {extractedStreams.length} luồng
              </span>
              {extractedStreams.length > 0 && (
                <button
                  onClick={probeAllCurrentStreams}
                  disabled={isProbing}
                  className="px-2.5 py-1 rounded-lg bg-amber-600/20 hover:bg-amber-600/30 disabled:opacity-50 border border-amber-500/40 text-amber-300 text-[11px] font-medium flex items-center gap-1.5 transition cursor-pointer"
                  title="Dò lại chất lượng toàn bộ luồng"
                >
                  {isProbing ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <Activity className="w-3.5 h-3.5" />
                  )}
                  <span>Dò chất lượng</span>
                </button>
              )}
              {extractedStreams.length > 0 && (
                <button
                  onClick={savePlaylistToTvPremium}
                  disabled={isSavingPlaylist}
                  className="px-3 py-1 rounded-lg bg-gradient-to-r from-indigo-600 via-purple-600 to-pink-600 hover:from-indigo-500 hover:to-pink-500 disabled:opacity-50 text-white text-[11px] font-semibold flex items-center gap-1.5 transition cursor-pointer shadow-md shadow-indigo-600/30"
                  title="Lưu kết quả vào file tvPremium.m3u để đồng bộ lên GitHub"
                >
                  {isSavingPlaylist ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <Save className="w-3.5 h-3.5" />
                  )}
                  <span>Lưu file tvPremium.m3u (GitHub)</span>
                </button>
              )}
              {extractedStreams.length > 0 && (
                <button
                  onClick={exportFoundLinks}
                  className="px-2.5 py-1 rounded-lg bg-emerald-600/20 hover:bg-emerald-600/30 border border-emerald-500/40 text-emerald-300 text-[11px] font-medium flex items-center gap-1.5 transition cursor-pointer"
                  title="Tải file tvPremium.m3u về máy tính"
                >
                  <Download className="w-3.5 h-3.5" />
                  <span>Tải .m3u</span>
                </button>
              )}
              {extractedStreams.length > 0 && (
                <button
                  onClick={clearAllStreams}
                  className="px-2.5 py-1 rounded-lg bg-red-600/20 hover:bg-red-600/30 border border-red-500/40 text-red-300 text-[11px] font-medium flex items-center gap-1.5 transition cursor-pointer"
                  title="Xóa tất cả KQ"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  <span>Xóa tất cả</span>
                </button>
              )}
            </div>
          </div>

          {/* Toast / Notification when saved */}

          {/* Toast / Notification when saved */}
          {saveSuccessNotice && (
            <div className="mt-3 p-3.5 bg-emerald-950/90 border border-emerald-500/60 rounded-xl text-xs text-emerald-200 flex items-start justify-between gap-3 shadow-xl">
              <div className="flex items-start gap-2.5">
                <CheckCircle2 className="w-4 h-4 text-emerald-400 mt-0.5 shrink-0" />
                <div className="space-y-1">
                  <p className="font-bold text-emerald-100">
                    Đã lưu thành công vào file tvPremium.m3u trong dự án!
                  </p>
                  <p className="text-slate-300 text-[11px] leading-relaxed">
                    File <code className="bg-slate-900 px-1 py-0.5 rounded text-indigo-300 font-mono">tvPremium.m3u</code> đã được cập nhật trực tiếp trên máy chủ. 
                    Bây giờ bạn chỉ cần mở tab <strong>GitHub sync</strong> (ở thanh trên cùng của AI Studio) và bấm <strong>[ ↥ Push changes to GitHub ]</strong> để đồng bộ lên GitHub của bạn!
                  </p>
                </div>
              </div>
              <button
                onClick={() => setSaveSuccessNotice(null)}
                className="text-slate-400 hover:text-white p-1 shrink-0"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          )}

          {sortedStreams.length > 0 ? (
            <div className="mt-4 flex flex-col gap-2 max-h-[600px] overflow-y-auto pr-1">
              {sortedStreams.map((st, i) => {
                const isActive = st.url === activeStreamUrl;

                const urlChannelMatch = st.url.match(/\/channel\/(\d+)(?:[/?#]|$)/i);
                const displayNumber =
                  st.channelNumber ??
                  (urlChannelMatch ? parseInt(urlChannelMatch[1], 10) : i + 1);

                const getCdnName = (url: string, sourceType?: string) => {
                  if (sourceType && sourceType.includes('(') && sourceType.includes(')')) {
                    const match = sourceType.match(/\(([^)]+)\)/);
                    if (match && match[1]) return match[1];
                  }
                  if (url.includes('aws') || url.includes('cloudfront')) return 'AWS CloudFront CDN';
                  if (url.includes('akamaized.net')) return 'Akamai CDN';
                  if (url.includes('tv360') || url.includes('viettel')) return 'TV360 Viettel CDN';
                  if (url.includes('vnetwork')) return 'VNetwork CDN';
                  if (url.includes('vtvdigital') || url.includes('vtvgolive')) return 'VTV Digital CDN';
                  if (url.includes('fptplay')) return 'FPT Play CDN';
                  return 'HLS Stream';
                };
                const cdnName = getCdnName(st.url, st.sourceType);

                const cleanTitle =
                  st.channelName ||
                  st.pageTitle
                    ?.replace(/^(?:VTVgo|TV360|FPT Play)\s*(?:Trực Tiếp\s*)?[-:]\s*/i, '')
                    ?.replace(/\s*[-:]\s*(?:TV360|VTVgo|FPT Play).*$/i, '') ||
                  'Không tên';

                return (
                  <div
                    key={`${st.url}-${i}`}
                    className={`p-3 rounded-xl border transition-all flex flex-col gap-2 ${
                      isActive
                        ? 'bg-indigo-950/70 border-indigo-500/60 shadow-lg shadow-indigo-950/50'
                        : 'bg-slate-950/70 border-slate-800 hover:border-slate-700'
                    }`}
                  >
                    {/* HÀNG TRÊN: số + CDN + tên + chất lượng + NÚT THAO TÁC (cùng hàng) */}
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-slate-800 text-slate-300 border border-slate-700 shrink-0 font-bold">
                        #{displayNumber}
                      </span>
                      <span className="text-slate-500 text-xs font-bold">+</span>
                      <span className="text-[11px] font-mono px-2 py-0.5 rounded bg-slate-800/60 text-slate-400 border border-slate-700/60 shrink-0">
                        ({cdnName})
                      </span>
                      <span className="text-slate-500 text-xs font-bold">+</span>
                      <span
                        className="text-[11px] font-medium text-cyan-300 break-words"
                        title={st.pageTitle}
                      >
                        {cleanTitle}
                      </span>

                      {/* ===== BADGE CHẤT LƯỢNG ===== */}
                      {st.probeStatus === 'pending' && (
                        <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-slate-500/15 text-slate-300 border border-slate-500/30 flex items-center gap-1 shrink-0">
                          <Loader2 className="w-2.5 h-2.5 animate-spin" />
                          Chờ dò...
                        </span>
                      )}

                      {st.probeStatus === 'probing' && (
                        <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-amber-500/15 text-amber-300 border border-amber-500/30 flex items-center gap-1 shrink-0">
                          <Loader2 className="w-2.5 h-2.5 animate-spin" />
                          Đang dò chất lượng...
                        </span>
                      )}

                      {st.probeStatus === 'done' && st.probeBest && (
                        <span
                          className="text-[10px] font-mono px-2 py-0.5 rounded bg-emerald-500/15 text-emerald-300 border border-emerald-500/30 flex items-center gap-1 shrink-0"
                          title={
                            st.probeLevels && st.probeLevels.length > 0
                              ? 'Các mức: ' +
                                st.probeLevels
                                  .map((l) =>
                                    l.height
                                      ? `${l.height}p@${Math.round((l.bitrate || 0) / 1000)}k`
                                      : `${Math.round((l.bitrate || 0) / 1000)}k`
                                  )
                                  .join(' • ')
                              : undefined
                          }
                        >
                          <Activity className="w-2.5 h-2.5" />
                          {st.probeBest.resolution || 'N/A'}
                          {st.probeBest.bitrate ? ` • ${st.probeBest.bitrate}` : ''}
                          {st.probeLevels && st.probeLevels.length > 1 && (
                            <span className="text-emerald-400/80">
                              ({st.probeLevels.length} mức)
                            </span>
                          )}
                        </span>
                      )}

                      {st.probeStatus === 'done' && !st.probeBest && (
                        <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-slate-500/15 text-slate-300 border border-slate-500/30 flex items-center gap-1 shrink-0">
                          <Activity className="w-2.5 h-2.5" />
                          Không rõ chất lượng
                        </span>
                      )}

                      {st.probeStatus === 'error' && (
                        <span
                          className="text-[10px] font-mono px-2 py-0.5 rounded bg-red-500/15 text-red-300 border border-red-500/30 flex items-center gap-1 shrink-0"
                          title={st.probeError}
                        >
                          <AlertCircle className="w-2.5 h-2.5" />
                          Không dò được
                        </span>
                      )}

                      {/* ===== NÚT THAO TÁC (cùng hàng với chất lượng) ===== */}
                      <div className="flex items-center gap-1.5 shrink-0 ml-auto">
                        <button
                          onClick={() => playStream(st.url)}
                          className={`px-2.5 py-1 rounded-lg text-xs font-medium flex items-center gap-1 transition cursor-pointer ${
                            isActive
                              ? 'bg-indigo-600 text-white'
                              : 'bg-slate-800 hover:bg-slate-700 text-slate-200'
                          }`}
                        >
                          <Play className="w-3 h-3" />
                          <span>Phát</span>
                        </button>

                        <button
                          onClick={() => copyText(st.url)}
                          className="px-2.5 py-1 rounded-lg text-xs font-medium bg-slate-800 hover:bg-slate-700 text-slate-200 flex items-center gap-1 transition cursor-pointer"
                          title="Sao chép liên kết"
                        >
                          {copiedUrl === st.url ? (
                            <>
                              <Check className="w-3 h-3 text-emerald-400" />
                              <span>Đã chép</span>
                            </>
                          ) : (
                            <>
                              <Copy className="w-3 h-3" />
                              <span>Copy</span>
                            </>
                          )}
                        </button>

                        <a
                          href={st.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 transition"
                          title="Mở trực tiếp link"
                        >
                          <ExternalLink className="w-3.5 h-3.5" />
                        </a>

                        {isActive && (
                          <span className="text-[10px] font-medium text-emerald-400 flex items-center gap-1 shrink-0 ml-1">
                            <Radio className="w-2.5 h-2.5 animate-pulse" />
                            Đang chọn
                          </span>
                        )}
                      </div>
                    </div>

                    {/* HÀNG DƯỚI: URL đầy đủ */}
                    <div className="w-full">
                      <p
                        className="font-mono text-[11px] text-slate-300 break-all select-all leading-relaxed whitespace-pre-wrap"
                        title={st.url}
                      >
                        {st.url}
                      </p>
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center text-xs text-slate-500 space-y-2 py-12">
              <FileCode className="w-8 h-8 mx-auto text-slate-600" />
              <p>Chưa có luồng nào được phát hiện.</p>
            </div>
          )}
        </div>
      </main>

      {/* GitHub Auto-Sync Modal */}
      {isGhModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-sm">
          <div
            className="bg-slate-900 border border-slate-800 rounded-2xl w-full max-w-lg shadow-2xl overflow-hidden flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="p-4 border-b border-slate-800 flex items-center justify-between bg-slate-950/70">
              <div className="flex items-center gap-2">
                <Settings className="w-5 h-5 text-indigo-400" />
                <h3 className="font-semibold text-sm text-white">
                  Cấu hình Tự động Lưu & Đồng bộ GitHub
                </h3>
              </div>
              <button
                onClick={() => setIsGhModalOpen(false)}
                className="p-1 rounded-lg text-slate-400 hover:text-white transition cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-5 space-y-4 text-xs">
              <div className="p-3 bg-indigo-950/40 border border-indigo-700/40 rounded-xl text-slate-300 space-y-1.5 leading-relaxed">
                <p className="font-semibold text-indigo-200 flex items-center gap-1.5">
                  <Zap className="w-3.5 h-3.5 text-indigo-400" />
                  Cơ chế tự động:
                </p>
                <p>
                  1. Mỗi khi dò kênh xong, playlist sẽ <strong>tự động lưu vào file <code className="text-white font-mono bg-slate-900 px-1 py-0.5 rounded">tvPremium.m3u</code></strong> trong dự án.
                </p>
                <p>
                  2. Nếu có <strong>GitHub Token</strong>, hệ thống sẽ tự động gọi GitHub API để <strong>tạo mới hoặc ghi đè file <code className="text-white font-mono bg-slate-900 px-1 py-0.5 rounded">tvPremium.m3u</code> trên GitHub</strong> của bạn mà không cần bấm nút thủ công.
                </p>
              </div>

              {/* Repo input */}
              <div className="space-y-1.5">
                <label className="font-medium text-slate-300 flex items-center justify-between">
                  <span>GitHub Repository:</span>
                  <span className="text-[10px] text-slate-500 font-mono">owner/repo-name</span>
                </label>
                <input
                  type="text"
                  value={tempRepo}
                  onChange={(e) => setTempRepo(e.target.value)}
                  placeholder="thanhthovn/tvPremium"
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs font-mono text-slate-200 placeholder:text-slate-600 focus:outline-none focus:border-indigo-500"
                />
              </div>

              {/* Branch input */}
              <div className="space-y-1.5">
                <label className="font-medium text-slate-300 flex items-center justify-between">
                  <span>Nhánh (Branch):</span>
                  <span className="text-[10px] text-slate-500">Mặc định: main</span>
                </label>
                <input
                  type="text"
                  value={tempBranch}
                  onChange={(e) => setTempBranch(e.target.value)}
                  placeholder="main"
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs font-mono text-slate-200 placeholder:text-slate-600 focus:outline-none focus:border-indigo-500"
                />
              </div>

              {/* Token input */}
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <label className="font-medium text-slate-300 flex items-center gap-1.5">
                    <Key className="w-3.5 h-3.5 text-amber-400" />
                    <span>GitHub Personal Access Token (PAT):</span>
                  </label>
                  <a
                    href="https://github.com/settings/tokens/new?scopes=repo&description=M3U8-AutoSync"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-[10px] text-indigo-400 hover:underline flex items-center gap-1"
                  >
                    <span>Tạo Token (1 phút)</span>
                    <ExternalLink className="w-2.5 h-2.5" />
                  </a>
                </div>
                <div className="relative">
                  <input
                    type={showGhToken ? 'text' : 'password'}
                    value={tempToken}
                    onChange={(e) => setTempToken(e.target.value)}
                    placeholder="ghp_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 pr-10 text-xs font-mono text-slate-200 placeholder:text-slate-600 focus:outline-none focus:border-indigo-500"
                  />
                  <button
                    type="button"
                    onClick={() => setShowGhToken(!showGhToken)}
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-white cursor-pointer"
                  >
                    {showGhToken ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
                <p className="text-[10px] text-slate-500">
                  Token cần quyền <code className="text-indigo-300">repo</code> (với Classic Token) hoặc <code className="text-indigo-300">Contents: Read and write</code> (với Fine-grained Token).
                </p>
              </div>

              {/* Auto Sync Toggle */}
              <div className="p-3 bg-slate-950 rounded-xl border border-slate-800 flex items-center justify-between">
                <div>
                  <p className="font-medium text-slate-200">Tự động đẩy lên GitHub khi dò kênh xong</p>
                  <p className="text-[10px] text-slate-500">
                    Ghi đè và commit file tvPremium.m3u ngay khi hoàn tất
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setTempAutoSync(!tempAutoSync)}
                  className={`w-11 h-6 rounded-full transition-colors flex items-center p-1 cursor-pointer ${
                    tempAutoSync ? 'bg-indigo-600 justify-end' : 'bg-slate-700 justify-start'
                  }`}
                >
                  <div className="w-4 h-4 rounded-full bg-white shadow-md" />
                </button>
              </div>
            </div>

            <div className="p-4 bg-slate-950/80 border-t border-slate-800 flex items-center justify-between gap-2">
              {extractedStreams.length > 0 && tempToken && (
                <button
                  type="button"
                  onClick={() => {
                    saveGhSettings(tempToken, tempRepo, tempBranch, tempAutoSync);
                    setTimeout(() => {
                      executeAutoSaveAndSync(
                        extractedStreams,
                        true,
                        `Manual sync tvPremium.m3u (${extractedStreams.length} channels)`
                      );
                    }, 50);
                  }}
                  disabled={isSavingPlaylist}
                  className="px-3 py-1.5 text-xs text-indigo-300 hover:text-white bg-indigo-950/60 hover:bg-indigo-900 border border-indigo-700/50 rounded-lg flex items-center gap-1.5 transition cursor-pointer"
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${isSavingPlaylist ? 'animate-spin' : ''}`} />
                  <span>Lưu & Đồng bộ ngay</span>
                </button>
              )}
              <div className="flex items-center gap-2 ml-auto">
                <button
                  onClick={() => setIsGhModalOpen(false)}
                  className="px-3 py-1.5 text-xs text-slate-400 hover:text-white transition cursor-pointer"
                >
                  Đóng
                </button>
                <button
                  onClick={() => {
                    saveGhSettings(tempToken, tempRepo, tempBranch, tempAutoSync);
                    alert('Đã lưu cấu hình GitHub thành công!');
                  }}
                  className="px-4 py-1.5 bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold rounded-lg transition cursor-pointer shadow-md shadow-indigo-600/30"
                >
                  Lưu cấu hình
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Raw HTML Paste Modal */}
      {isRawModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-sm">
          <div
            className="bg-slate-900 border border-slate-800 rounded-2xl w-full max-w-xl shadow-2xl overflow-hidden flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="p-4 border-b border-slate-800 flex items-center justify-between bg-slate-950/70">
              <div className="flex items-center gap-2">
                <Code2 className="w-5 h-5 text-indigo-400" />
                <h3 className="font-semibold text-sm text-white">
                  Dán mã nguồn HTML / Script chứa M3U8
                </h3>
              </div>
              <button
                onClick={() => setIsRawModalOpen(false)}
                className="p-1 rounded-lg text-slate-400 hover:text-white transition cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-4 space-y-3">
              <textarea
                rows={8}
                value={rawHtmlInput}
                onChange={(e) => setRawHtmlInput(e.target.value)}
                placeholder="Dán mã nguồn HTML, JSON, cURL hoặc đoạn script chứa link .m3u8 vào đây..."
                className="w-full bg-slate-950 border border-slate-800 rounded-xl p-3 text-xs font-mono text-slate-200 placeholder:text-slate-600 focus:outline-none focus:border-indigo-500 resize-none"
              />
            </div>

            <div className="p-4 bg-slate-950/80 border-t border-slate-800 flex items-center justify-between">
              <div className="flex items-center gap-2 ml-auto">
                <button
                  onClick={() => setIsRawModalOpen(false)}
                  className="px-3 py-1.5 text-xs text-slate-400 hover:text-white transition cursor-pointer"
                >
                  Hủy
                </button>
                <button
                  onClick={handleParseRawHtml}
                  disabled={!rawHtmlInput.trim()}
                  className="px-4 py-1.5 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white text-xs font-medium rounded-lg transition cursor-pointer"
                >
                  Trích xuất ngay
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Floating Copied Toast */}
      {copiedUrl && (
        <div className="fixed bottom-6 right-6 z-50 bg-slate-900 border border-emerald-500/40 text-emerald-200 px-4 py-2.5 rounded-xl shadow-2xl text-xs flex items-center gap-2 backdrop-blur-md">
          <CheckCircle2 className="w-4 h-4 text-emerald-400" />
          <span>Đã sao chép liên kết M3U8 vào bộ nhớ tạm!</span>
        </div>
      )}

      {/* Footer */}
      <footer className="border-t border-slate-800/80 bg-slate-950/80 py-4 px-6 text-center text-xs text-slate-500 mt-auto">
        HLS M3U8 Extractor & Player — Trích xuất đơn lẻ + Hàng loạt từ file .txt
      </footer>
    </div>
  );
}