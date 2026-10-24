import fs from 'fs';
import { discoverVtvgoChannels } from './update-vtvgo.js';
import { discoverXemtvChannels, extractXemtvChannelStream } from './update-xemtv.js';

const SLUG_TO_NAME = {
  vtv1: 'VTV1', vtv2: 'VTV2', vtv3: 'VTV3', vtv4: 'VTV4', vtv5: 'VTV5', vtv6: 'VTV6', vtv7: 'VTV7', vtv8: 'VTV8', vtv9: 'VTV9', vtv10: 'VTV10',
  vtv5tnb: 'VTV5 Tây Nam Bộ', vtv5tn: 'VTV5 Tây Nguyên', antv: 'ANTV', qpvn: 'QPVN', htv1: 'HTV1', htv2: 'HTV2', htv3: 'HTV3', htv4: 'HTV4', htv5: 'HTV5', htv7: 'HTV7', htv9: 'HTV9', htvthethao: 'HTV Thể Thao',
  lamdong1: 'Lâm Đồng 1', lamdong2: 'Lâm Đồng 2', sctv2: 'SCTV2', vinhlong1: 'Vĩnh Long 1', vinhlong2: 'Vĩnh Long 2', vinhlong3: 'Vĩnh Long 3', vinhlong4: 'Vĩnh Long 4', vinhlong5: 'Vĩnh Long 5',
  cantho1: 'Cần Thơ 1', cantho2: 'Cần Thơ 2', cantho3: 'Cần Thơ 3', hanoi1: 'Hà Nội 1', hanoi2: 'Hà Nội 2', haiphong: 'Hải Phòng', haiphong3: 'Hải Phòng 3',
  dongnai1: 'Đồng Nai 1', dongnai2: 'Đồng Nai 2', dongnai3: 'Đồng Nai 3', hue: 'Huế', danang1: 'Đà Nẵng 1', danang2: 'Đà Nẵng 2', caobang: 'Cao Bằng', hatinh: 'Hà Tĩnh', nghean: 'Nghệ An', thanhhoa: 'Thanh Hóa',
  quangninh1: 'Quảng Ninh 1', quangninh3: 'Quảng Ninh 3', langson: 'Lạng Sơn', sonla: 'Sơn La', dienbien: 'Điện Biên', laichau: 'Lai Châu', angiang1: 'An Giang 1', angiang2: 'An Giang 2', angiang3: 'An Giang 3',
  camau: 'Cà Mau', dongthap1: 'Đồng Tháp 1', dongthap2: 'Đồng Tháp 2', tayninh1: 'Tây Ninh 1', daklak: 'Đắk Lắk', khanhhoa: 'Khánh Hòa', khanhhoa1: 'Khánh Hòa 1', gialai: 'Gia Lai', quangngai: 'Quảng Ngãi', quangngai2: 'Quảng Ngãi 2', quangtri: 'Quảng Trị', ninhbinh: 'Ninh Bình', hungyen: 'Hưng Yên', bacninh: 'Bắc Ninh', phutho: 'Phú Thọ', thainguyen: 'Thái Nguyên', laocai: 'Lào Cai', tuyenquang: 'Tuyên Quang', vietnamtoday: 'Việt Nam Today',
};

const ALIASES = {
  hue: ['Huế', 'Hue', 'TRT'], danang2: ['Đà Nẵng 2', 'DN2'], caobang: ['Cao Bằng', 'CBTV'], hatinh: ['Hà Tĩnh', 'HTTV'], quangninh3: ['Quảng Ninh 3', 'QN3'],
  langson: ['Lạng Sơn', 'LSTV'], sonla: ['Sơn La', 'STV'], dienbien: ['Điện Biên', 'ĐTV'], laichau: ['Lai Châu'], camau: ['Cà Mau', 'CMTV'],
  daklak: ['Đắk Lắk', 'DakLak', 'DRT'], gialai: ['Gia Lai'], quangngai2: ['Quảng Ngãi 2'], quangtri: ['Quảng Trị', 'QRT'], laocai: ['Lào Cai'], tuyenquang: ['Tuyên Quang'],
  cantho1: ['Cần Thơ 1', 'CT1'], cantho2: ['Cần Thơ 2', 'CT2'], cantho3: ['Cần Thơ 3', 'CT3'], dongnai1: ['Đồng Nai 1', 'DN1'], dongnai2: ['Đồng Nai 2', 'DN2'], dongnai3: ['Đồng Nai 3', 'DN3'],
  lamdong1: ['Lâm Đồng 1', 'LTV1'], lamdong2: ['Lâm Đồng 2', 'LTV2', 'Bình Thuận'], vinhlong1: ['Vĩnh Long 1', 'THVL1'], vinhlong2: ['Vĩnh Long 2', 'THVL2'],
  vinhlong3: ['Vĩnh Long 3', 'THVL3'], vinhlong4: ['Vĩnh Long 4', 'THVL4'], vinhlong5: ['Vĩnh Long 5', 'THVL5'], angiang1: ['An Giang 1', 'ATV1'], angiang2: ['An Giang 2', 'ATV2'], angiang3: ['An Giang 3', 'ATV3'],
  hanoi1: ['Hà Nội 1', 'HN1'], haiphong: ['Hải Phòng', 'THP'], danang1: ['Đà Nẵng 1'], quangninh1: ['Quảng Ninh 1'], khanhhoa: ['Khánh Hòa', 'KTV'], khanhhoa1: ['Khánh Hòa 1'], quangngai: ['Quảng Ngãi'], dongthap1: ['Đồng Tháp 1'], dongthap2: ['Đồng Tháp 2'], tayninh1: ['Tây Ninh 1'],
  vtv5tnb: ['VTV5 Tây Nam Bộ', 'VTV5 TNB'], vtv5tn: ['VTV5 Tây Nguyên', 'VTV5 TN'], vtv6: ['VTV6', 'VTV Cần Thơ'], htvthethao: ['HTV Thể Thao', 'HTVTT'], vietnamtoday: ['Việt Nam Today'],
};

function normalize(s) {
  if (!s) return '';
  let t = s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  return t.replace(/đ/g, 'd').replace(/\b(hd|sd|fhd|uhd|4k)\b/g, '').replace(/[^a-z0-9]/g, '');
}

function getKeys(slug, name) {
  const k = new Set([normalize(name), normalize(slug)]);
  if (ALIASES[slug]) ALIASES[slug].forEach(a => k.add(normalize(a)));
  return Array.from(k).filter(Boolean);
}

async function probe(url, ref) {
  try {
    const r = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0', 'Referer': ref }, signal: AbortSignal.timeout(5000) });
    if (!r.ok) return 0;
    const t = await r.text();
    let h = 0, b = 0;
    const reg = /#EXT-X-STREAM-INF:([^\r\n]+)/g; let m;
    while ((m = reg.exec(t)) !== null) {
      const rh = (m[1].match(/RESOLUTION=(\d+)x(\d+)/i) || [])[2];
      const rb = (m[1].match(/BANDWIDTH=(\d+)/i) || [])[1];
      if (rh && parseInt(rh) > h) h = parseInt(rh);
      if (rb && parseInt(rb) > b) b = parseInt(rb);
    }
    return (h * 10000000) + b;
  } catch { return 0; }
}

async function main() {
  if (!fs.existsSync('channel_url.txt') || !fs.existsSync('tvPremium.m3u')) return console.log('Thiếu file');
  
  const slugs = fs.readFileSync('channel_url.txt', 'utf8').split(/\r?\n/).map(l => l.trim()).filter(l => l.startsWith('#')).map(l => l.replace(/^#+/, '').toLowerCase());
  const text = fs.readFileSync('tvPremium.m3u', 'utf8');
  const bom = text.charCodeAt(0) === 0xFEFF;
  let lines = text.split(/\r?\n/); if (bom && lines.length > 0) lines[0] = lines[0].replace(/^\uFEFF/, '');

  console.log('Đang tải cache VTVGo & XemTV...');
  const [vtv, xem] = await Promise.all([discoverVtvgoChannels(), discoverXemtvChannels()]);
  let rep = 0;

  for (const slug of slugs) {
    const name = SLUG_TO_NAME[slug]; if (!name) continue;
    const keys = getKeys(slug, name);
    
    let idx = -1;
    for (let i = 0; i < lines.length; i++) {
      if (!lines[i].startsWith('#EXTINF')) continue;
      const id = (lines[i].match(/tvg-id="([^"]+)"/i) || [])[1] || '';
      const nm = (lines[i].match(/,\s*(.+)$/) || [])[1]?.replace(/\([^)]*\)/g, '').replace(/\s+(HD|FHD|SD|4K)$/i, '').trim() || '';
      if (keys.some(k => normalize(id) === k || normalize(nm) === k || (k.length > 3 && (normalize(nm).includes(k) || k.includes(normalize(nm)))))) { idx = i; break; }
    }
    if (idx === -1) continue;
    
    let uidx = idx + 1; while (uidx < lines.length && lines[uidx].trim().startsWith('#')) uidx++;
    const old = lines[uidx]?.trim();
    const cands = [];

    // Lấy link VTVGo
    const ve = vtv.find(c => keys.some(k => normalize(c.channelName) === k || (k.length > 3 && normalize(c.channelName).includes(k))));
    if (ve) {
      try {
        const r = await fetch('https://api.vtvdigital.org/live-channel/v21.0/playback/source', { 
          method: 'POST', headers: { 'User-Agent': 'Mozilla/5.0', 'Referer': 'https://vtvgo.vn/', 'Content-Type': 'application/json' }, 
          body: JSON.stringify({ channelId: String(ve.channelId), platform: 'webPC', deviceId: crypto.randomUUID() }) 
        });
        if (r.ok) { 
          const d = await r.json(); 
          for (const md of (d.data?.sourceModes || [])) for (const ms of (md.multiSource || [])) for (const s of (ms.sources || [])) 
            if (s.url?.includes('.m3u8')) cands.push({ url: s.url, src: 'VTVGo' }); 
        }
      } catch {}
    }

    // Lấy link XemTV
    const xe = xem.find(c => keys.some(k => normalize(c.channelName) === k || (k.length > 3 && normalize(c.channelName).includes(k))));
    if (xe) {
      try { const r = await extractXemtvChannelStream(xe.url); if (r?.success) cands.push({ url: r.streamUrl, src: 'XemTV' }); } catch {}
    }

    // Chọn link chất lượng cao nhất
    const probed = [];
    for (const c of cands) {
      const score = await probe(c.url, c.src === 'VTVGo' ? 'https://vtvgo.vn/' : 'https://hd1.xemtv.net/');
      if (score > 0) probed.push({ url: c.url, score });
    }
    probed.sort((a, b) => b.score - a.score);
    
    if (probed[0] && probed[0].url !== old) { 
      lines[uidx] = probed[0].url; 
      rep++; 
      console.log(`[Thay thế] ${name}`);
    }
  }

  if (rep > 0) {
    fs.writeFileSync('tvPremium.m3u', (bom ? '\uFEFF' : '') + lines.join('\r\n'), 'utf8');
    console.log(`Hoàn tất! Đã thay ${rep} link.`);
  } else {
    console.log('Không có link nào thay đổi.');
  }
}
main().catch(console.error);