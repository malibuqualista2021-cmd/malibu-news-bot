const { Telegraf } = require('telegraf');
const axios = require('axios');
const RSSParser = require('rss-parser');
const translate = require('@vitalets/google-translate-api');
const fs = require('fs');
require('dotenv').config();

// =======================================================
//  MALIBU NEWS BOT v2.1 - KRITIK HABER ODAKLI (REFINE)
// =======================================================

const BOT_TOKEN = process.env.BOT_TOKEN;
const CHANNEL_ID = process.env.CHANNEL_ID;
const ADMIN_ID = process.env.ADMIN_ID;
const CRYPTOPANIC_API_KEY = process.env.CRYPTOPANIC_API_KEY;
const STATE_FILE = './news_state.json';

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
      let res = await translate.translate(processedText, { to: 'tr' });
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
        console.error('Ceviri hatasi:', e.message);
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

// =======================================================
//  HAFIZA YONETIMI
// =======================================================

function loadState() {
    try {
          if (fs.existsSync(STATE_FILE)) {
                  return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
          }
    } catch (e) {
          console.error('Hafiza yuklenemedi:', e.message);
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
          console.error('Hafiza kaydedilemedi:', e.message);
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
          const res = await axios.get(url, { timeout: 10000 });
          for (const item of (res.data.results || [])) {
                  if (!state.posted_ids.includes(item.id.toString())) {
                            items.push({
                                        id: item.id.toString(),
                                        title: item.title,
                                        url: item.url,
                                        source: item.source?.title || 'CryptoPanic',
                                        type: 'KRIPTO',
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

// =======================================================
//  ANA MOTOR - HABER CEKME VE PAYLASMA
// =======================================================

const MIN_SCORE = 250; // Sadece gercekten kritik haberler gecer

async function processNews() {
    const state = loadState();
    const isFirstRun = state.posted_ids.length === 0;
    const now = new Date().toLocaleTimeString('tr-TR');
    console.log(`\n[${now}] ====== TARAMA BASLADI ======`);

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
                  console.log(`  OK ${names[i]}: ${result.value.length} haber`);
                  allNews = allNews.concat(result.value);
          } else {
                  console.log(`  ERROR ${names[i]}: BASARISIZ`);
          }
    });

  console.log(`  Toplam: ${allNews.length} yeni haber bulundu`);

  // SKOR FILTRESI
  const qualified = allNews.filter(n => n.score >= MIN_SCORE);
    qualified.sort((a, b) => b.score - a.score);

  console.log(`  Esigi gecen: ${qualified.length} haber (min skor: ${MIN_SCORE})`);

  // Debug: En yuksek skorlu 5 haberi goster
  qualified.slice(0, 5).forEach((n, i) => {
        console.log(`    ${i + 1}. [${n.score}] ${n.title.substring(0, 80)}...`);
  });

  // Elenen haberleri hafizaya ekle (tekrar taranmasin)
  const rejected = allNews.filter(n => n.score < MIN_SCORE);
    rejected.forEach(n => state.posted_ids.push(n.id));

  // Ilk calistirmada sadece en iyi 2
  if (isFirstRun) {
        const skipped = qualified.slice(2);
        skipped.forEach(n => state.posted_ids.push(n.id));
        qualified.splice(2);
        saveState(state);
  }

  // Her dongude en onemli 3 haberi paylas
  const toPost = qualified.slice(0, 3);
    const toSkip = qualified.slice(3);
    toSkip.forEach(n => state.posted_ids.push(n.id));
    saveState(state);

  for (const item of toPost) {
        try {
                console.log(`\n  PAYLASILIYOR [Skor: ${item.score}] - ${item.source}`);
                console.log(`     "${item.title}"`);

          // Ceviri
          const translatedTitle = await translateText(item.title);
                const translatedSnippet = await translateSnippet(item.snippet);

       // Rozet Secimi
                  let badge;
                  if (item.score >= 200) {
                              badge = '<b>KRITIK GELISME</b>';
                  } else if (item.score >= 150) {
                              badge = '<b>ONEMLI HABER</b>';
                  } else {
                              badge = '<b>PIYASA HABERI</b>';
                  }
            
            // Mesaj Formati
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

          // Haberler arasi bekleme (5 saniye)
          await new Promise(r => setTimeout(r, 5000));
        } catch (e) {
                console.error('  Mesaj atma hatasi:', e.message);
        }
  }

  console.log(`[${new Date().toLocaleTimeString('tr-TR')}] ====== TARAMA BITTI ======\n`);
}

// ═══════════════════════════════════════════════════════
//  MESAJ DİNLEME VE OTOMATİK 👍 REAKSİYONU
// ═══════════════════════════════════════════════════════

bot.on('message', async (ctx) => {
  try {
    // Her gelen mesaja (metin, fotoğraf, grafik vb.) 👍 reaksiyonu bırak
    await ctx.react('👍');
  } catch (e) {
    // Reaksiyon özelliği her zaman çalışmayabilir (sohbet kapalıysa vb.)
    console.error('  ❗ Reaksiyon hatası:', e.message);
  }
});

// ═══════════════════════════════════════════════════════
//  BAŞLATMA — 30 SANIYEDE BIR TARAMA
// ═══════════════════════════════════════════════════════

bot.telegram.getMe().then((me) => {
    console.log(`\n+------------------------------------------+`);
    console.log(`|    [START] MALIBU NEWS BOT v2.1 BASLATILDI      |`);
    console.log(`|  Bot: @${me.username.padEnd(33)}|`);
    console.log(`|  Tarama: Her 30 saniyede bir             |`);
    console.log(`|  Kaynaklar: 8 paralel kaynak             |`);
    console.log(`|  Filtre: Sadece kritik haberler           |`);
    console.log(`+------------------------------------------+\n`);

                            // Ilk calistirma
                            processNews();

                            // Her 30 saniyede bir tarama (maksimum hiz)
                            setInterval(processNews, 30 * 1000);

                            // Mesaj dinlemeyi başlat
                            bot.launch();
                            console.log(`|  Dinleme: AKTİF (👍 reaksiyonu açık)     |`);
});

process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
