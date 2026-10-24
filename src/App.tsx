import React, { useState, useEffect, useRef, useCallback } from 'react';
import Hls from 'hls.js';
import {
  Globe, Play, Pause, Volume2, VolumeX, Maximize, Copy, Check,
  Search, ExternalLink, Film, Layers, Radio, AlertCircle, CheckCircle2,
  RotateCw, Code2, X, Tv,
  ListVideo, FileCode, Zap, Activity,
  Upload, Download,
  FileText, Trash2, Loader2, Save,
  Settings, Key, Eye, EyeOff, RefreshCw, Clock, Wand2,
} from 'lucide-react';

interface ExtractedStream {
  url: string;
  sourceType: string;
  pageTitle?: string;
  quality?: string;
  resolution?: string;
  channelNumber?: number;
  channelName?: string;
  probeStatus?: 'pending' | 'probing' | 'done' | 'error';
  probeLevels?: { height?: number; width?: number; bitrate?: number }[];
  probeBest?: { resolution?: string; bitrate?: string };
  probeError?: string;
}

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

const getQualityScore = (best?: { resolution?: string; bitrate?: string }): number => {
  if (!best) return -1;
  let score = 0;
  const res = best.resolution || '';
  const heightMatch = res.match(/(\d+)\s*p?$/i) || res.match(/x(\d+)$/i);
  const height = heightMatch ? parseInt(heightMatch[1], 10) : 0;
  score += (isNaN(height) ? 0 : height) * 1_000_000;
  const brMatch = (best.bitrate || '').match(/(\d+)/);
  const kbps = brMatch ? parseInt(brMatch[1], 10) : 0;
  score += isNaN(kbps) ? 0 : kbps * 1000;
  return score;
};

const compareStreamQuality = (a: ExtractedStream, b: ExtractedStream): number => {
  const sa = getQualityScore(a.probeBest);
  const sb = getQualityScore(b.probeBest);
  if (sa === -1 && sb === -1) return 0;
  if (sa !== sb) return sb - sa;
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

function getChannelPriority(name: string): number {
  const n = (name || '').trim();
  const vtvPureMatch = n.match(/^VTV\s*([1-9]|10)$/i);
  if (vtvPureMatch) return parseInt(vtvPureMatch[1], 10);
  if (/^VTV\s*6\b/i.test(n) || /VTV\s*Cần Thơ/i.test(n)) return 6;
  if (/^VTV5\s/i.test(n)) return 15;
  if (/^VTV/i.test(n)) return 30;
  return 100;
}

const buildM3uLines = (streams: ExtractedStream[]): string[] => {
  const groups = new Map<string, ExtractedStream[]>();
  streams.forEach((stream) => {
    const rawTitle =
      stream.channelName ||
      stream.pageTitle ||
      (typeof stream.channelNumber === 'number'
        ? `Kênh ${stream.channelNumber}`
        : getHostname(stream.url)) ||
      'Kênh không tên';
    const channelTitle =
      rawTitle
        .replace(/^(?:VTVgo|TV360|FPT Play)\s*(?:Trực Tiếp\s*)?[-:]\s*/i, '')
        .replace(/\s*[-:]\s*(?:TV360|VTVgo|FPT Play).*$/i, '')
        .replace(/[\r\n]+/g, ' ')
        .trim() || 'Kênh không tên';
    if (!groups.has(channelTitle)) groups.set(channelTitle, []);
    const arr = groups.get(channelTitle)!;
    if (!arr.some((s) => s.url === stream.url)) arr.push(stream);
  });
  const lines: string[] = ['#EXTM3U'];
  const sortedTitles = Array.from(groups.keys()).sort((a, b) => {
    const prioA = getChannelPriority(a);
    const prioB = getChannelPriority(b);
    if (prioA !== prioB) return prioA - prioB;
    return a.localeCompare(b, 'vi');
  });
  sortedTitles.forEach((channelTitle) => {
    const groupStreams = groups.get(channelTitle) || [];
    const sorted = [...groupStreams].sort(compareStreamQuality);
    const s = sorted[0];
    if (!s) return;
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

  const [isPlaying, setIsPlaying] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  const [volume, setVolume] = useState(1);
  const [qualityLevels, setQualityLevels] = useState<{ id: number; name: string }[]>([]);
  const [currentLevel, setCurrentLevel] = useState<number>(-1);
  const [playbackError, setPlaybackError] = useState<string | null>(null);
  const [streamInfo, setStreamInfo] = useState<{ resolution?: string; bitrate?: string } | null>(null);
  const [copiedUrl, setCopiedUrl] = useState<string | null>(null);

  const [isProbing, setIsProbing] = useState(false);
  const [autoProbeEnabled, setAutoProbeEnabled] = useState(true);
  const probeSessionRef = useRef(0);

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

  const [vtvgoStart, setVtvgoStart] = useState('1');
  const [vtvgoEnd, setVtvgoEnd] = useState('99');
  const [isVtvgoScanning, setIsVtvgoScanning] = useState(false);
  const [vtvgoProgress, setVtvgoProgress] = useState({ done: 0, total: 0 });
  const vtvgoCancelRef = useRef(false);
  const [isScanningPortal, setIsScanningPortal] = useState(false);
  const [portalChannelCount, setPortalChannelCount] = useState<number | null>(null);

  const [isScanningXemtv, setIsScanningXemtv] = useState(false);
  const [xemtvChannelCount, setXemtvChannelCount] = useState<number | null>(null);
  const [xemtvScanLimit, setXemtvScanLimit] = useState('120');

  const [playlistFileStatus, setPlaylistFileStatus] = useState<{
    exists: boolean;
    filename: string;
    size?: number;
    updatedAt?: string;
    channelCount?: number;
  } | null>(null);
  const [isSavingPlaylist, setIsSavingPlaylist] = useState(false);
  const [saveSuccessNotice, setSaveSuccessNotice] = useState<string | null>(null);

  const [ghToken, setGhToken] = useState(() => localStorage.getItem('gh_token') || '');
  const [ghRepo, setGhRepo] = useState(() => localStorage.getItem('gh_repo') || 'thanhthovn/tvPremium');
  const [ghBranch, setGhBranch] = useState(() => localStorage.getItem('gh_branch') || 'main');
  const [autoSaveAndSync, setAutoSaveAndSync] = useState(() => localStorage.getItem('gh_auto_sync') !== 'false');
  const [isGhModalOpen, setIsGhModalOpen] = useState(false);
  const [showGhToken, setShowGhToken] = useState(false);

  const [tempToken, setTempToken] = useState(ghToken);
  const [tempRepo, setTempRepo] = useState(ghRepo);
  const [tempBranch, setTempBranch] = useState(ghBranch);
  const [tempAutoSync, setTempAutoSync] = useState(autoSaveAndSync);
  const [isLoadingIptvOri, setIsLoadingIptvOri] = useState(false);

  /* ===== SMART REPLACE STATE ===== */
  const [isSmartReplacing, setIsSmartReplacing] = useState(false);
  const [smartReplaceProgress, setSmartReplaceProgress] = useState({ done: 0, total: 0, current: '' });
  const [smartReplaceLog, setSmartReplaceLog] = useState<
    Array<{
      slug: string;
      name: string;
      status: 'pending' | 'scanning' | 'found' | 'kept' | 'error';
      oldUrl?: string;
      newUrl?: string;
      quality?: string;
      source?: string;
      note?: string;
    }>
  >([]);
  const [smartReplaceSummary, setSmartReplaceSummary] = useState<{
    total: number;
    replaced: number;
    kept: number;
    failed: number;
    githubSynced?: boolean;
    commitUrl?: string;
  } | null>(null);

  // 🆕 Lưu nội dung M3U mới sau smart replace
  const [smartReplaceM3uContent, setSmartReplaceM3uContent] = useState<string | null>(null);

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
    } catch {
      /* ignore */
    }
  }, []);

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
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    fetchPlaylistStatus();
    fetchScheduleStatus();
    fetch('/api/discover-vtvgo-channels')
      .then((r) => r.json())
      .then((d) => {
        if (d?.count) setPortalChannelCount(d.count);
      })
      .catch(() => {});
    fetch('/api/discover-xemtv-channels')
      .then((r) => r.json())
      .then((d) => {
        if (d?.count) setXemtvChannelCount(d.count);
      })
      .catch(() => {});
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
          `⚡ Quét VTVGo xong: ${data.scanResult?.totalStreams || 0} luồng!`
        );
        setTimeout(() => setSaveSuccessNotice(null), 8000);
      } else {
        alert(data.message || data.error || 'Có lỗi khi chạy.');
      }
    } catch (e: any) {
      alert('Lỗi: ' + e.message);
    } finally {
      setIsTriggeringSchedule(false);
    }
  };

  const executeAutoSaveAndSync = useCallback(
    async (streamsToSave: ExtractedStream[], showNotification = true, customMsg?: string) => {
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
            commitMessage: customMsg || `Auto-sync (${streamsToSave.length} channels)`,
          }),
        });
        const data = await res.json();
        fetchPlaylistStatus();
        if (res.ok && data.success) {
          if (showNotification) {
            setSaveSuccessNotice(
              data.githubSynced
                ? `⚡ Đã sync GitHub (${data.repo}/tvPremium.m3u)!`
                : `💾 Đã lưu local ${data.channelCount} kênh!`
            );
            setTimeout(() => setSaveSuccessNotice(null), 8000);
          }
        }
      } catch (err: any) {
        console.error('Sync error:', err.message);
      } finally {
        setIsSavingPlaylist(false);
      }
    },
    [ghToken, ghRepo, ghBranch, fetchPlaylistStatus]
  );

  const videoRef = useRef<HTMLVideoElement>(null);
  const hlsRef = useRef<Hls | null>(null);
  const playerRef = useRef<HTMLDivElement>(null);
  const scanSessionRef = useRef(0);

  const copyText = (text: string) => {
    navigator.clipboard.writeText(text);
    setCopiedUrl(text);
    setTimeout(() => setCopiedUrl(null), 2500);
  };

  const normalizeTargetUrl = (url: string): string => {
    let trimmed = url.trim();
    if (!/^https?:\/\//i.test(trimmed)) trimmed = 'https://' + trimmed;
    return trimmed;
  };

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

  const resetAllResults = useCallback(() => {
    scanSessionRef.current += 1;
    probeSessionRef.current += 1;
    setExtractedStreams([]);
    setBatchResults([]);
    setScanStatus(null);
    setScanError(null);
    setPageMeta(null);
    setBatchProgress({ done: 0, total: 0 });
    setVtvgoProgress({ done: 0, total: 0 });
    setIsProbing(false);
  }, []);

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
      } catch {
        /* ignore */
      }
    }
    setIsPlaying(false);
    setPlaybackError(null);
    setStreamInfo(null);
    setQualityLevels([]);
    setCurrentLevel(-1);
    setActiveStreamUrl('');
  }, []);

  const playStream = (url: string) => {
    setActiveStreamUrl(url);
    loadStreamInPlayer(url, useProxyForPlayback);
    setTimeout(() => {
      playerRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 100);
  };

  const findM3u8LinksInClientText = (text: string): ExtractedStream[] => {
    const results: ExtractedStream[] = [];
    const seen = new Set<string>();
    const absRegex = /(https?:[\/\\]{1,2}[^\s"'<>\\{}|^`]+?\.m3u8(?:\?[^\s"'<>\\{}|^`]*)?)/gi;
    let match;
    while ((match = absRegex.exec(text)) !== null) {
      const cleanUrl = match[1].replace(/\\\//g, '/');
      if (!seen.has(cleanUrl)) {
        seen.add(cleanUrl);
        results.push({ url: cleanUrl, sourceType: 'manual-paste', pageTitle: getHostname(cleanUrl) });
      }
    }
    return results;
  };

  const parseBatchInput = (text: string): string[] => {
    return text
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter((l) => l && !l.startsWith('#') && !l.startsWith('//'));
  };

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
          resolve({ levels: [], error: 'Hls.js không hỗ trợ' });
          return;
        }
        let settled = false;
        let hls: Hls | null = null;
        const cleanup = () => {
          if (hls) {
            try {
              hls.destroy();
            } catch {
              /* ignore */
            }
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
          finish({ levels: [], error: 'Timeout' });
        }, timeoutMs);
        hls = new Hls({
          enableWorker: true,
          autoStartLoad: false,
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
            finish({ levels, error: 'Manifest không có level' });
            return;
          }
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
              bitrate: best.bitrate ? `${Math.round(best.bitrate / 1000)} kbps` : undefined,
            },
          });
        });
        hls.on(Hls.Events.ERROR, (_, data) => {
          if (data.fatal) finish({ levels: [], error: data.details || 'Lỗi' });
        });
        try {
          hls.loadSource(streamUrl);
        } catch (e: any) {
          finish({ levels: [], error: e?.message || 'Lỗi' });
        }
      });
    },
    []
  );

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
          setter((prev) => {
            if (myProbeSession !== undefined && myProbeSession !== probeSessionRef.current)
              return prev;
            const next = [...prev];
            if (next[myIdx]) next[myIdx] = { ...next[myIdx], probeStatus: 'probing' };
            return next;
          });
          if (!/\.m3u8(\?|$)/i.test(s.url)) {
            setter((prev) => {
              if (myProbeSession !== undefined && myProbeSession !== probeSessionRef.current)
                return prev;
              const next = [...prev];
              if (next[myIdx])
                next[myIdx] = { ...next[myIdx], probeStatus: 'error', probeError: 'Không phải .m3u8' };
              return next;
            });
            continue;
          }
          const result = await probeHlsQuality(s.url);
          if (myScanSession !== undefined && myScanSession !== scanSessionRef.current) return;
          if (myProbeSession !== undefined && myProbeSession !== probeSessionRef.current) return;
          setter((prev) => {
            if (myProbeSession !== undefined && myProbeSession !== probeSessionRef.current)
              return prev;
            const next = [...prev];
            if (next[myIdx]) {
              if (result.error && result.levels.length === 0) {
                next[myIdx] = { ...next[myIdx], probeStatus: 'error', probeError: result.error };
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
      await Promise.all(Array.from({ length: Math.min(concurrency, total) }, () => worker()));
      if (myProbeSession !== undefined && myProbeSession !== probeSessionRef.current) return;
      setIsProbing(false);
      if (autoSaveAndSync) {
        setter((finalProbed) => {
          if (finalProbed.length > 0) {
            setTimeout(() => {
              executeAutoSaveAndSync(
                finalProbed,
                true,
                `Auto-sync after probing (${finalProbed.length} channels)`
              );
            }, 60);
          }
          return finalProbed;
        });
      }
    },
    [probeHlsQuality, autoSaveAndSync, executeAutoSaveAndSync]
  );

  const scanForM3u8 = async (target: string) => {
    const cleanUrl = target.trim();
    if (!cleanUrl) return;
    resetAllResults();
    const mySession = scanSessionRef.current;
    setIsScanning(true);
    setScanStatus('Đang phân tích HTML và quét iframe...');
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
      if (!response.ok || !data.success) throw new Error(data.error || 'Không thể kết nối.');
      setPageMeta({ title: data.pageTitle, iframes: data.iframesFound, source: data.source });
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
        setScanStatus(`Tìm thấy ${data.streams.length} luồng M3U8!`);
        if (autoProbeEnabled && titledStreams.length > 0) {
          probeSessionRef.current += 1;
          const myProbe = probeSessionRef.current;
          setTimeout(() => {
            if (mySession !== scanSessionRef.current) return;
            if (myProbe !== probeSessionRef.current) return;
            probeStreamsInParallel(titledStreams, setExtractedStreams, 3, mySession, myProbe);
          }, 50);
        } else if (!autoProbeEnabled && autoSaveAndSync && titledStreams.length > 0) {
          setTimeout(() => {
            executeAutoSaveAndSync(titledStreams, true);
          }, 100);
        }
      } else {
        setScanError('Trang này sinh link động qua JS khi bấm Play.');
      }
    } catch (err: any) {
      if (mySession !== scanSessionRef.current) return;
      setScanError(`${err.message || 'Lỗi'}. Trang có thể chặn bot.`);
    } finally {
      if (mySession === scanSessionRef.current) setIsScanning(false);
    }
  };

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
      const hls = new Hls({ enableWorker: true, lowLatencyMode: true, backBufferLength: 90 });
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
            resolution: firstLevel.height ? `${firstLevel.width}x${firstLevel.height}` : undefined,
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
              setPlaybackError('Lỗi mạng hoặc CORS.');
              if (!forceProxy) setUseProxyForPlayback(true);
              break;
            case Hls.ErrorTypes.MEDIA_ERROR:
              setPlaybackError('Lỗi media, đang phục hồi...');
              hls.recoverMediaError();
              break;
            default:
              setPlaybackError('Không phát được: ' + data.details);
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
      setPlaybackError('Trình duyệt không hỗ trợ HLS.');
    }
  }, []);

  useEffect(() => {
    if (activeStreamUrl) loadStreamInPlayer(activeStreamUrl, useProxyForPlayback);
  }, [activeStreamUrl, useProxyForPlayback, loadStreamInPlayer]);

  const togglePlay = () => {
    const video = videoRef.current;
    if (!video) return;
    if (video.paused)
      video.play().then(() => setIsPlaying(true));
    else {
      video.pause();
      setIsPlaying(false);
    }
  };
  const toggleMute = () => {
    const v = videoRef.current;
    if (!v) return;
    v.muted = !v.muted;
    setIsMuted(v.muted);
  };
  const handleVolumeChange = (newVol: number) => {
    const v = videoRef.current;
    if (!v) return;
    v.volume = newVol;
    setVolume(newVol);
    setIsMuted(newVol === 0);
  };

  const scanSingleUrl = async (
    url: string
  ): Promise<{ streams: ExtractedStream[]; pageTitle?: string; error?: string }> => {
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
        if (/\.m3u8(\?|$)/i.test(url))
          return { streams: [{ url, sourceType: 'direct-input', pageTitle: getHostname(url) }] };
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
      if (/\.m3u8(\?|$)/i.test(url))
        return { streams: [{ url, sourceType: 'direct-input', pageTitle: getHostname(url) }] };
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
      alert('Chưa có URL nào.');
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
    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, urls.length) }, () => worker()));
    if (mySession !== scanSessionRef.current) return;
    setIsBatchRunning(false);
    if (autoProbeEnabled) {
      setBatchResults((prev) => {
        const allStreams = rebuildStreamsFromBatch(prev);
        if (allStreams.length === 0) return prev;
        const initialProbe = allStreams.map((s) => ({ ...s, probeStatus: 'pending' as const }));
        probeSessionRef.current += 1;
        const myProbe = probeSessionRef.current;
        setTimeout(() => {
          if (mySession !== scanSessionRef.current) return;
          if (myProbe !== probeSessionRef.current) return;
          setExtractedStreams(initialProbe);
          probeStreamsInParallel(initialProbe, setExtractedStreams, 3, mySession, myProbe);
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

  const exportFoundLinks = () => {
    if (extractedStreams.length === 0) {
      alert('Chưa có link nào.');
      return;
    }
    const lines = buildM3uLines(extractedStreams);
    downloadTextFile(`tvPremium.m3u`, lines);
  };

  const savePlaylistToTvPremium = async () => {
    if (extractedStreams.length === 0) {
      alert('Chưa có luồng nào!');
      return;
    }
    await executeAutoSaveAndSync(
      extractedStreams,
      true,
      `Manual sync (${extractedStreams.length} channels)`
    );
  };

  const loadIptvOriFromGitHub = async (targetFile = 'iptv_ori.m3u') => {
    setIsLoadingIptvOri(true);
    try {
      const res = await fetch(
        `/api/load-iptv-ori?repo=${encodeURIComponent(ghRepo)}&branch=${encodeURIComponent(
          ghBranch
        )}&filePath=${encodeURIComponent(targetFile)}&token=${encodeURIComponent(ghToken || '')}`
      );
      const data = await res.json();
      if (!data.success) {
        alert(data.error || `Không tải được ${targetFile}`);
        return;
      }
      const converted: ExtractedStream[] = (data.channels || []).map((c: any, idx: number) => ({
        url: c.url,
        sourceType: c.group || 'iptv_ori',
        channelName: c.name,
        pageTitle: `${c.group} - ${c.name}`,
        channelNumber: idx + 1,
        quality: c.name.includes('1080') ? '1080p' : c.name.includes('720') ? '720p' : 'Auto',
        probeStatus: 'pending' as const,
      }));
      setExtractedStreams(converted);
      if (converted.length > 0) setActiveStreamUrl(converted[0].url);
      setSaveSuccessNotice(
        `Đã nạp ${data.totalChannels} kênh từ ${targetFile} (${converted.length} luồng)`
      );
      setTimeout(() => setSaveSuccessNotice(null), 8000);
    } catch (err: any) {
      alert(`Lỗi đọc ${targetFile}: ${err.message}`);
    } finally {
      setIsLoadingIptvOri(false);
    }
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
      if (r.status === 'error') lines.push(`# STATUS: ERROR - ${r.error || 'unknown'}`);
      else {
        lines.push(`# STATUS: ${r.streams.length} stream(s) found`);
        const merged = r.streams.map((s) => {
          const found = extractedStreams.find((x) => x.url === s.url);
          return found ? { ...s, ...found } : s;
        });
        const sorted = merged.sort(compareStreamQuality);
        sorted.forEach((s) => {
          const q = s.probeBest;
          if (q?.resolution || q?.bitrate)
            lines.push(`#  Chất lượng: ${[q.resolution, q.bitrate].filter(Boolean).join(' • ')}`);
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
    if (document.fullscreenElement) document.exitFullscreen();
    else video.requestFullscreen().catch(() => {});
  };

  const buildVtvgoUrl = (num: number): string => `https://vtvgo.vn/channel/${num}`;

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
      alert('Khoảng không hợp lệ');
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

  const scanVtvgoPortal = async () => {
    resetAllResults();
    setIsScanningPortal(true);
    setScanError(null);
    setScanStatus('Đang quét vtvgo.vn...');
    try {
      const res = await fetch('/api/scan-vtvgo-portal', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || 'Không thể quét');
      setPortalChannelCount(data.channelsCount);
      const mappedStreams: ExtractedStream[] = (data.streams || []).map((s: any) => ({
        url: s.url,
        sourceType: s.sourceType || 'vtvgo-portal',
        channelName: s.channelName || 'VTVGo',
        pageTitle: s.pageTitle || s.channelName,
        probeStatus: 'done' as const,
      }));
      setExtractedStreams(mappedStreams);
      if (mappedStreams.length > 0) setActiveStreamUrl(mappedStreams[0].url);
      setScanStatus(`Đã quét vtvgo.vn: ${data.channelsCount} kênh, ${mappedStreams.length} link!`);
      fetchPlaylistStatus();
    } catch (err: any) {
      setScanError(`Lỗi vtvgo.vn: ${err.message}`);
    } finally {
      setIsScanningPortal(false);
    }
  };

  const scanXemtvPortal = async () => {
    resetAllResults();
    setIsScanningXemtv(true);
    setScanError(null);
    setScanStatus('Đang quét hd1.xemtv.net...');
    try {
      const limit = parseInt(xemtvScanLimit, 10) || 120;
      const res = await fetch('/api/scan-xemtv-portal', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ limit }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || 'Không thể quét');
      setXemtvChannelCount(data.channelsDiscovered || data.channelsCount);
      const mappedStreams: ExtractedStream[] = (data.streams || []).map((s: any) => ({
        url: s.url,
        sourceType: s.sourceType || 'xemtv-portal',
        channelName: s.channelName || 'XemTV',
        pageTitle: s.pageTitle || s.channelName,
        probeStatus: 'done' as const,
      }));
      setExtractedStreams(mappedStreams);
      if (mappedStreams.length > 0) setActiveStreamUrl(mappedStreams[0].url);
      setScanStatus(
        `Đã quét hd1.xemtv.net: ${data.channelsDiscovered || '?'} kênh, ${mappedStreams.length} link!`
      );
      fetchPlaylistStatus();
    } catch (err: any) {
      setScanError(`Lỗi XemTV: ${err.message}`);
    } finally {
      setIsScanningXemtv(false);
    }
  };

  const clearAllStreams = () => {
    resetAllResults();
    setIsScanning(false);
    setIsBatchRunning(false);
    setIsVtvgoScanning(false);
    batchCancelRef.current = true;
    vtvgoCancelRef.current = true;
    stopPlayer();
  };

  const inputLines = parseBatchInput(inputUrl);
  const isBatchMode = inputLines.length > 1;

  const handleSmartSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (isBatchMode) runBatchScan();
    else if (inputLines.length === 1) {
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
        setScanStatus('Đã nạp .m3u8 vào player!');
        setScanError(null);
        if (autoProbeEnabled) {
          const mySession = scanSessionRef.current;
          probeSessionRef.current += 1;
          const myProbe = probeSessionRef.current;
          setTimeout(() => {
            if (mySession !== scanSessionRef.current) return;
            if (myProbe !== probeSessionRef.current) return;
            probeStreamsInParallel([directStream], setExtractedStreams, 1, mySession, myProbe);
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

  /* ===== SMART REPLACE ===== */
  const runSmartReplace = async () => {
    if (isSmartReplacing) return;
    const token = (localStorage.getItem('gh_token') || ghToken || '').trim();
    const repo = (localStorage.getItem('gh_repo') || ghRepo || 'thanhthovn/tvPremium').trim();
    const branch = (localStorage.getItem('gh_branch') || ghBranch || 'main').trim();
    if (!token) {
      alert('Cần nhập GitHub Token trước (Bấm "Đồng bộ GitHub")');
      return;
    }
    setIsSmartReplacing(true);
    setSmartReplaceSummary(null);
    setSmartReplaceLog([]);
    setSmartReplaceM3uContent(null);  // 🆕 reset
    setSmartReplaceProgress({ done: 0, total: 0, current: 'Đang khởi động...' });
    setScanError(null);
    setScanStatus('🚀 Đang đọc channel_url.txt và tvPremium.m3u từ GitHub...');

    let fakeTick = 0;
    const fakeInterval = setInterval(() => {
      fakeTick += 1;
      setSmartReplaceProgress((p) => ({
        ...p,
        done: p.done + 1,
        current: `Đang xử lý... (${fakeTick}s)`,
      }));
    }, 1000);

    try {
      const res = await fetch('/api/smart-replace', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          token,
          repo,
          branch,
          channelUrlFile: 'channel_url.txt',
          m3uFile: 'tvPremium.m3u',
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || 'Server trả lỗi');

      setSmartReplaceSummary({
        total: data.total,
        replaced: data.replaced,
        kept: data.kept,
        failed: data.failed,
        githubSynced: data.githubSynced,
        commitUrl: data.commitUrl,
      });

      // 🆕 Lưu nội dung M3U mới nếu có thay đổi
      if (data.m3uContent) {
        setSmartReplaceM3uContent(data.m3uContent);
      }

      setSmartReplaceLog(data.results || []);
      setSmartReplaceProgress({ done: data.total, total: data.total, current: '' });
      setScanStatus(data.message || 'Hoàn tất!');
      if (data.githubSynced && data.commitUrl) {
        setSaveSuccessNotice(
          `✅ Smart Replace xong! ${data.replaced} thay mới, ${data.kept} giữ, ${data.failed} lỗi. Đã commit GitHub!`
        );
        setTimeout(() => setSaveSuccessNotice(null), 10000);
      } else if (data.m3uDirty) {
        setSaveSuccessNotice(
          `⚠️ Đã thay ${data.replaced} link nhưng chưa commit được. Kiểm tra log server.`
        );
        setTimeout(() => setSaveSuccessNotice(null), 10000);
      }
      fetchPlaylistStatus();
    } catch (e: any) {
      setScanError('Smart Replace lỗi: ' + e.message);
      setSmartReplaceProgress({ done: 0, total: 0, current: '' });
    } finally {
      clearInterval(fakeInterval);
      setIsSmartReplacing(false);
    }
  };

  const probeDoneCount = extractedStreams.filter(
    (s) => s.probeStatus === 'done' || s.probeStatus === 'error'
  ).length;
  const sortedStreams = [...extractedStreams].sort(compareStreamQuality);

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col font-sans selection:bg-indigo-500 selection:text-white pb-12">
      <div className="fixed inset-0 pointer-events-none overflow-hidden">
        <div className="absolute -top-40 left-1/2 -translate-x-1/2 w-[750px] h-[400px] bg-gradient-to-b from-indigo-600/20 via-purple-600/10 to-transparent blur-3xl rounded-full" />
        <div className="absolute bottom-10 -right-20 w-[450px] h-[300px] bg-cyan-600/10 blur-3xl rounded-full" />
      </div>

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
                  <Radio className="w-3 h-3 text-emerald-400 animate-pulse" /> Live Tool
                </span>
              </div>
              <p className="text-xs text-slate-400">
                Trích xuất & phát M3U8, Smart Replace tự động
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <button
              onClick={openGhModal}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-slate-900 hover:bg-slate-800 border border-slate-700 hover:border-indigo-500/60 text-xs text-slate-200 transition cursor-pointer shadow-sm"
              title="Cài đặt đồng bộ GitHub"
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

      <main className="relative flex-1 max-w-7xl w-full mx-auto p-4 sm:p-6 space-y-6">
        <div className="grid grid-cols-1 lg:grid-cols-4 gap-4">
          {/* KHỐI NHẬP LIỆU */}
          <div className="bg-emerald-900/60 border border-emerald-700/60 rounded-2xl p-5 shadow-xl space-y-4 lg:col-span-1">
            <label className="text-sm font-semibold text-white flex items-center gap-2">
              <Search className="w-4 h-4 text-emerald-300" /> Nhập URL
              <span className="text-[10px] font-normal text-emerald-200 bg-emerald-950/60 px-2 py-0.5 rounded-full border border-emerald-600/40">
                {isBatchMode ? `Hàng loạt: ${inputLines.length}` : 'Đơn lẻ'}
              </span>
            </label>
            <form onSubmit={handleSmartSubmit} className="space-y-2">
              <textarea
                value={inputUrl}
                onChange={(e) => setInputUrl(e.target.value)}
                rows={isBatchMode ? Math.min(Math.max(inputLines.length + 1, 3), 8) : 3}
                placeholder="Dán 1 link .m3u8 hoặc URL trang web..."
                className="w-full bg-emerald-950/80 border border-emerald-700/60 rounded-xl px-3 py-2 text-xs text-emerald-50 placeholder:text-emerald-300/50 focus:outline-none font-mono resize-y"
              />
              <button
                type="submit"
                disabled={isScanning || isBatchRunning || inputLines.length === 0}
                className="w-full py-2 bg-gradient-to-r from-indigo-600 to-purple-600 disabled:opacity-50 text-white font-medium text-xs rounded-xl flex items-center justify-center gap-1.5 cursor-pointer"
              >
                {isScanning || isBatchRunning ? (
                  <>
                    <RotateCw className="w-3.5 h-3.5 animate-spin" /> Đang quét...
                  </>
                ) : (
                  <>
                    <Zap className="w-3.5 h-3.5" />{' '}
                    {isBatchMode ? `Quét ${inputLines.length} link` : 'Trích xuất & Phát'}
                  </>
                )}
              </button>
            </form>
            {scanStatus && (
              <div className="text-[11px] text-emerald-200 bg-emerald-950/60 border border-emerald-500/50 px-2.5 py-1.5 rounded-lg flex items-center gap-1.5">
                <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
                {scanStatus}
              </div>
            )}
            {scanError && (
              <div className="text-[11px] text-amber-300 bg-amber-950/60 border border-amber-500/40 px-2.5 py-1.5 rounded-lg flex items-center gap-1.5">
                <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                {scanError}
              </div>
            )}
          </div>

          {/* SMART REPLACE CARD */}
          <div className="bg-gradient-to-br from-amber-900/70 to-orange-900/60 border border-amber-700/60 rounded-2xl p-5 shadow-xl space-y-3 lg:col-span-1">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Wand2 className="w-4 h-4 text-amber-300" />
                <h3 className="text-sm font-semibold text-white">Smart Replace</h3>
              </div>
              <span className="text-[10px] text-amber-200 px-2 py-0.5 rounded-full bg-amber-950/80 border border-amber-700/50">
                Auto Commit
              </span>
            </div>
            <p className="text-[11px] text-amber-100/90 leading-relaxed">
              Đọc <code className="font-mono text-white bg-amber-950/60 px-1 rounded">channel_url.txt</code> → quét
              VTVGo + XemTV <strong>song song</strong> → chọn link chất lượng cao nhất → thay vào{' '}
              <code className="font-mono text-white bg-amber-950/60 px-1 rounded">tvPremium.m3u</code> → commit
              GitHub.
            </p>
            <div className="p-2 bg-amber-950/70 border border-amber-600/40 rounded-lg text-[10px] text-amber-200 font-mono space-y-0.5">
              <p className="font-bold text-amber-100">channel_url.txt:</p>
              <p>#vtv1</p>
              <p>#vtv5tnb</p>
              <p>#htvthethao</p>
              <p className="text-amber-300/70 italic">Chỉ cần #slug, không cần URL</p>
            </div>
            <button
              onClick={runSmartReplace}
              disabled={isSmartReplacing}
              className="w-full py-2.5 bg-gradient-to-r from-amber-600 via-orange-600 to-red-600 hover:from-amber-500 hover:to-red-500 disabled:opacity-50 text-white font-semibold text-xs rounded-xl flex items-center justify-center gap-2 shadow-lg cursor-pointer"
            >
              {isSmartReplacing ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />{' '}
                  {smartReplaceProgress.current || 'Đang xử lý...'}
                </>
              ) : (
                <>
                  <Wand2 className="w-4 h-4" /> Chạy Smart Replace ngay
                </>
              )}
            </button>
            {smartReplaceSummary && (
              <div className="grid grid-cols-3 gap-1.5 text-[10px]">
                <div className="text-center p-1.5 rounded bg-emerald-950/60 border border-emerald-700/50">
                  <div className="text-emerald-300 font-bold text-sm">
                    {smartReplaceSummary.replaced}
                  </div>
                  <div className="text-emerald-200/70">Thay mới</div>
                </div>
                <div className="text-center p-1.5 rounded bg-slate-900/60 border border-slate-700/50">
                  <div className="text-slate-300 font-bold text-sm">
                    {smartReplaceSummary.kept}
                  </div>
                  <div className="text-slate-400">Giữ nguyên</div>
                </div>
                <div className="text-center p-1.5 rounded bg-red-950/60 border border-red-700/50">
                  <div className="text-red-300 font-bold text-sm">
                    {smartReplaceSummary.failed}
                  </div>
                  <div className="text-red-200/70">Lỗi</div>
                </div>
              </div>
            )}
            {smartReplaceSummary?.commitUrl && (
              <a
                href={smartReplaceSummary.commitUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="block text-[10px] text-center text-cyan-300 hover:underline"
              >
                <ExternalLink className="w-3 h-3 inline mr-1" />
                Xem commit trên GitHub
              </a>
            )}

            {/* 🆕 Nút tải + copy M3U sau smart replace */}
            {smartReplaceM3uContent && (
              <div className="space-y-1.5 pt-1">
                <button
                  onClick={() => {
                    const filename = `tvPremium-smart-${new Date().toISOString().slice(0, 10)}.m3u`;
                    const blob = new Blob([smartReplaceM3uContent], {
                      type: 'application/vnd.apple.mpegurl;charset=utf-8',
                    });
                    const url = URL.createObjectURL(blob);
                    const a = document.createElement('a');
                    a.href = url;
                    a.download = filename;
                    document.body.appendChild(a);
                    a.click();
                    a.remove();
                    setTimeout(() => URL.revokeObjectURL(url), 5000);
                  }}
                  className="w-full py-2 bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white font-semibold text-xs rounded-xl flex items-center justify-center gap-2 shadow-md cursor-pointer"
                >
                  <Download className="w-4 h-4" />
                  Tải {`tvPremium-smart-${new Date().toISOString().slice(0, 10)}.m3u`}
                </button>
                
                <button
                  onClick={() => {
                    navigator.clipboard.writeText(smartReplaceM3uContent);
                    setCopiedUrl('smart-m3u');
                    setTimeout(() => setCopiedUrl(null), 2000);
                  }}
                  className="w-full py-1.5 bg-slate-800/80 hover:bg-slate-700 border border-slate-700 text-slate-200 font-medium text-[11px] rounded-xl flex items-center justify-center gap-1.5 cursor-pointer"
                >
                  {copiedUrl === 'smart-m3u' ? (
                    <>
                      <Check className="w-3.5 h-3.5 text-emerald-400" />
                      Đã copy M3U
                    </>
                  ) : (
                    <>
                      <Copy className="w-3.5 h-3.5" />
                      Copy nội dung M3U
                    </>
                  )}
                </button>
              </div>
            )}

            {/* 🆕 Thông báo khi không có thay đổi */}
            {smartReplaceSummary && smartReplaceSummary.replaced === 0 && (
              <p className="text-[10px] text-center text-slate-400 italic pt-1">
                Không có link nào thay đổi — không cần tải lại.
              </p>
            )}
          </div>

          {/* VTVGO SCAN */}
          <div className="bg-red-900/60 border border-red-700/60 rounded-2xl p-5 shadow-xl space-y-3 lg:col-span-1">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Tv className="w-4 h-4 text-red-200" />
                <h3 className="text-sm font-semibold text-white">VTVgo Scanner</h3>
              </div>
              <span className="text-[10px] text-red-200 px-2 py-0.5 rounded-full bg-red-950/80 border border-red-700/50">
                {portalChannelCount ? `${portalChannelCount} kênh` : 'Tự động'}
              </span>
            </div>
            <button
              onClick={scanVtvgoPortal}
              disabled={isScanningPortal || isScanning}
              className="w-full py-2.5 bg-gradient-to-r from-rose-600 to-amber-600 disabled:opacity-50 text-white font-semibold text-xs rounded-xl flex items-center justify-center gap-2 cursor-pointer"
            >
              {isScanningPortal ? (
                <>
                  <RotateCw className="w-4 h-4 animate-spin" /> Đang quét...
                </>
              ) : (
                <>
                  <Radio className="w-4 h-4 animate-pulse" /> Quét vtvgo.vn
                </>
              )}
            </button>
            <div className="flex items-center gap-1.5 pt-1">
              <span className="text-[11px] text-red-200 shrink-0">Dải ID:</span>
              <input
                type="number"
                value={vtvgoStart}
                onChange={(e) => setVtvgoStart(e.target.value)}
                className="w-14 bg-red-950/80 border border-red-700/60 rounded px-1.5 py-1 text-xs text-red-50"
              />
              <span className="text-xs text-red-200">→</span>
              <input
                type="number"
                value={vtvgoEnd}
                onChange={(e) => setVtvgoEnd(e.target.value)}
                className="w-14 bg-red-950/80 border border-red-700/60 rounded px-1.5 py-1 text-xs text-red-50"
              />
              <button
                onClick={runVtvgoScan}
                disabled={isVtvgoScanning || isScanningPortal}
                className="px-2 py-1 bg-red-800 hover:bg-red-700 disabled:opacity-50 text-white text-xs rounded flex items-center gap-1 cursor-pointer"
              >
                {isVtvgoScanning ? <RotateCw className="w-3 h-3 animate-spin" /> : <Zap className="w-3 h-3" />}{' '}
                Quét
              </button>
            </div>
          </div>

          {/* XEMTV SCAN */}
          <div className="bg-sky-900/60 border border-sky-700/60 rounded-2xl p-5 shadow-xl space-y-3 lg:col-span-1">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Globe className="w-4 h-4 text-sky-300" />
                <h3 className="text-sm font-semibold text-white">XemTV Scanner</h3>
              </div>
              <span className="text-[10px] text-sky-200 px-2 py-0.5 rounded-full bg-sky-950/80 border border-sky-700/50">
                {xemtvChannelCount ? `${xemtvChannelCount} kênh` : '579 kênh'}
              </span>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="text-[11px] text-sky-200/80">Số kênh:</span>
              {['60', '120', '250', '0'].map((lim) => (
                <button
                  key={lim}
                  onClick={() => setXemtvScanLimit(lim)}
                  className={`px-1.5 py-0.5 text-[10px] rounded font-medium transition cursor-pointer border ${
                    xemtvScanLimit === lim
                      ? 'bg-cyan-500 text-slate-950 border-cyan-400 font-bold'
                      : 'bg-sky-950/90 text-sky-200 border-sky-700/60 hover:bg-sky-900'
                  }`}
                >
                  {lim === '0' ? 'Tất cả' : lim}
                </button>
              ))}
            </div>
            <button
              onClick={scanXemtvPortal}
              disabled={isScanningXemtv || isScanning}
              className="w-full py-2.5 bg-gradient-to-r from-cyan-600 to-indigo-600 disabled:opacity-50 text-white font-semibold text-xs rounded-xl flex items-center justify-center gap-2 cursor-pointer"
            >
              {isScanningXemtv ? (
                <>
                  <RotateCw className="w-4 h-4 animate-spin" /> Đang quét...
                </>
              ) : (
                <>
                  <Radio className="w-4 h-4 animate-pulse" /> Quét hd1.xemtv.net
                </>
              )}
            </button>
          </div>
        </div>

        {/* SMART REPLACE LOG */}
        {smartReplaceLog.length > 0 && (
          <div className="bg-slate-900/90 border border-slate-800 rounded-2xl p-4 shadow-xl space-y-2">
            <div className="flex items-center justify-between">
              <h3 className="text-xs font-semibold text-white flex items-center gap-1.5">
                <Activity className="w-3.5 h-3.5 text-amber-400" />
                Chi tiết Smart Replace (
                {smartReplaceLog.filter((l) => l.status === 'found').length}/
                {smartReplaceLog.length} thay thế)
              </h3>
              <button
                onClick={() => setSmartReplaceLog([])}
                className="text-[10px] text-slate-400 hover:text-white cursor-pointer"
              >
                <Trash2 className="w-3 h-3" />
              </button>
            </div>
            <div className="max-h-72 overflow-y-auto space-y-1 pr-1">
              {smartReplaceLog.map((l, i) => (
                <div
                  key={i}
                  className={`text-[11px] px-2 py-1 rounded flex items-center gap-2 ${
                    l.status === 'found'
                      ? 'bg-emerald-950/50 border border-emerald-700/40'
                      : l.status === 'kept'
                      ? 'bg-slate-800/50 border border-slate-700/40'
                      : l.status === 'error'
                      ? 'bg-red-950/50 border border-red-700/40'
                      : l.status === 'scanning'
                      ? 'bg-amber-950/50 border border-amber-700/40'
                      : 'bg-slate-900/50 border border-slate-800/40'
                  }`}
                >
                  <span className="w-4 text-center shrink-0">
                    {l.status === 'found'
                      ? '✓'
                      : l.status === 'kept'
                      ? '='
                      : l.status === 'error'
                      ? '✗'
                      : l.status === 'scanning'
                      ? <Loader2 className="w-3 h-3 animate-spin inline" />
                      : '·'}
                  </span>
                  <span className="font-mono text-cyan-300 shrink-0 w-24 truncate">{l.slug}</span>
                  <span className="font-semibold text-white shrink-0">{l.name}</span>
                  {l.quality && <span className="text-emerald-300 font-mono shrink-0">[{l.quality}]</span>}
                  {l.source && (
                    <span className="text-purple-300 text-[9px] px-1.5 py-0.5 rounded bg-purple-500/20 border border-purple-500/30 shrink-0">
                      {l.source}
                    </span>
                  )}
                  <span className="text-slate-400 truncate flex-1">{l.note}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* LỊCH QUÉT */}
        <div className="bg-gradient-to-r from-slate-900 via-indigo-950/40 to-slate-900 border border-indigo-500/30 rounded-2xl p-4 shadow-xl flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
          <div className="flex items-start gap-3">
            <div className="w-10 h-10 rounded-xl bg-indigo-600/20 border border-indigo-500/40 flex items-center justify-center text-indigo-400 shrink-0">
              <Clock className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-sm font-bold text-white">
                Lịch Quét Tự Động VTVGo (01:00 & 13:00 VN)
              </h3>
              <p className="text-xs text-slate-300 leading-relaxed">
                Tự động cào VTVGo, lưu <code className="text-indigo-300 font-mono">tvPremium.m3u</code>, đẩy lên{' '}
                <strong className="text-white font-mono">{ghRepo}</strong>.
              </p>
            </div>
          </div>
          <button
            onClick={triggerScheduleScanNow}
            disabled={isTriggeringSchedule || scheduleStatus?.isRunning}
            className="px-3.5 py-2 bg-gradient-to-r from-indigo-600 to-purple-600 disabled:opacity-50 text-white text-xs font-semibold rounded-xl flex items-center gap-1.5 cursor-pointer"
          >
            {isTriggeringSchedule || scheduleStatus?.isRunning ? (
              <>
                <Loader2 className="w-3.5 h-3.5 animate-spin" /> Đang chạy...
              </>
            ) : (
              <>
                <Zap className="w-3.5 h-3.5" /> Chạy quét thử
              </>
            )}
          </button>
        </div>

        {/* PLAYER */}
        <div
          ref={playerRef}
          className="bg-slate-900/90 border border-slate-800 rounded-2xl overflow-hidden shadow-2xl flex flex-col scroll-mt-24"
        >
          <div className="bg-slate-950 px-4 py-3 border-b border-slate-800 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Radio className="w-4 h-4 text-emerald-400 animate-pulse" />
              <span className="text-xs font-semibold text-white">Màn hình phát HLS</span>
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
                <p className="text-xs">Chưa có luồng</p>
              </div>
            )}
            {playbackError && (
              <div className="absolute inset-0 bg-black/90 flex flex-col items-center justify-center p-6 text-center space-y-3 z-10">
                <AlertCircle className="w-10 h-10 text-amber-400" />
                <div className="max-w-md space-y-1">
                  <h4 className="text-sm font-semibold text-white">Không thể phát</h4>
                  <p className="text-xs text-slate-400 leading-relaxed">{playbackError}</p>
                </div>
                <div className="flex flex-wrap items-center justify-center gap-2 pt-2">
                  <button
                    onClick={() => {
                      setUseProxyForPlayback(!useProxyForPlayback);
                      if (activeStreamUrl) loadStreamInPlayer(activeStreamUrl, !useProxyForPlayback);
                    }}
                    className="px-3.5 py-1.5 bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-medium rounded-lg flex items-center gap-1.5 cursor-pointer"
                  >
                    <Zap className="w-3.5 h-3.5" /> {useProxyForPlayback ? 'Tắt Proxy' : 'Bật Proxy CORS'}
                  </button>
                  <button
                    onClick={() => activeStreamUrl && copyText(activeStreamUrl)}
                    className="px-3.5 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-medium rounded-lg flex items-center gap-1.5 cursor-pointer"
                  >
                    <Copy className="w-3.5 h-3.5" /> Sao chép
                  </button>
                </div>
              </div>
            )}
            {!playbackError && activeStreamUrl && (
              <button
                onClick={togglePlay}
                className="absolute w-16 h-16 rounded-full bg-slate-900/70 hover:bg-indigo-600 text-white flex items-center justify-center backdrop-blur-md border border-white/20 opacity-0 group-hover:opacity-100 transition-all duration-200 cursor-pointer shadow-xl"
              >
                {isPlaying ? <Pause className="w-7 h-7" /> : <Play className="w-7 h-7 ml-1" />}
              </button>
            )}
          </div>
          <div className="p-3 bg-slate-950 border-t border-slate-800 flex flex-wrap items-center justify-between gap-3 text-xs">
            <div className="flex items-center gap-3">
              <button
                onClick={togglePlay}
                disabled={!activeStreamUrl}
                className="p-2 rounded-lg bg-slate-800 hover:bg-slate-700 disabled:opacity-40 text-white cursor-pointer"
              >
                {isPlaying ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4" />}
              </button>
              <div className="flex items-center gap-2">
                <button
                  onClick={toggleMute}
                  disabled={!activeStreamUrl}
                  className="p-2 rounded-lg bg-slate-800 hover:bg-slate-700 disabled:opacity-40 text-white cursor-pointer"
                >
                  {isMuted ? <VolumeX className="w-4 h-4 text-red-400" /> : <Volume2 className="w-4 h-4" />}
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
                className="p-2 rounded-lg bg-slate-800 hover:bg-slate-700 disabled:opacity-40 text-white cursor-pointer"
              >
                <Maximize className="w-4 h-4" />
              </button>
            </div>
          </div>
        </div>

        {/* DANH SÁCH KẾT QUẢ */}
        <div className="bg-slate-900/90 border border-slate-800 rounded-2xl p-5 shadow-2xl">
          <div className="flex items-center justify-between pb-3 border-b border-slate-800 flex-wrap gap-2">
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
                  className="px-2.5 py-1 rounded-lg bg-amber-600/20 hover:bg-amber-600/30 disabled:opacity-50 border border-amber-500/40 text-amber-300 text-[11px] font-medium flex items-center gap-1.5 cursor-pointer"
                >
                  {isProbing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Activity className="w-3.5 h-3.5" />}{' '}
                  Dò chất lượng
                </button>
              )}
              <button
                onClick={() => loadIptvOriFromGitHub('iptv_ori.m3u')}
                disabled={isLoadingIptvOri}
                className="px-2.5 py-1 rounded-lg bg-teal-600/20 hover:bg-teal-600/30 border border-teal-500/40 text-teal-300 text-[11px] font-medium flex items-center gap-1.5 cursor-pointer"
              >
                {isLoadingIptvOri ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <FileText className="w-3.5 h-3.5" />}{' '}
                Đọc iptv_ori.m3u
              </button>
              {extractedStreams.length > 0 && (
                <>
                  <button
                    onClick={savePlaylistToTvPremium}
                    disabled={isSavingPlaylist}
                    className="px-3 py-1 rounded-lg bg-gradient-to-r from-indigo-600 to-pink-600 hover:from-indigo-500 hover:to-pink-500 disabled:opacity-50 text-white text-[11px] font-semibold flex items-center gap-1.5 cursor-pointer shadow-md"
                  >
                    {isSavingPlaylist ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}{' '}
                    Lưu GitHub
                  </button>
                  <button
                    onClick={exportFoundLinks}
                    className="px-2.5 py-1 rounded-lg bg-emerald-600/20 hover:bg-emerald-600/30 border border-emerald-500/40 text-emerald-300 text-[11px] font-medium flex items-center gap-1.5 cursor-pointer"
                  >
                    <Download className="w-3.5 h-3.5" /> Tải .m3u
                  </button>
                  <button
                    onClick={clearAllStreams}
                    className="px-2.5 py-1 rounded-lg bg-red-600/20 hover:bg-red-600/30 border border-red-500/40 text-red-300 text-[11px] font-medium flex items-center gap-1.5 cursor-pointer"
                  >
                    <Trash2 className="w-3.5 h-3.5" /> Xóa
                  </button>
                </>
              )}
            </div>
          </div>

          {saveSuccessNotice && (
            <div className="mt-3 p-3.5 bg-emerald-950/90 border border-emerald-500/60 rounded-xl text-xs text-emerald-200 flex items-start justify-between gap-3 shadow-xl">
              <div className="flex items-start gap-2.5">
                <CheckCircle2 className="w-4 h-4 text-emerald-400 mt-0.5 shrink-0" />
                <p className="text-slate-200">{saveSuccessNotice}</p>
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
                  st.channelNumber ?? (urlChannelMatch ? parseInt(urlChannelMatch[1], 10) : i + 1);
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
                        ? 'bg-indigo-950/70 border-indigo-500/60 shadow-lg'
                        : 'bg-slate-950/70 border-slate-800 hover:border-slate-700'
                    }`}
                  >
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-slate-800 text-slate-300 border border-slate-700 shrink-0 font-bold">
                        #{displayNumber}
                      </span>
                      <span className="text-slate-500 text-xs font-bold">+</span>
                      <span className="text-[11px] font-mono px-2 py-0.5 rounded bg-slate-800/60 text-slate-400 border border-slate-700/60 shrink-0">
                        ({cdnName})
                      </span>
                      <span className="text-slate-500 text-xs font-bold">+</span>
                      <span className="text-[11px] font-medium text-cyan-300 break-words" title={st.pageTitle}>
                        {cleanTitle}
                      </span>
                      {st.probeStatus === 'pending' && (
                        <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-slate-500/15 text-slate-300 border border-slate-500/30 flex items-center gap-1 shrink-0">
                          <Loader2 className="w-2.5 h-2.5 animate-spin" />
                          Chờ dò...
                        </span>
                      )}
                      {st.probeStatus === 'probing' && (
                        <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-amber-500/15 text-amber-300 border border-amber-500/30 flex items-center gap-1 shrink-0">
                          <Loader2 className="w-2.5 h-2.5 animate-spin" />
                          Đang dò...
                        </span>
                      )}
                      {st.probeStatus === 'done' && st.probeBest && (
                        <span
                          className="text-[10px] font-mono px-2 py-0.5 rounded bg-emerald-500/15 text-emerald-300 border border-emerald-500/30 flex items-center gap-1 shrink-0"
                          title={st.probeLevels
                            ?.map((l) =>
                              l.height
                                ? `${l.height}p@${Math.round((l.bitrate || 0) / 1000)}k`
                                : `${Math.round((l.bitrate || 0) / 1000)}k`
                            )
                            .join(' • ')}
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
                          Không rõ
                        </span>
                      )}
                      {st.probeStatus === 'error' && (
                        <span
                          className="text-[10px] font-mono px-2 py-0.5 rounded bg-red-500/15 text-red-300 border border-red-500/30 flex items-center gap-1 shrink-0"
                          title={st.probeError}
                        >
                          <AlertCircle className="w-2.5 h-2.5" />
                          Lỗi
                        </span>
                      )}
                      <div className="flex items-center gap-1.5 shrink-0 ml-auto">
                        <button
                          onClick={() => playStream(st.url)}
                          className={`px-2.5 py-1 rounded-lg text-xs font-medium flex items-center gap-1 cursor-pointer ${
                            isActive
                              ? 'bg-indigo-600 text-white'
                              : 'bg-slate-800 hover:bg-slate-700 text-slate-200'
                          }`}
                        >
                          <Play className="w-3 h-3" />
                          Phát
                        </button>
                        <button
                          onClick={() => copyText(st.url)}
                          className="px-2.5 py-1 rounded-lg text-xs font-medium bg-slate-800 hover:bg-slate-700 text-slate-200 flex items-center gap-1 cursor-pointer"
                        >
                          {copiedUrl === st.url ? (
                            <>
                              <Check className="w-3 h-3 text-emerald-400" />
                              Đã chép
                            </>
                          ) : (
                            <>
                              <Copy className="w-3 h-3" />
                              Copy
                            </>
                          )}
                        </button>
                        <a
                          href={st.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 transition"
                          title="Mở link"
                        >
                          <ExternalLink className="w-3.5 h-3.5" />
                        </a>
                      </div>
                    </div>
                    <p
                      className="font-mono text-[11px] text-slate-300 break-all select-all leading-relaxed whitespace-pre-wrap"
                      title={st.url}
                    >
                      {st.url}
                    </p>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center text-xs text-slate-500 space-y-2 py-12">
              <FileCode className="w-8 h-8 mx-auto text-slate-600" />
              <p>Chưa có luồng nào.</p>
            </div>
          )}
        </div>
      </main>

      {/* GH MODAL */}
      {isGhModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-sm">
          <div
            className="bg-slate-900 border border-slate-800 rounded-2xl w-full max-w-lg shadow-2xl overflow-hidden flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="p-4 border-b border-slate-800 flex items-center justify-between bg-slate-950/70">
              <div className="flex items-center gap-2">
                <Settings className="w-5 h-5 text-indigo-400" />
                <h3 className="font-semibold text-sm text-white">Cấu hình GitHub</h3>
              </div>
              <button
                onClick={() => setIsGhModalOpen(false)}
                className="p-1 rounded-lg text-slate-400 hover:text-white cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="p-5 space-y-4 text-xs">
              <div className="p-3 bg-indigo-950/40 border border-indigo-700/40 rounded-xl text-slate-300 space-y-1.5">
                <p className="font-semibold text-indigo-200 flex items-center gap-1.5">
                  <Zap className="w-3.5 h-3.5 text-indigo-400" />
                  Cơ chế:
                </p>
                <p>
                  1. Tự động lưu <code className="text-white bg-slate-900 px-1 rounded">tvPremium.m3u</code> mỗi
                  khi dò xong.
                </p>
                <p>2. Nếu có Token, tự đẩy lên GitHub không cần bấm tay.</p>
              </div>
              <div className="space-y-1.5">
                <label className="font-medium text-slate-300">GitHub Repository:</label>
                <input
                  type="text"
                  value={tempRepo}
                  onChange={(e) => setTempRepo(e.target.value)}
                  placeholder="thanhthovn/tvPremium"
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs font-mono text-slate-200 focus:outline-none focus:border-indigo-500"
                />
              </div>
              <div className="space-y-1.5">
                <label className="font-medium text-slate-300">Nhánh (Branch):</label>
                <input
                  type="text"
                  value={tempBranch}
                  onChange={(e) => setTempBranch(e.target.value)}
                  placeholder="main"
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs font-mono text-slate-200 focus:outline-none focus:border-indigo-500"
                />
              </div>
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <label className="font-medium text-slate-300 flex items-center gap-1.5">
                    <Key className="w-3.5 h-3.5 text-amber-400" />
                    GitHub PAT:
                  </label>
                  <a
                    href="https://github.com/settings/tokens/new?scopes=repo&description=M3U8-AutoSync"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-[10px] text-indigo-400 hover:underline flex items-center gap-1"
                  >
                    <span>Tạo Token</span>
                    <ExternalLink className="w-2.5 h-2.5" />
                  </a>
                </div>
                <div className="relative">
                  <input
                    type={showGhToken ? 'text' : 'password'}
                    value={tempToken}
                    onChange={(e) => setTempToken(e.target.value)}
                    placeholder="ghp_xxx..."
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 pr-10 text-xs font-mono text-slate-200 focus:outline-none focus:border-indigo-500"
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
                  Token cần quyền <code className="text-indigo-300">repo</code> hoặc{' '}
                  <code className="text-indigo-300">Contents: Read and write</code>.
                </p>
              </div>
              <div className="p-3 bg-slate-950 rounded-xl border border-slate-800 flex items-center justify-between">
                <div>
                  <p className="font-medium text-slate-200">Tự động đẩy lên GitHub</p>
                  <p className="text-[10px] text-slate-500">Ghi đè commit file mỗi khi dò xong</p>
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
              <div className="p-3.5 bg-slate-950 rounded-xl border border-teal-900/50 space-y-2">
                <div className="flex items-center justify-between gap-3">
                  <div className="flex items-center gap-2">
                    <FileText className="w-4 h-4 text-teal-400 shrink-0" />
                    <div>
                      <p className="text-xs font-semibold text-teal-200">Đọc iptv_ori.m3u từ GitHub</p>
                      <p className="text-[10px] text-slate-400">Nạp kênh từ file iptv_ori.m3u</p>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      loadIptvOriFromGitHub('iptv_ori.m3u');
                      setIsGhModalOpen(false);
                    }}
                    disabled={isLoadingIptvOri}
                    className="px-3 py-1.5 text-xs font-semibold text-teal-200 bg-teal-900/60 hover:bg-teal-800 border border-teal-600/50 rounded-lg flex items-center gap-1.5 cursor-pointer whitespace-nowrap"
                  >
                    {isLoadingIptvOri ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    ) : (
                      <Download className="w-3.5 h-3.5" />
                    )}
                    <span>Nạp</span>
                  </button>
                </div>
              </div>
            </div>
            <div className="p-4 bg-slate-950/80 border-t border-slate-800 flex items-center justify-end gap-2">
              <button
                onClick={() => setIsGhModalOpen(false)}
                className="px-3 py-1.5 text-xs text-slate-400 hover:text-white cursor-pointer"
              >
                Đóng
              </button>
              <button
                onClick={() => {
                  saveGhSettings(tempToken, tempRepo, tempBranch, tempAutoSync);
                  alert('Đã lưu cấu hình GitHub!');
                }}
                className="px-4 py-1.5 bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold rounded-lg cursor-pointer shadow-md"
              >
                Lưu cấu hình
              </button>
            </div>
          </div>
        </div>
      )}

      {copiedUrl && (
        <div className="fixed bottom-6 right-6 z-50 bg-slate-900 border border-emerald-500/40 text-emerald-200 px-4 py-2.5 rounded-xl shadow-2xl text-xs flex items-center gap-2 backdrop-blur-md">
          <CheckCircle2 className="w-4 h-4 text-emerald-400" />
          <span>Đã sao chép!</span>
        </div>
      )}

      <footer className="border-t border-slate-800/80 bg-slate-950/80 py-4 px-6 text-center text-xs text-slate-500 mt-auto">
        HLS M3U8 Extractor & Smart Replace — VTVGo + XemTV song song
      </footer>
    </div>
  );
}