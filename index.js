require("dotenv").config();

const express = require("express");
const app = express();

app.get("/", (req, res) => res.send("Bot is alive"));
app.listen(process.env.PORT || 3000, () => {
  console.log("🌐 Web server running");
});

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
  ButtonStyle,
  PermissionFlagsBits
} = require("discord.js");

// ===== SAFE ENV CHECK =====
function mustGetEnv(name) {
  const value = process.env[name];
  if (!value) console.warn(`⚠️ Missing ENV: ${name}`);
  return value;
}

// ===== CONFIG =====
const TOKEN = mustGetEnv("TOKEN");
const GUILD_ID = mustGetEnv("GUILD_ID");

const TESTER_ROLE_ID = mustGetEnv("TESTER_ROLE_ID");
const RESULTS_CHANNEL_ID = mustGetEnv("RESULTS_CHANNEL_ID");
const TESTER_LOGS_CHANNEL_ID = mustGetEnv("TESTER_LOGS_CHANNEL_ID");
const TICKET_LOGS_CHANNEL_ID = mustGetEnv("TICKET_LOGS_CHANNEL_ID");

// ===== CLIENT =====
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent
  ]
});

// ===== DATA =====
const queue = [];
const activeTests = new Map();

// ===== COMMANDS =====
const commands = [
  new SlashCommandBuilder().setName("panel").setDescription("Queue panel"),
  new SlashCommandBuilder().setName("claim").setDescription("Claim player"),
  new SlashCommandBuilder()
    .setName("finish")
    .setDescription("Finish test")
    .addStringOption(opt =>
      opt.setName("rank").setDescription("Rank earned").setRequired(true)
    )
].map(c => c.toJSON());

// ===== READY =====
client.once(Events.ClientReady, async () => {
  console.log(`✅ Logged in as ${client.user.tag}`);

  try {
    const rest = new REST({ version: "10" }).setToken(TOKEN);

    await rest.put(
      Routes.applicationGuildCommands(client.user.id, GUILD_ID),
      { body: commands }
    );

    console.log("📦 Commands registered");
  } catch (err) {
    console.error("❌ Command registration failed:", err);
  }
});

// ===== ROLE CHECK SAFE =====
function isTester(member) {
  return member?.roles?.cache?.has(TESTER_ROLE_ID);
}

// ===== PANEL =====
function panelEmbed() {
  return new EmbedBuilder()
    .setTitle("🎮 Queue System")
    .setColor(0x00ff99)
    .addFields({ name: "Players in queue", value: `${queue.length}` });
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

// ===== INTERACTIONS =====
client.on(Events.InteractionCreate, async (interaction) => {
  try {

    // PANEL
    if (interaction.isChatInputCommand() && interaction.commandName === "panel") {
      return interaction.reply({
        embeds: [panelEmbed()],
        components: [panelButtons()]
      });
    }

    // JOIN
    if (interaction.isButton() && interaction.customId === "join") {
      if (queue.some(p => p.id === interaction.user.id)) {
        return interaction.reply({ content: "Already in queue", ephemeral: true });
      }

      queue.push({ id: interaction.user.id });

      return interaction.reply({
        content: `Joined queue (#${queue.length})`,
        ephemeral: true
      });
    }

    // LEAVE
    if (interaction.isButton() && interaction.customId === "leave") {
      const i = queue.findIndex(p => p.id === interaction.user.id);
      if (i === -1) return interaction.reply({ content: "Not in queue", ephemeral: true });

      queue.splice(i, 1);

      return interaction.reply({ content: "Left queue", ephemeral: true });
    }

    // CLAIM
    if (interaction.isChatInputCommand() && interaction.commandName === "claim") {
      if (!isTester(interaction.member)) {
        return interaction.reply({ content: "❌ Testers only", ephemeral: true });
      }

      const player = queue.shift();
      if (!player) {
        return interaction.reply({ content: "No players in queue", ephemeral: true });
      }

      const channel = await interaction.guild.channels.create({
        name: `test-${player.id}`,
        permissionOverwrites: [
          { id: interaction.guild.roles.everyone, deny: [PermissionFlagsBits.ViewChannel] },
          { id: player.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages] },
          { id: interaction.user.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages] },
          { id: TESTER_ROLE_ID, allow: [PermissionFlagsBits.ViewChannel] }
        ]
      });

      activeTests.set(player.id, { tester: interaction.user.id });

      await channel.send({
        content: `<@${player.id}> being tested by <@${interaction.user.id}>`,
        components: [
          new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId("stop_test").setLabel("Stop").setStyle(ButtonStyle.Danger),
            new ButtonBuilder().setCustomId("close_ticket").setLabel("Close").setStyle(ButtonStyle.Success)
          )
        ]
      });

      return interaction.reply({ content: "Test started", ephemeral: true });
    }

    // FINISH
    if (interaction.isChatInputCommand() && interaction.commandName === "finish") {
      await interaction.deferReply({ ephemeral: true });

      const entry = [...activeTests.entries()]
        .find(([_, v]) => v.tester === interaction.user.id);

      if (!entry) {
        return interaction.followUp({ content: "Not testing anyone", ephemeral: true });
      }

      const [playerId] = entry;
      const rank = interaction.options.getString("rank");

      const msg = `Player: <@${playerId}>\nTester: <@${interaction.user.id}>\nRank: ${rank}`;

      const results = interaction.guild.channels.cache.get(RESULTS_CHANNEL_ID);
      const logs = interaction.guild.channels.cache.get(TESTER_LOGS_CHANNEL_ID);

      if (results) results.send(msg);
      if (logs) logs.send("SUCCESS TEST\n\n" + msg);

      activeTests.delete(playerId);

      return interaction.followUp({ content: "Done", ephemeral: true });
    }

  } catch (err) {
    console.error("INTERACTION ERROR:", err);
  }
});

// ===== LOGIN SAFETY =====
if (!TOKEN) {
  console.error("❌ BOT TOKEN MISSING - CANNOT START");
} else {
  client.login(TOKEN);
}
