require('dotenv').config();
const TelegramBot = require('node-telegram-bot-api');
const Anthropic = require('@anthropic-ai/sdk');
const https = require('https');

const bot = new TelegramBot(process.env.TELEGRAM_BOT_TOKEN, { polling: true });
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const conversations = {};

const SYSTEM_PROMPT = `Tu es un assistant DAF expert, configuré pour Groupe Aksal Maroc. Tu es capable de lire et analyser des fichiers PDF directement. Quand un PDF t'est soumis, tu l'analyses intégralement.

Contexte :
- Entités : Nekky (cosmétiques), Taswik (import/production), SWK Maroc (athleisure), SKIMS (bodywear premium), IPEKYOL (franchise turque), Cinéma (Marrakech + Morocco Mall), El&N Café.
- Outils : JDE (comptabilité), ODDO (achats). Banques : Attijariwafa, CIH.
- Terminologie : MDH/KMAD, IS, BFR, TFT, CPC, PCM, TVA, IR, BAM, CGI, Loi 17-95, Loi 5-96.

Domaines : BPs, dossiers bancaires, BFR, fiscalité, intercompany, financement.
Comportement : français, précis, orienté action, challenge first.`;

function downloadFile(url) {
  return new Promise((resolve, reject) => {
    https.get(url, (res) => {
      const chunks = [];
      res.on('data', chunk => chunks.push(chunk));
      res.on('end', () => resolve(Buffer.concat(chunks)));
      res.on('error', reject);
    });
  });
}

async function callClaude(chatId, content) {
  if (!conversations[chatId]) conversations[chatId] = [];
  conversations[chatId].push({ role: 'user', content });
  if (conversations[chatId].length > 20) conversations[chatId] = conversations[chatId].slice(-20);

  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const response = await anthropic.messages.create({
        model: 'claude-sonnet-4-6',
        max_tokens: 2000,
        system: SYSTEM_PROMPT,
        messages: conversations[chatId],
      });
      const reply = response.content[0].text;
      conversations[chatId].push({ role: 'assistant', content: reply });
      return reply;
    } catch (err) {
      if (err.status === 529 && attempt < 3) {
        await new Promise(r => setTimeout(r, 5000 * attempt));
      } else {
        throw err;
      }
    }
  }
}

bot.on('message', async (msg) => {
  const chatId = msg.chat.id;

  try {
    if (msg.text === '/start') {
      conversations[chatId] = [];
      return bot.sendMessage(chatId, `Bonjour ! Assistant DAF Aksal 🏦\n\n• BPs & modèles financiers\n• Dossiers bancaires\n• BFR, TFT, Bilan\n• Fiscalité Maroc\n\n📎 Envoie un PDF ou une image directement.`);
    }

    if (msg.text === '/reset') {
      conversations[chatId] = [];
      return bot.sendMessage(chatId, 'Conversation réinitialisée ✓');
    }

    if (msg.photo) {
      bot.sendChatAction(chatId, 'typing');
      const photo = msg.photo[msg.photo.length - 1];
      const fileInfo = await bot.getFile(photo.file_id);
      const url = `https://api.telegram.org/file/bot${process.env.TELEGRAM_BOT_TOKEN}/${fileInfo.file_path}`;
      const buffer = await downloadFile(url);
      const b64 = buffer.toString('base64');
      const text = msg.caption || 'Analyse cette image dans un contexte DAF.';
      const reply = await callClaude(chatId, [
        { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: b64 } },
        { type: 'text', text }
      ]);
      return bot.sendMessage(chatId, reply, { parse_mode: 'Markdown' });
    }

    if (msg.document) {
      if (msg.document.mime_type !== 'application/pdf') {
        return bot.sendMessage(chatId, '⚠️ Envoie un PDF ou une capture d\'écran pour les Excel.');
      }
      bot.sendChatAction(chatId, 'typing');
      bot.sendMessage(chatId, '📄 PDF reçu, analyse en cours...');
      const fileInfo = await bot.getFile(msg.document.file_id);
      const url = `https://api.telegram.org/file/bot${process.env.TELEGRAM_BOT_TOKEN}/${fileInfo.file_path}`;
      const buffer = await downloadFile(url);
      const b64 = buffer.toString('base64');
      const text = msg.caption || 'Analyse ce PDF dans un contexte DAF et donne les points clés.';
      const reply = await callClaude(chatId, [
        { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: b64 } },
        { type: 'text', text }
      ]);
      return bot.sendMessage(chatId, reply, { parse_mode: 'Markdown' });
    }

    if (msg.text && !msg.text.startsWith('/')) {
      bot.sendChatAction(chatId, 'typing');
      const reply = await callClaude(chatId, msg.text);
      return bot.sendMessage(chatId, reply, { parse_mode: 'Markdown' });
    }

  } catch (err) {
    console.error('Erreur:', err.message);
    bot.sendMessage(chatId, `❌ Erreur : ${err.message}`);
  }
});

console.log('Bot DAF Aksal démarré ✓');
