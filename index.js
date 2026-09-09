require("dotenv").config();

const {
  Client,
  GatewayIntentBits,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  AttachmentBuilder,
  PermissionsBitField,
} = require("discord.js");

const express = require("express");
const fs = require("fs");
const path = require("path");

// ============================================================
// CONFIG
// ============================================================

const TOKEN = process.env.TOKEN;
const GUILD_ID = process.env.GUILD_ID;
const TESTER_ROLE_ID = process.env.TESTER_ROLE_ID;
const RESULTS_CHANNEL_ID = process.env.RESULTS_CHANNEL_ID;
const TESTER_LOGS_CHANNEL_ID = process.env.TESTER_LOGS_CHANNEL_ID;
const TICKET_LOGS_CHANNEL_ID = process.env.TICKET_LOGS_CHANNEL_ID;

// Channel where HTML transcripts are stored
const TRANSCRIPT_CHANNEL_ID = "1547279794800955392";

// ============================================================
// CLIENT
// ============================================================

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMembers,
  ],
});

// ============================================================
// EXPRESS SERVER
// ============================================================

const app = express();

app.get("/", (req, res) => {
  res.send("Bot is alive");
});

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`🌐 Web server running on port ${PORT}`);
});

// ============================================================
// DATA
// ============================================================

// Players waiting to be tested
const queue = [];

// playerId => test data
//
// Example:
// {
//   player: "123",
//   tester: "456",
//   claimedAt: Date,
//   closed: false,
//   finished: false
// }
const activeTests = new Map();

// Message used for the queue panel
let queuePanelMessage = null;

// ============================================================
// EMBEDS
// ============================================================

function createEmbed(title, description, color = 0x5865f2) {
  return new EmbedBuilder()
    .setTitle(title)
    .setDescription(description)
    .setColor(color)
    .setTimestamp();
}

// ============================================================
// QUEUE PANEL
// ============================================================

function createPanelEmbed() {
  const count = queue.length;

  return new EmbedBuilder()
    .setTitle("🧪 Testing Queue")
    .setDescription(
      "Join the queue to be tested by one of our testers.\n\n" +
        "Click **Join Queue** to enter the queue or **Leave Queue** to remove yourself."
    )
    .addFields({
      name: "👥 Players in Queue",
      value: `**${count}**`,
      inline: true,
    })
    .setColor(0x5865f2)
    .setTimestamp();
}

function createPanelButtons() {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId("join_queue")
      .setLabel("Join Queue")
      .setEmoji("➕")
      .setStyle(ButtonStyle.Success),

    new ButtonBuilder()
      .setCustomId("leave_queue")
      .setLabel("Leave Queue")
      .setEmoji("➖")
      .setStyle(ButtonStyle.Danger)
  );
}

async function updateQueuePanel() {
  if (!queuePanelMessage) return;

  try {
    await queuePanelMessage.edit({
      embeds: [createPanelEmbed()],
      components: [createPanelButtons()],
    });
  } catch (error) {
    console.error("❌ Failed to update queue panel:", error);
  }
}

// ============================================================
// TESTER CHECK
// ============================================================

function isTester(interaction) {
  return interaction.member?.roles?.cache?.has(TESTER_ROLE_ID);
}

// ============================================================
// ACTIVE TEST CHECK
// ============================================================

function getActiveTestForTester(testerId) {
  return [...activeTests.entries()].find(
    ([playerId, data]) =>
      data.tester === testerId && data.closed === false
  );
}

// ============================================================
// HTML ESCAPING
// ============================================================

function escapeHTML(text) {
  if (!text) return "";

  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

// ============================================================
// CREATE HTML TRANSCRIPT
// ============================================================

async function createTranscript(channel, playerId, testerId) {
  console.log(`📄 Creating transcript for ${channel.name}`);

  let messages = [];
  let lastId;

  while (true) {
    const options = {
      limit: 100,
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

  // Oldest first
  messages.reverse();

  const player = await client.users.fetch(playerId).catch(() => null);
  const tester = await client.users.fetch(testerId).catch(() => null);

  const generatedAt = new Date().toLocaleString("en-GB");

  let messageHTML = "";

  for (const message of messages) {
    const username = escapeHTML(message.author.username);
    const displayName = escapeHTML(
      message.member?.displayName || message.author.username
    );

    const timestamp = new Date(message.createdTimestamp).toLocaleString(
      "en-GB"
    );

    let content = escapeHTML(message.content || "");

    // Attachments
    if (message.attachments.size > 0) {
      for (const attachment of message.attachments.values()) {
        content += `
          <div class="attachment">
            📎 <a href="${escapeHTML(
              attachment.url
            )}" target="_blank">${escapeHTML(
          attachment.name || "Attachment"
        )}</a>
          </div>
        `;
      }
    }

    // Embeds
    if (message.embeds.length > 0) {
      for (const embed of message.embeds) {
        if (embed.title) {
          content += `<div class="discord-embed"><strong>${escapeHTML(
            embed.title
          )}</strong></div>`;
        }

        if (embed.description) {
          content += `<div class="discord-embed">${escapeHTML(
            embed.description
          )}</div>`;
        }
      }
    }

    messageHTML += `
      <div class="message">
        <div class="avatar">
          ${
            message.author.displayAvatarURL
              ? `<img src="${message.author.displayAvatarURL({
                  extension: "png",
                  size: 64,
                })}" />`
              : ""
          }
        </div>

        <div class="message-content">
          <div class="message-header">
            <span class="username">${displayName}</span>
            <span class="tag">@${username}</span>
            <span class="timestamp">${timestamp}</span>
          </div>

          <div class="content">
            ${content || "<em>No message content</em>"}
          </div>
        </div>
      </div>
    `;
  }

  const html = `
<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">

<meta name="viewport" content="width=device-width, initial-scale=1.0">

<title>Ticket Transcript - ${escapeHTML(channel.name)}</title>

<style>

* {
  box-sizing: border-box;
}

body {
  margin: 0;
  background: #313338;
  color: #dbdee1;
  font-family: Arial, Helvetica, sans-serif;
}

.container {
  max-width: 1100px;
  margin: 0 auto;
  padding: 30px;
}

.header {
  background: #2b2d31;
  padding: 25px;
  border-radius: 8px;
  margin-bottom: 20px;
}

.header h1 {
  margin: 0 0 15px 0;
  color: white;
}

.info {
  color: #b5bac1;
  line-height: 1.7;
}

.info strong {
  color: #ffffff;
}

.message {
  display: flex;
  gap: 15px;
  padding: 10px 15px;
  border-radius: 5px;
}

.message:hover {
  background: #2e3035;
}

.avatar img {
  width: 40px;
  height: 40px;
  border-radius: 50%;
}

.message-content {
  flex: 1;
}

.message-header {
  display: flex;
  align-items: baseline;
  gap: 8px;
  flex-wrap: wrap;
}

.username {
  color: white;
  font-weight: bold;
}

.tag {
  color: #949ba4;
  font-size: 12px;
}

.timestamp {
  color: #949ba4;
  font-size: 11px;
}

.content {
  margin-top: 3px;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  line-height: 1.4;
}

.attachment {
  margin-top: 8px;
  padding: 8px;
  background: #2b2d31;
  border-radius: 4px;
}

.attachment a {
  color: #00aff4;
  text-decoration: none;
}

.discord-embed {
  margin-top: 8px;
  padding: 10px;
  border-left: 4px solid #5865f2;
  background: #2b2d31;
  border-radius: 4px;
}

.footer {
  margin-top: 30px;
  text-align: center;
  color: #949ba4;
  font-size: 12px;
}

</style>
</head>

<body>

<div class="container">

  <div class="header">

    <h1>🧪 Ticket Transcript</h1>

    <div class="info">
      <strong>Ticket:</strong> ${escapeHTML(channel.name)}<br>
      <strong>Player:</strong> ${
        escapeHTML(player?.username || playerId)
      }<br>
      <strong>Tester:</strong> ${
        escapeHTML(tester?.username || testerId)
      }<br>
      <strong>Messages:</strong> ${messages.length}<br>
      <strong>Generated:</strong> ${generatedAt}
    </div>

  </div>

  ${messageHTML}

  <div class="footer">
    Transcript generated by the testing bot.
  </div>

</div>

</body>
</html>
`;

  const transcriptDirectory = path.join(__dirname, "transcripts");

  if (!fs.existsSync(transcriptDirectory)) {
    fs.mkdirSync(transcriptDirectory, {
      recursive: true,
    });
  }

  const safeName = channel.name.replace(/[^a-zA-Z0-9-_]/g, "_");

  const fileName = `${safeName}-${Date.now()}.html`;

  const filePath = path.join(transcriptDirectory, fileName);

  fs.writeFileSync(filePath, html, "utf8");

  console.log(`✅ Transcript created: ${filePath}`);

  return {
    filePath,
    fileName,
  };
}

// ============================================================
// SEND TRANSCRIPT
// ============================================================

async function sendTranscript(channel, playerId, testerId) {
  const { filePath, fileName } = await createTranscript(
    channel,
    playerId,
    testerId
  );

  let savedToChannel = false;
  let sentToPlayer = false;

  // ----------------------------------------------------------
  // Save transcript to transcript channel
  // ----------------------------------------------------------

  try {
    const transcriptChannel = await client.channels.fetch(
      TRANSCRIPT_CHANNEL_ID
    );

    if (transcriptChannel) {
      const attachment = new AttachmentBuilder(filePath).setName(
        fileName
      );

      await transcriptChannel.send({
        embeds: [
          createEmbed(
            "📄 Ticket Transcript",
            `Transcript saved for **${channel.name}**.\n\n` +
              `👤 Player: <@${playerId}>\n` +
              `🧪 Tester: <@${testerId}>`,
            0x5865f2
          ),
        ],
        files: [attachment],
      });

      savedToChannel = true;
    }
  } catch (error) {
    console.error("❌ Failed to save transcript:", error);
  }

  // ----------------------------------------------------------
  // DM transcript to player
  // ----------------------------------------------------------

  try {
    const player = await client.users.fetch(playerId);

    const attachment = new AttachmentBuilder(filePath).setName(
      fileName
    );

    await player.send({
      embeds: [
        createEmbed(
          "📄 Test Transcript",
          `Your test ticket transcript has been generated.\n\n` +
            `🧪 Tester: <@${testerId}>\n` +
            `🎫 Ticket: **${channel.name}**`,
          0x5865f2
        ),
      ],
      files: [attachment],
    });

    sentToPlayer = true;
  } catch (error) {
    console.error("❌ Failed to DM transcript to player:", error);
  }

  // ----------------------------------------------------------
  // Delete temporary file
  // ----------------------------------------------------------

  try {
    fs.unlinkSync(filePath);
  } catch (error) {
    console.error("⚠️ Failed to delete temporary transcript:", error);
  }

  return {
    savedToChannel,
    sentToPlayer,
  };
}

// ============================================================
// CLOSED TICKET BUTTONS
// ============================================================

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

// ============================================================
// BOT READY
// ============================================================

client.once("ready", async () => {
  console.log(`✅ Logged in as ${client.user.tag}`);
  console.log(`👥 Queue currently contains ${queue.length} players`);
});

// ============================================================
// SLASH COMMANDS
// ============================================================

client.on("interactionCreate", async (interaction) => {
  try {
    // ========================================================
    // SLASH COMMANDS
    // ========================================================

    if (interaction.isChatInputCommand()) {
      // ------------------------------------------------------
      // /panel
      // ------------------------------------------------------

      if (interaction.commandName === "panel") {
        if (!isTester(interaction)) {
          return interaction.reply({
            embeds: [
              createEmbed(
                "❌ No Permission",
                "You need the tester role to use this command.",
                0xff0000
              ),
            ],
            ephemeral: true,
          });
        }

        const message = await interaction.reply({
          embeds: [createPanelEmbed()],
          components: [createPanelButtons()],
          fetchReply: true,
        });

        queuePanelMessage = message;

        return;
      }

      // ------------------------------------------------------
      // /claim
      // ------------------------------------------------------

      if (interaction.commandName === "claim") {
        if (!isTester(interaction)) {
          return interaction.reply({
            embeds: [
              createEmbed(
                "❌ No Permission",
                "You need the tester role to use this command.",
                0xff0000
              ),
            ],
            ephemeral: true,
          });
        }

        // Check if tester is already testing someone
        const existingTest = getActiveTestForTester(
          interaction.user.id
        );

        if (existingTest) {
          const [existingPlayerId, existingData] = existingTest;

          return interaction.reply({
            embeds: [
              createEmbed(
                "❌ Already Testing",
                `You are already testing <@${existingPlayerId}>.\n\n` +
                  `You must **finish and close your current ticket** before claiming another player.`,
                0xff0000
              ),
            ],
            ephemeral: true,
          });
        }

        // Check queue
        if (queue.length === 0) {
          return interaction.reply({
            embeds: [
              createEmbed(
                "❌ Queue Empty",
                "There are currently no players waiting in the queue.",
                0xff0000
              ),
            ],
            ephemeral: true,
          });
        }

        // Get next player
        const playerId = queue.shift();

        // Update panel
        await updateQueuePanel();

        // Get guild
        const guild = await client.guilds.fetch(GUILD_ID);

        // Create ticket
        const ticketChannel = await guild.channels.create({
          name: `test-${playerId}`,
          type: 0,

          permissionOverwrites: [
            {
              id: guild.roles.everyone.id,
              deny: [
                PermissionsBitField.Flags.ViewChannel,
              ],
            },

            {
              id: playerId,
              allow: [
                PermissionsBitField.Flags.ViewChannel,
                PermissionsBitField.Flags.SendMessages,
                PermissionsBitField.Flags.ReadMessageHistory,
              ],
            },

            {
              id: interaction.user.id,
              allow: [
                PermissionsBitField.Flags.ViewChannel,
                PermissionsBitField.Flags.SendMessages,
                PermissionsBitField.Flags.ReadMessageHistory,
              ],
            },

            {
              id: client.user.id,
              allow: [
                PermissionsBitField.Flags.ViewChannel,
                PermissionsBitField.Flags.SendMessages,
                PermissionsBitField.Flags.ReadMessageHistory,
                PermissionsBitField.Flags.ManageChannels,
              ],
            },
          ],
        });

        // Store active test
        activeTests.set(playerId, {
          player: playerId,
          tester: interaction.user.id,
          claimedAt: new Date(),
          closed: false,
          finished: false,
        });

        // Ticket message
        const ticketEmbed = createEmbed(
          "🧪 Test Ticket",
          `Welcome <@${playerId}>!\n\n` +
            `Your tester is <@${interaction.user.id}>.\n\n` +
            `Your test can now begin. Good luck!`,
          0x5865f2
        );

        const buttons = new ActionRowBuilder().addComponents(
          new ButtonBuilder()
            .setCustomId("close_ticket")
            .setLabel("Close Ticket")
            .setEmoji("🔒")
            .setStyle(ButtonStyle.Secondary)
        );

        await ticketChannel.send({
          embeds: [ticketEmbed],
          components: [buttons],
        });

        // Tester response
        await interaction.reply({
          embeds: [
            createEmbed(
              "✅ Test Claimed",
              `You are now testing <@${playerId}>.\n\n` +
                `🎫 Ticket: ${ticketChannel}\n\n` +
                `You cannot claim another player until this ticket is closed.`,
              0x00ff00
            ),
          ],
          ephemeral: true,
        });

        return;
      }

      // ------------------------------------------------------
      // /finish
      // ------------------------------------------------------

      if (interaction.commandName === "finish") {
        if (!isTester(interaction)) {
          return interaction.reply({
            embeds: [
              createEmbed(
                "❌ No Permission",
                "You need the tester role to use this command.",
                0xff0000
              ),
            ],
            ephemeral: true,
          });
        }

        // Find only OPEN test
        const activeTest = [...activeTests.entries()].find(
          ([playerId, data]) =>
            data.tester === interaction.user.id &&
            data.closed === false
        );

        if (!activeTest) {
          return interaction.reply({
            embeds: [
              createEmbed(
                "❌ No Active Test",
                "You are not currently testing a player.",
                0xff0000
              ),
            ],
            ephemeral: true,
          });
        }

        const [playerId, testData] = activeTest;

        const rank = interaction.options.getString("rank");

        // Mark test as finished, but DO NOT remove it.
        // The ticket remains active until it is closed.
        activeTests.set(playerId, {
          ...testData,
          finished: true,
          finishedAt: new Date(),
          rank,
        });

        // Results channel
        try {
          const resultsChannel = await client.channels.fetch(
            RESULTS_CHANNEL_ID
          );

          await resultsChannel.send({
            embeds: [
              createEmbed(
                "🏆 Test Result",
                `👤 **Player:** <@${playerId}>\n` +
                  `🧪 **Tester:** <@${interaction.user.id}>\n` +
                  `📊 **Rank:** ${rank}`,
                0x00ff00
              ),
            ],
          });
        } catch (error) {
          console.error(
            "❌ Failed to send result:",
            error
          );
        }

        // Tester logs
        try {
          const logsChannel = await client.channels.fetch(
            TESTER_LOGS_CHANNEL_ID
          );

          await logsChannel.send({
            embeds: [
              createEmbed(
                "🧪 Test Completed",
                `Tester <@${interaction.user.id}> completed a test.\n\n` +
                  `👤 Player: <@${playerId}>\n` +
                  `📊 Rank: ${rank}`,
                0x00ff00
              ),
            ],
          });
        } catch (error) {
          console.error(
            "❌ Failed to send tester log:",
            error
          );
        }

        // Ticket channel
        try {
          const ticketChannel = await client.channels.fetch(
            interaction.channelId
          );

          await ticketChannel.send({
            embeds: [
              createEmbed(
                "🏆 Test Completed",
                `The test has been completed.\n\n` +
                  `📊 **Rank:** ${rank}\n\n` +
                  `The tester can now review the ticket and close it when ready.`,
                0x00ff00
              ),
            ],
          });
        } catch (error) {
          console.error(
            "❌ Failed to send ticket result:",
            error
          );
        }

        return interaction.reply({
          embeds: [
            createEmbed(
              "✅ Test Finished",
              `The test for <@${playerId}> has been marked as finished.\n\n` +
                `📊 **Rank:** ${rank}\n\n` +
                `You are still assigned to this ticket until you close it.`,
              0x00ff00
            ),
          ],
          ephemeral: true,
        });
      }
    }

    // ========================================================
    // BUTTONS
    // ========================================================

    if (interaction.isButton()) {
      // ------------------------------------------------------
      // JOIN QUEUE
      // ------------------------------------------------------

      if (interaction.customId === "join_queue") {
        // Already in queue
        if (queue.includes(interaction.user.id)) {
          return interaction.reply({
            embeds: [
              createEmbed(
                "❌ Already in Queue",
                "You are already waiting in the testing queue.",
                0xff0000
              ),
            ],
            ephemeral: true,
          });
        }

        // Already being tested
        if (activeTests.has(interaction.user.id)) {
          return interaction.reply({
            embeds: [
              createEmbed(
                "❌ Already Have a Test",
                "You already have a testing ticket and cannot join the queue.",
                0xff0000
              ),
            ],
            ephemeral: true,
          });
        }

        queue.push(interaction.user.id);

        const position = queue.indexOf(interaction.user.id) + 1;

        await updateQueuePanel();

        return interaction.reply({
          embeds: [
            createEmbed(
              "✅ Joined Queue",
              `You have been added to the testing queue.\n\n` +
                `📍 **Position:** ${position}\n` +
                `👥 **Players waiting:** ${queue.length}`,
              0x00ff00
            ),
          ],
          ephemeral: true,
        });
      }

      // ------------------------------------------------------
      // LEAVE QUEUE
      // ------------------------------------------------------

      if (interaction.customId === "leave_queue") {
        const index = queue.indexOf(interaction.user.id);

        if (index === -1) {
          return interaction.reply({
            embeds: [
              createEmbed(
                "❌ Not in Queue",
                "You are not currently in the testing queue.",
                0xff0000
              ),
            ],
            ephemeral: true,
          });
        }

        queue.splice(index, 1);

        await updateQueuePanel();

        return interaction.reply({
          embeds: [
            createEmbed(
              "✅ Left Queue",
              "You have been removed from the testing queue.",
              0x00ff00
            ),
          ],
          ephemeral: true,
        });
      }

      // ------------------------------------------------------
      // CLOSE TICKET
      // ------------------------------------------------------

      if (interaction.customId === "close_ticket") {
        const playerId = interaction.channel.name.replace(
          "test-",
          ""
        );

        const testData = activeTests.get(playerId);

        if (!testData) {
          return interaction.reply({
            embeds: [
              createEmbed(
                "❌ Test Not Found",
                "I couldn't find the test information for this ticket.",
                0xff0000
              ),
            ],
            ephemeral: true,
          });
        }

        // Only assigned tester can close
        if (testData.tester !== interaction.user.id) {
          return interaction.reply({
            embeds: [
              createEmbed(
                "❌ Not Your Ticket",
                "Only the tester assigned to this ticket can close it.",
                0xff0000
              ),
            ],
            ephemeral: true,
          });
        }

        // Already closed
        if (testData.closed) {
          return interaction.reply({
            embeds: [
              createEmbed(
                "❌ Already Closed",
                "This ticket is already closed.",
                0xff0000
              ),
            ],
            ephemeral: true,
          });
        }

        await interaction.deferReply({
          ephemeral: true,
        });

        // Generate and send transcript
        const transcriptResult = await sendTranscript(
          interaction.channel,
          playerId,
          testData.tester
        );

        // Mark closed
        activeTests.set(playerId, {
          ...testData,
          closed: true,
          closedAt: new Date(),
        });

        // Lock player and tester
        try {
          await interaction.channel.permissionOverwrites.edit(
            playerId,
            {
              SendMessages: false,
            }
          );

          await interaction.channel.permissionOverwrites.edit(
            testData.tester,
            {
              SendMessages: false,
            }
          );
        } catch (error) {
          console.error(
            "❌ Failed to lock ticket:",
            error
          );
        }

        let transcriptStatus = "";

        if (transcriptResult.sentToPlayer) {
          transcriptStatus += "📨 Transcript sent to the player.\n";
        } else {
          transcriptStatus +=
            "⚠️ The transcript could not be DM'd to the player.\n";
        }

        if (transcriptResult.savedToChannel) {
          transcriptStatus +=
            "📁 Transcript saved in the transcript channel.";
        } else {
          transcriptStatus +=
            "⚠️ The transcript could not be saved in the transcript channel.";
        }

        // Closed message
        await interaction.channel.send({
          embeds: [
            createEmbed(
              "🔒 Ticket Closed",
              `This ticket has been closed.\n\n` +
                `${transcriptStatus}\n\n` +
                `The ticket is now locked.\n` +
                `Use the buttons below to manage it.`,
              0xffa500
            ),
          ],
          components: [createClosedTicketButtons()],
        });

        return interaction.editReply({
          embeds: [
            createEmbed(
              "✅ Ticket Closed",
              `The ticket for <@${playerId}> has been closed successfully.\n\n` +
                `You can now claim another player.`,
              0x00ff00
            ),
          ],
        });
      }

      // ------------------------------------------------------
      // OPEN TICKET
      // ------------------------------------------------------

      if (interaction.customId === "open_ticket") {
        if (!isTester(interaction)) {
          return interaction.reply({
            embeds: [
              createEmbed(
                "❌ No Permission",
                "You need the tester role to open tickets.",
                0xff0000
              ),
            ],
            ephemeral: true,
          });
        }

        const playerId = interaction.channel.name.replace(
          "test-",
          ""
        );

        const testData = activeTests.get(playerId);

        if (!testData) {
          return interaction.reply({
            embeds: [
              createEmbed(
                "❌ Test Not Found",
                "I couldn't find the test information for this ticket.",
                0xff0000
              ),
            ],
            ephemeral: true,
          });
        }

        if (testData.tester !== interaction.user.id) {
          return interaction.reply({
            embeds: [
              createEmbed(
                "❌ Not Your Ticket",
                "Only the assigned tester can reopen this ticket.",
                0xff0000
              ),
            ],
            ephemeral: true,
          });
        }

        // Make sure tester isn't already testing another player
        const anotherActiveTest = [...activeTests.entries()].find(
          ([otherPlayerId, data]) =>
            otherPlayerId !== playerId &&
            data.tester === interaction.user.id &&
            data.closed === false
        );

        if (anotherActiveTest) {
          const [otherPlayerId] = anotherActiveTest;

          return interaction.reply({
            embeds: [
              createEmbed(
                "❌ Already Testing",
                `You are already testing <@${otherPlayerId}>.\n\n` +
                  `You cannot reopen this ticket until your other active ticket is closed.`,
                0xff0000
              ),
            ],
            ephemeral: true,
          });
        }

        // Reopen
        activeTests.set(playerId, {
          ...testData,
          closed: false,
        });

        try {
          await interaction.channel.permissionOverwrites.edit(
            playerId,
            {
              ViewChannel: true,
              SendMessages: true,
              ReadMessageHistory: true,
            }
          );

          await interaction.channel.permissionOverwrites.edit(
            interaction.user.id,
            {
              ViewChannel: true,
              SendMessages: true,
              ReadMessageHistory: true,
            }
          );
        } catch (error) {
          console.error(
            "❌ Failed to reopen ticket:",
            error
          );
        }

        await interaction.channel.send({
          embeds: [
            createEmbed(
              "🔓 Ticket Reopened",
              `This ticket has been reopened by <@${interaction.user.id}>.\n\n` +
                `The player and tester can now send messages again.`,
              0x00ff00
            ),
          ],
          components: [
            new ActionRowBuilder().addComponents(
              new ButtonBuilder()
                .setCustomId("close_ticket")
                .setLabel("Close Ticket")
                .setEmoji("🔒")
                .setStyle(ButtonStyle.Secondary)
            ),
          ],
        });

        return interaction.reply({
          embeds: [
            createEmbed(
              "✅ Ticket Reopened",
              "The ticket has been reopened. You are now assigned to this test again.",
              0x00ff00
            ),
          ],
          ephemeral: true,
        });
      }

      // ------------------------------------------------------
      // FORCE TRANSCRIPT
      // ------------------------------------------------------

      if (interaction.customId === "force_transcript") {
        if (!isTester(interaction)) {
          return interaction.reply({
            embeds: [
              createEmbed(
                "❌ No Permission",
                "You need the tester role to generate transcripts.",
                0xff0000
              ),
            ],
            ephemeral: true,
          });
        }

        const playerId = interaction.channel.name.replace(
          "test-",
          ""
        );

        const testData = activeTests.get(playerId);

        if (!testData) {
          return interaction.reply({
            embeds: [
              createEmbed(
                "❌ Test Not Found",
                "I couldn't find the test information for this ticket.",
                0xff0000
              ),
            ],
            ephemeral: true,
          });
        }

        await interaction.deferReply({
          ephemeral: true,
        });

        const result = await sendTranscript(
          interaction.channel,
          playerId,
          testData.tester
        );

        let status = "";

        if (result.savedToChannel) {
          status += "📁 Saved to transcript channel.\n";
        } else {
          status +=
            "⚠️ Failed to save to transcript channel.\n";
        }

        if (result.sentToPlayer) {
          status += "📨 Sent to player.";
        } else {
          status +=
            "⚠️ Failed to DM player.";
        }

        return interaction.editReply({
          embeds: [
            createEmbed(
              "📄 Transcript Generated",
              status,
              result.savedToChannel
                ? 0x00ff00
                : 0xffa500
            ),
          ],
        });
      }

      // ------------------------------------------------------
      // DELETE TICKET
      // ------------------------------------------------------

      if (interaction.customId === "delete_ticket") {
        if (!isTester(interaction)) {
          return interaction.reply({
            embeds: [
              createEmbed(
                "❌ No Permission",
                "You need the tester role to delete tickets.",
                0xff0000
              ),
            ],
            ephemeral: true,
          });
        }

        const playerId = interaction.channel.name.replace(
          "test-",
          ""
        );

        const testData = activeTests.get(playerId);

        if (!testData) {
          return interaction.reply({
            embeds: [
              createEmbed(
                "❌ Test Not Found",
                "I couldn't find the test information for this ticket.",
                0xff0000
              ),
            ],
            ephemeral: true,
          });
        }

        await interaction.reply({
          embeds: [
            createEmbed(
              "🗑️ Deleting Ticket",
              "This ticket will be deleted shortly.",
              0xff0000
            ),
          ],
          ephemeral: true,
        });

        // Clean up stored test
        activeTests.delete(playerId);

        setTimeout(async () => {
          try {
            await interaction.channel.delete(
              "Ticket deleted by tester"
            );
          } catch (error) {
            console.error(
              "❌ Failed to delete ticket:",
              error
            );
          }
        }, 1500);

        return;
      }
    }
  } catch (error) {
    console.error("❌ Interaction error:", error);

    try {
      if (interaction.deferred || interaction.replied) {
        await interaction.followUp({
          embeds: [
            createEmbed(
              "❌ Error",
              "Something went wrong while processing that action.",
              0xff0000
            ),
          ],
          ephemeral: true,
        });
      } else {
        await interaction.reply({
          embeds: [
            createEmbed(
              "❌ Error",
              "Something went wrong while processing that action.",
              0xff0000
            ),
          ],
          ephemeral: true,
        });
      }
    } catch {
      // Ignore secondary errors
    }
  }
});

// ============================================================
// LOGIN
// ============================================================

client.login(TOKEN);
