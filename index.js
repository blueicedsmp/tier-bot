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
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent
  ]
});

// ================= DATA =================
const queue = [];
const activeTests = new Map();

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

  await rest.put(
    Routes.applicationGuildCommands(client.user.id, process.env.GUILD_ID),
    { body: commands }
  );

  console.log("✅ Commands registered");
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

  // ================= PANEL =================
  if (interaction.isChatInputCommand() && interaction.commandName === "panel") {
    return interaction.reply({
      embeds: [panelEmbed()],
      components: [panelButtons()]
    });
  }

  // ================= JOIN =================
  if (interaction.isButton() && interaction.customId === "join") {

    if (queue.find(p => p.id === interaction.user.id)) {
      return interaction.reply({ content: "Already in queue", ephemeral: true });
    }

    queue.push({ id: interaction.user.id });

    return interaction.reply({
      content: `Joined queue (#${queue.length})`,
      ephemeral: true
    });
  }

  // ================= LEAVE =================
  if (interaction.isButton() && interaction.customId === "leave") {

    const i = queue.findIndex(p => p.id === interaction.user.id);
    if (i === -1) {
      return interaction.reply({ content: "Not in queue", ephemeral: true });
    }

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

    const alreadyTesting = [...activeTests.values()]
      .some(v => v.tester === interaction.user.id);

    if (alreadyTesting) {
      return interaction.reply({
        content: "❌ Already testing someone",
        ephemeral: true
      });
    }

    const player = queue.shift();

    if (!player) {
      return interaction.reply({ content: "No players in queue", ephemeral: true });
    }

    const guild = interaction.guild;

    const channel = await guild.channels.create({
      name: `test-${player.id}`,
      permissionOverwrites: [
        { id: guild.roles.everyone, deny: ["ViewChannel"] },
        { id: player.id, allow: ["ViewChannel", "SendMessages"] },
        { id: interaction.user.id, allow: ["ViewChannel", "SendMessages"] }
      ]
    });

    activeTests.set(player.id, {
      tester: interaction.user.id,
      channelId: channel.id
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
      .find(([playerId, data]) => data.tester === interaction.user.id);

    if (!entry) {
      return interaction.reply({
        content: "❌ Not testing anyone",
        ephemeral: true
      });
    }

    const [playerId, data] = entry;

    const filter = m => m.author.id === interaction.user.id;

    await interaction.reply({ content: "🌍 Enter REGION:", ephemeral: true });

    const region = (await interaction.channel.awaitMessages({ filter, max: 1, time: 60000 }))
      .first()?.content || "Unknown";

    await interaction.followUp({ content: "👤 Enter USERNAME:", ephemeral: true });

    const username = (await interaction.channel.awaitMessages({ filter, max: 1, time: 60000 }))
      .first()?.content || "Unknown";

    await interaction.followUp({ content: "📊 Enter PREVIOUS RANK:", ephemeral: true });

    const previousRank = (await interaction.channel.awaitMessages({ filter, max: 1, time: 60000 }))
      .first()?.content || "Unknown";

    const results = await interaction.guild.channels.fetch(process.env.RESULTS_CHANNEL_ID).catch(() => null);
    const logs = await interaction.guild.channels.fetch(process.env.TESTER_LOGS_CHANNEL_ID).catch(() => null);

    const msg =
`👤 <@${playerId}> TEST RESULT

Tester: <@${interaction.user.id}>
Region: ${region}
Username: ${username}
Previous Rank: ${previousRank}
Rank Earned: ${rank}`;

    if (results) results.send(msg);

    if (logs) logs.send("🟢 SUCCESSFUL TEST\n\n" + msg);

    activeTests.delete(playerId);

    interaction.followUp({ content: "✅ Test completed", ephemeral: true });

    setTimeout(() => {
      interaction.channel.delete().catch(() => {});
    }, 3000);
  }

  // ================= STOP TEST =================
  if (interaction.isButton() && interaction.customId === "stop_test") {

    const entry = [...activeTests.entries()]
      .find(([playerId, data]) => data.tester === interaction.user.id);

    if (!entry) {
      return interaction.reply({ content: "❌ Not your test", ephemeral: true });
    }

    const [playerId] = entry;

    await interaction.reply({ content: "🛑 Type reason for cancel", ephemeral: true });

    const filter = m => m.author.id === interaction.user.id;

    const reason = (await interaction.channel.awaitMessages({
      filter,
      max: 1,
      time: 30000
    })).first()?.content || "No reason";

    const logs = await interaction.guild.channels.fetch(process.env.TESTER_LOGS_CHANNEL_ID).catch(() => null);

    if (logs) {
      logs.send(
`🛑 CANCELLED TEST

Tester: <@${interaction.user.id}>
Player: <@${playerId}>
Reason: ${reason}`
      );
    }

    activeTests.delete(playerId);

    setTimeout(() => {
      interaction.channel.delete().catch(() => {});
    }, 3000);
  }
});

client.login(process.env.TOKEN);
