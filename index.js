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

// ===== EMBED HELPER =====
function createEmbed(title, description, color = 0x5865f2) {
  return new EmbedBuilder()
    .setTitle(title)
    .setDescription(description)
    .setColor(color)
    .setTimestamp();
}

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
    if (
      interaction.isChatInputCommand() &&
      interaction.commandName === "panel"
    ) {
      await interaction.reply({
        embeds: [createPanelEmbed()],
        components: [createPanelButtons()]
      });
    }

    // ===== JOIN QUEUE =====
    if (
      interaction.isButton() &&
      interaction.customId === "join_queue"
    ) {
      await interaction.deferReply({ ephemeral: true });

      if (queue.some(user => user.id === interaction.user.id)) {
        return interaction.editReply({
          embeds: [
            createEmbed(
              "❌ Already in Queue",
              "You are already in the testing queue.",
              0xff0000
            )
          ]
        });
      }

      queue.push({
        id: interaction.user.id
      });

      return interaction.editReply({
        embeds: [
          createEmbed(
            "✅ Joined Queue",
            `You have joined the testing queue.\n\n**Position:** #${queue.length}`,
            0x00ff00
          )
        ]
      });
    }

    // ===== LEAVE QUEUE =====
    if (
      interaction.isButton() &&
      interaction.customId === "leave_queue"
    ) {
      await interaction.deferReply({ ephemeral: true });

      const index = queue.findIndex(
        user => user.id === interaction.user.id
      );

      if (index === -1) {
        return interaction.editReply({
          embeds: [
            createEmbed(
              "❌ Not in Queue",
              "You are not currently in the testing queue.",
              0xff0000
            )
          ]
        });
      }

      queue.splice(index, 1);

      return interaction.editReply({
        embeds: [
          createEmbed(
            "✅ Left Queue",
            "You have left the testing queue.",
            0x00ff00
          )
        ]
      });
    }

    // ===== /claim =====
    if (
      interaction.isChatInputCommand() &&
      interaction.commandName === "claim"
    ) {

      if (!interaction.member.roles.cache.has(TESTER_ROLE_ID)) {
        return interaction.reply({
          embeds: [
            createEmbed(
              "❌ Testers Only",
              "You need the tester role to use this command.",
              0xff0000
            )
          ],
          ephemeral: true
        });
      }

      const nextPlayer = queue.shift();

      if (!nextPlayer) {
        return interaction.reply({
          embeds: [
            createEmbed(
              "❌ Queue Empty",
              "There are currently no players waiting to be tested.",
              0xff0000
            )
          ],
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
        embeds: [
          createEmbed(
            "🧪 Test Started",
            `<@${nextPlayer.id}> is being tested by <@${interaction.user.id}>.`,
            0x5865f2
          )
        ],
        components: [buttons]
      });

      return interaction.reply({
        embeds: [
          createEmbed(
            "✅ Test Created",
            `Created ${channel}`,
            0x00ff00
          )
        ],
        ephemeral: true
      });
    }

    // ===== /finish =====
    if (
      interaction.isChatInputCommand() &&
      interaction.commandName === "finish"
    ) {

      await interaction.deferReply({ ephemeral: true });

      const testEntry = [...activeTests.entries()]
        .find(([_, data]) => data.tester === interaction.user.id);

      if (!testEntry) {
        return interaction.editReply({
          embeds: [
            createEmbed(
              "❌ No Active Test",
              "You are not currently testing anyone.",
              0xff0000
            )
          ]
        });
      }

      const [playerId] = testEntry;

      const rank = interaction.options.getString("rank");

      // RESULTS
      const resultsChannel =
        interaction.guild.channels.cache.get(RESULTS_CHANNEL_ID);

      if (resultsChannel) {
        await resultsChannel.send({
          embeds: [
            new EmbedBuilder()
              .setTitle("🏆 Test Result")
              .setColor(0x00ff00)
              .addFields(
                {
                  name: "Player",
                  value: `<@${playerId}>`,
                  inline: true
                },
                {
                  name: "Tester",
                  value: `<@${interaction.user.id}>`,
                  inline: true
                },
                {
                  name: "Rank Earned",
                  value: rank,
                  inline: false
                }
              )
              .setTimestamp()
          ]
        });
      }

      // TESTER LOGS
      const testerLogs =
        interaction.guild.channels.cache.get(TESTER_LOGS_CHANNEL_ID);

      if (testerLogs) {
        await testerLogs.send({
          embeds: [
            new EmbedBuilder()
              .setTitle("🟢 Successful Test")
              .setColor(0x00ff00)
              .addFields(
                {
                  name: "Player",
                  value: `<@${playerId}>`,
                  inline: true
                },
                {
                  name: "Tester",
                  value: `<@${interaction.user.id}>`,
                  inline: true
                },
                {
                  name: "Rank Earned",
                  value: rank,
                  inline: false
                }
              )
              .setTimestamp()
          ]
        });
      }

      activeTests.delete(playerId);

      await interaction.editReply({
        embeds: [
          createEmbed(
            "✅ Test Finished",
            "The test has been successfully completed.",
            0x00ff00
          )
        ]
      });

      setTimeout(() => {
        interaction.channel.delete().catch(() => {});
      }, 2000);
    }

    // ===== STOP TEST =====
    if (
      interaction.isButton() &&
      interaction.customId === "stop_test"
    ) {

      await interaction.deferReply({ ephemeral: true });

      const testEntry = [...activeTests.entries()]
        .find(([_, data]) => data.tester === interaction.user.id);

      if (!testEntry) {
        return interaction.editReply({
          embeds: [
            createEmbed(
              "❌ Permission Denied",
              "Only the tester can stop this test.",
              0xff0000
            )
          ]
        });
      }

      const [playerId] = testEntry;

      const testerLogs =
        interaction.guild.channels.cache.get(TESTER_LOGS_CHANNEL_ID);

      if (testerLogs) {
        await testerLogs.send({
          embeds: [
            new EmbedBuilder()
              .setTitle("🛑 Test Cancelled")
              .setColor(0xff0000)
              .addFields(
                {
                  name: "Tester",
                  value: `<@${interaction.user.id}>`,
                  inline: true
                },
                {
                  name: "Player",
                  value: `<@${playerId}>`,
                  inline: true
                }
              )
              .setTimestamp()
          ]
        });
      }

      activeTests.delete(playerId);

      await interaction.editReply({
        embeds: [
          createEmbed(
            "🛑 Test Cancelled",
            "The test has been cancelled.",
            0xff0000
          )
        ]
      });

      setTimeout(() => {
        interaction.channel.delete().catch(() => {});
      }, 2000);
    }

    // ===== CLOSE TICKET =====
    if (
      interaction.isButton() &&
      interaction.customId === "close_ticket"
    ) {

      await interaction.deferReply({ ephemeral: true });

      const testEntry = [...activeTests.entries()]
        .find(([_, data]) => data.tester === interaction.user.id);

      if (!testEntry) {
        return interaction.editReply({
          embeds: [
            createEmbed(
              "❌ Permission Denied",
              "Only the tester can close this ticket.",
              0xff0000
            )
          ]
        });
      }

      const [playerId] = testEntry;

      const ticketLogs =
        interaction.guild.channels.cache.get(TICKET_LOGS_CHANNEL_ID);

      if (ticketLogs) {
        await ticketLogs.send({
          embeds: [
            new EmbedBuilder()
              .setTitle("📁 Ticket Closed")
              .setColor(0x808080)
              .addFields(
                {
                  name: "Tester",
                  value: `<@${interaction.user.id}>`,
                  inline: true
                },
                {
                  name: "Player",
                  value: `<@${playerId}>`,
                  inline: true
                }
              )
              .setTimestamp()
          ]
        });
      }

      activeTests.delete(playerId);

      await interaction.editReply({
        embeds: [
          createEmbed(
            "✅ Ticket Closed",
            "The ticket will now be closed.",
            0x00ff00
          )
        ]
      });

      setTimeout(() => {
        interaction.channel.delete().catch(() => {});
      }, 2000);
    }

  } catch (err) {
    console.error("❌ INTERACTION ERROR:", err);

    const errorEmbed = createEmbed(
      "❌ Something Went Wrong",
      "An unexpected error occurred while processing your request.",
      0xff0000
    );

    if (interaction.deferred || interaction.replied) {
      interaction.followUp({
        embeds: [errorEmbed],
        ephemeral: true
      }).catch(() => {});
    } else {
      interaction.reply({
        embeds: [errorEmbed],
        ephemeral: true
      }).catch(() => {});
    }
  }
});

// ===== LOGIN =====
client.login(TOKEN);
