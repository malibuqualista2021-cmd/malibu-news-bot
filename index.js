const { Telegraf } = require('telegraf');
const axios = require('axios');
const RSSParser = require('rss-parser');
const translate = require('@vitalets/google-translate-api');
const fs = require('fs');
require('dotenv').config();

const LOG_ORDER = { debug: 0, info: 1, warn: 2, error: 3 };

function parseLogLevelNum() {
    const name = (process.env.LOG_LEVEL || 'info').toLowerCase().trim();
    if (LOG_ORDER[name] !== undefined) return LOG_ORDER[name];
    return LOG_ORDER.info;
}

const logLevelNum = parseLogLevelNum();

function logDebug(...args) {
    if (logLevelNum <= LOG_ORDER.debug) console.log(...args);
}

function logInfo(...args) {
    if (logLevelNum <= LOG_ORDER.info) console.log(...args);
}

function logWarn(...args) {
    if (logLevelNum <= LOG_ORDER.warn) console.warn(...args);
}

function logError(...args) {
    if (logLevelNum <= LOG_ORDER.error) console.error(...args);
}

const runtimeStats = {
    isRunLoopActive: true,
    lastScanIso: null,
    lastScanTotalNews: 0,
    lastScanQualified: 0,
    lastScanSent: 0,
    lastScanPostedIdsSize: 0,
    lastScanFingerprintsSize: 0
};

function validateEnv() {
    const botToken = process.env.BOT_TOKEN;
    const channelId = process.env.CHANNEL_ID;
    const cryptoKey = process.env.CRYPTOPANIC_API_KEY;
    const adminId = process.env.ADMIN_ID;

    if (botToken === undefined || botToken === null || String(botToken).trim() === '') {
        logError('HATA: BOT_TOKEN zorunludur. .env dosyasinda tanimlayin (deger loglanmaz).');
        process.exit(1);
    }

    if (channelId === undefined || channelId === null || String(channelId).trim() === '') {
        logError('HATA: CHANNEL_ID zorunludur. .env dosyasinda tanimlayin (deger loglanmaz).');
        process.exit(1);
    }

    if (cryptoKey === undefined || cryptoKey === null || String(cryptoKey).trim() === '') {
        logWarn('UYARI: CryptoPanic API key yok, public endpoint kullanılacak.');
    }

    if (adminId !== undefined && adminId !== null && String(adminId).trim() !== '') {
        const s = String(adminId).trim();
        if (!/^-?\d{1,20}$/.test(s)) {
            logWarn('UYARI: ADMIN_ID beklenen sayisal Telegram ID formatinda degil; simdilik yoksayiliyor.');
        }
    }
}

validateEnv();

// =======================================================
//  MALIBU NEWS BOT v2.1 - KRITIK HABER ODAKLI (REFINE)
// =======================================================

const BOT_TOKEN = process.env.BOT_TOKEN;
const CHANNEL_ID = process.env.CHANNEL_ID;
const ADMIN_ID = process.env.ADMIN_ID;
const CRYPTOPANIC_API_KEY = process.env.CRYPTOPANIC_API_KEY;
const STATE_FILE = './news_state.json';

function parseAdminUserId() {
    if (!ADMIN_ID || String(ADMIN_ID).trim() === '') return null;
    const s = String(ADMIN_ID).trim();
    if (!/^-?\d{1,20}$/.test(s)) return null;
    return Number(s);
}

const ADMIN_USER_ID = parseAdminUserId();

const bot = new Telegraf(BOT_TOKEN);
const parser = new RSSParser();

// =======================================================
//  COK KATMANLI SKORLAMA MOTORU
// =======================================================

// Katman 1: KRITIK - Piyasayi aninda etkileyen gelismeler (+120 puan)
const TIER1_CRITICAL = [
    // Merkez Bankasi & Para Politikasi
    'fed ', 'fomc', 'powell', 'rate decision', 'rate cut', 'rate hike', 'faiz karari',
    'interest rate', 'monetary policy', 'quantitative', 'tightening', 'easing',
    'ecb', 'boj', 'boe', 'pboc', 'tcmb', 'lagarde', 'ueda',
    // Makro Veri Bombasi
    'cpi ', 'ppi ', 'nfp', 'non-farm', 'payrolls', 'gdp ', 'unemployment rate',
    'jobless claims', 'core inflation', 'consumer price',
    // Savas & Silahli Catisma (Aktif)
    'declares war', 'savas ilan', 'invade', 'invasion', 'isgal',
    'nuclear', 'nukleer', 'missile strike', 'airstrike', 'hava saldirisi',
    'troops deployed', 'ground operation', 'kara operasyonu', 'ceasefire', 'ateskes',
    // Acil Piyasa Olaylari
    'circuit breaker', 'flash crash', 'black swan', 'market halt', 'trading halted',
    'emergency meeting', 'acil toplanti', 'bankruptcy', 'iflas',
    'breaking:', 'breaking news', 'son dakika', 'urgent',
    // Buyuk Kripto Olaylari
    'etf approved', 'etf rejected', 'etf onay', 'sec lawsuit', 'sec dava',
    'major hack', 'exchange hack', 'billion liquidat', 'billion dollar'
  ];

// Katman 2: ONEMLI - Piyasayi belirgin etkileyen haberler (+70 puan)
const TIER2_IMPORTANT = [
    // Jeopolitik Gerilim
    'iran', 'israel', 'israil', 'russia', 'rusya', 'ukraine', 'ukrayna',
    'china', 'cin', 'taiwan', 'tayvan', 'north korea', 'kuzey kore',
    'nato', 'sanctions', 'yaptirim', 'embargo', 'tariff', 'trade war', 'ticaret savasi',
    'strait of hormuz', 'hurmuz', 'south china sea', 'guney cin denizi',
    // Onemli Ekonomik Sinyaller
    'recession', 'resesyon', 'stagflation', 'default', 'debt ceiling', 'borc tavani',
    'credit downgrade', 'not indirimi', 'yield curve', 'inverted',
    'inflation surge', 'deflation', 'bank run', 'bank failure', 'banka batik',
    'bail out', 'kurtarma paketi',
    // Buyuk Kripto Haberleri (Kritik alti)
    'sec ', 'whale', 'regulation', 'regulasyon', 'ban crypto', 'kripto yasak',
    'stablecoin', 'defi hack', 'rug pull', 'exploit',
    // Petrol & Emtia
    'crude oil', 'ham petrol', 'opec', 'oil price', 'petrol fiyat',
    'gold price', 'altin fiyat', 'gold surges', 'altin yuksel',
    // Onemli Sirket Haberleri (Sadece piyasa etkisi olanlar)
    'tesla', 'nvidia', 'apple earnings', 'microsoft earnings', 'amazon earnings'
  ];

// Katman 2.5: GENEL KRIPTO - Cok sik gecen ama tek basina yetersiz terimler (+30 puan)
const TIER2_5_GENERAL_CRYPTO = [
    'bitcoin', 'btc', 'ethereum', 'eth', 'etf ', 'crypto market', 'altcoin'
  ];

// Katman 3: GURULTU - Degersiz / Ilgisiz haberler (-100 puan)
const TIER3_NOISE = [
    // Analiz & Tahmin Gurultusu (YENI)
    'price prediction', 'price analysis', 'bullish', 'bearish', 'analyst says', 'predicts', 'forecasts',
    'tahmin ediyor', 'analiz etti', 'bekleniyor', 'fiyat hedefi', 'yukselebilir', 'dusebilir',
    'expert says', 'pundit', 'speculation', 'rumor', 'soylenti',
    // Bireysel hisse gurultusu
    'shares', 'stock ', 'stocks ', 'hisse', 'hisseleri',
    'rallied', 'rally', 'gains', 'surged', 'climbed', 'tumbled', 'slipped',
    'edges higher', 'edges lower', 'dips', 'rises', 'falls', 'rebounds',
    'yukseldi', 'dustu', 'artisla kapatti', 'dususle kapatti', 'gun ici',
    'quarterly', 'earnings beat', 'earnings miss', 'bilanco', 'gelir',
    'upgraded', 'downgraded', 'price target', 'hedef fiyat',
    'forecast', 'outlook', 'guidance', 'beklenti acikladi',
    'dividend', 'temettu', 'buyback', 'split',
    // Magazin & Eglence
    'celebrity', 'unlu', 'melania', 'trump jr', 'ivanka', 'kardashian',
    'movie', 'film', 'tv show', 'series', 'netflix', 'disney',
    'spotify', 'music', 'muzik', 'album', 'concert', 'konser',
    'fashion', 'moda', 'luxury', 'luks', 'brand',
    'restaurant', 'food', 'recipe', 'diet', 'health tip', 'wellness', 'fitness',
    // Spor
    'nba', 'nfl', 'mlb', 'nhl', 'fifa', 'premier league', 'champions league',
    'soccer', 'football match', 'basketball', 'tennis', 'golf', 'olympic',
    'world cup', 'super bowl', 'playoff', 'championship',
    'spor', 'mac', 'futbol', 'basketbol', 'sampiyon',
    // Lifestyle
    'travel', 'tourism', 'hotel', 'vacation', 'holiday', 'cruise',
    'real estate', 'housing market', 'mortgage rate', 'home sales',
    'car', 'auto', 'vehicle sale', 'ev sales',
    // Dusuk degerli is haberleri
    'partnership', 'partner', 'ceo says', 'ceo steps', 'announces plan',
    'launches new', 'unveils', 'opens new', 'expands to',
    'fast food', 'retail', 'retailer', 'supermarket', 'franchise', 'chain store',
    'autonomous', 'self-driving', 'ev charger', 'charging station',
    'startup raises', 'series a', 'series b', 'funding round',
    // Dusuk degerli yorumcular
    'cramer', 'jim cramer', 'mad money', 'top picks', 'buy the dip',
    'why you should', 'how to', 'beginner', 'tutorial',
    // Teknik analiz gurultusu
    'technical analysis', 'chart pattern', 'fibonacci', 'moving average',
    'rsi ', 'macd', 'support level', 'resistance level'
  ];

// Katman 4: YASAKLI - Bu kelimeler varsa haber ASLA gecmez (-500 puan)
const TIER4_BANNED = [
    'sponsored', 'reklam', 'advertisement', 'promoted', 'paid content',
    'horoscope', 'burc', 'astrology', 'zodiac',
    'weight loss', 'kilo ver', 'clickbait',
    'unbelievable', 'inanilmaz', 'you wont believe', 'shocking truth',
    'lottery', 'piyango', 'casino', 'gambling', 'kumar',
    'dating', 'flort', 'relationship advice'
  ];

function calculateImportance(title, snippet = '', votes = {}) {
    let score = 0;
    const text = (title + ' ' + snippet).toLowerCase();

  // Katman 1: Kritik (+120 her eslesme icin)
  TIER1_CRITICAL.forEach(w => { if (text.includes(w)) score += 120; });

  // Katman 2: Onemli (+70 her eslesme icin)
  TIER2_IMPORTANT.forEach(w => { if (text.includes(w)) score += 70; });

  // Katman 2.5: Genel Kripto (+30 her eslesme icin)
  TIER2_5_GENERAL_CRYPTO.forEach(w => { if (text.includes(w)) score += 30; });

  // Katman 3: Gurultu (-100 her eslesme icin)
  TIER3_NOISE.forEach(w => { if (text.includes(w)) score -= 100; });

  // Katman 4: Yasakli (-500, tek eslesme yeter)
  TIER4_BANNED.forEach(w => { if (text.includes(w)) score -= 500; });

  // CryptoPanic topluluk oylari (Katsayilar dusuruldu)
  if (votes) {
        score += (votes.positive || 0) * 5; // 8 -> 5
      score += (votes.liked || 0) * 3;    // 4 -> 3
      score -= (votes.negative || 0) * 5;
        score -= (votes.disliked || 0) * 3;
  }

  // Bonus: Birden fazla Tier1 kelime = cok kritik
  let tier1Hits = 0;
    TIER1_CRITICAL.forEach(w => { if (text.includes(w)) tier1Hits++; });
    if (tier1Hits >= 2) score += 50; // Coklu kritik bonus

  return score;
}

// =======================================================
//  GELISMIS CEVIRI MOTORU
// =======================================================

const PROTECTED_WORDS = [
    // Kurumlar & Duzenleyiciler
    'Fed', 'FOMC', 'SEC', 'ECB', 'BOJ', 'BOE', 'PBOC', 'TCMB', 'IMF', 'NATO', 'OPEC',
    'Powell', 'Lagarde', 'Yellen', 'Trump', 'Biden', 'Xi Jinping', 'Putin', 'Erdogan',
    // Kripto & Finans
    'Bitcoin', 'BTC', 'Ethereum', 'ETH', 'SOL', 'XRP', 'USDT', 'USDC','BNB',
    'Binance', 'Coinbase', 'Kraken', 'MicroStrategy', 'BlackRock', 'Grayscale',
    'ETF', 'CPI', 'PPI', 'GDP', 'NFP', 'S&P 500', 'Nasdaq', 'Dow Jones', 'VIX',
    // Medya Kaynaklari
    'CoinDesk', 'CNBC', 'Reuters', 'Bloomberg', 'ForexLive', 'FXStreet', 'CryptoPanic',
    'The Block', 'Investing.com',
    // Sirketler
    'Tesla', 'Nvidia', 'Apple', 'Microsoft', 'Amazon', 'Meta', 'Google', 'Alphabet',
    // Ulkeler (ceviride bozulmamasi icin)
    'Hezbollah', 'Hamas', 'Houthi'
  ];

const FINANCE_GLOSSARY = {
    // Para Politikasi
    'not dususu': 'not indirimi', 'not dususlerinin': 'not indirimlerinin',
    'not artisi': 'not artirimi',
    'faiz artisi': 'faiz artirimi', 'faiz dususu': 'faiz indirimi',
    'oran artisi': 'faiz artirimi', 'oran indirimi': 'faiz indirimi',
    'oran kesintisi': 'faiz indirimi', 'oran artirimi': 'faiz artirimi',
    'oran karari': 'faiz karari',
    'para politikasi': 'para politikasi', // koruma
    'gevseme': 'parasal genisleme', 'sikilastirma': 'parasal sikilastirma',
    'niceliksel gevseme': 'niceliksel genisleme (QE)',

    // Piyasa Terimleri
    'ayi piyasasi': 'dusus trendi', 'boga piyasasi': 'yukselis trendi',
    'ayi kosusu': 'dusus dalgasi', 'boga kosusu': 'yukselis dalgasi',
    'likidasyon': 'tasfiye', 'volatilite': 'fiyat oynakligi',
    'piyasa degeri': 'piyasa degeri',
    'kisa satis': 'aciga satis', 'kisa pozisyon': 'kisa pozisyon',
    'uzun pozisyon': 'uzun pozisyon',
    'getiri egrisi': 'verim egrisi', 'ters cevrilmis': 'tersine donmus',
    'temerrut': 'temerrut (default)',

    // Jeopolitik
    'ticaret savasi': 'ticaret savasi',
    'gumruk duvari': 'gumruk tarifeleri', 'gumruk vergisi': 'gumruk tarifeleri',
    'yaptirimlar': 'yaptirimlar', 'ambargo': 'ambargo',
    'ateskes': 'ateskes', 'muzakere': 'muzakere',

    // Kripto Spesifik
    'madencilik': 'madencilik (mining)',
    'yarilanma': 'yarilanma (halving)',
    'cuzdan': 'cuzdan (wallet)',
    'akilli sozlesme': 'akilli kontrat',
    'merkeziyetsiz finans': 'DeFi',
    'merkezi olmayan': 'merkeziyetsiz',

    // Genel Duzeltmeler
    'Bogaz': 'Bogazi', // Hurmuz Bogaz -> Hurmuz Bogazi
    'ham petrol': 'ham petrol',
    'borc tavani': 'borc tavani',
    'kapatma': 'hukumet kapanmasi', // government shutdown context
    'durgunluk': 'resesyon',
    'enflasyon artisi': 'enflasyon yukselisi',
    'buyume orani': 'buyume orani'
};

async function translateText(text) {
    if (!text || text.trim() === '') return text;

  try {
        let processedText = text;
        const placeholders = [];

      // 1. OZEL KELIMELERI KORUMAYA AL
      PROTECTED_WORDS.forEach((word, index) => {
              const regex = new RegExp(`\\b${word}\\b`, 'gi');
              processedText = processedText.replace(regex, (match) => {
                        const placeholder = `[[P${index}]]`;
                        placeholders.push({ placeholder, original: match });
                        return placeholder;
              });
      });

      // 2. CEVIRI YAP
      let res = await retryWithBackoff(
        () => translate.translate(processedText, { to: 'tr' }),
        { maxRetries: 3, baseDelayMs: 500, isRetryable: () => true }
      );
        let translatedText = res.text;

      // 3. KORUNAN KELIMELERI GERI YERLESTIR
      placeholders.forEach(item => {
              translatedText = translatedText.replaceAll(item.placeholder, item.original);
              // Bazen Google Translate placeholder'lari bozmaz ama bosluk ekler
                                 translatedText = translatedText.replaceAll(
                                           item.placeholder.replace('[[', '[ [').replace(']]', '] ]'), 
                                           item.original
                                         );
      });

      // 4. FINANSAL SOZLUK DUZELTMELERI
      Object.keys(FINANCE_GLOSSARY).forEach(key => {
              const regex = new RegExp(key, 'gi');
              translatedText = translatedText.replace(regex, FINANCE_GLOSSARY[key]);
      });

      // 5. TEMIZLIK - Kalan placeholder'lari temizle
      translatedText = translatedText.replace(/\[\[P\d+\]\]/g, '');

      return translatedText.trim();
  } catch (e) {
        logError('Ceviri hatasi:', e.message);
        return text;
  }
}

// Snippet'i de cevir (kisa ozet)
async function translateSnippet(snippet) {
    if (!snippet || snippet.trim() === '') return '';
    // Snippet'i 200 karakterle sinirla (ceviri kalitesi icin)
  const short = snippet.length > 200 ? snippet.substring(0, 200) + '...' : snippet;
    return await translateText(short);
}

async function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

function isRetryableAxiosError(err) {
    if (!err) return false;
    if (err.code === 'ECONNABORTED' || err.code === 'ETIMEDOUT' || err.code === 'ECONNRESET') return true;
    if (err.response) {
        const s = err.response.status;
        if (s === 408 || s === 429) return true;
        if (s >= 500) return true;
        return false;
    }
    return true;
}

function isRetryableRssFetchError(err) {
    if (!err) return false;
    const c = err.code || err.cause?.code;
    if (c === 'ECONNRESET' || c === 'ETIMEDOUT' || c === 'ECONNREFUSED' || c === 'ENOTFOUND' || c === 'ECONNABORTED') return true;
    const status = err.statusCode || err.response?.status;
    if (status === 408 || status === 429) return true;
    if (status >= 500) return true;
    if (status === 404 || status === 401 || status === 403) return false;
    if (status && status < 500) return false;
    return true;
}

async function retryWithBackoff(fn, options = {}) {
    const maxRetries = options.maxRetries ?? 3;
    const baseDelayMs = options.baseDelayMs ?? 500;
    const isRetryable = options.isRetryable ?? (() => true);
    let lastError;
    for (let attempt = 0; attempt < maxRetries; attempt++) {
        try {
            return await fn();
        } catch (e) {
            lastError = e;
            if (!isRetryable(e)) throw e;
            if (attempt === maxRetries - 1) break;
            await sleep(baseDelayMs * Math.pow(2, attempt));
        }
    }
    throw lastError;
}

function isTransientTelegramApiError(err) {
    const r = err?.response;
    if (!r) return true;
    const code = r.error_code;
    return code === 500 || code === 502 || code === 503;
}

async function sendTelegramMessageWithRetry(sendFn) {
    const maxRetries = 3;
    let lastError;
    for (let attempt = 0; attempt < maxRetries; attempt++) {
        try {
            return await sendFn();
        } catch (e) {
            lastError = e;
            const r = e.response;
            if (r?.error_code === 429 && r.parameters?.retry_after != null && attempt < maxRetries - 1) {
                const sec = Math.min(Math.max(Number(r.parameters.retry_after), 1), 60);
                await sleep(sec * 1000 + 200);
                continue;
            }
            if (attempt < maxRetries - 1 && isTransientTelegramApiError(e)) {
                await sleep(500 * Math.pow(2, attempt));
                continue;
            }
            throw e;
        }
    }
    throw lastError;
}

function escapeHtml(text) {
    if (text == null) return '';
    return String(text)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

function trimText(text, maxLength) {
    if (text == null || text === '') return '';
    const s = String(text).trim();
    const cap = Math.max(0, Number(maxLength) || 0);
    if (cap === 0) return '';
    if (s.length <= cap) return s;
    const dots = cap >= 3 ? '...' : '';
    const bodyLen = cap - dots.length;
    return (bodyLen > 0 ? s.substring(0, bodyLen) : '') + dots;
}

function isValidNewsUrl(url) {
    if (!url || typeof url !== 'string') return false;
    const trimmed = url.trim();
    if (trimmed === '') return false;
    try {
        const u = new URL(trimmed);
        return u.protocol === 'http:' || u.protocol === 'https:';
    } catch {
        return false;
    }
}

const TRACKING_QUERY_KEYS = new Set([
    'utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content',
    'ref', 'fbclid', 'gclid'
]);

const MIN_TITLE_FINGERPRINT_LEN = 20;

function normalizeUrl(url) {
    if (!url || typeof url !== 'string') return '';
    const trimmed = url.trim();
    if (trimmed === '') return '';
    try {
        const u = new URL(trimmed);
        if (u.protocol !== 'http:' && u.protocol !== 'https:') return '';
        TRACKING_QUERY_KEYS.forEach((k) => u.searchParams.delete(k));
        let pathname = u.pathname;
        if (pathname.length > 1 && pathname.endsWith('/')) {
            pathname = pathname.replace(/\/+$/, '') || '/';
            u.pathname = pathname;
        }
        return u.href;
    } catch {
        return '';
    }
}

function normalizeTitle(title) {
    if (!title || typeof title !== 'string') return '';
    let s = title.toLowerCase();
    s = s.replace(/[^a-z0-9ğüşöçıı\u0400-\u04FF\s]/gi, ' ');
    s = s.replace(/\s+/g, ' ').trim();
    return s;
}

function createNewsFingerprints(item) {
    const out = [];
    const nu = normalizeUrl(item.url || '');
    if (nu) out.push(`url:${nu}`);
    const nt = normalizeTitle(item.title || '');
    if (nt.length >= MIN_TITLE_FINGERPRINT_LEN) out.push(`title:${nt}`);
    return [...new Set(out)];
}

function fingerprintsOverlap(fpsA, fpsB) {
    if (fpsA.length === 0 || fpsB.length === 0) return false;
    const setB = new Set(fpsB);
    for (const fp of fpsA) {
        if (setB.has(fp)) return true;
    }
    return false;
}

function postedContainsAnyFingerprint(state, fps) {
    for (const fp of fps) {
        if (state.posted_fingerprints.includes(fp)) return true;
    }
    return false;
}

function registerFingerprint(state, fp) {
    if (!fp) return;
    if (state.posted_fingerprints.includes(fp)) return;
    state.posted_fingerprints.push(fp);
    if (state.posted_fingerprints.length > 1000) {
        state.posted_fingerprints = state.posted_fingerprints.slice(-1000);
    }
}

function persistFingerprintForItem(state, item, kind) {
    const fps = createNewsFingerprints(item);
    if (kind === 'rejected') {
        for (const fp of fps) {
            if (fp.startsWith('url:')) registerFingerprint(state, fp);
        }
        return;
    }
    for (const fp of fps) {
        registerFingerprint(state, fp);
    }
}

function dedupeNewsBatchByFingerprint(items) {
    const n = items.length;
    const fpsList = items.map((it) => createNewsFingerprints(it));
    const parent = Array.from({ length: n }, (_, i) => i);
    function find(i) {
        if (parent[i] !== i) parent[i] = find(parent[i]);
        return parent[i];
    }
    function union(i, j) {
        const ri = find(i);
        const rj = find(j);
        if (ri !== rj) parent[ri] = rj;
    }
    for (let i = 0; i < n; i++) {
        for (let j = i + 1; j < n; j++) {
            if (fingerprintsOverlap(fpsList[i], fpsList[j])) union(i, j);
        }
    }
    const bestInRoot = new Map();
    for (let i = 0; i < n; i++) {
        const root = find(i);
        const it = items[i];
        const prev = bestInRoot.get(root);
        if (!prev || it.score > prev.score) bestInRoot.set(root, it);
    }
    const winners = new Set(bestInRoot.values());
    for (let i = 0; i < n; i++) {
        if (!winners.has(items[i])) {
            const t = (items[i].title || '').substring(0, 80);
            logDebug(`Duplicate skipped: ${t}`);
        }
    }
    return Array.from(bestInRoot.values());
}

// =======================================================
//  HAFIZA YONETIMI
// =======================================================

function ensureStateShape(state) {
    if (!Array.isArray(state.posted_ids)) state.posted_ids = [];
    if (!Array.isArray(state.posted_fingerprints)) state.posted_fingerprints = [];
    if (typeof state.last_check !== 'string') state.last_check = '';
}

function loadState() {
    try {
          if (fs.existsSync(STATE_FILE)) {
                  const raw = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
                  ensureStateShape(raw);
                  return raw;
          }
    } catch (e) {
          logError('Hafiza yuklenemedi:', e.message);
    }
    return { posted_ids: [], last_check: '', posted_fingerprints: [] };
}

function saveState(state) {
    try {
          if (state.posted_ids.length > 500) {
                  state.posted_ids = state.posted_ids.slice(-500);
          }
          if (state.posted_fingerprints.length > 1000) {
                  state.posted_fingerprints = state.posted_fingerprints.slice(-1000);
          }
          fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
    } catch (e) {
          logError('Hafiza kaydedilemedi:', e.message);
    }
}

// =======================================================
//  HABER KAYNAKLARI (7+ Kaynak, Paralel Tarama)
// =======================================================

async function fetchCryptoPanic(state) {
    const items = [];
    try {
          const url = CRYPTOPANIC_API_KEY
            ? `https://cryptopanic.com/api/v1/posts/?auth_token=${CRYPTOPANIC_API_KEY}&public=true&filter=important`
                  : `https://cryptopanic.com/api/v1/posts/?public=true&filter=important`;
          const res = await retryWithBackoff(
            () => axios.get(url, { timeout: 10000 }),
            { maxRetries: 3, baseDelayMs: 500, isRetryable: isRetryableAxiosError }
          );
          for (const item of (res.data.results || [])) {
                  if (state.posted_ids.includes(item.id.toString())) continue;
                  const cand = {
                            id: item.id.toString(),
                            title: item.title,
                            url: item.url,
                            source: item.source?.title || 'CryptoPanic',
                            type: 'KRIPTO',
                            snippet: '',
                            score: calculateImportance(item.title, '', item.votes)
                  };
                  const fps = createNewsFingerprints(cand);
                  if (postedContainsAnyFingerprint(state, fps)) {
                            const t = (item.title || '').substring(0, 80);
                            logDebug(`Duplicate skipped: ${t}`);
                            continue;
                  }
                  items.push(cand);
          }
    } catch (e) { logWarn('[CryptoPanic] Hata:', e.message); }
    return items;
}

async function fetchRSS(url, sourceName, type, state) {
    const items = [];
    try {
          const feed = await retryWithBackoff(
            () => parser.parseURL(url),
            { maxRetries: 3, baseDelayMs: 500, isRetryable: isRetryableRssFetchError }
          );
          for (const item of (feed.items || [])) {
                  const newsId = item.guid || item.link || item.title;
                  if (state.posted_ids.includes(newsId)) continue;
                  const snippet = item.contentSnippet || item.content || '';
                  const cand = {
                            id: newsId,
                            title: item.title,
                            url: item.link,
                            source: sourceName,
                            type: type,
                            snippet: snippet.substring(0, 300),
                            score: calculateImportance(item.title, snippet)
                  };
                  const fps = createNewsFingerprints(cand);
                  if (postedContainsAnyFingerprint(state, fps)) {
                            const t = (item.title || '').substring(0, 80);
                            logDebug(`Duplicate skipped: ${t}`);
                            continue;
                  }
                  items.push(cand);
          }
    } catch (e) { logWarn(`[${sourceName}] Hata:`, e.message); }
    return items;
}

// =======================================================
//  ANA MOTOR - HABER CEKME VE PAYLASMA
// =======================================================

const MIN_SCORE = 250; // Sadece gercekten kritik haberler gecer

const IMPACT_LABEL_TR = { high: 'yüksek', medium: 'orta', low: 'düşük' };
const BIAS_LABEL_TR = { bullish: 'pozitif', bearish: 'negatif', neutral: 'nötr' };
function analyzeNewsImpact(item) {
    const title = (item.title || '').toLowerCase();
    const snippet = (item.snippet || '').toLowerCase();
    const text = `${title} ${snippet}`;
    const score = item.score || 0;

    const uncertaintyKw = [
        'rumor', 'reportedly', ' allegedly', 'speculation', 'may ', ' could ', 'might ',
        'soylenti', 'iddia', 'belirsiz', 'unconfirmed'
    ];
    let uncertaintyHits = 0;
    uncertaintyKw.forEach((w) => {
        if (text.includes(w)) uncertaintyHits += 1;
    });

    const bearishKw = [
        'hack', 'exploit', 'breach', 'lawsuit', 'ban ', 'banned', 'investigation', 'fraud', 'bankruptcy',
        'iflas', 'crash', 'flash crash', 'sanction', 'yaptirim', 'embargo', 'war ', 'invasion', 'nuclear',
        'liquidat', 'selloff', 'default', 'rug pull', 'delist', 'halt', 'outage', 'withdraw freeze',
        'etf reject', 'etf rejected',
        'rate hike', 'hawkish', 'tightening', 'faiz art', 'inflation hot', 'inflation surge', 'stagflation',
        'recession', 'black swan', 'circuit breaker'
    ];
    let bearishScore = 0;
    bearishKw.forEach((w) => {
        if (text.includes(w)) bearishScore += 2;
    });

    const bullishKw = [
        'etf approval', 'etf approved', 'institutional', 'inflow', 'rate cut', 'easing', 'liquidity inject',
        'stimulus', 'listing', 'partnership', 'upgrade', 'adoption', 'integration', 'milestone', 'breakthrough',
        'record high', 'ath ', 'all-time high', 'bull run', 'accumulation'
    ];
    let bullishScore = 0;
    bullishKw.forEach((w) => {
        if (text.includes(w)) bullishScore += 2;
    });
    ['listing', 'partnership', 'upgrade'].forEach((w) => {
        if (text.includes(w)) bullishScore += 1;
    });

    const categoryKeywords = {
        regulation: ['sec ', 'regulation', 'regulator', 'lawsuit', 'cftc', 'court', 'compliance', 'ban crypto', 'yasak'],
        security: ['hack', 'exploit', 'breach', 'phishing', 'malware', 'stolen', 'drain wallet', 'ransom'],
        exchange: ['exchange', 'binance', 'coinbase', 'kraken', 'withdraw', 'deposit', 'trading halt', 'outage'],
        geopolitical: ['sanction', 'nato', 'taiwan', 'ukraine', 'iran', 'israel', 'russia', 'china', 'war ', 'invasion'],
        macro: ['fed', 'fomc', 'ecb', 'cpi', 'ppi', 'nfp', 'gdp', 'inflation', 'interest rate', 'yield', 'recession'],
        crypto: ['bitcoin', 'btc', 'ethereum', 'eth', 'etf ', 'crypto', 'stablecoin', 'defi', 'altcoin', 'token']
    };
    let category = 'general';
    let bestCatScore = 0;
    Object.entries(categoryKeywords).forEach(([cat, kws]) => {
        let c = 0;
        kws.forEach((w) => {
            if (text.includes(w)) c += 1;
        });
        if (c > bestCatScore) {
            bestCatScore = c;
            category = cat;
        }
    });

    let marketBias = 'neutral';
    if (bullishScore >= bearishScore + 3) marketBias = 'bullish';
    else if (bearishScore >= bullishScore + 3) marketBias = 'bearish';

    let impactLevel = 'medium';
    if (score >= 360 || bearishScore >= 8 || (bearishScore >= 5 && (text.includes('hack') || text.includes('exploit')))) {
        impactLevel = 'high';
    } else if (score < 270 && bearishScore < 3 && bullishScore < 3) {
        impactLevel = 'low';
    }

    let confidence = 70;
    if (bullishScore + bearishScore >= 4) confidence += 12;
    if (score >= 340) confidence += 10;
    if (uncertaintyHits > 0) confidence -= 14 * Math.min(uncertaintyHits, 3);
    if (marketBias !== 'neutral') confidence += 5;
    confidence = Math.max(30, Math.min(95, Math.round(confidence)));

    const riskParts = [];
    if (text.includes('hack') || text.includes('exploit') || text.includes('breach')) {
        riskParts.push('Güvenlik olayı volatiliteyi artırabilir.');
    }
    if (text.includes('lawsuit') || text.includes('investigation') || (text.includes('sec ') && text.includes('charg'))) {
        riskParts.push('Regülasyon belirsizliği.');
    }
    if ((text.includes('war') || text.includes('sanction') || text.includes('yaptirim')) && marketBias === 'bearish') {
        riskParts.push('Jeopolitik risk iştahını kesebilir.');
    }
    if ((text.includes('etf approval') || text.includes('etf approved')) && marketBias === 'bullish') {
        riskParts.push('Kurumsal/kripto lehine sinyal.');
    }
    if ((text.includes('rate cut') || text.includes('easing')) && marketBias === 'bullish') {
        riskParts.push('Gevşek para politikası risk varlıklarını destekleyebilir.');
    }
    if (uncertaintyHits > 0) {
        riskParts.push('Belirsiz dil; güven düşük.');
    }
    let riskNote = riskParts.length ? riskParts.join(' ') : (
        marketBias === 'bullish' ? 'Kısa vadede pozitif etki beklenebilir.' :
            marketBias === 'bearish' ? 'Kısa vadede baskı riski.' :
                'Sınırlı veya yönü belirsiz etki.'
    );
    riskNote = riskNote.replace(/\s+/g, ' ').trim().slice(0, 120);

    return {
        impactLevel,
        marketBias,
        riskNote,
        category,
        confidence
    };
}

function buildChannelHeaderLine(score, biasLabelEscaped) {
    let emoji = '📊';
    let label = 'PİYASA';
    if (score >= 200) {
        emoji = '🚨';
        label = 'KRİTİK';
    } else if (score >= 150) {
        emoji = '📌';
        label = 'ÖNEMLİ';
    }
    return `${emoji} ${label} | ${biasLabelEscaped}`;
}

function buildShortChannelMessage(translatedTitle, translatedSnippet, item, analysis) {
    const safeBias = escapeHtml(BIAS_LABEL_TR[analysis.marketBias] || analysis.marketBias);
    const headerLine = buildChannelHeaderLine(item.score, safeBias);

    let maxTitle = 120;
    let maxSum = 220;
    let maxRisk = 60;

    let lastMsg = '';
    for (let iter = 0; iter < 24; iter++) {
        const titleRaw = trimText((translatedTitle || '').trim(), maxTitle);
        const safeTitle = escapeHtml(titleRaw);

        let sumPart = '';
        if (translatedSnippet && String(translatedSnippet).trim()) {
            const oneLine = String(translatedSnippet).replace(/\s+/g, ' ').trim();
            sumPart = escapeHtml(trimText(oneLine, maxSum));
        }

        const safeImpact = escapeHtml(IMPACT_LABEL_TR[analysis.impactLevel] || analysis.impactLevel);
        const safeConf = escapeHtml(String(analysis.confidence));
        const riskOne = (analysis.riskNote || '').replace(/\s+/g, ' ').trim();
        const safeRisk = escapeHtml(trimText(riskOne, maxRisk));

        const safeSource = escapeHtml(item.source || '');

        let msg = `${headerLine}\n\n<b>${safeTitle}</b>`;
        if (sumPart) msg += `\nÖzet: ${sumPart}`;
        msg += `\nEtki: ${safeImpact} | Güven: ${safeConf}/100 | Risk: ${safeRisk}`;
        if (isValidNewsUrl(item.url)) {
            msg += `\nKaynak: ${safeSource} · <a href="${escapeHtml(item.url.trim())}">Haberi aç</a>`;
        } else {
            msg += `\nKaynak: ${safeSource}`;
        }

        lastMsg = msg;
        if (msg.length <= 700 || (maxTitle <= 35 && maxSum <= 28 && maxRisk <= 12)) return msg;
        maxSum = Math.max(28, maxSum - 35);
        maxTitle = Math.max(35, maxTitle - 20);
        maxRisk = Math.max(12, maxRisk - 8);
    }
    return lastMsg;
}

async function processNews() {
    const state = loadState();
    ensureStateShape(state);
    const isFirstRun = state.posted_ids.length === 0;
    const now = new Date().toLocaleTimeString('tr-TR');
    logDebug(`\n[${now}] ====== TARAMA BASLADI ======`);

  // TUM KAYNAKLAR PARALEL TARANIR (Promise.allSettled)
  const [
        cryptoPanic,
        coinDesk,
        cnbc,
        reuters,
        forexLive,
        fxStreet,
        theBlock,
        investing
      ] = await Promise.allSettled([
        fetchCryptoPanic(state),
        fetchRSS('https://www.coindesk.com/arc/outboundfeeds/rss/', 'CoinDesk', 'KRIPTO', state),
        fetchRSS('https://www.cnbc.com/id/100003114/device/rss/rss.html', 'CNBC', 'FINANS', state),
        fetchRSS('https://feeds.reuters.com/reuters/worldNews', 'Reuters', 'DUNYA', state),
        fetchRSS('https://www.forexlive.com/feed/', 'ForexLive', 'FOREX', state),
        fetchRSS('https://www.fxstreet.com/rss', 'FXStreet', 'FOREX', state),
        fetchRSS('https://www.theblock.co/rss.xml', 'The Block', 'KRIPTO', state),
        fetchRSS('https://www.investing.com/rss/news.rss', 'Investing.com', 'FINANS', state)
      ]);

  // Sonuclari birlestir (basarisiz olanlari atla)
  let allNews = [];
    [cryptoPanic, coinDesk, cnbc, reuters, forexLive, fxStreet, theBlock, investing].forEach((result, i) => {
          const names = ['CryptoPanic', 'CoinDesk', 'CNBC', 'Reuters', 'ForexLive', 'FXStreet', 'The Block', 'Investing.com'];
          if (result.status === 'fulfilled') {
                  logDebug(`  OK ${names[i]}: ${result.value.length} haber`);
                  allNews = allNews.concat(result.value);
          } else {
                  logWarn(`  Kaynak basarisiz: ${names[i]}`);
          }
    });

  allNews = dedupeNewsBatchByFingerprint(allNews);

  logDebug(`  Toplam: ${allNews.length} yeni haber bulundu`);

  // SKOR FILTRESI
  const qualified = allNews.filter(n => n.score >= MIN_SCORE);
    qualified.sort((a, b) => b.score - a.score);

  logDebug(`  Esigi gecen: ${qualified.length} haber (min skor: ${MIN_SCORE})`);

  // Debug: En yuksek skorlu 5 haberi goster
  qualified.slice(0, 5).forEach((n, i) => {
        logDebug(`    ${i + 1}. [${n.score}] ${n.title.substring(0, 80)}...`);
  });

  // Elenen haberleri hafizaya ekle (tekrar taranmasin)
  const rejected = allNews.filter(n => n.score < MIN_SCORE);
    rejected.forEach((n) => {
          state.posted_ids.push(n.id);
          persistFingerprintForItem(state, n, 'rejected');
    });

  // Ilk calistirmada sadece en iyi 2
  if (isFirstRun) {
        const skipped = qualified.slice(2);
        skipped.forEach((n) => {
              state.posted_ids.push(n.id);
              persistFingerprintForItem(state, n, 'skipped');
        });
        qualified.splice(2);
        saveState(state);
  }

  // Her dongude en onemli 3 haberi paylas
  const toPost = qualified.slice(0, 3);
    const toSkip = qualified.slice(3);
    toSkip.forEach((n) => {
          state.posted_ids.push(n.id);
          persistFingerprintForItem(state, n, 'skipped');
    });
    saveState(state);

  let sentThisRound = 0;
  for (const item of toPost) {
        try {
                logDebug(`\n  PAYLASILIYOR [Skor: ${item.score}] - ${item.source}`);
                logDebug(`     "${item.title}"`);

          // Ceviri
          const translatedTitle = await translateText(item.title);
                const translatedSnippet = await translateSnippet(item.snippet);

            const analysis = analyzeNewsImpact(item);
            const message = buildShortChannelMessage(translatedTitle, translatedSnippet, item, analysis);

          await sendTelegramMessageWithRetry(() =>
            bot.telegram.sendMessage(CHANNEL_ID, message, {
                    parse_mode: 'HTML',
                    disable_web_page_preview: true
            })
          );

          state.posted_ids.push(item.id);
                persistFingerprintForItem(state, item, 'posted');
                saveState(state);
                sentThisRound += 1;

          // Haberler arasi bekleme (5 saniye)
          await new Promise(r => setTimeout(r, 5000));
        } catch (e) {
                logError('  Mesaj atma hatasi:', e.message);
        }
  }

  state.last_check = new Date().toISOString();
    runtimeStats.lastScanIso = state.last_check;
    runtimeStats.lastScanTotalNews = allNews.length;
    runtimeStats.lastScanQualified = qualified.length;
    runtimeStats.lastScanSent = sentThisRound;
    runtimeStats.lastScanPostedIdsSize = state.posted_ids.length;
    runtimeStats.lastScanFingerprintsSize = state.posted_fingerprints.length;
    saveState(state);

  logInfo(`Tur ozeti | toplam=${allNews.length} esik_ustu=${qualified.length} gonderilen=${sentThisRound} posted_ids=${state.posted_ids.length} fingerprints=${state.posted_fingerprints.length} | son=${state.last_check}`);
  logDebug(`[${new Date().toLocaleTimeString('tr-TR')}] ====== TARAMA BITTI ======\n`);
}

// ═══════════════════════════════════════════════════════
//  BAŞLATMA — 30 SANIYEDE BIR TARAMA
// ═══════════════════════════════════════════════════════

if (ADMIN_USER_ID !== null) {
    bot.command('status', async (ctx) => {
        if (ctx.from?.id !== ADMIN_USER_ID) {
            await ctx.reply('Yetkisiz.');
            return;
        }
        const s = runtimeStats;
        const alive = s.isRunLoopActive ? 'Evet' : 'Hayir';
        const text = [
            `Bot: ${alive}`,
            `Son tarama: ${s.lastScanIso || 'henuz yok'}`,
            `Son tur toplam haber: ${s.lastScanTotalNews}`,
            `Esik ustu: ${s.lastScanQualified}`,
            `Gonderilen: ${s.lastScanSent}`,
            `posted_ids: ${s.lastScanPostedIdsSize}`,
            `posted_fingerprints: ${s.lastScanFingerprintsSize}`
        ].join('\n');
        await ctx.reply(text);
    });
}

bot.telegram.getMe().then((me) => {
    logInfo(`[START] Malibu News Bot v2.1 | @${me.username} | tarama 30s`);

                            // Ilk calistirma
                            processNews();

                            // Her 30 saniyede bir tarama (maksimum hiz)
                            setInterval(processNews, 30 * 1000);

                            bot.launch();
}).catch(() => {
    logError('Telegram getMe basarisiz; BOT_TOKEN gecersiz veya ag hatasi olabilir (token loglanmaz).');
    process.exit(1);
});

process.once('SIGINT', () => {
    runtimeStats.isRunLoopActive = false;
    bot.stop('SIGINT');
});
process.once('SIGTERM', () => {
    runtimeStats.isRunLoopActive = false;
    bot.stop('SIGTERM');
});
