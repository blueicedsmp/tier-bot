require("dotenv").config();

const express = require("express");
const app = express();

app.get("/", (req, res) => res.send("Bot is alive"));
app.listen(process.env.PORT || 3000);

const {
  Client,
  GatewayIntentBits,
  REST,
  Routes,
  SlashCommandBuilder,
  Events,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle
} = require("discord.js");

// ================= BOT =================
const client = new Client({
  intents: [GatewayIntentBits.Guilds]
});

// ================= DATA =================
const queue = [];
const activeTests = new Map();
let panelMessage = null;

// ================= COMMANDS =================
const commands = [
  new SlashCommandBuilder()
    .setName("panel")
    .setDescription("Open the queue panel"),

  new SlashCommandBuilder()
    .setName("claim")
    .setDescription("Claim next player (testers only)"),

  new SlashCommandBuilder()
    .setName("finish")
    .setDescription("Finish test and submit rank")
    .addStringOption(opt =>
      opt.setName("rank")
        .setDescription("Rank (LT5 - HT1)")
        .setRequired(true)
    )
].map(c => c.toJSON());

// ================= READY =================
client.once(Events.ClientReady, async () => {
  console.log(`Logged in as ${client.user.tag}`);

  const rest = new REST({ version: "10" }).setToken(process.env.TOKEN);

  try {
    await rest.put(
      Routes.applicationGuildCommands(client.user.id, process.env.GUILD_ID),
      { body: commands }
    );

    console.log("✅ Commands registered");

  } catch (err) {
    console.error("Command error:", err);
  }

  // 🔄 AUTO UPDATE PANEL
  setInterval(async () => {
    try {
      if (!panelMessage) return;

      await panelMessage.edit({
        embeds: [panelEmbed()],
        components: [panelButtons()]
      });
    } catch (err) {
      console.log("Panel update error:", err.message);
    }
  }, 10000);
});

// ================= PANEL =================
function panelEmbed() {
  const queueList = queue.length
    ? queue.map((p, i) => `${i + 1}. <@${p.id}>`).join("\n")
    : "Empty";

  const activeList = activeTests.size
    ? Array.from(activeTests.entries())
        .map(([player, tester]) => `<@${player}> → <@${tester}>`)
        .join("\n")
    : "None";

  return new EmbedBuilder()
    .setTitle("🎮 Tier Testing System")
    .setColor(0x00ff99)
    .addFields(
      { name: "Queue Size", value: `${queue.length}/20`, inline: true },
      { name: "Queue", value: queueList },
      { name: "Active Tests", value: activeList }
    );
}

function panelButtons() {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId("join")
      .setLabel("Join Queue")
      .setStyle(ButtonStyle.Success),

    new ButtonBuilder()
      .setCustomId("leave")
      .setLabel("Leave Queue")
      .setStyle(ButtonStyle.Danger)
  );
}

// ================= INTERACTIONS =================
client.on(Events.InteractionCreate, async (interaction) => {

  // ===== /panel =====
  if (interaction.isChatInputCommand() && interaction.commandName === "panel") {

    const msg = await interaction.reply({
      embeds: [panelEmbed()],
      components: [panelButtons()],
      fetchReply: true
    });

    panelMessage = msg;
    return;
  }

  // ===== /claim =====
  if (interaction.isChatInputCommand() && interaction.commandName === "claim") {

    const testerRole = "Tester";

    if (!interaction.member.roles.cache.some(r => r.name === testerRole)) {
      return interaction.reply({
        content: "❌ Not a tester",
        ephemeral: true
      });
    }

    const player = queue.shift();

    if (!player) {
      return interaction.reply({
        content: "No players in queue",
        ephemeral: true
      });
    }

    activeTests.set(player.id, interaction.user.id);

    return interaction.reply({
      content: `🧑‍⚖️ You are now testing <@${player.id}>`,
      ephemeral: true
    });
  }

  // ===== /finish =====
  if (interaction.isChatInputCommand() && interaction.commandName === "finish") {

    const rank = interaction.options.getString("rank");

    const entry = [...activeTests.entries()]
      .find(([playerId, testerId]) => testerId === interaction.user.id);

    if (!entry) {
      return interaction.reply({
        content: "❌ You are not testing anyone",
        ephemeral: true
      });
    }

    const [playerId] = entry;

    activeTests.delete(playerId);

    const results = interaction.guild.channels.cache.get(process.env.RESULTS_CHANNEL_ID);

    if (!results) {
      return interaction.reply({
        content: "❌ Results channel not found",
        ephemeral: true
      });
    }

    await results.send(
`🎮 TEST RESULT
Player: <@${playerId}>
Tester: <@${interaction.user.id}>
Rank: ${rank}`
    );

    return interaction.reply({
      content: `✅ Result submitted for <@${playerId}>`,
      ephemeral: true
    });
  }

  // ===== BUTTONS =====
  if (!interaction.isButton()) return;

  const user = interaction.user;

  if (interaction.customId === "join") {

    if (queue.find(p => p.id === user.id))
      return interaction.reply({ content: "Already in queue", ephemeral: true });

    if (queue.length >= 20)
      return interaction.reply({ content: "Queue full", ephemeral: true });

    queue.push({ id: user.id });

    return interaction.reply({ content: "Joined queue", ephemeral: true });
  }

  if (interaction.customId === "leave") {

    const index = queue.findIndex(p => p.id === user.id);

    if (index === -1)
      return interaction.reply({ content: "Not in queue", ephemeral: true });

    queue.splice(index, 1);

    return interaction.reply({ content: "Left queue", ephemeral: true });
  }
});

client.login(process.env.TOKEN);
