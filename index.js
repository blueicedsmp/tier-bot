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
  PermissionFlagsBits,
  ChannelType
} = require("discord.js");

// ===== ENV =====
const TOKEN = process.env.TOKEN;
const GUILD_ID = process.env.GUILD_ID;

const TESTER_ROLE_ID = process.env.TESTER_ROLE_ID;
const RESULTS_CHANNEL_ID = process.env.RESULTS_CHANNEL_ID;
const TESTER_LOGS_CHANNEL_ID = process.env.TESTER_LOGS_CHANNEL_ID;
const TICKET_LOGS_CHANNEL_ID = process.env.TICKET_LOGS_CHANNEL_ID;

// ===== CLIENT =====
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMembers
  ]
});

// ===== DATA =====
const queue = [];
const activeTests = new Map();

// ===== COMMANDS =====
const commands = [
  new SlashCommandBuilder()
    .setName("panel")
    .setDescription("Create queue panel"),

  new SlashCommandBuilder()
    .setName("claim")
    .setDescription("Claim next player"),

  new SlashCommandBuilder()
    .setName("finish")
    .setDescription("Finish current test")
    .addStringOption(option =>
      option
        .setName("rank")
        .setDescription("Rank earned")
        .setRequired(true)
    )
].map(cmd => cmd.toJSON());

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

// ===== PANEL =====
function createPanelEmbed() {
  return new EmbedBuilder()
    .setTitle("🎮 Testing Queue")
    .setDescription("Join the queue to get tested.")
    .setColor(0x00ff99)
    .addFields({
      name: "Players in Queue",
      value: `${queue.length}`,
      inline: true
    });
}

function createPanelButtons() {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId("join_queue")
      .setLabel("Join Queue")
      .setStyle(ButtonStyle.Success),

    new ButtonBuilder()
      .setCustomId("leave_queue")
      .setLabel("Leave Queue")
      .setStyle(ButtonStyle.Danger)
  );
}

// ===== INTERACTIONS =====
client.on(Events.InteractionCreate, async interaction => {
  try {

    // ===== /panel =====
    if (interaction.isChatInputCommand() && interaction.commandName === "panel") {

      await interaction.reply({
        embeds: [createPanelEmbed()],
        components: [createPanelButtons()]
      });
    }

    // ===== JOIN QUEUE =====
    if (interaction.isButton() && interaction.customId === "join_queue") {

      await interaction.deferReply({ ephemeral: true });

      if (queue.some(user => user.id === interaction.user.id)) {
        return interaction.editReply({
          content: "❌ You are already in the queue."
        });
      }

      queue.push({
        id: interaction.user.id
      });

      return interaction.editReply({
        content: `✅ Joined queue (#${queue.length})`
      });
    }

    // ===== LEAVE QUEUE =====
    if (interaction.isButton() && interaction.customId === "leave_queue") {

      await interaction.deferReply({ ephemeral: true });

      const index = queue.findIndex(user => user.id === interaction.user.id);

      if (index === -1) {
        return interaction.editReply({
          content: "❌ You are not in the queue."
        });
      }

      queue.splice(index, 1);

      return interaction.editReply({
        content: "✅ Left the queue."
      });
    }

    // ===== /claim =====
    if (interaction.isChatInputCommand() && interaction.commandName === "claim") {

      if (!interaction.member.roles.cache.has(TESTER_ROLE_ID)) {
        return interaction.reply({
          content: "❌ Testers only.",
          ephemeral: true
        });
      }

      const nextPlayer = queue.shift();

      if (!nextPlayer) {
        return interaction.reply({
          content: "❌ Queue is empty.",
          ephemeral: true
        });
      }

      const channel = await interaction.guild.channels.create({
        name: `test-${nextPlayer.id}`,
        type: ChannelType.GuildText,

        permissionOverwrites: [
          {
            id: interaction.guild.roles.everyone,
            deny: [PermissionFlagsBits.ViewChannel]
          },

          {
            id: nextPlayer.id,
            allow: [
              PermissionFlagsBits.ViewChannel,
              PermissionFlagsBits.SendMessages
            ]
          },

          {
            id: interaction.user.id,
            allow: [
              PermissionFlagsBits.ViewChannel,
              PermissionFlagsBits.SendMessages
            ]
          },

          {
            id: TESTER_ROLE_ID,
            allow: [PermissionFlagsBits.ViewChannel]
          }
        ]
      });

      activeTests.set(nextPlayer.id, {
        tester: interaction.user.id
      });

      const buttons = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId("stop_test")
          .setLabel("Stop Test")
          .setStyle(ButtonStyle.Danger),

        new ButtonBuilder()
          .setCustomId("close_ticket")
          .setLabel("Close Ticket")
          .setStyle(ButtonStyle.Secondary)
      );

      await channel.send({
        content: `🧪 <@${nextPlayer.id}> is being tested by <@${interaction.user.id}>`,
        components: [buttons]
      });

      return interaction.reply({
        content: `✅ Created ${channel}`,
        ephemeral: true
      });
    }

    // ===== /finish =====
    if (interaction.isChatInputCommand() && interaction.commandName === "finish") {

      await interaction.deferReply({ ephemeral: true });

      const testEntry = [...activeTests.entries()]
        .find(([_, data]) => data.tester === interaction.user.id);

      if (!testEntry) {
        return interaction.editReply({
          content: "❌ You are not testing anyone."
        });
      }

      const [playerId] = testEntry;

      const rank = interaction.options.getString("rank");

      const resultMessage =
`<@${playerId}>

Tester: <@${interaction.user.id}>
Rank Earned: ${rank}`;

      // RESULTS
      const resultsChannel =
        interaction.guild.channels.cache.get(RESULTS_CHANNEL_ID);

      if (resultsChannel) {
        await resultsChannel.send(resultMessage);
      }

      // TESTER LOGS
      const testerLogs =
        interaction.guild.channels.cache.get(TESTER_LOGS_CHANNEL_ID);

      if (testerLogs) {
        await testerLogs.send(
          `🟢 SUCCESSFUL TEST\n\n${resultMessage}`
        );
      }

      activeTests.delete(playerId);

      await interaction.editReply({
        content: "✅ Test finished."
      });

      setTimeout(() => {
        interaction.channel.delete().catch(() => {});
      }, 2000);
    }

    // ===== STOP TEST =====
    if (interaction.isButton() && interaction.customId === "stop_test") {

      await interaction.deferReply({ ephemeral: true });

      const testEntry = [...activeTests.entries()]
        .find(([_, data]) => data.tester === interaction.user.id);

      if (!testEntry) {
        return interaction.editReply({
          content: "❌ Only the tester can stop this test."
        });
      }

      const [playerId] = testEntry;

      const testerLogs =
        interaction.guild.channels.cache.get(TESTER_LOGS_CHANNEL_ID);

      if (testerLogs) {
        await testerLogs.send(
          `🛑 TEST CANCELLED\nTester: <@${interaction.user.id}>\nPlayer: <@${playerId}>`
        );
      }

      activeTests.delete(playerId);

      await interaction.editReply({
        content: "🛑 Test cancelled."
      });

      setTimeout(() => {
        interaction.channel.delete().catch(() => {});
      }, 2000);
    }

    // ===== CLOSE TICKET =====
    if (interaction.isButton() && interaction.customId === "close_ticket") {

      await interaction.deferReply({ ephemeral: true });

      const testEntry = [...activeTests.entries()]
        .find(([_, data]) => data.tester === interaction.user.id);

      if (!testEntry) {
        return interaction.editReply({
          content: "❌ Only the tester can close this ticket."
        });
      }

      const [playerId] = testEntry;

      const ticketLogs =
        interaction.guild.channels.cache.get(TICKET_LOGS_CHANNEL_ID);

      if (ticketLogs) {
        await ticketLogs.send(
          `📁 Ticket Closed\nTester: <@${interaction.user.id}>\nPlayer: <@${playerId}>`
        );
      }

      activeTests.delete(playerId);

      await interaction.editReply({
        content: "✅ Ticket closed."
      });

      setTimeout(() => {
        interaction.channel.delete().catch(() => {});
      }, 2000);
    }

  } catch (err) {
    console.error("❌ INTERACTION ERROR:", err);

    if (interaction.deferred || interaction.replied) {
      interaction.followUp({
        content: "❌ Something went wrong.",
        ephemeral: true
      }).catch(() => {});
    } else {
      interaction.reply({
        content: "❌ Something went wrong.",
        ephemeral: true
      }).catch(() => {});
    }
  }
});

// ===== LOGIN =====
client.login(TOKEN);
