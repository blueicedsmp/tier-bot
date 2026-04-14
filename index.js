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
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent]
});

// ================= DATA =================
const queue = [];
const activeTests = new Map();

let lastResult = "None";
let lastCancel = "None";

// ================= COMMANDS =================
const commands = [
  new SlashCommandBuilder()
    .setName("panel")
    .setDescription("Open queue panel"),

  new SlashCommandBuilder()
    .setName("claim")
    .setDescription("Claim next player (testers only)"),

  new SlashCommandBuilder()
    .setName("finish")
    .setDescription("Finish test")
    .addStringOption(opt =>
      opt.setName("rank")
        .setDescription("Rank earned")
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
    console.error(err);
  }

  // dashboard updater (simple)
  setInterval(async () => {
    const channel = client.channels.cache.get(process.env.DASHBOARD_CHANNEL_ID);
    if (!channel) return;

    const embed = new EmbedBuilder()
      .setTitle("🎮 Staff Dashboard")
      .setColor(0x00ff99)
      .addFields(
        { name: "Queue", value: `${queue.length}`, inline: true },
        { name: "Active Tests", value: `${activeTests.size}`, inline: true },
        {
          name: "Active List",
          value: activeTests.size
            ? [...activeTests.entries()].map(([p, t]) => `<@${t}> → <@${p}>`).join("\n")
            : "None"
        },
        { name: "Last Result", value: lastResult },
        { name: "Last Cancel", value: lastCancel }
      );

    const msgs = await channel.messages.fetch({ limit: 1 });
    const msg = msgs.first();

    if (msg && msg.author.id === client.user.id) {
      msg.edit({ embeds: [embed] });
    } else {
      channel.send({ embeds: [embed] });
    }
  }, 10000);
});

// ================= PANEL =================
function panelEmbed() {
  return new EmbedBuilder()
    .setTitle("🎮 Queue System")
    .setColor(0x00ff99)
    .addFields(
      { name: "Queue", value: `${queue.length} players` }
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

  // ===== PANEL =====
  if (interaction.isChatInputCommand() && interaction.commandName === "panel") {
    return interaction.reply({
      embeds: [panelEmbed()],
      components: [panelButtons()],
      fetchReply: true
    });
  }

  // ===== JOIN =====
  if (interaction.isButton() && interaction.customId === "join") {

    if (queue.find(p => p.id === interaction.user.id))
      return interaction.reply({ content: "Already in queue", ephemeral: true });

    queue.push({ id: interaction.user.id });

    return interaction.reply({
      content: `Joined queue (#${queue.length})`,
      ephemeral: true
    });
  }

  // ===== LEAVE =====
  if (interaction.isButton() && interaction.customId === "leave") {

    const i = queue.findIndex(p => p.id === interaction.user.id);
    if (i === -1)
      return interaction.reply({ content: "Not in queue", ephemeral: true });

    queue.splice(i, 1);

    return interaction.reply({
      content: "Left queue",
      ephemeral: true
    });
  }

  // ================= CLAIM =================
  if (interaction.isChatInputCommand() && interaction.commandName === "claim") {

    const testerRole = "Tester";
    if (!interaction.member.roles.cache.some(r => r.name === testerRole)) {
      return interaction.reply({ content: "❌ Not tester", ephemeral: true });
    }

    const already = [...activeTests.values()].includes(interaction.user.id);
    if (already) {
      return interaction.reply({ content: "❌ Already testing someone", ephemeral: true });
    }

    const player = queue.shift();
    if (!player) {
      return interaction.reply({ content: "No queue", ephemeral: true });
    }

    activeTests.set(player.id, interaction.user.id);

    const guild = interaction.guild;

    const channel = await guild.channels.create({
      name: `test-${player.id}`,
      permissionOverwrites: [
        { id: guild.roles.everyone, deny: ["ViewChannel"] },
        { id: player.id, allow: ["ViewChannel", "SendMessages"] },
        { id: interaction.user.id, allow: ["ViewChannel", "SendMessages"] }
      ]
    });

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId("stop_test")
        .setLabel("🛑 Stop Test")
        .setStyle(ButtonStyle.Danger)
    );

    await channel.send({
      content: `<@${player.id}> You are being tested by <@${interaction.user.id}>`,
      components: [row]
    });

    return interaction.reply({
      content: `Testing <@${player.id}>`,
      ephemeral: true
    });
  }

  // ================= FINISH =================
  if (interaction.isChatInputCommand() && interaction.commandName === "finish") {

    const rank = interaction.options.getString("rank");

    const entry = [...activeTests.entries()]
      .find(([p, t]) => t === interaction.user.id);

    if (!entry)
      return interaction.reply({ content: "Not testing anyone", ephemeral: true });

    const [playerId] = entry;
    const channel = interaction.channel;

    await interaction.reply({
      content: "Send: username | region | previous rank",
      ephemeral: true
    });

    const collected = await channel.awaitMessages({
      max: 1,
      time: 60000,
      filter: m => m.author.id === interaction.user.id
    });

    const input = collected.first()?.content.split("|") || [];

    const username = input[0]?.trim() || "Unknown";
    const region = input[1]?.trim() || "Unknown";
    const previousRank = input[2]?.trim() || "Unknown";

    const results = interaction.guild.channels.cache.get(process.env.RESULTS_CHANNEL_ID);
    const logs = interaction.guild.channels.cache.get(process.env.TESTER_LOGS_CHANNEL_ID);

    const msg =
`👤 <@${playerId}> TEST RESULT

Tester: <@${interaction.user.id}>
Region: ${region}
Username: ${username}
Previous Rank: ${previousRank}
Rank Earned: ${rank}`;

    if (results) results.send(msg);

    lastResult = `${username} → ${rank}`;

    if (logs) logs.send("🟢 SUCCESS\n\n" + msg);

    activeTests.delete(playerId);

    setTimeout(() => channel.delete().catch(() => {}), 3000);
  }

  // ================= STOP TEST =================
  if (interaction.isButton() && interaction.customId === "stop_test") {

    const entry = [...activeTests.entries()]
      .find(([p, t]) => t === interaction.user.id);

    if (!entry)
      return interaction.reply({ content: "Not your test", ephemeral: true });

    const [playerId] = entry;

    await interaction.reply({
      content: "Type reason for cancel",
      ephemeral: true
    });

    const collected = await interaction.channel.awaitMessages({
      max: 1,
      time: 30000,
      filter: m => m.author.id === interaction.user.id
    });

    const reason = collected.first()?.content || "No reason";

    const logs = interaction.guild.channels.cache.get(process.env.TESTER_LOGS_CHANNEL_ID);

    if (logs) {
      logs.send(
`🛑 CANCELLED

Tester: <@${interaction.user.id}>
Player: <@${playerId}>
Reason: ${reason}`
      );
    }

    lastCancel = `${playerId} (${reason})`;

    activeTests.delete(playerId);

    setTimeout(() => interaction.channel.delete().catch(() => {}), 3000);
  }
});

client.login(process.env.TOKEN);
