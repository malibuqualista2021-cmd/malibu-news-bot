const { Telegraf, Markup } = require('telegraf');
const axios = require('axios');
const RSSParser = require('rss-parser');
const translate = require('@vitalets/google-translate-api');
const fs = require('fs');
require('dotenv').config();

// --- YAPILANDIRMA ---
const BOT_TOKEN = process.env.BOT_TOKEN;
const CHANNEL_ID = process.env.CHANNEL_ID;
const ADMIN_ID = process.env.ADMIN_ID;
const CRYPTOPANIC_API_KEY = process.env.CRYPTOPANIC_API_KEY;
const STATE_FILE = './news_state.json';

const bot = new Telegraf(BOT_TOKEN);
const parser = new RSSParser();

// --- ÖNEM SIRALAMA AYARLARI ---
const MIN_SCORE_THRESHOLD = 100; // Sadece gerçekten kritik haberler geçer
const CRITICAL_WORDS = [
  // Ekonomi & Finans
  'fed', 'etf', 'sec', 'faiz', 'cpi', 'tüfe', 'fomc', 'powell', 'breaking', 'kritik', 'urgent', 'enflasyon', 'merkez bankası', 'faiz oranı', 'tüketici fiyat', 'işsizlik',
  // Savaş & Jeopolitik (Yüksek Öncelik)
  'savaş', 'war', 'israil', 'israel', 'iran', 'filistin', 'palestine', 'rusya', 'russia', 'ukrayna', 'ukraine', 
  'hizbullah', 'hezbollah', 'hamas', 'askeri', 'military', 'füze', 'missile', 'patlama', 'explosion', 
  'saldırı', 'attack', 'vurdu', 'strike', 'operasyon', 'operation'
];
const IMPORTANT_WORDS = ['btc', 'eth', 'bitcoin', 'inflation', 'whale', 'halkarz', 'temettü', 'kap', 'tariff', 'gümrük', 'yaptırım', 'sanctions', 'default', 'recession', 'resesyon', 'crash', 'çöküş'];
const NOISE_WORDS = [
  // Genel borsa gürültüsü
  'hisse', 'hisseleri', 'yükseldi', 'düştü', 'bilanço', 'rebound', 'açıkladı', 'beklenti', 'endeks',
  'gün içi', 'düşüşle kapat', 'artışla kapat', 'shares', 'stock', 'stocks', 'rallied', 'rally',
  'gains', 'surged', 'climbed', 'tumbled', 'slipped', 'edges', 'dips', 'rises', 'falls',
  'quarterly', 'earnings', 'revenue', 'profit', 'upgraded', 'downgraded', 'analyst', 'analysts',
  'forecast', 'outlook', 'guidance', 'beat expectations', 'missed expectations', 'report',
  // Eğlence / Magazin / İlgisiz
  'celebrity', 'ünlü', 'melania', 'kardashian', 'movie', 'film', 'tv show', 'netflix', 'spotify',  
  'fashion', 'moda', 'restaurant', 'food', 'recipe', 'diet', 'health', 'wellness', 'fitness',
  'sports', 'spor', 'nba', 'nfl', 'soccer', 'football', 'tennis', 'golf', 'olympic',
  'lifestyle', 'travel', 'tourism', 'hotel', 'vacation', 'holiday',
  // Düşük değerli iş haberleri
  'partnership', 'listing', 'ceo says', 'announces', 'launches', 'unveils', 'plans to',
  'fast food', 'retail', 'retailer', 'supermarket', 'franchise', 'chain', 'store', 'stores',
  'autonomous', 'self-driving', 'ev charger', 'charging station',
  // Cramer ve düşük değerli yorumcular
  'cramer', 'jim cramer', 'mad money', 'why you should', 'top picks', 'buy the dip'
];

// --- ÇEVİRİ KORUMA VE SÖZLÜK ---
const PROTECTED_WORDS = [
  'Circle', 'Bullish', 'Binance', 'Fed', 'SEC', 'ETF', 'CPI', 'FOMC', 'CoinDesk', 'CNBC', 'CryptoPanic', 
  'Bitcoin', 'Ethereum', 'BTC', 'ETH', 'SOL', 'XRP', 'Kraken', 'Coinbase', 'MicroStrategy'
];

const FINANCE_GLOSSARY = {
  'not düşüşü': 'not indirimi',
  'not düşüşlerinin': 'not indirimlerinin',
  'not artışı': 'not artırımı',
  'faiz artışı': 'faiz artırımı',
  'faiz düşüşü': 'faiz indirimi',
  'oran artışı': 'faiz artırımı',
  'oran indirimi': 'faiz indirimi',
  'ayı piyasası': 'düşüş trendi',
  'boğa piyasası': 'yükseliş trendi',
  'likidasyon': 'tasfiye',
  'volatilite': 'fiyat oynaklığı'
};

function calculateImportance(title, votes = {}) {
  let score = 0;
  const lowerTitle = title.toLowerCase();
  
  // Anahtar kelime kontrolü
  CRITICAL_WORDS.forEach(w => { if (lowerTitle.includes(w)) score += 100; });
  IMPORTANT_WORDS.forEach(w => { if (lowerTitle.includes(w)) score += 50; });
  
  // Gürültü/Değersiz haber cezası
  NOISE_WORDS.forEach(w => { if (lowerTitle.includes(w)) score -= 80; });
  
  // CryptoPanic oyları / Sosyal Etki (varsa)
  if (votes) {
    score += (votes.positive || 0) * 5;
    score += (votes.liked || 0) * 3;
    score -= (votes.negative || 0) * 2;
  }
  
  return score;
}

// --- HAFIZA YÖNETİMİ ---
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
    // Hafızayı çok büyütmemek için son 200 haberi tut
    if (state.posted_ids.length > 200) {
      state.posted_ids = state.posted_ids.slice(-200);
    }
    fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
  } catch (e) {
    console.error('Hafıza kaydedilemedi:', e.message);
  }
}

// --- ÇEVİRİ MOTORU ---
async function translateText(text) {
  try {
    let processedText = text;
    const placeholders = [];

    // 1. ÖZEL KELİMELERİ KORUMAYA AL (Placeholder ile)
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
      translatedText = translatedText.replace(item.placeholder, item.original);
    });

    // 4. FİNANSAL SÖZLÜK DÜZELTMELERİ (Post-Process)
    Object.keys(FINANCE_GLOSSARY).forEach(key => {
      const regex = new RegExp(key, 'gi');
      translatedText = translatedText.replace(regex, FINANCE_GLOSSARY[key]);
    });

    return translatedText;
  } catch (e) {
    console.error('Çeviri hatası:', e.message);
    return text; // Hata durumunda orijinali döndür
  }
}

// --- HABER ÇEKME VE PAYLAŞMA ---
async function processNews() {
  const state = loadState();
  const isFirstRun = state.posted_ids.length === 0;
  console.log(`[${new Date().toLocaleTimeString()}] Haber taraması başlatıldı...`);

  let allNewNews = [];

  // 1. KRİPTO HABERLERİ (CryptoPanic - Sadece Önemli ve Filtrelenmiş)
  try {
    const cryptoUrl = CRYPTOPANIC_API_KEY 
      ? `https://cryptopanic.com/api/v1/posts/?auth_token=${CRYPTOPANIC_API_KEY}&public=true&filter=important`
      : `https://cryptopanic.com/api/v1/posts/?public=true&filter=important`;
    
    const res = await axios.get(cryptoUrl);
    const newsItems = res.data.results || [];

    for (const item of newsItems) {
      if (!state.posted_ids.includes(item.id.toString())) {
        allNewNews.push({
          id: item.id.toString(),
          title: item.title,
          url: item.url,
          source: item.source.title,
          type: 'KRİPTO',
          score: calculateImportance(item.title, item.votes) + 10 // Profesyonel agregatör bonusu
        });
      }
    }
  } catch (e) { console.error('Kripto (Panic) hatası:', e.message); }

  // 1.1 KRİPTO HABERLERİ (CoinDesk - Altın Standart)
  try {
    const cdFeed = await parser.parseURL('https://www.coindesk.com/arc/outboundfeeds/rss/');
    for (const item of cdFeed.items) {
      const newsId = item.guid || item.link;
      if (!state.posted_ids.includes(newsId)) {
        allNewNews.push({
          id: newsId,
          title: item.title,
          url: item.link,
          source: 'CoinDesk',
          type: 'KRİPTO',
          score: calculateImportance(item.title) + 15 // Kaynak bonusu (düşük tutuldu)
        });
      }
    }
  } catch (e) { console.error('CoinDesk hatası:', e.message); }

  // 2. FİNANS HABERLERİ (CNBC - Global Başlıklar)
  try {
    const cnbcFeed = await parser.parseURL('https://www.cnbc.com/id/100003114/device/rss/rss.html');
    for (const item of cnbcFeed.items) {
      const newsId = item.guid || item.link;
      if (!state.posted_ids.includes(newsId)) {
        allNewNews.push({
          id: newsId,
          title: item.title,
          url: item.link,
          source: 'CNBC',
          type: 'FİNANS',
          snippet: item.contentSnippet,
          score: calculateImportance(item.title) + 15 // Finans bonusu (düşük tutuldu)
        });
      }
    }
  } catch (e) { console.error('CNBC hatası:', e.message); }

  // --- ÖNEM SIRASINA GÖRE SIRALA VE FİLTRELE ---
  allNewNews = allNewNews.filter(n => n.score >= MIN_SCORE_THRESHOLD); // Baraj altını ele
  allNewNews.sort((a, b) => b.score - a.score);

  // İlk açılışta sadece en iyi 3 haberi gönder
  if (isFirstRun) {
    const skipped = allNewNews.slice(2);
    skipped.forEach(n => state.posted_ids.push(n.id));
    allNewNews = allNewNews.slice(0, 2);
    saveState(state);
  }

  // Her döngüde en önemli 2 haberi paylaş (kaliteyi yüksek tut)
  const toPost = allNewNews.slice(0, 2);
  
  // Geri kalanları "zaten görüldü" olarak işaretle (Kanalı boğmamak için)
  const toSkip = allNewNews.slice(2);
  toSkip.forEach(n => { state.posted_ids.push(n.id); });
  saveState(state);

  for (const item of toPost) {
    try {
      console.log(`[PAYLAŞILIYOR] Score: ${item.score} - ${item.title}`);
      
      const translatedTitle = item.isAlreadyTR ? item.title : await translateText(item.title);
      
      // Basit ve Sade Rozet Seçimi
      let badge = item.type === 'KRİPTO' ? '🔹 <b>GLOBAL HABER</b>' : '🔸 <b>FİNANS HABER</b>';
      if (item.score >= 150) badge = '🔴 <b>KRİTİK GELİŞME</b>';
      else if (item.score >= 100) badge = '🟡 <b>ÖNEMLİ HABER</b>';

      const message = `${badge}\n\n` +
                      `<b>${translatedTitle}</b>\n\n` +
                      (item.snippet ? `${item.snippet}` : '');
      
      await bot.telegram.sendMessage(CHANNEL_ID, message, { 
        parse_mode: 'HTML'
      });

      state.posted_ids.push(item.id);
      saveState(state);
      
      // Haberler arası bekleme (30 saniye)
      await new Promise(r => setTimeout(r, 30000));
    } catch (e) {
      console.error('Mesaj atma hatası:', e.message);
    }
  }
}

// --- BAŞLATMA ---
bot.telegram.getMe().then((me) => {
  console.log(`✅ HABER BOTU BAŞLATILDI: @${me.username}`);
  
  // İlk çalıştırma
  processNews();
  
  // Her 10 dakikada bir tarama yap (Kanalı dinlendirmek için)
  setInterval(processNews, 10 * 60 * 1000);
});

process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
