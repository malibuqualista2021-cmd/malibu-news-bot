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
  console.log(`[${new Date().toLocaleTimeString()}] Haber taraması başlatıldı...`);

  // 1. KRİPTO HABERLERİ (CryptoPanic)
  try {
    const cryptoUrl = CRYPTOPANIC_API_KEY 
      ? `https://cryptopanic.com/api/v1/posts/?auth_token=${CRYPTOPANIC_API_KEY}&public=true`
      : `https://cryptopanic.com/api/v1/posts/?public=true`;
    
    const res = await axios.get(cryptoUrl);
    const newsItems = res.data.results || [];

    for (const item of newsItems) {
      if (!state.posted_ids.includes(item.id.toString())) {
        console.log(`[YENİ KRİPTO] ${item.title}`);
        
        const translatedTitle = await translateText(item.title);
        const message = `🚀 <b>KRİPTO HABER</b>\n\n` +
                        `🔹 <b>${translatedTitle}</b>\n\n` +
                        `🏢 <i>Kaynak: ${item.source.title}</i>`;
        
        const keyboard = Markup.inlineKeyboard([
          [Markup.button.url('📖 Haberi Oku', item.url)]
        ]);

        await bot.telegram.sendMessage(CHANNEL_ID, message, { 
          parse_mode: 'HTML',
          ...keyboard
        });

        state.posted_ids.push(item.id.toString());
        saveState(state);
        // Hız sınırı ve çeviri kotası için kısa bekleme
        await new Promise(r => setTimeout(r, 2000));
      }
    }
  } catch (e) {
    console.error('Kripto haber çekme hatası:', e.message);
  }

  // 2. FİNANS VE BORSA HABERLERİ (Investing.com RSS)
  try {
    const financeFeed = await parser.parseURL('https://tr.investing.com/rss/news_25.rss');
    for (const item of financeFeed.items) {
      const newsId = item.guid || item.link;
      if (!state.posted_ids.includes(newsId)) {
        console.log(`[YENİ FİNANS] ${item.title}`);
        
        // Zaten Türkçe olan kaynakları çevirme
        const isAlreadyTR = financeFeed.title.includes('Investing.com Türkiye');
        const translatedTitle = isAlreadyTR ? item.title : await translateText(item.title);
        
        const message = `📈 <b>GLOBAL FİNANS</b>\n\n` +
                        `🔹 <b>${translatedTitle}</b>\n\n` +
                        `📑 ${item.contentSnippet || ''}`;
        
        const keyboard = Markup.inlineKeyboard([
          [Markup.button.url('🔗 Detayları Gör', item.link)]
        ]);

        await bot.telegram.sendMessage(CHANNEL_ID, message, { 
          parse_mode: 'HTML',
          ...keyboard
        });

        state.posted_ids.push(newsId);
        saveState(state);
        await new Promise(r => setTimeout(r, 2000));
      }
    }
  } catch (e) {
    console.error('Finans haber çekme hatası:', e.message);
  }
}

// --- BAŞLATMA ---
bot.telegram.getMe().then((me) => {
  console.log(`✅ HABER BOTU BAŞLATILDI: @${me.username}`);
  
  // İlk çalıştırma
  processNews();
  
  // Her 3 dakikada bir tarama yap (Gecikmeyi önlemek için makul süre)
  setInterval(processNews, 3 * 60 * 1000);
});

process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
