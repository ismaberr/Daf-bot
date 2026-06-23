require('dotenv').config();
const TelegramBot = require('node-telegram-bot-api');
const Anthropic = require('@anthropic-ai/sdk');

const bot = new TelegramBot(process.env.TELEGRAM_BOT_TOKEN, { polling: true });
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const conversations = {};

const SYSTEM_PROMPT = `Tu es un assistant DAF expert, configuré pour Groupe Aksal Maroc.

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

bot.onText(/\/start/, (msg) => {
  const chatId = msg.chat.id;
  conversations[chatId] = [];
  bot.sendMessage(chatId,
    `Bonjour ! Je suis ton assistant DAF Aksal 🏦\n\nJe peux t'aider sur :\n• Business Plans & modèles financiers\n• Dossiers de financement bancaire\n• Analyse BFR, TFT, Bilan\n• Fiscalité et réglementation Maroc\n• Structuration intercompany\n\nPose ta question directement.`
  );
});

bot.onText(/\/reset/, (msg) => {
  const chatId = msg.chat.id;
  conversations[chatId] = [];
  bot.sendMessage(chatId, 'Conversation réinitialisée ✓');
});

bot.on('message', async (msg) => {
  const chatId = msg.chat.id;
  const text = msg.text;

  if (!text || text.startsWith('/')) return;

  if (!conversations[chatId]) conversations[chatId] = [];

  bot.sendChatAction(chatId, 'typing');

  conversations[chatId].push({ role: 'user', content: text });

  if (conversations[chatId].length > 20) {
    conversations[chatId] = conversations[chatId].slice(-20);
  }

  try {
    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 1500,
      system: SYSTEM_PROMPT,
      messages: conversations[chatId],
    });

    const reply = response.content[0].text;

    conversations[chatId].push({ role: 'assistant', content: reply });

    bot.sendMessage(chatId, reply, { parse_mode: 'Markdown' });

  } catch (error) {
    console.error(error);
    bot.sendMessage(chatId, 'Erreur lors de la connexion à Claude. Réessaie dans un instant.');
  }
});

console.log('Bot DAF Aksal démarré ✓');
