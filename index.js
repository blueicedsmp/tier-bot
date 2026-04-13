require("dotenv").config();

const express = require("express");
const app = express();

app.get("/", (req, res) => res.send("Bot is alive"));
app.listen(process.env.PORT || 3000);

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
// playerId → testerId

let panelMessage = null;

// ================= CONFIG =================
const MAX_QUEUE = 20;

// ================= READY =================
client.once(Events.ClientReady, async () => {
  console.log(`Logged in as ${client.user.tag}`);

  const channel = client.channels.cache.get(process.env.PANEL_CHANNEL_ID);

  if (channel) {
    panelMessage = await channel.send({
      embeds: [panel()],
      components: [buttons()]
    });

    // AUTO UPDATE EVERY 20 SECONDS
    setInterval(async () => {
      try {
        await panelMessage.edit({
          embeds: [panel()],
          components: [buttons()]
        });
      } catch (err) {
        console.log("Panel update failed:", err.message);
      }
    }, 20000);
  }
});

// ================= PANEL =================
function panel() {

  const queueList = queue
    .map((p, i) => `${i + 1}. <@${p.id}>`)
    .join("\n") || "Empty";

  const activeList = Array.from(activeTests.entries())
    .map(([player, tester]) => `<@${player}> → <@${tester}>`)
    .join("\n") || "None";

  return new EmbedBuilder()
    .setTitle("🎮 Tier Testing System")
    .setColor(0x00ff99)
    .addFields(
      { name: "Queue Size", value: `${queue.length}/${MAX_QUEUE}`, inline: true },
      { name: "Queue", value: queueList },
      { name: "Active Tests", value: activeList }
    );
}

// ================= BUTTONS =================
function buttons() {
  return new ActionRowBuilder().addComponents(
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
      .setLabel("Claim Next (Tester Only)")
      .setStyle(ButtonStyle.Primary)
  );
}

// ================= EVENTS =================
client.on(Events.InteractionCreate, async (interaction) => {

  if (!interaction.isButton() && !interaction.isModalSubmit()) return;

  const user = interaction.user;

  // ================= JOIN =================
  if (interaction.customId === "join") {

    if (queue.find(p => p.id === user.id))
      return interaction.reply({ content: "Already in queue", ephemeral: true });

    if (queue.length >= MAX_QUEUE)
      return interaction.reply({ content: "Queue full", ephemeral: true });

    queue.push({ id: user.id });

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

  // ================= CLAIM (FIXED FLOW) =================
  if (interaction.customId === "claim") {

    // must NOT already be testing someone
    if (activeTests.has(user.id))
      return interaction.reply({ content: "Finish your current test first", ephemeral: true });

    const player = queue.shift();

    if (!player)
      return interaction.reply({ content: "No players in queue", ephemeral: true });

    activeTests.set(player.id, user.id);

    return interaction.reply({
      content: `You are now testing <@${player.id}>`,
      ephemeral: true
    });
  }

  // ================= RANK SUBMIT =================
  if (interaction.isButton()) return;

  if (interaction.isModalSubmit()) {

    const playerId = interaction.customId.split("_")[1];
    const player = { id: playerId };

    const rank = interaction.fields.getTextInputValue("rank");

    activeTests.delete(playerId);

    const results = interaction.guild.channels.cache.get(process.env.RESULTS_CHANNEL_ID);

    results?.send(
`PLAYER: <@${playerId}>
TESTER: <@${interaction.user.id}>
RANK: ${rank}`
    );

    return interaction.reply({ content: "Result submitted", ephemeral: true });
  }
});

client.login(process.env.TOKEN);
