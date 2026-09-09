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
  SlashCommandBuilder,
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

/*
activeTests

Key = ticket channel ID

Example:

{
  channelId: "123456789",
  playerId: "123456789",
  testerId: "987654321",
  playerUsername: "Eclipxal",
  claimedAt: Date,
  finished: false,
  rank: null,
  closed: false
}
*/

const activeTests = new Map();

// Queue panel message
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
// TESTER CHECK
// ============================================================

function isTester(interaction) {
  return interaction.member?.roles?.cache?.has(TESTER_ROLE_ID);
}

// ============================================================
// FIND TEST
// ============================================================

function getTestByChannel(channelId) {
  return activeTests.get(channelId);
}

function getTestByPlayer(playerId) {
  return [...activeTests.values()].find(
    (test) => test.playerId === playerId
  );
}

function getActiveTestForTester(testerId) {
  return [...activeTests.values()].find(
    (test) =>
      test.testerId === testerId &&
      test.closed === false
  );
}

// ============================================================
// TICKET NAME
// ============================================================

function createTicketName(username) {
  let safeUsername = username
    .toLowerCase()
    .replace(/[^a-z0-9-_]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");

  if (!safeUsername) {
    safeUsername = "player";
  }

  // Discord channel names cannot exceed 100 characters
  safeUsername = safeUsername.slice(0, 90);

  return `test-${safeUsername}`;
}

// ============================================================
// QUEUE PANEL
// ============================================================

function createPanelEmbed() {
  return new EmbedBuilder()
    .setTitle("🧪 Testing Queue")
    .setDescription(
      "Join the queue to be tested by one of our testers.\n\n" +
        "Click **Join Queue** to enter the queue.\n" +
        "Click **Leave Queue** to leave the queue."
    )
    .addFields({
      name: "👥 Players in Queue",
      value: `**${queue.length}**`,
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

    console.log(`📊 Queue panel updated: ${queue.length} players`);
  } catch (error) {
    console.error("❌ Failed to update queue panel:", error);
  }
}

// ============================================================
// TICKET BUTTONS
// ============================================================

function createOpenTicketButtons() {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId("close_ticket")
      .setLabel("Close Ticket")
      .setEmoji("🔒")
      .setStyle(ButtonStyle.Secondary)
  );
}

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
// HTML ESCAPING
// ============================================================

function escapeHTML(text) {
  if (!text) return "";

  return String(text)
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

    if (batch.size === 0) {
      break;
    }

    messages.push(...batch.values());

    lastId = batch.last().id;

    if (batch.size < 100) {
      break;
    }
  }

  // Oldest first
  messages.reverse();

  const player = await client.users
    .fetch(playerId)
    .catch(() => null);

  const tester = await client.users
    .fetch(testerId)
    .catch(() => null);

  const generatedAt = new Date().toLocaleString("en-GB");

  let messageHTML = "";

  for (const message of messages) {
    const username = escapeHTML(
      message.author.username
    );

    const displayName = escapeHTML(
      message.member?.displayName ||
        message.author.username
    );

    const timestamp = new Date(
      message.createdTimestamp
    ).toLocaleString("en-GB");

    let content = escapeHTML(
      message.content || ""
    );

    // Attachments
    if (message.attachments.size > 0) {
      for (const attachment of message.attachments.values()) {
        content += `
          <div class="attachment">
            📎
            <a href="${escapeHTML(
              attachment.url
            )}" target="_blank">
              ${escapeHTML(
                attachment.name || "Attachment"
              )}
            </a>
          </div>
        `;
      }
    }

    // Embeds
    if (message.embeds.length > 0) {
      for (const embed of message.embeds) {
        if (embed.title) {
          content += `
            <div class="discord-embed">
              <strong>${escapeHTML(
                embed.title
              )}</strong>
            </div>
          `;
        }

        if (embed.description) {
          content += `
            <div class="discord-embed">
              ${escapeHTML(
                embed.description
              )}
            </div>
          `;
        }
      }
    }

    messageHTML += `
      <div class="message">

        <div class="avatar">
          <img
            src="${message.author.displayAvatarURL({
              extension: "png",
              size: 64,
            })}"
          />
        </div>

        <div class="message-content">

          <div class="message-header">
            <span class="username">
              ${displayName}
            </span>

            <span class="tag">
              @${username}
            </span>

            <span class="timestamp">
              ${timestamp}
            </span>
          </div>

          <div class="content">
            ${
              content ||
              "<em>No message content</em>"
            }
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

<meta
  name="viewport"
  content="width=device-width, initial-scale=1.0"
>

<title>
  Ticket Transcript - ${escapeHTML(
    channel.name
  )}
</title>

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
  margin: auto;
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
  color: white;
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

      <strong>Ticket:</strong>
      ${escapeHTML(channel.name)}
      <br>

      <strong>Player:</strong>
      ${escapeHTML(
        player?.username || playerId
      )}
      <br>

      <strong>Tester:</strong>
      ${escapeHTML(
        tester?.username || testerId
      )}
      <br>

      <strong>Messages:</strong>
      ${messages.length}
      <br>

      <strong>Generated:</strong>
      ${generatedAt}

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

  const transcriptDirectory = path.join(
    __dirname,
    "transcripts"
  );

  if (!fs.existsSync(transcriptDirectory)) {
    fs.mkdirSync(transcriptDirectory, {
      recursive: true,
    });
  }

  const safeName = channel.name.replace(
    /[^a-zA-Z0-9-_]/g,
    "_"
  );

  const fileName =
    `${safeName}-${Date.now()}.html`;

  const filePath = path.join(
    transcriptDirectory,
    fileName
  );

  fs.writeFileSync(
    filePath,
    html,
    "utf8"
  );

  console.log(
    `✅ Transcript created: ${fileName}`
  );

  return {
    filePath,
    fileName,
  };
}

// ============================================================
// SEND TRANSCRIPT
// ============================================================

async function sendTranscript(
  channel,
  playerId,
  testerId
) {
  const {
    filePath,
    fileName,
  } = await createTranscript(
    channel,
    playerId,
    testerId
  );

  let savedToChannel = false;
  let sentToPlayer = false;

  // ----------------------------------------------------------
  // SAVE TO TRANSCRIPT CHANNEL
  // ----------------------------------------------------------

  try {
    const transcriptChannel =
      await client.channels.fetch(
        TRANSCRIPT_CHANNEL_ID
      );

    if (!transcriptChannel) {
      throw new Error(
        "Transcript channel not found."
      );
    }

    const attachment =
      new AttachmentBuilder(filePath)
        .setName(fileName);

    await transcriptChannel.send({
      embeds: [
        createEmbed(
          "📄 Ticket Transcript",
          `A ticket transcript has been saved.\n\n` +
            `🎫 **Ticket:** ${channel.name}\n` +
            `👤 **Player:** <@${playerId}>\n` +
            `🧪 **Tester:** <@${testerId}>`,
          0x5865f2
        ),
      ],
      files: [attachment],
    });

    savedToChannel = true;
  } catch (error) {
    console.error(
      "❌ Failed to save transcript:",
      error
    );
  }

  // ----------------------------------------------------------
  // DM PLAYER
  // ----------------------------------------------------------

  try {
    const player =
      await client.users.fetch(playerId);

    const attachment =
      new AttachmentBuilder(filePath)
        .setName(fileName);

    await player.send({
      embeds: [
        createEmbed(
          "📄 Test Transcript",
          `Your testing ticket transcript has been generated.\n\n` +
            `🎫 **Ticket:** ${channel.name}\n` +
            `🧪 **Tester:** <@${testerId}>\n\n` +
            `Your transcript is attached to this message.`,
          0x5865f2
        ),
      ],
      files: [attachment],
    });

    sentToPlayer = true;
  } catch (error) {
    console.error(
      "❌ Failed to DM transcript:",
      error
    );
  }

  // ----------------------------------------------------------
  // REMOVE TEMPORARY FILE
  // ----------------------------------------------------------

  try {
    fs.unlinkSync(filePath);
  } catch (error) {
    console.error(
      "⚠️ Failed to remove temporary transcript:",
      error
    );
  }

  return {
    savedToChannel,
    sentToPlayer,
  };
}

// ============================================================
// SLASH COMMAND REGISTRATION
// ============================================================

const commands = [
  new SlashCommandBuilder()
    .setName("panel")
    .setDescription(
      "Create the testing queue panel."
    ),

  new SlashCommandBuilder()
    .setName("claim")
    .setDescription(
      "Claim the next player in the testing queue."
    ),

  new SlashCommandBuilder()
    .setName("finish")
    .setDescription(
      "Finish the current player's test."
    )
    .addStringOption((option) =>
      option
        .setName("rank")
        .setDescription(
          "The player's test result/rank."
        )
        .setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName("result")
    .setDescription(
      "Submit the result for your current test."
    )
    .addStringOption((option) =>
      option
        .setName("rank")
        .setDescription(
          "The player's test result/rank."
        )
        .setRequired(true)
    ),
].map((command) => command.toJSON());

// ============================================================
// REGISTER COMMANDS
// ============================================================

async function registerCommands() {
  try {
    const guild =
      await client.guilds.fetch(GUILD_ID);

    await guild.commands.set(commands);

    console.log(
      `✅ Registered ${commands.length} slash commands in ${guild.name}`
    );

    console.log(
      "📋 Commands: /panel, /claim, /finish, /result"
    );
  } catch (error) {
    console.error(
      "❌ Failed to register slash commands:",
      error
    );
  }
}

// ============================================================
// BOT READY
// ============================================================

client.once("ready", async () => {
  console.log(
    `✅ Logged in as ${client.user.tag}`
  );

  console.log(
    `👥 Queue: ${queue.length} players`
  );

  await registerCommands();
});

// ============================================================
// FINISH TEST FUNCTION
// ============================================================

async function finishTest(
  interaction,
  rank
) {
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

  // Find tester's active ticket
  const test =
    getActiveTestForTester(
      interaction.user.id
    );

  if (!test) {
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

  // Don't allow finishing twice
  if (test.finished) {
    return interaction.reply({
      embeds: [
        createEmbed(
          "❌ Test Already Finished",
          `This test has already been finished with the result **${test.rank}**.`,
          0xff0000
        ),
      ],
      ephemeral: true,
    });
  }

  const playerId = test.playerId;

  // Update test data
  activeTests.set(test.channelId, {
    ...test,
    finished: true,
    rank: rank,
    finishedAt: new Date(),
  });

  // ----------------------------------------------------------
  // RESULTS CHANNEL
  // ----------------------------------------------------------

  try {
    const resultsChannel =
      await client.channels.fetch(
        RESULTS_CHANNEL_ID
      );

    await resultsChannel.send({
      embeds: [
        createEmbed(
          "🏆 Test Result",
          `👤 **Player:** <@${playerId}>\n` +
            `🧪 **Tester:** <@${interaction.user.id}>\n` +
            `📊 **Result:** **${rank}**`,
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

  // ----------------------------------------------------------
  // TESTER LOG
  // ----------------------------------------------------------

  try {
    const logsChannel =
      await client.channels.fetch(
        TESTER_LOGS_CHANNEL_ID
      );

    await logsChannel.send({
      embeds: [
        createEmbed(
          "🧪 Test Completed",
          `A tester has completed a test.\n\n` +
            `👤 **Player:** <@${playerId}>\n` +
            `🧪 **Tester:** <@${interaction.user.id}>\n` +
            `📊 **Result:** **${rank}**\n` +
            `🎫 **Ticket:** <#${test.channelId}>`,
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

  // ----------------------------------------------------------
  // TICKET LOG
  // ----------------------------------------------------------

  try {
    const ticketLogs =
      await client.channels.fetch(
        TICKET_LOGS_CHANNEL_ID
      );

    await ticketLogs.send({
      embeds: [
        createEmbed(
          "🏆 Test Finished",
          `👤 **Player:** <@${playerId}>\n` +
            `🧪 **Tester:** <@${interaction.user.id}>\n` +
            `📊 **Result:** **${rank}**\n` +
            `🎫 **Ticket:** <#${test.channelId}>`,
          0x00ff00
        ),
      ],
    });
  } catch (error) {
    console.error(
      "❌ Failed to send ticket log:",
      error
    );
  }

  // ----------------------------------------------------------
  // TICKET MESSAGE
  // ----------------------------------------------------------

  try {
    const ticketChannel =
      await client.channels.fetch(
        test.channelId
      );

    await ticketChannel.send({
      embeds: [
        createEmbed(
          "🏆 Test Completed",
          `The test has been completed.\n\n` +
            `📊 **Result:** **${rank}**\n\n` +
            `The ticket remains open until it is closed by the tester.`,
          0x00ff00
        ),
      ],
    });
  } catch (error) {
    console.error(
      "❌ Failed to send ticket completion:",
      error
    );
  }

  return interaction.reply({
    embeds: [
      createEmbed(
        "✅ Test Finished",
        `The test for <@${playerId}> has been completed.\n\n` +
          `📊 **Result:** **${rank}**\n\n` +
          `Close the ticket when you're finished so you can claim another player.`,
        0x00ff00
      ),
    ],
    ephemeral: true,
  });
}

// ============================================================
// INTERACTIONS
// ============================================================

client.on(
  "interactionCreate",
  async (interaction) => {
    try {
      // ======================================================
      // SLASH COMMANDS
      // ======================================================

      if (interaction.isChatInputCommand()) {

        // ----------------------------------------------------
        // /panel
        // ----------------------------------------------------

        if (
          interaction.commandName === "panel"
        ) {
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

          const message =
            await interaction.reply({
              embeds: [
                createPanelEmbed(),
              ],
              components: [
                createPanelButtons(),
              ],
              fetchReply: true,
            });

          queuePanelMessage = message;

          return;
        }

        // ----------------------------------------------------
        // /claim
        // ----------------------------------------------------

        if (
          interaction.commandName === "claim"
        ) {
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

          // Tester already has an active ticket
          const existingTest =
            getActiveTestForTester(
              interaction.user.id
            );

          if (existingTest) {
            return interaction.reply({
              embeds: [
                createEmbed(
                  "❌ Already Testing",
                  `You are already testing <@${existingTest.playerId}>.\n\n` +
                    `You must close your current ticket before claiming another player.`,
                  0xff0000
                ),
              ],
              ephemeral: true,
            });
          }

          // Queue empty
          if (queue.length === 0) {
            return interaction.reply({
              embeds: [
                createEmbed(
                  "❌ Queue Empty",
                  "There are currently no players waiting in the testing queue.",
                  0xff0000
                ),
              ],
              ephemeral: true,
            });
          }

          // Get player
          const playerId =
            queue.shift();

          await updateQueuePanel();

          // Get guild
          const guild =
            await client.guilds.fetch(
              GUILD_ID
            );

          // Get player member
          let playerMember;

          try {
            playerMember =
              await guild.members.fetch(
                playerId
              );
          } catch (error) {
            console.error(
              "❌ Could not fetch queued player:",
              error
            );

            return interaction.reply({
              embeds: [
                createEmbed(
                  "❌ Player Not Found",
                  "The queued player could not be found in the server.",
                  0xff0000
                ),
              ],
              ephemeral: true,
            });
          }

          const playerUsername =
            playerMember.user.username;

          // Create ticket name
          const ticketName =
            createTicketName(
              playerUsername
            );

          // Create channel
          const ticketChannel =
            await guild.channels.create({
              name: ticketName,
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

          // Store test
          activeTests.set(
            ticketChannel.id,
            {
              channelId:
                ticketChannel.id,

              playerId:
                playerId,

              testerId:
                interaction.user.id,

              playerUsername:
                playerUsername,

              claimedAt:
                new Date(),

              finished:
                false,

              rank:
                null,

              closed:
                false,
            }
          );

          // --------------------------------------------------
          // TICKET EMBED
          // --------------------------------------------------

          const ticketEmbed =
            new EmbedBuilder()
              .setTitle(
                "🧪 Test Ticket"
              )
              .setDescription(
                `Welcome <@${playerId}>!\n\n` +
                  `You are now being tested by <@${interaction.user.id}>.\n\n` +
                  `The tester will begin your test shortly.\n\n` +
                  `Good luck! 🍀`
              )
              .addFields(
                {
                  name: "👤 Player",
                  value: `<@${playerId}>`,
                  inline: true,
                },
                {
                  name: "🧪 Tester",
                  value: `<@${interaction.user.id}>`,
                  inline: true,
                }
              )
              .setColor(0x5865f2)
              .setTimestamp();

          await ticketChannel.send({
            embeds: [
              ticketEmbed,
            ],
            components: [
              createOpenTicketButtons(),
            ],
          });

          // Tester confirmation
          return interaction.reply({
            embeds: [
              createEmbed(
                "✅ Test Claimed",
                `You are now testing <@${playerId}>.\n\n` +
                  `🎫 **Ticket:** ${ticketChannel}\n` +
                  `👤 **Player:** ${playerUsername}\n\n` +
                  `You cannot claim another player until this ticket is closed.`,
                0x00ff00
              ),
            ],
            ephemeral: true,
          });
        }

        // ----------------------------------------------------
        // /finish
        // ----------------------------------------------------

        if (
          interaction.commandName === "finish"
        ) {
          const rank =
            interaction.options.getString(
              "rank"
            );

          return finishTest(
            interaction,
            rank
          );
        }

        // ----------------------------------------------------
        // /result
        // ----------------------------------------------------

        if (
          interaction.commandName === "result"
        ) {
          const rank =
            interaction.options.getString(
              "rank"
            );

          return finishTest(
            interaction,
            rank
          );
        }
      }

      // ======================================================
      // BUTTONS
      // ======================================================

      if (interaction.isButton()) {

        // ----------------------------------------------------
        // JOIN QUEUE
        // ----------------------------------------------------

        if (
          interaction.customId ===
          "join_queue"
        ) {
          // Already in queue
          if (
            queue.includes(
              interaction.user.id
            )
          ) {
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

          // Already has a ticket
          const existingPlayerTest =
            getTestByPlayer(
              interaction.user.id
            );

          if (existingPlayerTest) {
            return interaction.reply({
              embeds: [
                createEmbed(
                  "❌ Already Have a Ticket",
                  "You already have a testing ticket and cannot join the queue.",
                  0xff0000
                ),
              ],
              ephemeral: true,
            });
          }

          // Join
          queue.push(
            interaction.user.id
          );

          const position =
            queue.indexOf(
              interaction.user.id
            ) + 1;

          await updateQueuePanel();

          return interaction.reply({
            embeds: [
              createEmbed(
                "✅ Joined Queue",
                `You have been added to the testing queue.\n\n` +
                  `📍 **Position:** ${position}\n` +
                  `👥 **Players in queue:** ${queue.length}`,
                0x00ff00
              ),
            ],
            ephemeral: true,
          });
        }

        // ----------------------------------------------------
        // LEAVE QUEUE
        // ----------------------------------------------------

        if (
          interaction.customId ===
          "leave_queue"
        ) {
          const index =
            queue.indexOf(
              interaction.user.id
            );

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

          queue.splice(
            index,
            1
          );

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

        // ----------------------------------------------------
        // CLOSE TICKET
        // ----------------------------------------------------

        if (
          interaction.customId ===
          "close_ticket"
        ) {
          const test =
            getTestByChannel(
              interaction.channel.id
            );

          if (!test) {
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

          // Only tester
          if (
            test.testerId !==
            interaction.user.id
          ) {
            return interaction.reply({
              embeds: [
                createEmbed(
                  "❌ Not Your Ticket",
                  "Only the assigned tester can close this ticket.",
                  0xff0000
                ),
              ],
              ephemeral: true,
            });
          }

          if (test.closed) {
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

          // Create transcript BEFORE locking
          const transcriptResult =
            await sendTranscript(
              interaction.channel,
              test.playerId,
              test.testerId
            );

          // Mark closed
          activeTests.set(
            interaction.channel.id,
            {
              ...test,
              closed: true,
              closedAt: new Date(),
            }
          );

          // Lock player
          try {
            await interaction.channel.permissionOverwrites.edit(
              test.playerId,
              {
                SendMessages: false,
              }
            );

            await interaction.channel.permissionOverwrites.edit(
              test.testerId,
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

          let transcriptStatus =
            "";

          if (
            transcriptResult.sentToPlayer
          ) {
            transcriptStatus +=
              "📨 The transcript has been sent to the player.\n";
          } else {
            transcriptStatus +=
              "⚠️ The transcript could not be sent to the player.\n";
          }

          if (
            transcriptResult.savedToChannel
          ) {
            transcriptStatus +=
              "📁 The transcript has been saved in the transcript channel.";
          } else {
            transcriptStatus +=
              "⚠️ The transcript could not be saved in the transcript channel.";
          }

          // Closed ticket message
          await interaction.channel.send({
            embeds: [
              createEmbed(
                "🔒 Ticket Closed",
                `This ticket has been closed and locked.\n\n` +
                  `${transcriptStatus}\n\n` +
                  `The tester can use the buttons below to manage the ticket.`,
                0xffa500
              ),
            ],
            components: [
              createClosedTicketButtons(),
            ],
          });

          return interaction.editReply({
            embeds: [
              createEmbed(
                "✅ Ticket Closed",
                `The ticket for <@${test.playerId}> has been closed.\n\n` +
                  `You are now free to claim another player.`,
                0x00ff00
              ),
            ],
          });
        }

        // ----------------------------------------------------
        // OPEN TICKET
        // ----------------------------------------------------

        if (
          interaction.customId ===
          "open_ticket"
        ) {
          if (!isTester(interaction)) {
            return interaction.reply({
              embeds: [
                createEmbed(
                  "❌ No Permission",
                  "You need the tester role to reopen tickets.",
                  0xff0000
                ),
              ],
              ephemeral: true,
            });
          }

          const test =
            getTestByChannel(
              interaction.channel.id
            );

          if (!test) {
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

          if (
            test.testerId !==
            interaction.user.id
          ) {
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

          // Check for another active ticket
          const anotherTest =
            getActiveTestForTester(
              interaction.user.id
            );

          if (
            anotherTest &&
            anotherTest.channelId !==
              test.channelId
          ) {
            return interaction.reply({
              embeds: [
                createEmbed(
                  "❌ Already Testing",
                  `You are already testing <@${anotherTest.playerId}>.\n\n` +
                    `Close that ticket before reopening this one.`,
                  0xff0000
                ),
              ],
              ephemeral: true,
            });
          }

          // Reopen
          activeTests.set(
            interaction.channel.id,
            {
              ...test,
              closed: false,
            }
          );

          try {
            await interaction.channel.permissionOverwrites.edit(
              test.playerId,
              {
                ViewChannel: true,
                SendMessages: true,
                ReadMessageHistory: true,
              }
            );

            await interaction.channel.permissionOverwrites.edit(
              test.testerId,
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
                  `The player and tester can send messages again.`,
                0x00ff00
              ),
            ],
            components: [
              createOpenTicketButtons(),
            ],
          });

          return interaction.reply({
            embeds: [
              createEmbed(
                "✅ Ticket Reopened",
                "The ticket has been reopened. You are now actively assigned to this player again.",
                0x00ff00
              ),
            ],
            ephemeral: true,
          });
        }

        // ----------------------------------------------------
        // FORCE TRANSCRIPT
        // ----------------------------------------------------

        if (
          interaction.customId ===
          "force_transcript"
        ) {
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

          const test =
            getTestByChannel(
              interaction.channel.id
            );

          if (!test) {
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

          const result =
            await sendTranscript(
              interaction.channel,
              test.playerId,
              test.testerId
            );

          let status = "";

          if (
            result.savedToChannel
          ) {
            status +=
              "📁 Saved to the transcript channel.\n";
          } else {
            status +=
              "⚠️ Failed to save to the transcript channel.\n";
          }

          if (
            result.sentToPlayer
          ) {
            status +=
              "📨 Sent to the player.";
          } else {
            status +=
              "⚠️ Failed to DM the player.";
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

        // ----------------------------------------------------
        // DELETE TICKET
        // ----------------------------------------------------

        if (
          interaction.customId ===
          "delete_ticket"
        ) {
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

          const test =
            getTestByChannel(
              interaction.channel.id
            );

          if (!test) {
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

          // Remove stored test
          activeTests.delete(
            interaction.channel.id
          );

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
      console.error(
        "❌ Interaction error:",
        error
      );

      try {
        if (
          interaction.deferred ||
          interaction.replied
        ) {
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
        // Ignore secondary error
      }
    }
  }
);

// ============================================================
// LOGIN
// ============================================================

client.login(TOKEN);
