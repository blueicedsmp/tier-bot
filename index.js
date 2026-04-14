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
  new SlashCommandBuilder().setName("panel").setDescription("Queue panel"),
  new SlashCommandBuilder().setName("claim").setDescription("Claim player"),
  new SlashCommandBuilder()
    .setName("finish")
    .setDescription("Finish test")
    .addStringOption(opt =>
      opt.setName("rank").setDescription("Rank earned").setRequired(true)
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

  console.log("Commands registered");

  // ===== DASHBOARD =====
  setInterval(async () => {
    try {
      const channel = await client.channels.fetch(process.env.DASHBOARD_CHANNEL_ID).catch(() => null);
      if (!channel) return;

      const embed = new EmbedBuilder()
        .setTitle("🎮 Dashboard")
        .setColor(0x00ff99)
        .addFields(
          { name: "Queue", value: `${queue.length}`, inline: true },
          { name: "Active Tests", value: `${activeTests.size}`, inline: true }
        )
        .setTimestamp();

      const msgs = await channel.messages.fetch({ limit: 1 });
      const last = msgs.first();

      if (last && last.author.id === client.user.id) {
        await last.edit({ embeds: [embed] });
      } else {
        await channel.send({ embeds: [embed] });
      }

    } catch (err) {
      console.log("Dashboard error:", err);
    }
  }, 10000);
});

// ================= PANEL =================
function panelEmbed() {
  return new EmbedBuilder()
    .setTitle("🎮 Queue System")
    .setColor(0x00ff99)
    .addFields({ name: "Players in queue", value: `${queue.length}` });
}

function panelButtons() {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId("join").setLabel("Join Queue").setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId("leave").setLabel("Leave Queue").setStyle(ButtonStyle.Danger)
  );
}

// ================= INTERACTIONS =================
client.on(Events.InteractionCreate, async (interaction) => {

  try {

    // ===== PANEL =====
    if (interaction.isChatInputCommand() && interaction.commandName === "panel") {
      return interaction.reply({
        embeds: [panelEmbed()],
        components: [panelButtons()]
      });
    }

    // ===== JOIN =====
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

    // ===== LEAVE =====
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

    // ===== CLAIM =====
    if (interaction.isChatInputCommand() && interaction.commandName === "claim") {

      const player = queue.shift();
      if (!player) {
        return interaction.reply({ content: "No players in queue", ephemeral: true });
      }

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
        new ButtonBuilder().setCustomId("stop_test").setLabel("🛑 Stop Test").setStyle(ButtonStyle.Danger),
        new ButtonBuilder().setCustomId("close_ticket").setLabel("✅ Close Ticket").setStyle(ButtonStyle.Success)
      );

      await channel.send({
        content: `<@${player.id}> being tested by <@${interaction.user.id}>`,
        components: [row]
      });

      return interaction.reply({ content: "Test started", ephemeral: true });
    }

    // ===== FINISH =====
    if (interaction.isChatInputCommand() && interaction.commandName === "finish") {

      await interaction.deferReply({ ephemeral: true });

      const rank = interaction.options.getString("rank");

      const entry = [...activeTests.entries()]
        .find(([p, v]) => v.tester === interaction.user.id);

      if (!entry) {
        return interaction.followUp({ content: "Not testing anyone", ephemeral: true });
      }

      const [playerId, data] = entry;

      const filter = m => m.author.id === interaction.user.id;

      const ask = async (q) => {
        await interaction.followUp({ content: q, ephemeral: true });

        try {
          const collected = await interaction.channel.awaitMessages({
            filter,
            max: 1,
            time: 60000,
            errors: ["time"]
          });

          return collected.first().content.trim();
        } catch {
          return "No response";
        }
      };

      const region = await ask("🌍 Enter REGION:");
      const username = await ask("👤 Enter USERNAME:");
      const previousRank = await ask("📊 Enter PREVIOUS RANK:");

      let results, logs;

      try {
        results = await interaction.guild.channels.fetch(process.env.RESULTS_CHANNEL_ID);
      } catch { console.log("❌ RESULTS CHANNEL ERROR"); }

      try {
        logs = await interaction.guild.channels.fetch(process.env.TESTER_LOGS_CHANNEL_ID);
      } catch { console.log("❌ LOGS CHANNEL ERROR"); }

      const msg =
`👤 <@${playerId}> TEST RESULT

Tester: <@${interaction.user.id}>
Region: ${region}
Username: ${username}
Previous Rank: ${previousRank}
Rank Earned: ${rank}`;

      if (results) await results.send(msg);
      if (logs) await logs.send("🟢 SUCCESSFUL TEST\n\n" + msg);

      activeTests.delete(playerId);

      await interaction.followUp({ content: "✅ Test completed", ephemeral: true });

      const testChannel = interaction.guild.channels.cache.get(data.channelId);
      if (testChannel) {
        setTimeout(() => testChannel.delete().catch(() => {}), 2000);
      }
    }

    // ===== STOP TEST =====
    if (interaction.isButton() && interaction.customId === "stop_test") {

      await interaction.deferReply({ ephemeral: true });

      const entry = [...activeTests.entries()]
        .find(([p, v]) => v.tester === interaction.user.id);

      if (!entry) {
        return interaction.followUp({ content: "Not your test", ephemeral: true });
      }

      const [playerId, data] = entry;

      const filter = m => m.author.id === interaction.user.id;

      await interaction.followUp({ content: "🛑 Enter cancel reason:", ephemeral: true });

      let reason = "No response";

      try {
        const collected = await interaction.channel.awaitMessages({
          filter,
          max: 1,
          time: 30000,
          errors: ["time"]
        });

        reason = collected.first().content;
      } catch {}

      let logs;
      try {
        logs = await interaction.guild.channels.fetch(process.env.TESTER_LOGS_CHANNEL_ID);
      } catch { console.log("❌ LOGS ERROR"); }

      if (logs) {
        await logs.send(
`🛑 CANCELLED TEST

Tester: <@${interaction.user.id}>
Player: <@${playerId}>
Reason: ${reason}`
        );
      }

      activeTests.delete(playerId);

      await interaction.followUp({ content: "❌ Test cancelled", ephemeral: true });

      const testChannel = interaction.guild.channels.cache.get(data.channelId);
      if (testChannel) {
        setTimeout(() => testChannel.delete().catch(() => {}), 2000);
      }
    }

    // ===== CLOSE TICKET =====
    if (interaction.isButton() && interaction.customId === "close_ticket") {

      await interaction.deferReply({ ephemeral: true });

      const entry = [...activeTests.entries()]
        .find(([p, v]) => v.tester === interaction.user.id);

      if (!entry) {
        return interaction.followUp({ content: "Only tester can close", ephemeral: true });
      }

      const [playerId, data] = entry;

      activeTests.delete(playerId);

      await interaction.followUp({ content: "✅ Ticket closed", ephemeral: true });

      const testChannel = interaction.guild.channels.cache.get(data.channelId);
      if (testChannel) {
        setTimeout(() => testChannel.delete().catch(() => {}), 2000);
      }
    }

  } catch (err) {
    console.error("ERROR:", err);
  }
});

client.login(process.env.TOKEN);
