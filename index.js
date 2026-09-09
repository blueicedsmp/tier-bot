require("dotenv").config();

const express = require("express");
const fs = require("fs");
const path = require("path");
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

// ===== TRANSCRIPT CHANNEL =====
const TRANSCRIPT_CHANNEL_ID = "1547279794800955392";

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

// ===== HTML ESCAPE =====
function escapeHTML(text) {
  if (!text) return "";

  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

// ===== CREATE HTML TRANSCRIPT =====
async function createTranscript(channel, playerId, testerId) {
  let messages = [];
  let lastId;

  // Get all messages
  while (true) {
    const options = {
      limit: 100
    };

    if (lastId) {
      options.before = lastId;
    }

    const batch = await channel.messages.fetch(options);

    if (batch.size === 0) break;

    messages.push(...batch.values());

    lastId = batch.last().id;

    if (batch.size < 100) break;
  }

  messages.reverse();

  const player = await client.users.fetch(playerId).catch(() => null);
  const tester = await client.users.fetch(testerId).catch(() => null);

  const playerName = player
    ? `${player.username}#${player.discriminator}`
    : playerId;

  const testerName = tester
    ? `${tester.username}#${tester.discriminator}`
    : testerId;

  let messageHTML = "";

  for (const message of messages) {
    const username = escapeHTML(message.author.username);
    const avatar = message.author.displayAvatarURL({
      extension: "png",
      size: 128
    });

    const timestamp = new Date(message.createdTimestamp).toLocaleString(
      "en-GB",
      {
        dateStyle: "short",
        timeStyle: "medium"
      }
    );

    let content = escapeHTML(message.content);

    if (!content) {
      content = "<em>No message content</em>";
    }

    // Attachments
    if (message.attachments.size > 0) {
      for (const attachment of message.attachments.values()) {
        content += `
          <div class="attachment">
            📎 <a href="${attachment.url}" target="_blank">
              ${escapeHTML(attachment.name || "Attachment")}
            </a>
          </div>
        `;
      }
    }

    // Embeds
    if (message.embeds.length > 0) {
      content += `
        <div class="bot-embed">
          <strong>Embed</strong>
          <br>
          ${message.embeds
            .map(embed => escapeHTML(embed.description || embed.title || "Embed"))
            .join("<br>")}
        </div>
      `;
    }

    messageHTML += `
      <div class="message">
        <img class="avatar" src="${avatar}">
        <div class="message-content">
          <div>
            <span class="username">${username}</span>
            <span class="timestamp">${timestamp}</span>
          </div>
          <div class="content">${content}</div>
        </div>
      </div>
    `;
  }

  const html = `
<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>Ticket Transcript - ${escapeHTML(channel.name)}</title>

<style>

body {
  margin: 0;
  padding: 0;
  background: #313338;
  color: #dbdee1;
  font-family: Arial, Helvetica, sans-serif;
}

.header {
  background: #1e1f22;
  padding: 25px;
  border-bottom: 1px solid #111214;
}

.header h1 {
  margin: 0 0 10px 0;
  color: white;
}

.info {
  color: #949ba4;
  line-height: 1.6;
}

.messages {
  padding: 25px;
}

.message {
  display: flex;
  gap: 15px;
  margin-bottom: 22px;
}

.avatar {
  width: 40px;
  height: 40px;
  border-radius: 50%;
}

.message-content {
  max-width: 90%;
}

.username {
  color: white;
  font-weight: bold;
  margin-right: 8px;
}

.timestamp {
  color: #949ba4;
  font-size: 12px;
}

.content {
  margin-top: 5px;
  white-space: pre-wrap;
  word-wrap: break-word;
  line-height: 1.5;
}

.attachment {
  margin-top: 8px;
  background: #2b2d31;
  padding: 10px;
  border-radius: 5px;
}

.attachment a {
  color: #00a8fc;
}

.bot-embed {
  margin-top: 8px;
  padding: 10px;
  background: #2b2d31;
  border-left: 4px solid #5865f2;
  border-radius: 4px;
}

a {
  color: #00a8fc;
}

</style>
</head>

<body>

<div class="header">

<h1>📋 Ticket Transcript</h1>

<div class="info">
<strong>Ticket:</strong> ${escapeHTML(channel.name)}<br>
<strong>Player:</strong> ${escapeHTML(playerName)}<br>
<strong>Tester:</strong> ${escapeHTML(testerName)}<br>
<strong>Guild:</strong> ${escapeHTML(channel.guild.name)}<br>
<strong>Created:</strong> ${new Date(channel.createdTimestamp).toLocaleString("en-GB")}<br>
<strong>Messages:</strong> ${messages.length}
</div>

</div>

<div class="messages">

${messageHTML}

</div>

</body>
</html>
`;

  const transcriptDirectory = path.join(__dirname, "transcripts");

  if (!fs.existsSync(transcriptDirectory)) {
    fs.mkdirSync(transcriptDirectory);
  }

  const fileName =
    `transcript-${channel.name}-${Date.now()}.html`;

  const filePath =
    path.join(transcriptDirectory, fileName);

  fs.writeFileSync(filePath, html);

  return {
    filePath,
    fileName,
    messageCount: messages.length
  };
}

// ===== SEND TRANSCRIPT =====
async function sendTranscript(channel, playerId, testerId) {
  try {
    const transcript = await createTranscript(
      channel,
      playerId,
      testerId
    );

    const transcriptChannel =
      channel.guild.channels.cache.get(
        TRANSCRIPT_CHANNEL_ID
      );

    if (!transcriptChannel) {
      console.error(
        "❌ Transcript channel not found."
      );

      return {
        success: false,
        transcript
      };
    }

    // ===== TRANSCRIPT EMBED =====
    const transcriptEmbed = new EmbedBuilder()
      .setTitle("📋 Ticket Transcript")
      .setColor(0x5865f2)
      .addFields(
        {
          name: "Ticket",
          value: channel.name,
          inline: true
        },
        {
          name: "Player",
          value: `<@${playerId}>`,
          inline: true
        },
        {
          name: "Tester",
          value: `<@${testerId}>`,
          inline: true
        },
        {
          name: "Messages",
          value: `${transcript.messageCount}`,
          inline: true
        }
      )
      .setTimestamp();

    // Save in transcript channel
    await transcriptChannel.send({
      embeds: [transcriptEmbed],
      files: [
        {
          attachment: transcript.filePath,
          name: transcript.fileName
        }
      ]
    });

    // Send to player
    const player =
      await client.users.fetch(playerId).catch(() => null);

    let dmSent = false;

    if (player) {
      try {
        await player.send({
          embeds: [
            new EmbedBuilder()
              .setTitle("📋 Your Ticket Transcript")
              .setDescription(
                `Your transcript from **${channel.name}** is attached below.`
              )
              .setColor(0x5865f2)
              .setTimestamp()
          ],
          files: [
            {
              attachment: transcript.filePath,
              name: transcript.fileName
            }
          ]
        });

        dmSent = true;

      } catch (err) {
        console.log(
          `⚠️ Could not DM transcript to ${playerId}`
        );
      }
    }

    return {
      success: true,
      dmSent,
      transcript
    };

  } catch (err) {
    console.error(
      "❌ Transcript error:",
      err
    );

    return {
      success: false
    };
  }
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
    const rest =
      new REST({ version: "10" }).setToken(TOKEN);

    await rest.put(
      Routes.applicationGuildCommands(
        client.user.id,
        GUILD_ID
      ),
      { body: commands }
    );

    console.log("📦 Commands registered");

  } catch (err) {
    console.error(
      "❌ Command registration failed:",
      err
    );
  }
});

// ===== PANEL =====
function createPanelEmbed() {
  return new EmbedBuilder()
    .setTitle("🎮 Testing Queue")
    .setDescription(
      "Join the queue to get tested."
    )
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

// ===== CLOSED TICKET BUTTONS =====
function createClosedTicketButtons() {
  return new ActionRowBuilder().addComponents(

    new ButtonBuilder()
      .setCustomId("open_ticket")
      .setLabel("Open Ticket")
      .setEmoji("🔓")
      .setStyle(ButtonStyle.Success),

    new ButtonBuilder()
      .setCustomId("force_transcript")
      .setLabel("Force Transcript")
      .setEmoji("📄")
      .setStyle(ButtonStyle.Secondary),

    new ButtonBuilder()
      .setCustomId("delete_ticket")
      .setLabel("Delete Ticket")
      .setEmoji("🗑️")
      .setStyle(ButtonStyle.Danger)

  );
}

// ===== INTERACTIONS =====
client.on(
  Events.InteractionCreate,
  async interaction => {

    try {

      // ===== /panel =====
      if (
        interaction.isChatInputCommand() &&
        interaction.commandName === "panel"
      ) {

        return interaction.reply({
          embeds: [
            createPanelEmbed()
          ],
          components: [
            createPanelButtons()
          ]
        });
      }

      // ===== JOIN QUEUE =====
      if (
        interaction.isButton() &&
        interaction.customId === "join_queue"
      ) {

        await interaction.deferReply({
          ephemeral: true
        });

        if (
          queue.some(
            user =>
              user.id === interaction.user.id
          )
        ) {

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

        await interaction.deferReply({
          ephemeral: true
        });

        const index =
          queue.findIndex(
            user =>
              user.id === interaction.user.id
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

        if (
          !interaction.member.roles.cache.has(
            TESTER_ROLE_ID
          )
        ) {

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

        const nextPlayer =
          queue.shift();

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

        const channel =
          await interaction.guild.channels.create({

            name: `test-${nextPlayer.id}`,

            type: ChannelType.GuildText,

            permissionOverwrites: [

              {
                id:
                  interaction.guild.roles.everyone.id,

                deny: [
                  PermissionFlagsBits.ViewChannel
                ]
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

                allow: [
                  PermissionFlagsBits.ViewChannel
                ]
              }

            ]
          });

        activeTests.set(
          nextPlayer.id,
          {
            tester:
              interaction.user.id,

            closed: false
          }
        );

        const buttons =
          new ActionRowBuilder()
            .addComponents(

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

          components: [
            buttons
          ]

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

        await interaction.deferReply({
          ephemeral: true
        });

        const testEntry =
          [...activeTests.entries()]
            .find(
              ([_, data]) =>
                data.tester ===
                interaction.user.id
            );

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

        const [playerId] =
          testEntry;

        const rank =
          interaction.options.getString(
            "rank"
          );

        const resultsChannel =
          interaction.guild.channels.cache.get(
            RESULTS_CHANNEL_ID
          );

        if (resultsChannel) {

          await resultsChannel.send({

            embeds: [
              new EmbedBuilder()
                .setTitle("🏆 Test Result")
                .setColor(0x00ff00)
                .addFields(

                  {
                    name: "Player",
                    value:
                      `<@${playerId}>`,
                    inline: true
                  },

                  {
                    name: "Tester",
                    value:
                      `<@${interaction.user.id}>`,
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

        const testerLogs =
          interaction.guild.channels.cache.get(
            TESTER_LOGS_CHANNEL_ID
          );

        if (testerLogs) {

          await testerLogs.send({

            embeds: [
              new EmbedBuilder()
                .setTitle(
                  "🟢 Successful Test"
                )
                .setColor(0x00ff00)
                .addFields(

                  {
                    name: "Player",
                    value:
                      `<@${playerId}>`,
                    inline: true
                  },

                  {
                    name: "Tester",
                    value:
                      `<@${interaction.user.id}>`,
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

        activeTests.delete(
          playerId
        );

        await interaction.editReply({

          embeds: [
            createEmbed(
              "✅ Test Finished",
              "The test has been successfully completed.",
              0x00ff00
            )
          ]

        });

        // NOTE:
        // The channel is NOT deleted here anymore.
        // Staff can close/delete it manually.

        await interaction.channel.send({

          embeds: [
            createEmbed(
              "🏆 Test Completed",
              `<@${playerId}> has received **${rank}**.`,
              0x00ff00
            )
          ]

        });
      }

      // ===== STOP TEST =====
      if (
        interaction.isButton() &&
        interaction.customId === "stop_test"
      ) {

        await interaction.deferReply({
          ephemeral: true
        });

        const testEntry =
          [...activeTests.entries()]
            .find(
              ([_, data]) =>
                data.tester ===
                interaction.user.id
            );

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

        const [playerId] =
          testEntry;

        const testerLogs =
          interaction.guild.channels.cache.get(
            TESTER_LOGS_CHANNEL_ID
          );

        if (testerLogs) {

          await testerLogs.send({

            embeds: [
              new EmbedBuilder()
                .setTitle(
                  "🛑 Test Cancelled"
                )
                .setColor(0xff0000)
                .addFields(

                  {
                    name: "Tester",
                    value:
                      `<@${interaction.user.id}>`,
                    inline: true
                  },

                  {
                    name: "Player",
                    value:
                      `<@${playerId}>`,
                    inline: true
                  }

                )
                .setTimestamp()
            ]

          });
        }

        activeTests.delete(
          playerId
        );

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

          interaction.channel.delete()
            .catch(() => {});

        }, 2000);

      }

      // =====================================================
      // CLOSE TICKET
      // =====================================================

      if (
        interaction.isButton() &&
        interaction.customId === "close_ticket"
      ) {

        await interaction.deferReply({
          ephemeral: true
        });

        const testEntry =
          [...activeTests.entries()]
            .find(
              ([playerId, data]) =>
                interaction.channel.name ===
                `test-${playerId}`
            );

        if (!testEntry) {

          return interaction.editReply({

            embeds: [
              createEmbed(
                "❌ Error",
                "This ticket could not be found.",
                0xff0000
              )
            ]

          });
        }

        const [playerId, testData] =
          testEntry;

        // Only tester can close
        if (
          testData.tester !==
          interaction.user.id
        ) {

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

        // Create transcript
        const transcriptResult =
          await sendTranscript(
            interaction.channel,
            playerId,
            testData.tester
          );

        // Mark closed
        activeTests.set(
          playerId,
          {
            ...testData,
            closed: true
          }
        );

        // Lock player and tester
        await interaction.channel.permissionOverwrites.edit(
          playerId,
          {
            ViewChannel: true,
            SendMessages: false
          }
        );

        await interaction.channel.permissionOverwrites.edit(
          testData.tester,
          {
            ViewChannel: true,
            SendMessages: false
          }
        );

        // Closed embed
        const dmStatus =
          transcriptResult.dmSent
            ? "sent to the player"
            : "could not be DM'd to the player";

        await interaction.channel.send({

          embeds: [

            new EmbedBuilder()
              .setTitle("🔒 Ticket Closed")
              .setDescription(
                `This ticket has been closed.\n\n` +
                `📄 The transcript has been **${dmStatus}**.\n` +
                `💾 The transcript has been **saved in the transcript channel**.\n\n` +
                `Use the buttons below to manage this ticket.`
              )
              .setColor(0xff9900)
              .setTimestamp()

          ],

          components: [
            createClosedTicketButtons()
          ]

        });

        return interaction.editReply({

          embeds: [
            createEmbed(
              "✅ Ticket Closed",
              "The ticket has been closed and the transcript has been saved.",
              0x00ff00
            )
          ]

        });
      }

      // =====================================================
      // OPEN TICKET
      // =====================================================

      if (
        interaction.isButton() &&
        interaction.customId === "open_ticket"
      ) {

        await interaction.deferReply({
          ephemeral: true
        });

        const testEntry =
          [...activeTests.entries()]
            .find(
              ([playerId]) =>
                interaction.channel.name ===
                `test-${playerId}`
            );

        if (!testEntry) {

          return interaction.editReply({

            embeds: [
              createEmbed(
                "❌ Error",
                "This ticket could not be found.",
                0xff0000
              )
            ]

          });
        }

        const [playerId, testData] =
          testEntry;

        // Tester only
        if (
          testData.tester !==
          interaction.user.id
        ) {

          return interaction.editReply({

            embeds: [
              createEmbed(
                "❌ Permission Denied",
                "Only the tester can reopen this ticket.",
                0xff0000
              )
            ]

          });
        }

        await interaction.channel.permissionOverwrites.edit(
          playerId,
          {
            ViewChannel: true,
            SendMessages: true
          }
        );

        await interaction.channel.permissionOverwrites.edit(
          testData.tester,
          {
            ViewChannel: true,
            SendMessages: true
          }
        );

        activeTests.set(
          playerId,
          {
            ...testData,
            closed: false
          }
        );

        await interaction.channel.send({

          embeds: [
            createEmbed(
              "🔓 Ticket Reopened",
              `<@${playerId}> and <@${testData.tester}> can now send messages again.`,
              0x00ff00
            )
          ]

        });

        return interaction.editReply({

          embeds: [
            createEmbed(
              "✅ Ticket Reopened",
              "The ticket has been reopened.",
              0x00ff00
            )
          ]

        });
      }

      // =====================================================
      // FORCE TRANSCRIPT
      // =====================================================

      if (
        interaction.isButton() &&
        interaction.customId === "force_transcript"
      ) {

        await interaction.deferReply({
          ephemeral: true
        });

        const testEntry =
          [...activeTests.entries()]
            .find(
              ([playerId]) =>
                interaction.channel.name ===
                `test-${playerId}`
            );

        if (!testEntry) {

          return interaction.editReply({

            embeds: [
              createEmbed(
                "❌ Error",
                "This ticket could not be found.",
                0xff0000
              )
            ]

          });
        }

        const [playerId, testData] =
          testEntry;

        if (
          !interaction.member.roles.cache.has(
            TESTER_ROLE_ID
          )
        ) {

          return interaction.editReply({

            embeds: [
              createEmbed(
                "❌ Permission Denied",
                "Only testers can force a transcript.",
                0xff0000
              )
            ]

          });
        }

        const result =
          await sendTranscript(
            interaction.channel,
            playerId,
            testData.tester
          );

        if (!result.success) {

          return interaction.editReply({

            embeds: [
              createEmbed(
                "❌ Transcript Failed",
                "The transcript could not be saved.",
                0xff0000
              )
            ]

          });
        }

        return interaction.editReply({

          embeds: [
            createEmbed(
              "📄 Transcript Saved",
              "A new transcript has been saved in the transcript channel.",
              0x00ff00
            )
          ]

        });
      }

      // =====================================================
      // DELETE TICKET
      // =====================================================

      if (
        interaction.isButton() &&
        interaction.customId === "delete_ticket"
      ) {

        await interaction.deferReply({
          ephemeral: true
        });

        if (
          !interaction.member.roles.cache.has(
            TESTER_ROLE_ID
          )
        ) {

          return interaction.editReply({

            embeds: [
              createEmbed(
                "❌ Permission Denied",
                "Only testers can delete tickets.",
                0xff0000
              )
            ]

          });
        }

        await interaction.editReply({

          embeds: [
            createEmbed(
              "🗑️ Deleting Ticket",
              "The ticket will be permanently deleted.",
              0xff0000
            )
          ]

        });

        setTimeout(() => {

          interaction.channel.delete()
            .catch(() => {});

        }, 1500);

      }

    } catch (err) {

      console.error(
        "❌ INTERACTION ERROR:",
        err
      );

      const errorEmbed =
        createEmbed(
          "❌ Something Went Wrong",
          "An unexpected error occurred while processing your request.",
          0xff0000
        );

      if (
        interaction.deferred ||
        interaction.replied
      ) {

        interaction.followUp({

          embeds: [
            errorEmbed
          ],

          ephemeral: true

        }).catch(() => {});

      } else {

        interaction.reply({

          embeds: [
            errorEmbed
          ],

          ephemeral: true

        }).catch(() => {});

      }

    }

  }
);

// ===== LOGIN =====
client.login(TOKEN);
