require("dotenv").config();

const express = require("express");
const app = express();

app.get("/", (req, res) => res.send("Bot is alive"));
app.listen(process.env.PORT || 3000, () => console.log("Web server running"));

const {
  Client,
  GatewayIntentBits,
  Events,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle
} = require("discord.js");

// ================= BOT =================
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent
  ]
});

// ================= DATA =================
const queue = [];
const activeTests = new Map();

// ================= READY =================
client.once(Events.ClientReady, () => {
  console.log(`Logged in as ${client.user.tag}`);
});

// ================= DEBUG MESSAGE LOG =================
client.on(Events.MessageCreate, async (message) => {
  if (!message.guild || message.author.bot) return;

  console.log("MESSAGE SEEN:", message.content);

  // ================= PANEL =================
  if (message.content === "!panel") {

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId("join")
        .setLabel("Join Queue")
        .setStyle(ButtonStyle.Success),

      new ButtonBuilder()
        .setCustomId("leave")
        .setLabel("Leave Queue")
        .setStyle(ButtonStyle.Danger),

      new ButtonBuilder()
        .setCustomId("claim")
        .setLabel("Claim Next")
        .setStyle(ButtonStyle.Primary)
    );

    const embed = new EmbedBuilder()
      .setTitle("🎮 Tier Testing Queue")
      .setDescription(`Queue size: ${queue.length}/20`)
      .setColor(0x00ff99);

    message.channel.send({ embeds: [embed], components: [row] });
  }
});

// ================= BUTTONS =================
client.on(Events.InteractionCreate, async (interaction) => {

  if (!interaction.isButton() && !interaction.isModalSubmit()) return;

  const user = interaction.user;

  // ================= JOIN =================
  if (interaction.customId === "join") {

    if (queue.find(p => p.id === user.id))
      return interaction.reply({ content: "Already in queue", ephemeral: true });

    if (queue.length >= 20)
      return interaction.reply({ content: "Queue full", ephemeral: true });

    queue.push({
      id: user.id,
      tag: user.tag,
      rank: 0
    });

    return interaction.reply({ content: "Joined queue", ephemeral: true });
  }

  // ================= LEAVE =================
  if (interaction.customId === "leave") {

    const index = queue.findIndex(p => p.id === user.id);

    if (index === -1)
      return interaction.reply({ content: "Not in queue", ephemeral: true });

    queue.splice(index, 1);

    return interaction.reply({ content: "Left queue", ephemeral: true });
  }

  // ================= CLAIM =================
  if (interaction.customId === "claim") {

    if (queue.length === 0)
      return interaction.reply({ content: "Queue empty", ephemeral: true });

    const player = queue[0];
    activeTests.set(player.id, user.id);

    const modal = new ModalBuilder()
      .setCustomId(`rank_${player.id}`)
      .setTitle("Set Rank Result");

    const input = new TextInputBuilder()
      .setCustomId("rank")
      .setLabel("Enter rank (LT5 - HT1)")
      .setStyle(TextInputStyle.Short);

    modal.addComponents(new ActionRowBuilder().addComponents(input));

    return interaction.showModal(modal);
  }

  // ================= MODAL =================
  if (interaction.isModalSubmit()) {

    const playerId = interaction.customId.split("_")[1];
    const player = queue.find(p => p.id === playerId);

    if (!player)
      return interaction.reply({ content: "Player not found", ephemeral: true });

    const rank = interaction.fields.getTextInputValue("rank");

    queue.splice(queue.findIndex(p => p.id === playerId), 1);
    activeTests.delete(playerId);

    const results = interaction.guild.channels.cache.get(process.env.RESULTS_CHANNEL_ID);

    results?.send(
`PLAYER: <@${player.id}>
TESTER: <@${interaction.user.id}>
RANK: ${rank}`
    );

    return interaction.reply({ content: "Result submitted", ephemeral: true });
  }
});

client.login(process.env.TOKEN);
