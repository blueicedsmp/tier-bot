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
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  StringSelectMenuBuilder,
  ChannelType,
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

const TRANSCRIPT_CHANNEL_ID = "1547279794800955392";

// ============================================================
// ROLE CONFIG
// ============================================================

const RANK_ROLES = {
  LT5: "1312061443817865360",
  HT5: "1312060216912642049",
  LT4: "1312059901874409583",
  HT4: "1312059847788855326",
  LT3: "1312059797608337478",
  HT3: "1312059672961880095",
  LT2: "1312059581366665286",
  HT2: "1312059439125106780",
  LT1: "1312059250364780586",
  HT1: "1312059166151671818",
};

const REGION_ROLES = {
  EU: "1312843793384341666",
  NA: "1312843913563738153",
  AS: "1312843979041280170",
};

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

const queue = [];
const activeTests = new Map();

let queuePanelMessage = null;

// ============================================================
// EMBEDS
// ============================================================

function createEmbed(
  title,
  description,
  color = 0x5865f2
) {
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
  return interaction.member?.roles?.cache?.has(
    TESTER_ROLE_ID
  );
}

// ============================================================
// TEST LOOKUPS
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
// ROLE HELPERS
// ============================================================

function getPlayerRegion(member) {
  for (const [region, roleId] of Object.entries(
    REGION_ROLES
  )) {
    if (member.roles.cache.has(roleId)) {
      return region;
    }
  }

  return "Unknown";
}

function getPlayerRank(member) {
  for (const [rank, roleId] of Object.entries(
    RANK_ROLES
  )) {
    if (member.roles.cache.has(roleId)) {
      return rank;
    }
  }

  return "Unranked";
}

async function changePlayerRank(member, newRank) {
  const newRoleId = RANK_ROLES[newRank];

  if (!newRoleId) {
    throw new Error(`Invalid rank: ${newRank}`);
  }

  const rolesToRemove = [];

  for (const roleId of Object.values(RANK_ROLES)) {
    if (member.roles.cache.has(roleId)) {
      rolesToRemove.push(roleId);
    }
  }

  if (rolesToRemove.length > 0) {
    await member.roles.remove(
      rolesToRemove,
      `Testing result: ${newRank}`
    );
  }

  await member.roles.add(
    newRoleId,
    `Testing result: ${newRank}`
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
        "Click **Join Queue** and enter your Minecraft IGN.\n" +
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

    console.log(
      `📊 Queue panel updated: ${queue.length} players`
    );
  } catch (error) {
    console.error(
      "❌ Failed to update queue panel:",
      error
    );
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
// RANK SELECT MENU
// ============================================================

function createRankSelectMenu(customId) {
  return new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId(customId)
      .setPlaceholder("Select the rank earned")
      .addOptions(
        {
          label: "LT5",
          value: "LT5",
          description: "Award LT5",
        },
        {
          label: "HT5",
          value: "HT5",
          description: "Award HT5",
        },
        {
          label: "LT4",
          value: "LT4",
          description: "Award LT4",
        },
        {
          label: "HT4",
          value: "HT4",
          description: "Award HT4",
        },
        {
          label: "LT3",
          value: "LT3",
          description: "Award LT3",
        },
        {
          label: "HT3",
          value: "HT3",
          description: "Award HT3",
        },
        {
          label: "LT2",
          value: "LT2",
          description: "Award LT2",
        },
        {
          label: "HT2",
          value: "HT2",
          description: "Award HT2",
        },
        {
          label: "LT1",
          value: "LT1",
          description: "Award LT1",
        },
        {
          label: "HT1",
          value: "HT1",
          description: "Award HT1",
        }
      )
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

async function createTranscript(
  channel,
  playerId,
  testerId
) {
  console.log(
    `📄 Creating transcript for ${channel.name}`
  );

  let messages = [];
  let lastId;

  while (true) {
    const options = {
      limit: 100,
    };

    if (lastId) {
      options.before = lastId;
    }

    const batch =
      await channel.messages.fetch(options);

    if (batch.size === 0) {
      break;
    }

    messages.push(...batch.values());

    lastId = batch.last().id;

    if (batch.size < 100) {
      break;
    }
  }

  messages.reverse();

  const player = await client.users
    .fetch(playerId)
    .catch(() => null);

  const tester = await client.users
    .fetch(testerId)
    .catch(() => null);

  const generatedAt =
    new Date().toLocaleString("en-GB");

  let messageHTML = "";

  for (const message of messages) {
    const username = escapeHTML(
      message.author.username
    );

    const displayName = escapeHTML(
      message.member?.displayName ||
        message.author.username
    );

    const timestamp =
      new Date(
        message.createdTimestamp
      ).toLocaleString("en-GB");

    let content = escapeHTML(
      message.content || ""
    );

    if (message.attachments.size > 0) {
      for (const attachment of message.attachments.values()) {
        content += `
          <div class="attachment">
            📎
            <a href="${escapeHTML(
              attachment.url
            )}" target="_blank">
              ${escapeHTML(
                attachment.name ||
                  "Attachment"
              )}
            </a>
          </div>
        `;
      }
    }

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
            src="${escapeHTML(
              message.author.displayAvatarURL({
                extension: "png",
                size: 64,
              })
            )}"
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

  const transcriptDirectory =
    path.join(
      __dirname,
      "transcripts"
    );

  if (
    !fs.existsSync(
      transcriptDirectory
    )
  ) {
    fs.mkdirSync(
      transcriptDirectory,
      {
        recursive: true,
      }
    );
  }

  const safeName =
    channel.name.replace(
      /[^a-zA-Z0-9-_]/g,
      "_"
    );

  const fileName =
    `${safeName}-${Date.now()}.html`;

  const filePath =
    path.join(
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
  testerId,
  {
    sendToChannel = true,
    sendToPlayer = true,
  } = {}
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

  if (sendToChannel) {
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
        new AttachmentBuilder(
          filePath
        ).setName(fileName);

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

      console.log(
        "✅ Transcript sent to transcript channel"
      );
    } catch (error) {
      console.error(
        "❌ Failed to save transcript:",
        error
      );
    }
  }

  if (sendToPlayer) {
    try {
      const player =
        await client.users.fetch(
          playerId
        );

      const attachment =
        new AttachmentBuilder(
          filePath
        ).setName(fileName);

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

      console.log(
        "✅ Transcript sent to player"
      );
    } catch (error) {
      console.error(
        "❌ Failed to DM transcript:",
        error
      );
    }
  }

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
// TRANSCRIPT STATUS EMBEDS
// ============================================================

function createTranscriptChannelStatus(result) {
  return createEmbed(
    result.savedToChannel
      ? "📁 Transcript → Channel"
      : "❌ Transcript → Channel",
    result.savedToChannel
      ? "The transcript was successfully sent to the transcript channel."
      : "The transcript could not be sent to the transcript channel.",
    result.savedToChannel
      ? 0x00ff00
      : 0xff0000
  );
}

function createTranscriptPlayerStatus(
  result,
  force = false
) {
  if (force) {
    return createEmbed(
      "⚪ Transcript → Player",
      "Not sent — **Force Transcript only sends the transcript to the transcript channel.**",
      0x808080
    );
  }

  return createEmbed(
    result.sentToPlayer
      ? "📨 Transcript → Player"
      : "❌ Transcript → Player",
    result.sentToPlayer
      ? "The transcript was successfully sent to the player."
      : "The transcript could not be sent to the player.",
    result.sentToPlayer
      ? 0x00ff00
      : 0xff0000
  );
}

function createTranscriptOverallStatus(
  result,
  force = false
) {
  if (force) {
    return createEmbed(
      "📋 Force Transcript Complete",
      result.savedToChannel
        ? "The transcript has been generated and successfully sent to the transcript channel."
        : "The transcript was generated, but it could not be sent to the transcript channel.",
      result.savedToChannel
        ? 0x00ff00
        : 0xff0000
    );
  }

  const success =
    result.savedToChannel &&
    result.sentToPlayer;

  return createEmbed(
    success
      ? "📋 Transcript Complete"
      : "⚠️ Transcript Completed With Issues",
    success
      ? "The transcript was successfully sent to both the transcript channel and the player."
      : "The transcript was generated, but one or more destinations failed.",
    success
      ? 0x00ff00
      : 0xffa500
  );
}

// ============================================================
// TICKET LOGGING
// ============================================================

async function sendTicketLog(
  title,
  description,
  color = 0x5865f2
) {
  try {
    const channel =
      await client.channels.fetch(
        TICKET_LOGS_CHANNEL_ID
      );

    if (!channel) return;

    await channel.send({
      embeds: [
        createEmbed(
          title,
          description,
          color
        ),
      ],
    });
  } catch (error) {
    console.error(
      "❌ Failed to send ticket log:",
      error
    );
  }
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
    .setName("log")
    .setDescription(
      "Log a successfully completed test."
    ),

  new SlashCommandBuilder()
    .setName("finish")
    .setDescription(
      "Finish the current test and select the earned rank."
    ),
].map((command) =>
  command.toJSON()
);

// ============================================================
// REGISTER COMMANDS
// ============================================================

async function registerCommands() {
  try {
    const guild =
      await client.guilds.fetch(
        GUILD_ID
      );

    await guild.commands.set(
      commands
    );

    console.log(
      `✅ Registered ${commands.length} slash commands in ${guild.name}`
    );

    console.log(
      "📋 Commands: /panel, /claim, /log, /finish"
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

client.once(
  "ready",
  async () => {
    console.log(
      `✅ Logged in as ${client.user.tag}`
    );

    console.log(
      `👥 Queue: ${queue.length} players`
    );

    await registerCommands();
  }
);

// ============================================================
// SHOW RANK SELECTION
// ============================================================

async function showRankSelection(
  interaction,
  commandType
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

  if (test.finished) {
    return interaction.reply({
      embeds: [
        createEmbed(
          "❌ Test Already Finished",
          `This test has already been logged as **${test.rank}**.`,
          0xff0000
        ),
      ],
      ephemeral: true,
    });
  }

  const title =
    commandType === "log"
      ? "🏆 Log Successful Test"
      : "🏆 Finish Test";

  const description =
    commandType === "log"
      ? `Select the rank that **<@${test.playerId}>** earned.\n\n` +
        `This will remove their previous rank role and give them the selected rank.`
      : `Select the rank that **<@${test.playerId}>** should receive.\n\n` +
        `This will remove their previous rank role and give them the selected rank.`;

  return interaction.reply({
    embeds: [
      createEmbed(
        title,
        description,
        0x5865f2
      ),
    ],
    components: [
      createRankSelectMenu(
        commandType === "log"
          ? "select_rank_log"
          : "select_rank_finish"
      ),
    ],
    ephemeral: true,
  });
}

// ============================================================
// PROCESS SUCCESSFUL RESULT
// ============================================================

async function processTestResult(
  interaction,
  rank,
  commandType
) {
  if (!isTester(interaction)) {
    return interaction.reply({
      embeds: [
        createEmbed(
          "❌ No Permission",
          "You need the tester role to use this.",
          0xff0000
        ),
      ],
      ephemeral: true,
    });
  }

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

  if (test.finished) {
    return interaction.reply({
      embeds: [
        createEmbed(
          "❌ Test Already Finished",
          `This test has already been logged as **${test.rank}**.`,
          0xff0000
        ),
      ],
      ephemeral: true,
    });
  }

  await interaction.deferUpdate();

  const guild =
    await client.guilds.fetch(
      GUILD_ID
    );

  let playerMember;

  try {
    playerMember =
      await guild.members.fetch(
        test.playerId
      );
  } catch (error) {
    return interaction.followUp({
      embeds: [
        createEmbed(
          "❌ Player Not Found",
          "I could not fetch the player from the server, so their rank was not changed.",
          0xff0000
        ),
      ],
      ephemeral: true,
    });
  }

  // ----------------------------------------------------------
  // GET OLD ROLE INFORMATION
  // ----------------------------------------------------------

  const previousRank =
    getPlayerRank(
      playerMember
    );

  const region =
    getPlayerRegion(
      playerMember
    );

  // ----------------------------------------------------------
  // CHANGE RANK
  // ----------------------------------------------------------

  try {
    await changePlayerRank(
      playerMember,
      rank
    );
  } catch (error) {
    console.error(
      "❌ Failed to change player rank:",
      error
    );

    return interaction.followUp({
      embeds: [
        createEmbed(
          "❌ Failed To Update Rank",
          `I could not change the player's rank role to **${rank}**.\n\n` +
            `Make sure the bot's highest role is above the rank roles.`,
          0xff0000
        ),
      ],
      ephemeral: true,
    });
  }

  // ----------------------------------------------------------
  // UPDATE TEST DATA
  // ----------------------------------------------------------

  const updatedTest = {
    ...test,
    finished: true,
    rank,
    previousRank,
    region,
    finishedAt: new Date(),
  };

  activeTests.set(
    test.channelId,
    updatedTest
  );

  // ----------------------------------------------------------
  // RESULT EMBED
  // ----------------------------------------------------------

  const resultDescription =
    `**<@${test.playerId}>**\n\n` +
    `**Tester:** <@${interaction.user.id}>\n` +
    `**Region:** ${region}\n` +
    `**Username:** ${test.minecraftUsername}\n` +
    `**Previous Rank:** ${previousRank}\n` +
    `**Rank Earned:** ${rank}`;

  // ----------------------------------------------------------
  // RESULTS CHANNEL
  // ----------------------------------------------------------

  let resultsSent = false;

  try {
    const resultsChannel =
      await client.channels.fetch(
        RESULTS_CHANNEL_ID
      );

    await resultsChannel.send({
      embeds: [
        createEmbed(
          "🏆 Test Result",
          resultDescription,
          0x00ff00
        ),
      ],
    });

    resultsSent = true;
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
          `**Player:** <@${test.playerId}>\n` +
            `**Tester:** <@${interaction.user.id}>\n` +
            `**Username:** ${test.minecraftUsername}\n` +
            `**Region:** ${region}\n` +
            `**Previous Rank:** ${previousRank}\n` +
            `**Rank Earned:** ${rank}\n` +
            `**Ticket:** <#${test.channelId}>`,
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

  await sendTicketLog(
    "🏆 Test Completed",
    `**Player:** <@${test.playerId}>\n` +
      `**Tester:** <@${interaction.user.id}>\n` +
      `**Username:** ${test.minecraftUsername}\n` +
      `**Region:** ${region}\n` +
      `**Previous Rank:** ${previousRank}\n` +
      `**Rank Earned:** ${rank}\n` +
      `**Ticket:** <#${test.channelId}>`,
    0x00ff00
  );

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
          "🏆 Test Completed Successfully",
          `The test has been successfully completed.\n\n` +
            `👤 **Player:** <@${test.playerId}>\n` +
            `🎮 **Username:** ${test.minecraftUsername}\n` +
            `🌍 **Region:** ${region}\n` +
            `📊 **Previous Rank:** ${previousRank}\n` +
            `🏆 **Rank Earned:** ${rank}\n\n` +
            `The player's rank role has been updated.\n\n` +
            `🔒 **Close the ticket when finished. You cannot claim another test until this ticket is closed.**`,
          0x00ff00
        ),
      ],
    });
  } catch (error) {
    console.error(
      "❌ Failed to send completion message:",
      error
    );
  }

  // ----------------------------------------------------------
  // UPDATE EPHEMERAL MENU
  // ----------------------------------------------------------

  return interaction.editReply({
    embeds: [
      createEmbed(
        "✅ Test Logged",
        `The test for <@${test.playerId}> has been successfully logged.\n\n` +
          `🎮 **Username:** ${test.minecraftUsername}\n` +
          `🌍 **Region:** ${region}\n` +
          `📊 **Previous Rank:** ${previousRank}\n` +
          `🏆 **Rank Earned:** ${rank}\n\n` +
          `🎭 The player's rank role has been updated.\n` +
          `${resultsSent ? "📨 The result was sent to the results channel." : "⚠️ The result could not be sent to the results channel."}\n\n` +
          `🔒 Close the ticket before claiming another player.`,
        resultsSent
          ? 0x00ff00
          : 0xffa500
      ),
    ],
    components: [],
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

          queuePanelMessage =
            message;

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

          const queueEntry =
            queue.shift();

          await updateQueuePanel();

          const playerId =
            queueEntry.playerId;

          const minecraftUsername =
            queueEntry.minecraftUsername;

          const guild =
            await client.guilds.fetch(
              GUILD_ID
            );

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

            queue.unshift(
              queueEntry
            );

            await updateQueuePanel();

            return interaction.reply({
              embeds: [
                createEmbed(
                  "❌ Player Not Found",
                  "The queued player could not be found in the server. They have been returned to the queue.",
                  0xff0000
                ),
              ],
              ephemeral: true,
            });
          }

          const playerDiscordUsername =
            playerMember.user.username;

          let ticketName =
            createTicketName(
              playerDiscordUsername
            );

          const existingChannel =
            guild.channels.cache.find(
              (channel) =>
                channel.name === ticketName
            );

          if (existingChannel) {
            ticketName =
              `${ticketName}-${playerId.slice(-5)}`;
          }

          // --------------------------------------------------
          // CREATE TICKET
          // --------------------------------------------------

          let ticketChannel;

          try {
            ticketChannel =
              await guild.channels.create({
                name: ticketName,
                type: ChannelType.GuildText,

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
                      PermissionsBitField.Flags.EmbedLinks,
                      PermissionsBitField.Flags.AttachFiles,
                    ],
                  },
                ],
              });
          } catch (error) {
            console.error(
              "❌ Failed to create ticket:",
              error
            );

            queue.unshift(
              queueEntry
            );

            await updateQueuePanel();

            return interaction.reply({
              embeds: [
                createEmbed(
                  "❌ Ticket Creation Failed",
                  "I could not create the testing ticket. The player has been returned to the queue.",
                  0xff0000
                ),
              ],
              ephemeral: true,
            });
          }

          // --------------------------------------------------
          // STORE TEST
          // --------------------------------------------------

          activeTests.set(
            ticketChannel.id,
            {
              channelId:
                ticketChannel.id,

              playerId,

              testerId:
                interaction.user.id,

              minecraftUsername,

              playerDiscordUsername,

              claimedAt:
                new Date(),

              finished:
                false,

              rank:
                null,

              previousRank:
                null,

              region:
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
                  `🎮 **Minecraft Username:** ${minecraftUsername}\n\n` +
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
                },
                {
                  name: "🎮 Username",
                  value: minecraftUsername,
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

          await sendTicketLog(
            "🎫 Ticket Created",
            `**Player:** <@${playerId}>\n` +
              `**Minecraft Username:** ${minecraftUsername}\n` +
              `**Tester:** <@${interaction.user.id}>\n` +
              `**Ticket:** <#${ticketChannel.id}>`,
            0x5865f2
          );

          return interaction.reply({
            embeds: [
              createEmbed(
                "✅ Test Claimed",
                `You are now testing <@${playerId}>.\n\n` +
                  `🎫 **Ticket:** ${ticketChannel}\n` +
                  `🎮 **Username:** ${minecraftUsername}\n\n` +
                  `You cannot claim another player until this ticket is closed.`,
                0x00ff00
              ),
            ],
            ephemeral: true,
          });
        }

        // ----------------------------------------------------
        // /log
        // ----------------------------------------------------

        if (
          interaction.commandName === "log"
        ) {
          return showRankSelection(
            interaction,
            "log"
          );
        }

        // ----------------------------------------------------
        // /finish
        // ----------------------------------------------------

        if (
          interaction.commandName === "finish"
        ) {
          return showRankSelection(
            interaction,
            "finish"
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
          if (
            queue.some(
              (entry) =>
                entry.playerId ===
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

          const modal =
            new ModalBuilder()
              .setCustomId(
                "join_queue_modal"
              )
              .setTitle(
                "Join Testing Queue"
              );

          const usernameInput =
            new TextInputBuilder()
              .setCustomId(
                "minecraft_username"
              )
              .setLabel(
                "Minecraft Username"
              )
              .setPlaceholder(
                "Enter your Minecraft IGN"
              )
              .setStyle(
                TextInputStyle.Short
              )
              .setMinLength(1)
              .setMaxLength(16)
              .setRequired(true);

          modal.addComponents(
            new ActionRowBuilder().addComponents(
              usernameInput
            )
          );

          return interaction.showModal(
            modal
          );
        }

        // ----------------------------------------------------
        // LEAVE QUEUE
        // ----------------------------------------------------

        if (
          interaction.customId ===
          "leave_queue"
        ) {
          const index =
            queue.findIndex(
              (entry) =>
                entry.playerId ===
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

          const transcriptResult =
            await sendTranscript(
              interaction.channel,
              test.playerId,
              test.testerId,
              {
                sendToChannel: true,
                sendToPlayer: true,
              }
            );

          activeTests.set(
            interaction.channel.id,
            {
              ...test,
              closed: true,
              closedAt: new Date(),
            }
          );

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

          await interaction.channel.send({
            embeds: [
              createTranscriptChannelStatus(
                transcriptResult
              ),
            ],
          });

          await interaction.channel.send({
            embeds: [
              createTranscriptPlayerStatus(
                transcriptResult,
                false
              ),
            ],
          });

          await interaction.channel.send({
            embeds: [
              createTranscriptOverallStatus(
                transcriptResult,
                false
              ),
            ],
          });

          await interaction.channel.send({
            embeds: [
              createEmbed(
                "🔒 Ticket Closed",
                `This ticket has been closed and locked.\n\n` +
                  `The tester can now claim another player.\n\n` +
                  `Use the buttons below to manage this ticket.`,
                0xffa500
              ),
            ],
            components: [
              createClosedTicketButtons(),
            ],
          });

          await sendTicketLog(
            "🔒 Ticket Closed",
            `**Player:** <@${test.playerId}>\n` +
              `**Tester:** <@${test.testerId}>\n` +
              `**Ticket:** <#${test.channelId}>\n\n` +
              `📁 Transcript channel: ${
                transcriptResult.savedToChannel
                  ? "✅ Successful"
                  : "❌ Failed"
              }\n` +
              `📨 Player DM: ${
                transcriptResult.sentToPlayer
                  ? "✅ Successful"
                  : "❌ Failed"
              }`,
            0xffa500
          );

          return interaction.editReply({
            embeds: [
              createEmbed(
                "✅ Ticket Closed",
                `The ticket for <@${test.playerId}> has been closed.\n\n` +
                  `📁 **Transcript → Channel:** ${
                    transcriptResult.savedToChannel
                      ? "✅"
                      : "❌"
                  }\n` +
                  `📨 **Transcript → Player:** ${
                    transcriptResult.sentToPlayer
                      ? "✅"
                      : "❌"
                  }\n\n` +
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

          try {
            await interaction.message.edit({
              components: [],
            });
          } catch {
            // Ignore
          }

          await interaction.channel.send({
            embeds: [
              createEmbed(
                "🔓 Ticket Reopened",
                `This ticket has been reopened by <@${interaction.user.id}>.\n\n` +
                  `The player and tester can send messages again.\n\n` +
                  `You are now actively assigned to this test and cannot claim another player.`,
                0x00ff00
              ),
            ],
            components: [
              createOpenTicketButtons(),
            ],
          });

          await sendTicketLog(
            "🔓 Ticket Reopened",
            `**Player:** <@${test.playerId}>\n` +
              `**Tester:** <@${test.testerId}>\n` +
              `**Ticket:** <#${test.channelId}>`,
            0x00ff00
          );

          return interaction.reply({
            embeds: [
              createEmbed(
                "✅ Ticket Reopened",
                "The ticket has been reopened. You are actively assigned to this player again.",
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
              test.testerId,
              {
                sendToChannel: true,
                sendToPlayer: false,
              }
            );

          await interaction.followUp({
            embeds: [
              createTranscriptChannelStatus(
                result
              ),
            ],
            ephemeral: true,
          });

          await interaction.followUp({
            embeds: [
              createTranscriptPlayerStatus(
                result,
                true
              ),
            ],
            ephemeral: true,
          });

          return interaction.followUp({
            embeds: [
              createTranscriptOverallStatus(
                result,
                true
              ),
            ],
            ephemeral: true,
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

          await sendTicketLog(
            "🗑️ Ticket Deleted",
            `**Player:** <@${test.playerId}>\n` +
              `**Tester:** <@${test.testerId}>\n` +
              `**Ticket:** <#${test.channelId}>`,
            0xff0000
          );

          activeTests.delete(
            interaction.channel.id
          );

          setTimeout(
            async () => {
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
            },
            1500
          );

          return;
        }
      }

      // ======================================================
      // MODALS
      // ======================================================

      if (
        interaction.isModalSubmit()
      ) {
        if (
          interaction.customId ===
          "join_queue_modal"
        ) {
          const minecraftUsername =
            interaction.fields
              .getTextInputValue(
                "minecraft_username"
              )
              .trim();

          if (!minecraftUsername) {
            return interaction.reply({
              embeds: [
                createEmbed(
                  "❌ Invalid Username",
                  "Please enter your Minecraft username.",
                  0xff0000
                ),
              ],
              ephemeral: true,
            });
          }

          if (
            queue.some(
              (entry) =>
                entry.playerId ===
                interaction.user.id
            )
          ) {
            return interaction.reply({
              embeds: [
                createEmbed(
                  "❌ Already in Queue",
                  "You are already in the testing queue.",
                  0xff0000
                ),
              ],
              ephemeral: true,
            });
          }

          const existingTest =
            getTestByPlayer(
              interaction.user.id
            );

          if (existingTest) {
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

          queue.push({
            playerId:
              interaction.user.id,
            minecraftUsername,
          });

          const position =
            queue.length;

          await updateQueuePanel();

          return interaction.reply({
            embeds: [
              createEmbed(
                "✅ Joined Queue",
                `You have been added to the testing queue.\n\n` +
                  `🎮 **Username:** ${minecraftUsername}\n` +
                  `📍 **Position:** ${position}\n` +
                  `👥 **Players in queue:** ${queue.length}`,
                0x00ff00
              ),
            ],
            ephemeral: true,
          });
        }
      }

      // ======================================================
      // SELECT MENUS
      // ======================================================

      if (
        interaction.isStringSelectMenu()
      ) {
        if (
          interaction.customId ===
          "select_rank_log"
        ) {
          const rank =
            interaction.values[0];

          return processTestResult(
            interaction,
            rank,
            "log"
          );
        }

        if (
          interaction.customId ===
          "select_rank_finish"
        ) {
          const rank =
            interaction.values[0];

          return processTestResult(
            interaction,
            rank,
            "finish"
          );
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
