require("dotenv").config();

const express = require("express");
const app = express();

app.get("/", (req, res) => res.send("Bot is alive"));
app.listen(process.env.PORT || 3000, () => console.log("Web server running"));

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

// ================= SLASH COMMANDS =================
const commands = [
  new SlashCommandBuilder()
    .setName("panel")
    .setDescription("Open the testing queue panel"),

  new SlashCommandBuilder()
    .setName("claim")
    .setDescription("Claim next player (TESTERS ONLY)")
].map(cmd => cmd.toJSON());

// ================= REGISTER SLASH COMMANDS (GUILD MODE) =================
client.once(Events.ClientReady, async () => {
  console.log(`Logged in as ${client.user.tag}`);

  const rest = new REST({ version: "10" }).setToken(process.env.TOKEN);

  try {
    await rest.put(
      Routes.applicationGuildCommands(client.user.id, process.env.GUILD_ID),
      { body: commands }
    );

    console.log("Guild slash commands registered instantly");
  } catch (err) {
    console.error("Slash command error:", err);
  }
});

// ================= PANEL UI =================
function panelEmbed() {
  return new EmbedBuilder()
    .setTitle("🎮 Tier Testing Queue")
    .setColor(0x00ff99)
    .setDescription(
      queue.length === 0
        ? "No players in queue"
        : queue.map((p, i) => `${i + 1}. <@${p.id}>`).join("\n")
    )
    .addFields(
      { name: "Queue Size", value: `${queue.length}/20`, inline: true },
      { name: "Active Tests", value: `${activeTests.size}`, inline: true }
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

  // ================= /PANEL =================
  if (interaction.isChatInputCommand() && interaction.commandName === "panel") {

    return interaction.reply({
      embeds: [panelEmbed()],
      components: [panelButtons()]
    });
  }

  // ================= /CLAIM (TESTERS ONLY) =================
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
