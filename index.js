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
const CRITICAL_WORDS = ['fed', 'etf', 'sec', 'faiz', 'cpi', 'tüfe', 'fomc', 'powell', 'breaking', 'kritik', 'urgent', 'binance', 'coinbase', 'ripple', 'xrp', 'lawsuit', 'enflasyon'];
const IMPORTANT_WORDS = ['btc', 'eth', 'bitcoin', 'listing', 'partnership', 'investment', 'inflation', 'bull', 'bear', 'whale', 'halkarz', 'temettü'];

function calculateImportance(title, votes = {}) {
  let score = 0;
  const lowerTitle = title.toLowerCase();
  
  // Anahtar kelime kontrolü
  CRITICAL_WORDS.forEach(w => { if (lowerTitle.includes(w)) score += 100; });
  IMPORTANT_WORDS.forEach(w => { if (lowerTitle.includes(w)) score += 40; });
  
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
    const res = await translate.translate(text, { to: 'tr' });
    return res.text;
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

  // 1. KRİPTO HABERLERİ
  try {
    const cryptoUrl = CRYPTOPANIC_API_KEY 
      ? `https://cryptopanic.com/api/v1/posts/?auth_token=${CRYPTOPANIC_API_KEY}&public=true`
      : `https://cryptopanic.com/api/v1/posts/?public=true`;
    
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
          score: calculateImportance(item.title, item.votes)
        });
      }
    }
  } catch (e) { console.error('Kripto haber çekme hatası:', e.message); }

  // 2. FİNANS VE BORSA HABERLERİ
  try {
    const financeFeed = await parser.parseURL('https://tr.investing.com/rss/news_25.rss');
    for (const item of financeFeed.items) {
      const newsId = item.guid || item.link;
      if (!state.posted_ids.includes(newsId)) {
        allNewNews.push({
          id: newsId,
          title: item.title,
          url: item.link,
          source: 'Investing.com',
          type: 'FİNANS',
          snippet: item.contentSnippet,
          isAlreadyTR: financeFeed.title.includes('Investing.com Türkiye'),
          score: calculateImportance(item.title)
        });
      }
    }
  } catch (e) { console.error('Finans haber çekme hatası:', e.message); }

  // --- ÖNEM SIRASINA GÖRE SIRALA ---
  allNewNews.sort((a, b) => b.score - a.score);

  // İlk açılışta sadece en iyi 3 haberi gönder
  if (isFirstRun) {
    const skipped = allNewNews.slice(3);
    skipped.forEach(n => state.posted_ids.push(n.id));
    allNewNews = allNewNews.slice(0, 3);
    saveState(state);
  }

  // Her döngüde en önemli 5 haberi paylaş
  const toPost = allNewNews.slice(0, 5);
  
  // Geri kalanları "zaten görüldü" olarak işaretle (Kanalı boğmamak için)
  const toSkip = allNewNews.slice(5);
  toSkip.forEach(n => { state.posted_ids.push(n.id); });
  saveState(state);

  for (const item of toPost) {
    try {
      console.log(`[PAYLAŞILIYOR] Score: ${item.score} - ${item.title}`);
      
      const translatedTitle = item.isAlreadyTR ? item.title : await translateText(item.title);
      
      // Önem derecesine göre emoji/etiket seç
      let prefix = item.type === 'KRİPTO' ? '🚀' : '📈';
      if (item.score >= 100) prefix = '🔥 <b>KRİTİK</b>';
      else if (item.score >= 40) prefix = '⭐ <b>ÖNEMLİ</b>';

      const message = `${prefix} <b>${item.type} HABER</b>\n\n` +
                      `🔹 <b>${translatedTitle}</b>\n\n` +
                      (item.snippet ? `📑 ${item.snippet}\n\n` : '') +
                      `🏢 <i>Kaynak: ${item.source}</i>`;
      
      const keyboard = Markup.inlineKeyboard([
        [Markup.button.url(item.type === 'KRİPTO' ? '📖 Haberi Oku' : '🔗 Detayları Gör', item.url)]
      ]);

      await bot.telegram.sendMessage(CHANNEL_ID, message, { 
        parse_mode: 'HTML',
        ...keyboard
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
