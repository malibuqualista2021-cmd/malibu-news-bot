const { Telegraf } = require('telegraf');
const axios = require('axios');
const RSSParser = require('rss-parser');
const translate = require('@vitalets/google-translate-api');
const fs = require('fs');
require('dotenv').config();

// ═══════════════════════════════════════════════════════
//  MALIBU NEWS BOT v2.0 — SADECE KRİTİK GELİŞMELER
// ═══════════════════════════════════════════════════════

const BOT_TOKEN = process.env.BOT_TOKEN;
const CHANNEL_ID = process.env.CHANNEL_ID;
const ADMIN_ID = process.env.ADMIN_ID;
const CRYPTOPANIC_API_KEY = process.env.CRYPTOPANIC_API_KEY;
const STATE_FILE = './news_state.json';

const bot = new Telegraf(BOT_TOKEN);
const parser = new RSSParser();

// ═══════════════════════════════════════════════════════
//  ÇOK KATMANLI SKORLAMA MOTORu
// ═══════════════════════════════════════════════════════

// Katman 1: KRİTİK — Piyasayı anında etkileyen gelişmeler (+120 puan)
const TIER1_CRITICAL = [
  // Merkez Bankası & Para Politikası
  'fed ', 'fomc', 'powell', 'rate decision', 'rate cut', 'rate hike', 'faiz kararı',
  'interest rate', 'monetary policy', 'quantitative', 'tightening', 'easing',
  'ecb', 'boj', 'boe', 'pboc', 'tcmb', 'lagarde', 'ueda',
  // Makro Veri Bombası
  'cpi ', 'ppi ', 'nfp', 'non-farm', 'payrolls', 'gdp ', 'unemployment rate',
  'jobless claims', 'core inflation', 'consumer price',
  // Savaş & Silahlı Çatışma (Aktif)
  'declares war', 'savaş ilan', 'invade', 'invasion', 'işgal',
  'nuclear', 'nükleer', 'missile strike', 'airstrike', 'hava saldırısı',
  'troops deployed', 'ground operation', 'kara operasyonu', 'ceasefire', 'ateşkes',
  // Acil Piyasa Olayları
  'circuit breaker', 'flash crash', 'black swan', 'market halt', 'trading halted',
  'emergency meeting', 'acil toplantı', 'bankruptcy', 'iflas',
  'breaking:', 'breaking news', 'son dakika', 'urgent',
  // Büyük Kripto Olayları
  'etf approved', 'etf rejected', 'etf onay', 'sec lawsuit', 'sec dava',
  'major hack', 'exchange hack', 'billion liquidat', 'billion dollar'
];

// Katman 2: ÖNEMLİ — Piyasayı belirgin etkileyen haberler (+70 puan)
const TIER2_IMPORTANT = [
  // Jeopolitik Gerilim
  'iran', 'israel', 'israil', 'russia', 'rusya', 'ukraine', 'ukrayna',
  'china', 'çin', 'taiwan', 'tayvan', 'north korea', 'kuzey kore',
  'nato', 'sanctions', 'yaptırım', 'embargo', 'tariff', 'trade war', 'ticaret savaşı',
  'strait of hormuz', 'hürmüz', 'south china sea', 'güney çin denizi',
  // Önemli Ekonomik Sinyaller
  'recession', 'resesyon', 'stagflation', 'default', 'debt ceiling', 'borç tavanı',
  'credit downgrade', 'not indirimi', 'yield curve', 'inverted',
  'inflation surge', 'deflation', 'bank run', 'bank failure', 'banka batık',
  'bail out', 'kurtarma paketi',
  // Büyük Kripto Haberleri
  'bitcoin', 'btc', 'ethereum', 'eth', 'sec ', 'etf ',
  'whale', 'regulation', 'regülasyon', 'ban crypto', 'kripto yasak',
  'stablecoin', 'defi hack', 'rug pull', 'exploit',
  // Petrol & Emtia
  'crude oil', 'ham petrol', 'opec', 'oil price', 'petrol fiyat',
  'gold price', 'altın fiyat', 'gold surges', 'altın yüksel',
  // Önemli Şirket Haberleri (Sadece piyasa etkisi olanlar)
  'tesla', 'nvidia', 'apple earnings', 'microsoft earnings', 'amazon earnings'
];

// Katman 3: GÜRÜLTÜ — Değersiz / İlgisiz haberler (-100 puan)
const TIER3_NOISE = [
  // Bireysel hisse gürültüsü
  'shares', 'stock ', 'stocks ', 'hisse', 'hisseleri',
  'rallied', 'rally', 'gains', 'surged', 'climbed', 'tumbled', 'slipped',
  'edges higher', 'edges lower', 'dips', 'rises', 'falls', 'rebounds',
  'yükseldi', 'düştü', 'artışla kapattı', 'düşüşle kapattı', 'gün içi',
  'quarterly', 'earnings beat', 'earnings miss', 'bilanço', 'gelir',
  'upgraded', 'downgraded', 'price target', 'hedef fiyat',
  'forecast', 'outlook', 'guidance', 'beklenti açıkladı',
  'dividend', 'temettü', 'buyback', 'split',
  // Magazin & Eğlence
  'celebrity', 'ünlü', 'melania', 'trump jr', 'ivanka', 'kardashian',
  'movie', 'film', 'tv show', 'series', 'netflix', 'disney',
  'spotify', 'music', 'müzik', 'album', 'concert', 'konser',
  'fashion', 'moda', 'luxury', 'lüks', 'brand',
  'restaurant', 'food', 'recipe', 'diet', 'health tip', 'wellness', 'fitness',
  // Spor
  'nba', 'nfl', 'mlb', 'nhl', 'fifa', 'premier league', 'champions league',
  'soccer', 'football match', 'basketball', 'tennis', 'golf', 'olympic',
  'world cup', 'super bowl', 'playoff', 'championship',
  'spor', 'maç', 'futbol', 'basketbol', 'şampiyon',
  // Lifestyle
  'travel', 'tourism', 'hotel', 'vacation', 'holiday', 'cruise',
  'real estate', 'housing market', 'mortgage rate', 'home sales',
  'car', 'auto', 'vehicle sale', 'ev sales',
  // Düşük değerli iş haberleri
  'partnership', 'partner', 'ceo says', 'ceo steps', 'announces plan',
  'launches new', 'unveils', 'opens new', 'expands to',
  'fast food', 'retail', 'retailer', 'supermarket', 'franchise', 'chain store',
  'autonomous', 'self-driving', 'ev charger', 'charging station',
  'startup raises', 'series a', 'series b', 'funding round',
  // Düşük değerli yorumcular
  'cramer', 'jim cramer', 'mad money', 'top picks', 'buy the dip',
  'why you should', 'how to', 'beginner', 'tutorial',
  // Teknik analiz gürültüsü
  'technical analysis', 'chart pattern', 'fibonacci', 'moving average',
  'rsi ', 'macd', 'support level', 'resistance level'
];

// Katman 4: YASAKLI — Bu kelimeler varsa haber ASLA geçmez (-500 puan)
const TIER4_BANNED = [
  'sponsored', 'reklam', 'advertisement', 'promoted', 'paid content',
  'horoscope', 'burç', 'astrology', 'zodiac',
  'weight loss', 'kilo ver', 'clickbait',
  'unbelievable', 'inanılmaz', 'you wont believe', 'shocking truth',
  'lottery', 'piyango', 'casino', 'gambling', 'kumar',
  'dating', 'flört', 'relationship advice'
];

function calculateImportance(title, snippet = '', votes = {}) {
  let score = 0;
  const text = (title + ' ' + snippet).toLowerCase();

  // Katman 1: Kritik (+120 her eşleşme için)
  TIER1_CRITICAL.forEach(w => { if (text.includes(w)) score += 120; });

  // Katman 2: Önemli (+70 her eşleşme için)
  TIER2_IMPORTANT.forEach(w => { if (text.includes(w)) score += 70; });

  // Katman 3: Gürültü (-100 her eşleşme için)
  TIER3_NOISE.forEach(w => { if (text.includes(w)) score -= 100; });

  // Katman 4: Yasaklı (-500, tek eşleşme yeter)
  TIER4_BANNED.forEach(w => { if (text.includes(w)) score -= 500; });

  // CryptoPanic topluluk oyları
  if (votes) {
    score += (votes.positive || 0) * 8;
    score += (votes.liked || 0) * 4;
    score -= (votes.negative || 0) * 5;
    score -= (votes.disliked || 0) * 3;
  }

  // Bonus: Birden fazla Tier1 kelime = çok kritik
  let tier1Hits = 0;
  TIER1_CRITICAL.forEach(w => { if (text.includes(w)) tier1Hits++; });
  if (tier1Hits >= 2) score += 50; // Çoklu kritik bonus

  return score;
}

// ═══════════════════════════════════════════════════════
//  GELİŞMİŞ ÇEVİRİ MOTORU
// ═══════════════════════════════════════════════════════

const PROTECTED_WORDS = [
  // Kurumlar & Düzenleyiciler
  'Fed', 'FOMC', 'SEC', 'ECB', 'BOJ', 'BOE', 'PBOC', 'TCMB', 'IMF', 'NATO', 'OPEC',
  'Powell', 'Lagarde', 'Yellen', 'Trump', 'Biden', 'Xi Jinping', 'Putin', 'Erdogan',
  // Kripto & Finans
  'Bitcoin', 'BTC', 'Ethereum', 'ETH', 'SOL', 'XRP', 'USDT', 'USDC','BNB',
  'Binance', 'Coinbase', 'Kraken', 'MicroStrategy', 'BlackRock', 'Grayscale',
  'ETF', 'CPI', 'PPI', 'GDP', 'NFP', 'S&P 500', 'Nasdaq', 'Dow Jones', 'VIX',
  // Medya Kaynakları
  'CoinDesk', 'CNBC', 'Reuters', 'Bloomberg', 'ForexLive', 'FXStreet', 'CryptoPanic',
  'The Block', 'Investing.com',
  // Şirketler
  'Tesla', 'Nvidia', 'Apple', 'Microsoft', 'Amazon', 'Meta', 'Google', 'Alphabet',
  // Ülkeler (çeviride bozulmaması için)
  'Hezbollah', 'Hamas', 'Houthi'
];

const FINANCE_GLOSSARY = {
  // Para Politikası
  'not düşüşü': 'not indirimi', 'not düşüşlerinin': 'not indirimlerinin',
  'not artışı': 'not artırımı',
  'faiz artışı': 'faiz artırımı', 'faiz düşüşü': 'faiz indirimi',
  'oran artışı': 'faiz artırımı', 'oran indirimi': 'faiz indirimi',
  'oran kesintisi': 'faiz indirimi', 'oran artırımı': 'faiz artırımı',
  'oran kararı': 'faiz kararı',
  'para politikası': 'para politikası', // koruma
  'gevşeme': 'parasal genişleme', 'sıkılaştırma': 'parasal sıkılaştırma',
  'niceliksel gevşeme': 'niceliksel genişleme (QE)',
  
  // Piyasa Terimleri
  'ayı piyasası': 'düşüş trendi', 'boğa piyasası': 'yükseliş trendi',
  'ayı koşusu': 'düşüş dalgası', 'boğa koşusu': 'yükseliş dalgası',
  'likidasyon': 'tasfiye', 'volatilite': 'fiyat oynaklığı',
  'piyasa değeri': 'piyasa değeri',
  'kısa satış': 'açığa satış', 'kısa pozisyon': 'kısa pozisyon',
  'uzun pozisyon': 'uzun pozisyon',
  'getiri eğrisi': 'verim eğrisi', 'ters çevrilmiş': 'tersine dönmüş',
  'temerrüt': 'temerrüt (default)',
  
  // Jeopolitik
  'ticaret savaşı': 'ticaret savaşı',
  'gümrük duvarı': 'gümrük tarifeleri', 'gümrük vergisi': 'gümrük tarifeleri',
  'yaptırımlar': 'yaptırımlar', 'ambargo': 'ambargo',
  'ateşkes': 'ateşkes', 'müzakere': 'müzakere',
  
  // Kripto Spesifik
  'madencilik': 'madencilik (mining)',
  'yarılanma': 'yarılanma (halving)',
  'cüzdan': 'cüzdan (wallet)',
  'akıllı sözleşme': 'akıllı kontrat',
  'merkeziyetsiz finans': 'DeFi',
  'merkezi olmayan': 'merkeziyetsiz',
  
  // Genel Düzeltmeler
  'Boğaz': 'Boğazı', // Hürmüz Boğaz → Hürmüz Boğazı
  'ham petrol': 'ham petrol',
  'borç tavanı': 'borç tavanı',
  'kapatma': 'hükümet kapanması', // government shutdown context
  'durgunluk': 'resesyon',
  'enflasyon artışı': 'enflasyon yükselişi',
  'büyüme oranı': 'büyüme oranı'
};

async function translateText(text) {
  if (!text || text.trim() === '') return text;
  
  try {
    let processedText = text;
    const placeholders = [];

    // 1. ÖZEL KELİMELERİ KORUMAYA AL
    PROTECTED_WORDS.forEach((word, index) => {
      const regex = new RegExp(`\\b${word}\\b`, 'gi');
      processedText = processedText.replace(regex, (match) => {
        const placeholder = `[[P${index}]]`;
        placeholders.push({ placeholder, original: match });
        return placeholder;
      });
    });

    // 2. ÇEVİRİ YAP
    let res = await translate.translate(processedText, { to: 'tr' });
    let translatedText = res.text;

    // 3. KORUNAN KELİMELERİ GERİ YERLEŞTİR
    placeholders.forEach(item => {
      translatedText = translatedText.replaceAll(item.placeholder, item.original);
      // Bazen Google Translate placeholder'ları bozmaz ama boşluk ekler
      translatedText = translatedText.replaceAll(
        item.placeholder.replace('[[', '[ [').replace(']]', '] ]'), 
        item.original
      );
    });

    // 4. FİNANSAL SÖZLÜK DÜZELTMELERİ
    Object.keys(FINANCE_GLOSSARY).forEach(key => {
      const regex = new RegExp(key, 'gi');
      translatedText = translatedText.replace(regex, FINANCE_GLOSSARY[key]);
    });

    // 5. TEMİZLİK — Kalan placeholder'ları temizle
    translatedText = translatedText.replace(/\[\[P\d+\]\]/g, '');
    
    return translatedText.trim();
  } catch (e) {
    console.error('Çeviri hatası:', e.message);
    return text;
  }
}

// Snippet'i de çevir (kısa özet)
async function translateSnippet(snippet) {
  if (!snippet || snippet.trim() === '') return '';
  // Snippet'i 200 karakterle sınırla (çeviri kalitesi için)
  const short = snippet.length > 200 ? snippet.substring(0, 200) + '...' : snippet;
  return await translateText(short);
}

// ═══════════════════════════════════════════════════════
//  HAFIZA YÖNETİMİ
// ═══════════════════════════════════════════════════════

function loadState() {
  try {
    if (fs.existsSync(STATE_FILE)) {
      return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
    }
  } catch (e) {
    console.error('Hafıza yüklenemedi:', e.message);
  }
  return { posted_ids: [], last_check: '' };
}

function saveState(state) {
  try {
    if (state.posted_ids.length > 500) {
      state.posted_ids = state.posted_ids.slice(-500);
    }
    fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
  } catch (e) {
    console.error('Hafıza kaydedilemedi:', e.message);
  }
}

// ═══════════════════════════════════════════════════════
//  HABER KAYNAKLARI (7+ Kaynak, Paralel Tarama)
// ═══════════════════════════════════════════════════════

async function fetchCryptoPanic(state) {
  const items = [];
  try {
    const url = CRYPTOPANIC_API_KEY
      ? `https://cryptopanic.com/api/v1/posts/?auth_token=${CRYPTOPANIC_API_KEY}&public=true&filter=important`
      : `https://cryptopanic.com/api/v1/posts/?public=true&filter=important`;
    const res = await axios.get(url, { timeout: 10000 });
    for (const item of (res.data.results || [])) {
      if (!state.posted_ids.includes(item.id.toString())) {
        items.push({
          id: item.id.toString(),
          title: item.title,
          url: item.url,
          source: item.source?.title || 'CryptoPanic',
          type: 'KRİPTO',
          snippet: '',
          score: calculateImportance(item.title, '', item.votes)
        });
      }
    }
  } catch (e) { console.error('[CryptoPanic] Hata:', e.message); }
  return items;
}

async function fetchRSS(url, sourceName, type, state) {
  const items = [];
  try {
    const feed = await parser.parseURL(url);
    for (const item of (feed.items || [])) {
      const newsId = item.guid || item.link || item.title;
      if (!state.posted_ids.includes(newsId)) {
        const snippet = item.contentSnippet || item.content || '';
        items.push({
          id: newsId,
          title: item.title,
          url: item.link,
          source: sourceName,
          type: type,
          snippet: snippet.substring(0, 300),
          score: calculateImportance(item.title, snippet)
        });
      }
    }
  } catch (e) { console.error(`[${sourceName}] Hata:`, e.message); }
  return items;
}

// ═══════════════════════════════════════════════════════
//  ANA MOTOR — HABER ÇEKME VE PAYLAŞMA
// ═══════════════════════════════════════════════════════

const MIN_SCORE = 150; // Sadece kritik haberler geçer

async function processNews() {
  const state = loadState();
  const isFirstRun = state.posted_ids.length === 0;
  const now = new Date().toLocaleTimeString('tr-TR');
  console.log(`\n[${now}] ══════ TARAMA BAŞLADI ══════`);

  // TÜM KAYNAKLAR PARALEL TARANIR (Promise.allSettled)
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
    fetchRSS('https://www.coindesk.com/arc/outboundfeeds/rss/', 'CoinDesk', 'KRİPTO', state),
    fetchRSS('https://www.cnbc.com/id/100003114/device/rss/rss.html', 'CNBC', 'FİNANS', state),
    fetchRSS('https://feeds.reuters.com/reuters/worldNews', 'Reuters', 'DÜNYA', state),
    fetchRSS('https://www.forexlive.com/feed/', 'ForexLive', 'FOREX', state),
    fetchRSS('https://www.fxstreet.com/rss', 'FXStreet', 'FOREX', state),
    fetchRSS('https://www.theblock.co/rss.xml', 'The Block', 'KRİPTO', state),
    fetchRSS('https://www.investing.com/rss/news.rss', 'Investing.com', 'FİNANS', state)
  ]);

  // Sonuçları birleştir (başarısız olanları atla)
  let allNews = [];
  [cryptoPanic, coinDesk, cnbc, reuters, forexLive, fxStreet, theBlock, investing].forEach((result, i) => {
    const names = ['CryptoPanic', 'CoinDesk', 'CNBC', 'Reuters', 'ForexLive', 'FXStreet', 'The Block', 'Investing.com'];
    if (result.status === 'fulfilled') {
      console.log(`  ✅ ${names[i]}: ${result.value.length} haber`);
      allNews = allNews.concat(result.value);
    } else {
      console.log(`  ❌ ${names[i]}: BAŞARISIZ`);
    }
  });

  console.log(`  📊 Toplam: ${allNews.length} yeni haber bulundu`);

  // SKOR FİLTRESİ
  const qualified = allNews.filter(n => n.score >= MIN_SCORE);
  qualified.sort((a, b) => b.score - a.score);

  console.log(`  🎯 Eşiği geçen: ${qualified.length} haber (min skor: ${MIN_SCORE})`);

  // Debug: En yüksek skorlu 5 haberi göster
  qualified.slice(0, 5).forEach((n, i) => {
    console.log(`    ${i + 1}. [${n.score}] ${n.title.substring(0, 80)}...`);
  });

  // Elenen haberleri hafızaya ekle (tekrar taranmasın)
  const rejected = allNews.filter(n => n.score < MIN_SCORE);
  rejected.forEach(n => state.posted_ids.push(n.id));

  // İlk çalıştırmada sadece en iyi 2
  if (isFirstRun) {
    const skipped = qualified.slice(2);
    skipped.forEach(n => state.posted_ids.push(n.id));
    qualified.splice(2);
    saveState(state);
  }

  // Her döngüde en önemli 3 haberi paylaş
  const toPost = qualified.slice(0, 3);
  const toSkip = qualified.slice(3);
  toSkip.forEach(n => state.posted_ids.push(n.id));
  saveState(state);

  for (const item of toPost) {
    try {
      console.log(`\n  📤 PAYLAŞILIYOR [Skor: ${item.score}] — ${item.source}`);
      console.log(`     "${item.title}"`);

      // Çeviri
      const translatedTitle = await translateText(item.title);
      const translatedSnippet = await translateSnippet(item.snippet);

      // Rozet Seçimi
      let badge;
      if (item.score >= 200) {
        badge = '🔴 <b>KRİTİK GELİŞME</b>';
      } else if (item.score >= 150) {
        badge = '🟡 <b>ÖNEMLİ HABER</b>';
      } else {
        badge = '🔵 <b>PİYASA HABERİ</b>';
      }

      // Mesaj Formatı
      const sourceLine = `<i>${item.source}</i>`;
      let message = `${badge}\n\n` +
                     `<b>${translatedTitle}</b>\n\n`;
      
      if (translatedSnippet) {
        message += `${translatedSnippet}\n\n`;
      }
      
      message += sourceLine;

      await bot.telegram.sendMessage(CHANNEL_ID, message, {
        parse_mode: 'HTML',
        disable_web_page_preview: true
      });

      state.posted_ids.push(item.id);
      saveState(state);

      // Haberler arası bekleme (5 saniye)
      await new Promise(r => setTimeout(r, 5000));
    } catch (e) {
      console.error('  ❗ Mesaj atma hatası:', e.message);
    }
  }

  console.log(`[${new Date().toLocaleTimeString('tr-TR')}] ══════ TARAMA BİTTİ ══════\n`);
}

// ═══════════════════════════════════════════════════════
//  BAŞLATMA — 2 DAKİKADA BİR TARAMA
// ═══════════════════════════════════════════════════════

bot.telegram.getMe().then((me) => {
  console.log(`\n╔══════════════════════════════════════════╗`);
  console.log(`║  🚀 MALIBU NEWS BOT v2.0 BAŞLATILDI      ║`);
  console.log(`║  Bot: @${me.username.padEnd(33)}║`);
  console.log(`║  Tarama: Her 30 saniyede bir             ║`);
  console.log(`║  Kaynaklar: 8 paralel kaynak             ║`);
  console.log(`║  Filtre: Sadece kritik haberler           ║`);
  console.log(`╚══════════════════════════════════════════╝\n`);

  // İlk çalıştırma
  processNews();

  // Her 30 saniyede bir tarama (maksimum hız)
  setInterval(processNews, 30 * 1000);
});

process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
