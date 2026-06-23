require('dotenv').config();
const TelegramBot = require('node-telegram-bot-api');
const Anthropic = require('@anthropic-ai/sdk');
const https = require('https');

const bot = new TelegramBot(process.env.TELEGRAM_BOT_TOKEN, { polling: true });
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const conversations = {};

const SYSTEM_PROMPT = `Tu es un assistant DAF expert, configuré pour Groupe Aksal Maroc.Tu es capable de lire et analyser des fichiers PDF directement. Quand un PDF t'est soumis, tu l'analyses intégralement sans jamais dire que tu ne peux pas traiter de fichiers

Contexte :
- Tu assistes le DAF d'un périmètre d'entités en développement : Nekky (cosmétiques), Taswik (import/production), SWK Maroc (athleisure, Morocco Mall), SKIMS (bodywear premium, deux flagships Casablanca), IPEKYOL (franchise turque), projets Cinéma (Marrakech + Morocco Mall), El&N Café.
- Pas d'ERP groupe. Comptabilité externalisée. Outils : JDE (comptabilité), ODDO (achats).
- Exercice groupe : clôture 31 mars. Entités périmètre : clôture 31 décembre.
- Banques principales : Attijariwafa, CIH.

Terminologie standard :
- Utilise MDH/KMAD, IS, BFR, TFT, CPC, PCM, TVA, IR
- Références réglementaires : Loi 17-95 (SA), Loi 5-96 (SARL), CGI Maroc, BAM
- BP = Business Plan, TRI = Taux de Rentabilité Interne, WACC, DSCR

Domaines de compétence prioritaires :
1. Construction et audit de Business Plans (P&L, TFT, Bilan, BFR, Capex, RH)
2. Montage de dossiers de financement bancaire
3. Analyse financière et KPIs
4. Fiscalité marocaine et réglementation
5. Structuration intercompany (achat-revente, management fees, conventions)
6. Stratégie de financement (crédits documentaires, escompte, caution)

Comportement :
- Réponds toujours en français
- Sois précis, concis, orienté action
- Signale systématiquement les incohérences ou risques dans les hypothèses présentées
- Adopte une posture "challenge first, validation second"`;

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

async function analyzeWithClaude(chatId, messageContent, retries = 3) {
  if (!conversations[chatId]) conversations[chatId] = [];
  conversations[chatId].push({ role: 'user', content: messageContent });

  if (conversations[chatId].length > 20) {
    conversations[chatId] = conversations[chatId].slice(-20);
  }

  for (let i = 0; i < retries; i++) {
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

    } catch (error) {
      if (error.status === 529 && i < retries - 1) {
        await new Promise(res => setTimeout(res, 5000)); // attend 5 secondes
        continue;
      }
      throw error;
    }
  }
}
bot.on('message', async (msg) => {
  const chatId = msg.chat.id;

  try {
    // Commandes
    if (msg.text === '/start') {
      conversations[chatId] = [];
      return bot.sendMessage(chatId,
        `Bonjour ! Je suis ton assistant DAF Aksal 🏦\n\nJe peux t'aider sur :\n• Business Plans & modèles financiers\n• Dossiers de financement bancaire\n• Analyse BFR, TFT, Bilan\n• Fiscalité et réglementation Maroc\n• Structuration intercompany\n\n📎 Envoie-moi un PDF ou une image à analyser.\n\nPose ta question directement.`
      );
    }

    if (msg.text === '/reset') {
      conversations[chatId] = [];
      return bot.sendMessage(chatId, 'Conversation réinitialisée ✓');
    }

    // Image envoyée directement
    if (msg.photo) {
      bot.sendChatAction(chatId, 'typing');
      bot.sendMessage(chatId, '🖼️ Image reçue, analyse en cours...');

      const photo = msg.photo[msg.photo.length - 1];
      const fileInfo = await bot.getFile(photo.file_id);
      const fileUrl = `https://api.telegram.org/file/bot${process.env.TELEGRAM_BOT_TOKEN}/${fileInfo.file_path}`;
      const fileBuffer = await downloadFile(fileUrl);
      const base64Data = fileBuffer.toString('base64');
      const caption = msg.caption || 'Analyse cette image dans un contexte DAF et donne-moi les points clés.';

      const content = [
        { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: base64Data } },
        { type: 'text', text: caption }
      ];

      const reply = await analyzeWithClaude(chatId, content);
      return bot.sendMessage(chatId, reply, { parse_mode: 'Markdown' });
    }

    // Document (PDF)
    if (msg.document) {
      const doc = msg.document;
      const mimeType = doc.mime_type || '';

      if (mimeType !== 'application/pdf') {
        return bot.sendMessage(chatId, '⚠️ Seuls les PDFs sont supportés comme documents.\nPour Excel, fais une capture d\'écran et envoie-la moi en image.');
      }

      bot.sendChatAction(chatId, 'typing');
      bot.sendMessage(chatId, '📄 PDF reçu, analyse en cours...');

      const fileInfo = await bot.getFile(doc.file_id);
      const fileUrl = `https://api.telegram.org/file/bot${process.env.TELEGRAM_BOT_TOKEN}/${fileInfo.file_path}`;
      const fileBuffer = await downloadFile(fileUrl);
      const base64Data = fileBuffer.toString('base64');
      const caption = msg.caption || 'Analyse ce document PDF dans un contexte DAF et donne-moi les points clés.';

      const content = [
        { 
          type: 'document', 
          source: { 
            type: 'base64', 
            media_type: 'application/pdf', 
            data: base64Data 
          },
          cache_control: {"type": "ephemeral"}
        },
        { type: 'text', text: caption }
      ];

      const reply = await analyzeWithClaude(chatId, content);
      return bot.sendMessage(chatId, reply, { parse_mode: 'Markdown' });
    }

    // Message texte simple
    if (msg.text && !msg.text.startsWith('/')) {
      bot.sendChatAction(chatId, 'typing');
      const reply = await analyzeWithClaude(chatId, msg.text);
      return bot.sendMessage(chatId, reply, { parse_mode: 'Markdown' });
    }

  } catch (error) {
    console.error('Erreur:', error);
    bot.sendMessage(chatId, `❌ Erreur : ${error.message}`);
  }
});

console.log('Bot DAF Aksal démarré ✓');
