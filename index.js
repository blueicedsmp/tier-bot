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
    .setDescription("Queue panel"),

  new SlashCommandBuilder()
    .setName("claim")
    .setDescription("Claim player"),

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

  console.log("Commands loaded");

  // simple dashboard
  setInterval(async () => {
    const channel = client.channels.cache.get(process.env.DASHBOARD_CHANNEL_ID);
    if (!channel) return;

    const embed = new EmbedBuilder()
      .setTitle("🎮 Dashboard")
      .setColor(0x00ff99)
      .addFields(
        { name: "Queue", value: `${queue.length}`, inline: true },
        { name: "Active Tests", value: `${activeTests.size}`, inline: true }
      );

    const msg = (await channel.messages.fetch({ limit: 1 })).first();

    if (msg && msg.author.id === client.user.id) {
      msg.edit({ embeds: [embed] });
    } else {
      channel.send({ embeds: [embed] });
    }
  }, 10000);
});

// ================= PANEL =================
function panel() {
  return new EmbedBuilder()
    .setTitle("🎮 Queue System")
    .setColor(0x00ff99)
    .addFields({ name: "Players in queue", value: `${queue.length}` });
}

// ================= INTERACTIONS =================
client.on(Events.InteractionCreate, async (interaction) => {

  // ===== PANEL =====
  if (interaction.isChatInputCommand() && interaction.commandName === "panel") {
    return interaction.reply({ embeds: [panel()] });
  }

  // ===== JOIN =====
  if (interaction.isButton() && interaction.customId === "join") {

    if (queue.find(p => p.id === interaction.user.id)) {
      return interaction.reply({ content: "Already in queue", ephemeral: true });
    }

    queue.push({ id: interaction.user.id });

    return interaction.reply({ content: "Joined queue", ephemeral: true });
  }

  // ===== LEAVE =====
  if (interaction.isButton() && interaction.customId === "leave") {

    const i = queue.findIndex(p => p.id === interaction.user.id);
    if (i === -1) return interaction.reply({ content: "Not in queue", ephemeral: true });

    queue.splice(i, 1);

    return interaction.reply({ content: "Left queue", ephemeral: true });
  }

  // ================= CLAIM =================
  if (interaction.isChatInputCommand() && interaction.commandName === "claim") {

    const testerRole = "Tester";
    if (!interaction.member.roles.cache.some(r => r.name === testerRole)) {
      return interaction.reply({ content: "❌ Not tester", ephemeral: true });
    }

    if ([...activeTests.values()].some(v => v.tester === interaction.user.id)) {
      return interaction.reply({ content: "Already testing", ephemeral: true });
    }

    const player = queue.shift();
    if (!player) return interaction.reply({ content: "No queue", ephemeral: true });

    const channel = await interaction.guild.channels.create({
      name: `test-${player.id}`,
      permissionOverwrites: [
        { id: interaction.guild.roles.everyone, deny: ["ViewChannel"] },
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
      content: `<@${player.id}> being tested by <@${interaction.user.id}>`,
      components: [row]
    });

    return interaction.reply({ content: "Claimed", ephemeral: true });
  }

  // ================= FINISH =================
  if (interaction.isChatInputCommand() && interaction.commandName === "finish") {

    const rank = interaction.options.getString("rank");

    const entry = [...activeTests.entries()]
      .find(([p, v]) => v.tester === interaction.user.id);

    if (!entry) {
      return interaction.reply({ content: "Not testing anyone", ephemeral: true });
    }

    const [playerId, data] = entry;

    const filter = m => m.author.id === interaction.user.id;

    const ask = async (text) => {
      await interaction.followUp({ content: text, ephemeral: true });

      const collected = await interaction.channel.awaitMessages({
        filter,
        max: 1,
        time: 60000
      });

      return collected.first()?.content || "Unknown";
    };

    await interaction.reply({ content: "🌍 Enter REGION:", ephemeral: true });

    const region = await ask("👤 Enter USERNAME:");
    const username = await ask("📊 Enter PREVIOUS RANK:");

    const results = await interaction.guild.channels.fetch(process.env.RESULTS_CHANNEL_ID).catch(() => null);
    const logs = await interaction.guild.channels.fetch(process.env.TESTER_LOGS_CHANNEL_ID).catch(() => null);

    const msg =
`👤 <@${playerId}> TEST RESULT

Tester: <@${interaction.user.id}>
Region: ${region}
Username: ${username}
Previous Rank: ${username}
Rank Earned: ${rank}`;

    if (results) results.send(msg);
    if (logs) logs.send("🟢 SUCCESS\n\n" + msg);

    activeTests.delete(playerId);

    setTimeout(() => {
      interaction.channel.delete().catch(() => {});
    }, 3000);
  }

  // ================= STOP TEST =================
  if (interaction.isButton() && interaction.customId === "stop_test") {

    const entry = [...activeTests.entries()]
      .find(([p, v]) => v.tester === interaction.user.id);

    if (!entry) {
      return interaction.reply({ content: "Not your test", ephemeral: true });
    }

    const [playerId] = entry;

    await interaction.reply({ content: "Type reason", ephemeral: true });

    const filter = m => m.author.id === interaction.user.id;

    const reason = (await interaction.channel.awaitMessages({
      filter,
      max: 1,
      time: 30000
    })).first()?.content || "No reason";

    const logs = await interaction.guild.channels.fetch(process.env.TESTER_LOGS_CHANNEL_ID).catch(() => null);

    if (logs) {
      logs.send(
`🛑 CANCELLED

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
