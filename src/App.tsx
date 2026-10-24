import React, { useState, useEffect, useRef, useCallback } from 'react';
import Hls from 'hls.js';
import {
  Globe, Play, Pause, Volume2, VolumeX, Maximize, Copy, Check,
  Search, ExternalLink, Film, Layers, Radio, AlertCircle, CheckCircle2,
  RotateCw, X, Tv, ListVideo, FileCode, Zap, Activity,
  Download, FileText, Trash2, Loader2, Save, Settings, Key,
  Eye, EyeOff, Wand2, MonitorPlay, SkipBack, SkipForward, ChevronUp, Wrench, RefreshCw,
  LocateFixed
} from 'lucide-react';

interface ExtractedStream {
  url: string;
  sourceType?: string;
  pageTitle?: string;
  quality?: string;
  resolution?: string;
  channelNumber?: number;
  channelName?: string;
  probeStatus?: 'pending' | 'probing' | 'done' | 'error';
  probeLevels?: { height?: number; width?: number; bitrate?: number }[];
  probeBest?: { resolution?: string; bitrate?: string };
  probeError?: string;
  logo?: string;
  group?: string;
}

const getHostname = (url: string): string => {
  try { return new URL(url).hostname; } catch { return ''; }
};

export default function App() {
  // ==========================================
  // TRẠNG THÁI CHUNG & PLAYLIST MẶC ĐỊNH
  // ==========================================
  const DEFAULT_M3U_URL = 'https://raw.githubusercontent.com/thanhthovn/tvPremium/refs/heads/main/tvPremium.m3u';
  const [playlistUrl, setPlaylistUrl] = useState(DEFAULT_M3U_URL);
  const [extractedStreams, setExtractedStreams] = useState<ExtractedStream[]>([]);
  const [isLoadingPlaylist, setIsLoadingPlaylist] = useState(false);
  const [activeStreamUrl, setActiveStreamUrl] = useState<string>('');
  
  // Trạng thái Trình phát
  const [isPlaying, setIsPlaying] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  const [volume, setVolume] = useState(1);
  const [qualityLevels, setQualityLevels] = useState<{ id: number; name: string }[]>([]);
  const [currentLevel, setCurrentLevel] = useState<number>(-1);
  const [playbackError, setPlaybackError] = useState<string | null>(null);
  const [useProxyForPlayback, setUseProxyForPlayback] = useState(false);
  const [streamInfo, setStreamInfo] = useState<{ resolution?: string; bitrate?: string } | null>(null);
  const [copiedUrl, setCopiedUrl] = useState<string | null>(null);

  // Trạng thái Tools / Tunning Modal
  const [isTunningOpen, setIsTunningOpen] = useState(false);
  const [activeTunningTab, setActiveTunningTab] = useState<'scan' | 'smart' | 'logs'>('smart');

  // Trạng thái Smart Replace
  const [isSmartReplacing, setIsSmartReplacing] = useState(false);
  const [smartReplaceLog, setSmartReplaceLog] = useState<any[]>([]);
  const [smartReplaceSummary, setSmartReplaceSummary] = useState<any>(null);
  const [smartReplaceM3uContent, setSmartReplaceM3uContent] = useState<string | null>(null);

  // Cấu hình GitHub
  const [ghToken, setGhToken] = useState(() => localStorage.getItem('gh_token') || '');
  const [ghRepo, setGhRepo] = useState(() => localStorage.getItem('gh_repo') || 'thanhthovn/tvPremium');
  const [ghBranch, setGhBranch] = useState(() => localStorage.getItem('gh_branch') || 'main');
  const [tempToken, setTempToken] = useState(ghToken);
  const [tempRepo, setTempRepo] = useState(ghRepo);
  const [tempBranch, setTempBranch] = useState(ghBranch);
  const [showGhToken, setShowGhToken] = useState(false);

  // Trạng thái Quét Web
  const [inputUrl, setInputUrl] = useState('https://vtvgo.vn/channel/1');
  const [isScanning, setIsScanning] = useState(false);
  const [scanStatus, setScanStatus] = useState<string | null>(null);

  const videoRef = useRef<HTMLVideoElement>(null);
  const hlsRef = useRef<Hls | null>(null);
  const playerRef = useRef<HTMLDivElement>(null); // Ref để cuộn lên Player

  // ==========================================
  // LOGIC ĐỌC FILE M3U TỪ GITHUB
  // ==========================================
  const loadPlaylistFromUrl = useCallback(async (url: string) => {
    setIsLoadingPlaylist(true);
    try {
      const res = await fetch(`/api/proxy-m3u8?url=${encodeURIComponent(url)}`);
      if (!res.ok) throw new Error('Không thể tải playlist');
      const text = await res.text();
      
      const lines = text.split(/\r?\n/);
      const streams: ExtractedStream[] = [];
      let currentInfo: any = null;

      for (let i = 0; i < lines.length; i++) {
        const line = lines[i].trim();
        if (line.startsWith('#EXTINF:')) {
          const nameMatch = line.match(/,(.+)$/);
          const logoMatch = line.match(/tvg-logo="([^"]+)"/i);
          const groupMatch = line.match(/group-title="([^"]+)"/i);
          currentInfo = {
            name: nameMatch ? nameMatch[1].trim() : 'Không tên',
            logo: logoMatch ? logoMatch[1] : '',
            group: groupMatch ? groupMatch[1] : 'Khác'
          };
        } else if (line && !line.startsWith('#')) {
          if (currentInfo) {
            streams.push({
              url: line,
              channelName: currentInfo.name,
              pageTitle: currentInfo.name,
              logo: currentInfo.logo,
              group: currentInfo.group,
              sourceType: 'playlist'
            });
            currentInfo = null;
          }
        }
      }
      setExtractedStreams(streams);
      if (streams.length > 0) setActiveStreamUrl(streams[0].url);
    } catch (err: any) {
      alert('Lỗi tải M3U: ' + err.message);
    } finally {
      setIsLoadingPlaylist(false);
    }
  }, []);

  useEffect(() => {
    loadPlaylistFromUrl(playlistUrl);
  }, [loadPlaylistFromUrl, playlistUrl]);

  // ==========================================
  // LOGIC TRÌNH PHÁT HLS
  // ==========================================
  const loadStreamInPlayer = useCallback((streamUrl: string, forceProxy = false) => {
    const video = videoRef.current;
    if (!video) return;
    setPlaybackError(null);
    setQualityLevels([]);
    setCurrentLevel(-1);
    if (hlsRef.current) { hlsRef.current.destroy(); hlsRef.current = null; }
    
    const finalPlaybackUrl = forceProxy ? `/api/proxy-m3u8?url=${encodeURIComponent(streamUrl)}` : streamUrl;
    
    if (Hls.isSupported()) {
      const hls = new Hls({ enableWorker: true, lowLatencyMode: true, backBufferLength: 90 });
      hlsRef.current = hls;
      hls.loadSource(finalPlaybackUrl);
      hls.attachMedia(video);
      hls.on(Hls.Events.MANIFEST_PARSED, (_, data) => {
        setPlaybackError(null);
        if (data.levels && data.levels.length > 0) {
          setQualityLevels(data.levels.map((lvl, index) => ({ id: index, name: lvl.height ? `${lvl.height}p` : `Mức ${index + 1}` })));
        }
        video.play().then(() => setIsPlaying(true)).catch(() => setIsPlaying(false));
      });
      hls.on(Hls.Events.LEVEL_SWITCHED, (_, data) => {
        setCurrentLevel(data.level);
        if (hls.levels[data.level]) {
          const lvl = hls.levels[data.level];
          setStreamInfo({ resolution: lvl.height ? `${lvl.width}x${lvl.height}` : undefined, bitrate: `${Math.round(lvl.bitrate / 1000)} kbps` });
        }
      });
      hls.on(Hls.Events.ERROR, (_, data) => {
        if (data.fatal) {
          if (data.type === Hls.ErrorTypes.NETWORK_ERROR) {
            setPlaybackError('Lỗi mạng hoặc CORS.');
            if (!forceProxy) setUseProxyForPlayback(true);
          } else if (data.type === Hls.ErrorTypes.MEDIA_ERROR) {
            hls.recoverMediaError();
          } else {
            setPlaybackError('Không phát được stream này.');
            hls.destroy();
          }
        }
      });
    } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
      video.src = finalPlaybackUrl;
      video.play().then(() => setIsPlaying(true)).catch(() => setIsPlaying(false));
    }
  }, []);

  useEffect(() => {
    if (activeStreamUrl) loadStreamInPlayer(activeStreamUrl, useProxyForPlayback);
  }, [activeStreamUrl, useProxyForPlayback, loadStreamInPlayer]);

  const togglePlay = () => {
    const video = videoRef.current;
    if (!video) return;
    if (video.paused) video.play().then(() => setIsPlaying(true));
    else { video.pause(); setIsPlaying(false); }
  };

  // ==========================================
  // ĐIỀU HƯỚNG KÊNH (PREV / NEXT / SCROLL)
  // ==========================================
  const currentIndex = extractedStreams.findIndex(s => s.url === activeStreamUrl);

  const playNext = () => {
    if (currentIndex >= 0 && currentIndex < extractedStreams.length - 1) {
      playStream(extractedStreams[currentIndex + 1].url);
    }
  };

  const playPrev = () => {
    if (currentIndex > 0) {
      playStream(extractedStreams[currentIndex - 1].url);
    }
  };

  const playStream = (url: string) => {
    setActiveStreamUrl(url);
    // Cuộn mượt lên Player khi chọn kênh
    playerRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  // ==========================================
  // CÁC HÀM XỬ LÝ TOOLBOX (SMART REPLACE, SCAN...)
  // ==========================================
  const runSmartReplace = async () => {
    if (isSmartReplacing) return;
    const token = (localStorage.getItem('gh_token') || ghToken || '').trim();
    const repo = (localStorage.getItem('gh_repo') || ghRepo || 'thanhthovn/tvPremium').trim();
    const branch = (localStorage.getItem('gh_branch') || ghBranch || 'main').trim();
    if (!token) { alert('Cần nhập GitHub Token trước!'); return; }
    
    setIsSmartReplacing(true);
    setSmartReplaceSummary(null);
    setSmartReplaceLog([]);
    setSmartReplaceM3uContent(null);

    try {
      const res = await fetch('/api/smart-replace', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token, repo, branch, channelUrlFile: 'channel_url.txt', m3uFile: 'tvPremium.m3u' }) });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || 'Lỗi Server');
      
      setSmartReplaceSummary({ total: data.total, replaced: data.replaced, kept: data.kept, failed: data.failed });
      if (data.m3uContent) setSmartReplaceM3uContent(data.m3uContent);
      setSmartReplaceLog(data.results || []);
      alert('Smart Replace hoàn tất!');
      loadPlaylistFromUrl(playlistUrl);
    } catch (e: any) {
      alert('Lỗi: ' + e.message);
    } finally {
      setIsSmartReplacing(false);
    }
  };

  const handleScanUrl = async () => {
    if (!inputUrl.trim()) return;
    setIsScanning(true);
    setScanStatus('Đang quét...');
    try {
      const res = await fetch('/api/extract-m3u8', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ url: inputUrl }) });
      const data = await res.json();
      if (data.success && data.streams) {
        const newStreams = data.streams.map((s: any) => ({ url: s.url, channelName: data.pageTitle || 'Kênh mới', sourceType: 'scan' }));
        setExtractedStreams(prev => [...newStreams, ...prev]);
        setScanStatus(`Đã tìm thấy ${newStreams.length} luồng!`);
        playStream(newStreams[0].url);
      } else setScanStatus('Không tìm thấy luồng.');
    } catch (e: any) {
      setScanStatus('Lỗi: ' + e.message);
    } finally {
      setIsScanning(false);
    }
  };

  const copyText = (text: string) => {
    navigator.clipboard.writeText(text);
    setCopiedUrl(text);
    setTimeout(() => setCopiedUrl(null), 2000);
  };

  return (
    // Tone màu tổng thể: Xanh Quân Đội / Rêu tối
    <div className="min-h-screen bg-[#121612] text-[#d1d5db] flex flex-col font-sans selection:bg-[#5e6d4e] selection:text-white">
      
      {/* HEADER */}
      <header className="border-b border-[#2a3327] bg-[#1a2019] sticky top-0 z-40 px-4 py-3 shadow-md">
        <div className="max-w-[1600px] mx-auto flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-[#4a593d] flex items-center justify-center shadow-lg shadow-black/50 border border-[#5e6d4e]">
              <Tv className="w-5 h-5 text-[#e5e7eb]" />
            </div>
            <div>
              <h1 className="font-bold text-lg text-[#e5e7eb] tracking-tight leading-tight">TV Premium Player</h1>
              <p className="text-[11px] text-[#8a9a7b]">Tactical Streaming Network</p>
            </div>
          </div>
          
          <div className="flex items-center gap-3">
            <button onClick={() => setIsTunningOpen(true)} className="flex items-center gap-2 px-4 py-2 rounded-xl bg-[#4a593d] hover:bg-[#5e6d4e] text-[#e5e7eb] text-sm font-semibold shadow-lg shadow-black/30 border border-[#5e6d4e] transition-all hover:scale-105 active:scale-95">
              <Wrench className="w-4 h-4" /> Stream Tunning
            </button>
          </div>
        </div>
      </header>

      {/* MAIN VIEW: PLAYER + CHANNEL LIST */}
      <main className="flex-1 max-w-[1600px] w-full mx-auto p-4 sm:p-6 flex flex-col gap-6">
        
        {/* KHU VỰC TRÌNH PHÁT */}
        {/* Thêm scroll-mt để khi cuộn lên không bị Header che khuất */}
        <div ref={playerRef} className="bg-[#1a2019] border border-[#2a3327] rounded-2xl overflow-hidden shadow-2xl flex flex-col scroll-mt-24">
          <div className="relative aspect-video bg-black flex items-center justify-center group w-full">
            <video ref={videoRef} className="w-full h-full object-contain" playsInline onClick={togglePlay} />
            
            {/* Overlay Loading / Error */}
            {playbackError && (
              <div className="absolute inset-0 bg-black/80 flex flex-col items-center justify-center p-4 text-center z-10">
                <AlertCircle className="w-10 h-10 text-red-500 mb-2" />
                <p className="text-sm text-[#e5e7eb]">{playbackError}</p>
                <div className="flex gap-2 mt-4">
                  <button onClick={() => { setUseProxyForPlayback(!useProxyForPlayback); loadStreamInPlayer(activeStreamUrl, !useProxyForPlayback); }} className="px-4 py-2 bg-[#4a593d] text-white text-sm rounded-lg hover:bg-[#5e6d4e]">Bật Proxy</button>
                  <button onClick={() => loadStreamInPlayer(activeStreamUrl, useProxyForPlayback)} className="px-4 py-2 bg-[#2a3327] text-white text-sm rounded-lg hover:bg-[#3a4535] flex items-center gap-2"><RefreshCw className="w-4 h-4"/> Thử lại</button>
                </div>
              </div>
            )}

            {/* Nút Play giữa màn hình */}
            {!playbackError && activeStreamUrl && (
              <button onClick={togglePlay} className="absolute w-20 h-20 rounded-full bg-[#4a593d]/90 hover:bg-[#5e6d4e] text-white flex items-center justify-center backdrop-blur-md opacity-0 group-hover:opacity-100 transition-all duration-300 shadow-2xl transform scale-90 group-hover:scale-100 cursor-pointer border border-[#5e6d4e]">
                {isPlaying ? <Pause className="w-8 h-8" /> : <Play className="w-8 h-8 ml-1" />}
              </button>
            )}

            {/* Thông tin kênh đang phát (Góc trên trái) */}
            <div className="absolute top-4 left-4 bg-black/60 backdrop-blur-md px-3 py-1.5 rounded-lg border border-[#5e6d4e]/50 flex items-center gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
              <Radio className="w-4 h-4 text-[#a3b18a] animate-pulse" />
              <span className="text-sm font-semibold text-[#e5e7eb]">
                {extractedStreams[currentIndex]?.channelName || 'Đang phát'}
              </span>
            </div>
          </div>

                   {/* Thanh Điều Khiển (Controls) */}
          <div className="bg-[#1f261e] px-4 py-3 flex flex-wrap items-center justify-between gap-4 border-t border-[#2a3327]">
                        <div className="flex items-center gap-2">
              
              {/* 1. ICON KÊNH ĐANG PHÁT (Nằm trước nút Previous) */}
              <div className="w-10 h-10 rounded-lg flex items-center justify-center shrink-0 mr-1">
                {extractedStreams[currentIndex]?.logo ? (
                  <img 
                    src={extractedStreams[currentIndex].logo} 
                    alt="logo" 
                    className="w-full h-full object-contain drop-shadow-md" 
                  />
                ) : (
                  <div className="w-8 h-8 rounded-lg bg-[#2a3327] flex items-center justify-center border border-[#3a4535]">
                    <Tv className="w-4 h-4 text-[#a3b18a]" />
                  </div>
                )}
              </div>

              {/* 2. NÚT PREVIOUS */}
              <button onClick={playPrev} disabled={currentIndex <= 0} className="p-2 rounded-lg hover:bg-[#2a3327] disabled:opacity-30 text-white transition"><SkipBack className="w-5 h-5" /></button>
              
              {/* 3. NÚT PLAY / PAUSE */}
              <button onClick={togglePlay} className="p-2.5 rounded-xl bg-[#4a593d] hover:bg-[#5e6d4e] text-white shadow-lg shadow-black/30 transition border border-[#5e6d4e]">
                {isPlaying ? <Pause className="w-5 h-5" /> : <Play className="w-5 h-5" />}
              </button>
              
              {/* 4. NÚT NEXT */}
              <button onClick={playNext} disabled={currentIndex >= extractedStreams.length - 1} className="p-2 rounded-lg hover:bg-[#2a3327] disabled:opacity-30 text-white transition"><SkipForward className="w-5 h-5" /></button>
              
              {/* Dải phân cách */}
              <div className="h-6 w-px bg-[#3a4535] mx-2"></div>
              
              {/* 5. NÚT ÂM LƯỢNG */}
              <button onClick={() => { const v = videoRef.current; if(v) { v.muted = !v.muted; setIsMuted(v.muted); } }} className="p-2 rounded-lg hover:bg-[#2a3327] text-white transition">
                {isMuted ? <VolumeX className="w-5 h-5 text-red-400" /> : <Volume2 className="w-5 h-5" />}
              </button>
              
              {/* Thanh trượt âm lượng */}
              <input type="range" min="0" max="1" step="0.05" value={isMuted ? 0 : volume} onChange={(e) => { const v = videoRef.current; if(v) { v.volume = parseFloat(e.target.value); setVolume(parseFloat(e.target.value)); setIsMuted(parseFloat(e.target.value) === 0); } }} className="w-20 accent-[#5e6d4e]" />
              
              {/* 6. NÚT TRỎ XUỐNG KÊNH ĐANG PHÁT TRONG LIST */}
              <button 
                onClick={() => {
                  const el = document.getElementById(`channel-item-${currentIndex}`);
                  if (el) {
                    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
                    el.classList.add('ring-2', 'ring-[#a3b18a]', 'scale-105');
                    setTimeout(() => el.classList.remove('ring-2', 'ring-[#a3b18a]', 'scale-105'), 2000);
                  }
                }}
                className="p-2 ml-2 rounded-lg bg-[#2a3327] hover:bg-[#4a593d] text-[#a3b18a] transition border border-[#3a4535]"
                title="Trỏ xuống kênh đang phát trong danh sách"
              >
                <LocateFixed className="w-5 h-5" />
              </button>

            </div>

            <div className="flex items-center gap-3">
               {/* HIỂN THỊ THÔNG SỐ CHẤT LƯỢNG HIỆN TẠI */}
               {streamInfo && (
                 <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-[#121612] border border-[#3a4535]">
                   <Activity className="w-3.5 h-3.5 text-[#a3b18a]" />
                   <span className="text-[11px] font-mono text-[#a3b18a]">
                     {streamInfo.resolution || 'HD'} {streamInfo.bitrate ? `• ${streamInfo.bitrate}` : ''}
                   </span>
                 </div>
               )}
               
               <div className="text-xs text-[#8a9a7b] font-mono hidden sm:block">
                  {extractedStreams[currentIndex]?.group || 'Live TV'}
               </div>
               
               <div className="h-6 w-px bg-[#3a4535] mx-1"></div>

               {/* MENU CHỌN CHẤT LƯỢNG */}
               {qualityLevels.length > 0 && (
                 <div className="flex items-center gap-1.5 bg-[#121612] px-2 py-1 rounded-lg border border-[#3a4535]">
                   <Layers className="w-3.5 h-3.5 text-[#a3b18a]" />
                   <select
                     value={currentLevel}
                     onChange={(e) => {
                       const level = parseInt(e.target.value);
                       if (hlsRef.current) {
                         hlsRef.current.currentLevel = level;
                         setCurrentLevel(level);
                       }
                     }}
                     className="bg-transparent text-[#d1d5db] text-xs font-semibold focus:outline-none cursor-pointer"
                   >
                     <option value={-1} className="bg-[#1a2019]">Tự động (Auto)</option>
                     {qualityLevels.map((lvl) => (
                       <option key={lvl.id} value={lvl.id} className="bg-[#1a2019]">
                         {lvl.name}
                       </option>
                     ))}
                   </select>
                 </div>
               )}

               <button onClick={() => { const v = videoRef.current; if(v) { if(document.fullscreenElement) document.exitFullscreen(); else v.requestFullscreen().catch(()=>{}); } }} className="p-2 rounded-lg hover:bg-[#2a3327] text-white transition"><Maximize className="w-5 h-5" /></button>
            </div>
          </div>
        </div>

        {/* KHU VỰC DANH SÁCH KÊNH */}
        <div className="bg-[#1a2019] border border-[#2a3327] rounded-2xl shadow-xl flex flex-col flex-1">
          <div className="px-5 py-3 border-b border-[#2a3327] flex flex-wrap items-center justify-between gap-2 bg-[#1f261e] rounded-t-2xl">
            <h2 className="text-sm font-bold text-white flex items-center gap-2">
              <ListVideo className="w-4 h-4 text-[#a3b18a]" /> Danh sách kênh ({extractedStreams.length})
            </h2>
            <div className="flex items-center gap-2">
              <input 
                type="text" 
                value={playlistUrl} 
                onChange={e => setPlaylistUrl(e.target.value)}
                className="bg-[#121612] border border-[#3a4535] rounded-lg px-2 py-1 text-xs text-[#d1d5db] w-64 focus:outline-none focus:border-[#5e6d4e]"
                placeholder="Nhập link M3U..."
              />
              <button onClick={() => loadPlaylistFromUrl(playlistUrl)} disabled={isLoadingPlaylist} className="p-1.5 rounded-lg bg-[#4a593d]/30 text-[#a3b18a] hover:bg-[#4a593d]/60 border border-[#5e6d4e]/30">
                {isLoadingPlaylist ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
              </button>
            </div>
          </div>
          
  <div className="flex-1 overflow-y-auto p-4 grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4 max-h-[600px]">
            {extractedStreams.map((st, i) => {
              const isActive = st.url === activeStreamUrl;
              return (
                <div 
                  key={i} 
                  id={`channel-item-${i}`} 
                  onClick={() => playStream(st.url)} 
                  className={`cursor-pointer p-3 rounded-2xl border transition-all duration-300 flex flex-col items-center justify-start gap-3 ${
                    isActive 
                      ? 'bg-[#4a593d]/30 border-[#a3b18a] shadow-[0_0_20px_rgba(163,177,138,0.15)] ring-1 ring-[#a3b18a]/50' 
                      : 'bg-[#1f261e] border-[#2a3327] hover:border-[#4a593d] hover:bg-[#1f261e]/80'
                  }`}
                >
                  {/* Icon/Logo phóng to, BỎ NỀN ĐEN */}
                  <div className="w-24 h-24 flex items-center justify-center shrink-0 p-1">
                    {st.logo ? (
                      <img src={st.logo} alt="logo" className="w-full h-full object-contain" />
                    ) : (
                      <Tv className="w-10 h-10 text-[#5e6d4e]" />
                    )}
                  </div>
                  
                  {/* Tên kênh hiển thị đầy đủ, tự động xuống dòng */}
                  <div className="w-full text-center">
                    <p 
                      className={`text-sm font-bold whitespace-normal break-words leading-tight ${isActive ? 'text-[#a3b18a]' : 'text-[#d1d5db]'}`} 
                      title={st.channelName}
                    >
                      {st.channelName}
                    </p>
                  </div>
                  
                  {/* Chấm trạng thái nếu đang phát */}
                  {isActive && <div className="w-2 h-2 rounded-full bg-[#a3b18a] animate-pulse mt-1"></div>}
                </div>
              );
            })}
          </div>
        </div>
      </main>

      {/* ========================================== */}
      {/* MODAL: STREAM TUNNING (Giao diện Toolbox) */}
      {/* ========================================== */}
      {isTunningOpen && (
        <div className="fixed inset-0 z-50 bg-[#121612]/95 backdrop-blur-sm flex flex-col animate-in fade-in duration-200">
          {/* Header Modal */}
          <div className="bg-[#1a2019] border-b border-[#2a3327] px-4 py-3 flex items-center justify-between shrink-0">
            <div className="flex items-center gap-3">
              <Wrench className="w-5 h-5 text-[#a3b18a]" />
              <h2 className="text-lg font-bold text-white">Stream Tunning Toolbox</h2>
            </div>
            <button onClick={() => setIsTunningOpen(false)} className="p-2 rounded-lg hover:bg-[#2a3327] text-[#8a9a7b] hover:text-white transition">
              <X className="w-6 h-6" />
            </button>
          </div>

          {/* Tab Navigation */}
          <div className="bg-[#1a2019] border-b border-[#2a3327] px-4 pt-2 flex gap-4 shrink-0">
            <button onClick={() => setActiveTunningTab('smart')} className={`pb-2 text-sm font-semibold border-b-2 transition-colors ${activeTunningTab === 'smart' ? 'border-[#a3b18a] text-[#a3b18a]' : 'border-transparent text-[#8a9a7b] hover:text-[#d1d5db]'}`}>Smart Replace</button>
            <button onClick={() => setActiveTunningTab('scan')} className={`pb-2 text-sm font-semibold border-b-2 transition-colors ${activeTunningTab === 'scan' ? 'border-[#a3b18a] text-[#a3b18a]' : 'border-transparent text-[#8a9a7b] hover:text-[#d1d5db]'}`}>Quét Link</button>
            <button onClick={() => setActiveTunningTab('logs')} className={`pb-2 text-sm font-semibold border-b-2 transition-colors ${activeTunningTab === 'logs' ? 'border-[#a3b18a] text-[#a3b18a]' : 'border-transparent text-[#8a9a7b] hover:text-[#d1d5db]'}`}>Cài đặt GitHub</button>
          </div>

          {/* Tab Content */}
          <div className="flex-1 overflow-y-auto p-4 sm:p-6 max-w-5xl mx-auto w-full">
            
            {/* TAB SMART REPLACE */}
            {activeTunningTab === 'smart' && (
              <div className="space-y-6">
                <div className="bg-[#2a3327]/50 border border-[#4a593d]/50 rounded-2xl p-5 shadow-lg flex flex-col md:flex-row items-center justify-between gap-4">
                  <div>
                    <h3 className="text-base font-bold text-[#d4d9c8] mb-1 flex items-center gap-2"><Wand2 className="w-5 h-5 text-[#a3b18a]"/> Chạy Smart Replace</h3>
                    <p className="text-sm text-[#8a9a7b]">Quét VTVGo & XemTV để tìm link mới thay thế vào file cũ.</p>
                  </div>
                  <button onClick={runSmartReplace} disabled={isSmartReplacing} className="px-6 py-3 bg-[#4a593d] hover:bg-[#5e6d4e] text-white font-bold text-sm rounded-xl shadow-lg transition whitespace-nowrap border border-[#5e6d4e]">
                    {isSmartReplacing ? <Loader2 className="w-5 h-5 animate-spin"/> : 'Bắt đầu thay thế'}
                  </button>
                </div>

                {smartReplaceM3uContent && (
                  <div className="p-4 bg-[#1f261e] border border-[#4a593d] rounded-xl flex items-center justify-between">
                    <p className="text-sm text-[#a3b18a]">Đã tạo xong file M3U mới với các link thay thế!</p>
                    <button onClick={() => {
                        const blob = new Blob([smartReplaceM3uContent], { type: 'application/vnd.apple.mpegurl;charset=utf-8' });
                        const url = URL.createObjectURL(blob);
                        const a = document.createElement('a'); a.href = url; a.download = `tvPremium-new.m3u`; a.click(); URL.revokeObjectURL(url);
                    }} className="px-4 py-2 bg-[#4a593d] hover:bg-[#5e6d4e] text-white text-sm font-semibold rounded-lg flex items-center gap-2 border border-[#5e6d4e]">
                      <Download className="w-4 h-4" /> Tải File Mới
                    </button>
                  </div>
                )}

                <div className="bg-[#1a2019] border border-[#2a3327] rounded-2xl shadow-xl flex flex-col">
                   <div className="px-4 py-3 border-b border-[#2a3327] flex justify-between items-center bg-[#1f261e] rounded-t-2xl">
                     <span className="text-sm font-bold text-[#d1d5db]">Lịch sử thay thế</span>
                     {smartReplaceSummary && (
                       <div className="flex gap-2">
                         <span className="px-2 py-1 rounded bg-[#2a3327] text-[#a3b18a] text-xs font-bold border border-[#4a593d]">Mới: {smartReplaceSummary.replaced}</span>
                         <span className="px-2 py-1 rounded bg-[#1f261e] text-[#8a9a7b] text-xs font-bold border border-[#3a4535]">Giữ: {smartReplaceSummary.kept}</span>
                         <span className="px-2 py-1 rounded bg-red-950/30 text-red-400 text-xs font-bold border border-red-900/50">Lỗi: {smartReplaceSummary.failed}</span>
                       </div>
                     )}
                   </div>
                   <div className="p-3 space-y-2 max-h-[400px] overflow-y-auto">
                     {smartReplaceLog.length === 0 ? <p className="text-center text-[#8a9a7b] text-sm py-4">Chưa có dữ liệu.</p> : smartReplaceLog.map((l, i) => (
                        <div key={i} className="p-3 rounded-xl border bg-[#1f261e] border-[#2a3327] flex flex-col gap-2">
                           <div className="flex items-center gap-3">
                              <span className="font-mono text-xs text-[#a3b18a] w-24 truncate">{l.slug}</span>
                              <span className="font-semibold text-sm text-white w-32 truncate">{l.name}</span>
                              {l.status === 'found' && <span className="px-2 py-0.5 rounded bg-[#4a593d]/40 text-[#a3b18a] text-[10px] font-bold border border-[#5e6d4e]/50">Đã thay</span>}
                              {l.status === 'kept' && <span className="px-2 py-0.5 rounded bg-slate-700/50 text-slate-300 text-[10px] font-bold border border-slate-600/50">Giữ</span>}
                              {l.status === 'error' && <span className="px-2 py-0.5 rounded bg-red-900/30 text-red-400 text-[10px] font-bold border border-red-800/50">Lỗi</span>}
                              <span className="text-xs text-[#8a9a7b] ml-auto">{l.note}</span>
                           </div>
                           {l.newUrl && <p className="text-xs font-mono text-[#a3b18a] break-all select-all flex items-center gap-2"><span className="text-[10px] bg-[#2a3327] px-1 rounded text-white border border-[#4a593d]">NEW</span> {l.newUrl}</p>}
                        </div>
                     ))}
                   </div>
                </div>
              </div>
            )}

            {/* TAB QUÉT LINK */}
            {activeTunningTab === 'scan' && (
              <div className="space-y-6 max-w-2xl mx-auto">
                 <div className="bg-[#1a2019] border border-[#2a3327] rounded-2xl p-6 shadow-xl space-y-4">
                    <h3 className="text-base font-bold text-white flex items-center gap-2"><Search className="w-5 h-5 text-[#a3b18a]"/> Trích xuất link từ Web</h3>
                    <div className="flex gap-2">
                      <input value={inputUrl} onChange={e => setInputUrl(e.target.value)} placeholder="https://..." className="flex-1 bg-[#121612] border border-[#3a4535] rounded-xl px-4 py-2.5 text-sm text-[#d1d5db] focus:outline-none focus:border-[#5e6d4e]" />
                      <button onClick={handleScanUrl} disabled={isScanning} className="px-6 py-2.5 bg-[#4a593d] hover:bg-[#5e6d4e] text-white font-semibold rounded-xl flex items-center gap-2 border border-[#5e6d4e]">
                        {isScanning ? <Loader2 className="w-4 h-4 animate-spin"/> : <Zap className="w-4 h-4"/>} Quét
                      </button>
                    </div>
                    {scanStatus && <p className="text-sm text-[#a3b18a] bg-[#1f261e] p-3 rounded-lg border border-[#2a3327]">{scanStatus}</p>}
                 </div>
                 
                 <div className="bg-[#1a2019] border border-[#2a3327] rounded-2xl p-6 shadow-xl grid grid-cols-2 gap-4">
                    <button onClick={() => alert('Tính năng đang phát triển')} className="py-4 bg-[#2a3327] hover:bg-[#3a4535] border border-[#4a593d] rounded-xl flex flex-col items-center justify-center gap-2 text-[#d1d5db] font-semibold transition"><Tv className="w-6 h-6 text-[#a3b18a]"/> Quét VTVGo</button>
                    <button onClick={() => alert('Tính năng đang phát triển')} className="py-4 bg-[#2a3327] hover:bg-[#3a4535] border border-[#4a593d] rounded-xl flex flex-col items-center justify-center gap-2 text-[#d1d5db] font-semibold transition"><Globe className="w-6 h-6 text-[#a3b18a]"/> Quét XemTV</button>
                 </div>
              </div>
            )}

            {/* TAB CÀI ĐẶT */}
            {activeTunningTab === 'logs' && (
               <div className="max-w-xl mx-auto bg-[#1a2019] border border-[#2a3327] rounded-2xl p-6 shadow-xl space-y-4">
                  <h3 className="text-base font-bold text-white flex items-center gap-2"><Settings className="w-5 h-5 text-[#a3b18a]"/> Cấu hình GitHub</h3>
                  <div className="space-y-3">
                    <div>
                      <label className="text-xs text-[#8a9a7b] mb-1 block">Repository</label>
                      <input type="text" value={tempRepo} onChange={e => setTempRepo(e.target.value)} className="w-full bg-[#121612] border border-[#3a4535] rounded-xl px-4 py-2 text-sm text-[#d1d5db]" />
                    </div>
                    <div>
                      <label className="text-xs text-[#8a9a7b] mb-1 block">Branch</label>
                      <input type="text" value={tempBranch} onChange={e => setTempBranch(e.target.value)} className="w-full bg-[#121612] border border-[#3a4535] rounded-xl px-4 py-2 text-sm text-[#d1d5db]" />
                    </div>
                    <div>
                      <label className="text-xs text-[#8a9a7b] mb-1 block">Personal Access Token</label>
                      <div className="relative">
                        <input type={showGhToken ? 'text' : 'password'} value={tempToken} onChange={e => setTempToken(e.target.value)} className="w-full bg-[#121612] border border-[#3a4535] rounded-xl px-4 py-2 text-sm text-[#d1d5db] pr-10" />
                        <button onClick={() => setShowGhToken(!showGhToken)} className="absolute right-3 top-1/2 -translate-y-1/2 text-[#8a9a7b] hover:text-white">
                          {showGhToken ? <EyeOff className="w-4 h-4"/> : <Eye className="w-4 h-4"/>}
                        </button>
                      </div>
                    </div>
                    <button onClick={() => {
                      setGhToken(tempToken); setGhRepo(tempRepo); setGhBranch(tempBranch);
                      localStorage.setItem('gh_token', tempToken); localStorage.setItem('gh_repo', tempRepo); localStorage.setItem('gh_branch', tempBranch);
                      alert('Đã lưu cấu hình!');
                    }} className="w-full py-2.5 bg-[#4a593d] hover:bg-[#5e6d4e] text-white font-semibold rounded-xl mt-2 transition shadow-lg border border-[#5e6d4e]">Lưu cài đặt</button>
                  </div>
               </div>
            )}

          </div>
        </div>
      )}
      
      {/* Toast Copy */}
      {copiedUrl && (
        <div className="fixed bottom-6 right-6 z-[60] bg-[#1a2019] border border-[#4a593d] text-[#a3b18a] px-4 py-2.5 rounded-xl shadow-2xl text-xs flex items-center gap-2 backdrop-blur-md animate-in slide-in-from-bottom-5">
          <CheckCircle2 className="w-4 h-4 text-[#a3b18a]" /> Đã sao chép!
        </div>
      )}
    </div>
  );
}