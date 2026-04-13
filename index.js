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
    .setDescription("Open live queue panel"),

  new SlashCommandBuilder()
    .setName("claim")
    .setDescription("Claim next player (testers only)")
].map(c => c.toJSON());

// ================= REGISTER COMMANDS =================
client.once(Events.ClientReady, async () => {
  console.log(`Logged in as ${client.user.tag}`);

  const rest = new REST({ version: "10" }).setToken(process.env.TOKEN);

  try {
    await rest.put(
      Routes.applicationGuildCommands(client.user.id, process.env.GUILD_ID),
      { body: commands }
    );
    console.log("Slash commands registered");
  } catch (err) {
    console.error(err);
  }

  // AUTO REFRESH LOOP (REAL TIME UI)
  setInterval(async () => {
    try {
      if (!panelMessage) return;

      await panelMessage.edit({
        embeds: [panelEmbed()],
        components: [panelButtons()]
      });
    } catch (err) {
      console.log("Panel update failed:", err.message);
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

// ================= BUTTONS =================
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

// ================= EVENTS =================
client.on(Events.InteractionCreate, async (interaction) => {

  // ================= /PANEL =================
  if (interaction.isChatInputCommand() && interaction.commandName === "panel") {

    const msg = await interaction.reply({
      embeds: [panelEmbed()],
      components: [panelButtons()],
      fetchReply: true
    });

    panelMessage = msg;
    return;
  }

  // ================= /CLAIM =================
  if (interaction.isChatInputCommand() && interaction.commandName === "claim") {

    const testerRole = "Tester";

    if (!interaction.member.roles.cache.some(r => r.name === testerRole)) {
      return interaction.reply({
        content: "❌ You are not a tester.",
        ephemeral: true
      });
    }

    const player = queue.shift();

    if (!player) {
      return interaction.reply({
        content: "No players in queue.",
        ephemeral: true
      });
    }

    activeTests.set(player.id, interaction.user.id);

    return interaction.reply({
      content: `🧑‍⚖️ You are now testing <@${player.id}>`,
      ephemeral: true
    });
  }

  // ================= BUTTONS =================
  if (!interaction.isButton()) return;

  const user = interaction.user;

  // JOIN
  if (interaction.customId === "join") {

    if (queue.find(p => p.id === user.id))
      return interaction.reply({ content: "Already in queue", ephemeral: true });

    if (queue.length >= 20)
      return interaction.reply({ content: "Queue full", ephemeral: true });

    queue.push({ id: user.id });

    return interaction.reply({ content: "Joined queue", ephemeral: true });
  }

  // LEAVE
  if (interaction.customId === "leave") {

    const index = queue.findIndex(p => p.id === user.id);

    if (index === -1)
      return interaction.reply({ content: "Not in queue", ephemeral: true });

    queue.splice(index, 1);

    return interaction.reply({ content: "Left queue", ephemeral: true });
  }
});

client.login(process.env.TOKEN);
