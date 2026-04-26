require("dotenv").config();

const {
  default: makeWASocket,
  useMultiFileAuthState,
  DisconnectReason,
  fetchLatestBaileysVersion
} = require("@whiskeysockets/baileys");
const { Boom } = require("@hapi/boom");
const pino = require("pino");
const qrcode = require("qrcode-terminal");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const modeArg = (process.argv[2] || "qr").toLowerCase();
const loginMode = modeArg === "pair" ? "pair" : "qr";
const phoneNumber = process.env.PHONE_NUMBER || "";
const commandPrefix = (process.env.PREFIX || ".").trim() || ".";
const aiApiKey = process.env.AI_API_KEY || "";
const aiBaseUrl = process.env.AI_BASE_URL || "https://api.openai.com/v1";
const aiModel = process.env.AI_MODEL || "gpt-4o-mini";
const aiSystemPrompt =
  process.env.AI_SYSTEM_PROMPT ||
  "You are HELOX-MD assistant. Reply clearly and helpfully. Keep answers concise unless asked for details.";
const aiAllowedNumbers = (process.env.AI_ALLOWED_NUMBERS || "252637824865")
  .split(",")
  .map((n) => n.replace(/\D/g, ""))
  .filter(Boolean);
const ownerNumbers = (process.env.OWNER_NUMBERS || "")
  .split(",")
  .map((n) => n.replace(/\D/g, ""))
  .filter(Boolean);
const antiLinkState = new Map();
const sessionFilePath = path.join("auth_info", "helox-session.json");

function getTextFromMessage(message) {
  return (
    message.message?.conversation ||
    message.message?.extendedTextMessage?.text ||
    message.message?.imageMessage?.caption ||
    message.message?.videoMessage?.caption ||
    ""
  );
}

function normalizeCommandToken(rawToken) {
  return rawToken.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function registerAliases(aliasMap, canonical, aliases) {
  for (const alias of aliases) {
    aliasMap.set(normalizeCommandToken(alias), canonical);
  }
}

function buildAliasMap() {
  const aliasMap = new Map();
  const baseCommands = {
    help: ["help", "menu", "cmds", "commands", "adminmenu"],
    ai: ["ai", "ask", "chatgpt", "grok", "botai"],
    aistatus: ["aistatus", "aicheck", "checkai", "aihealth"],
    ping: ["ping", "alive", "test"],
    owner: ["owner", "creator", "dev"],
    setantilink: ["antilink", "setantilink", "linkguard", "antilinkmode"],
    join: ["join", "joingroup", "acceptinvite"],
    kick: ["kick", "remove", "ban", "out"],
    add: ["add", "invite", "insert"],
    promote: ["promote", "makeadmin", "adminup"],
    demote: ["demote", "removeadmin", "admindown"],
    mute: ["mute", "close", "lock", "readonly"],
    unmute: ["unmute", "open", "unlock", "write"],
    link: ["link", "grouplink", "invitecode"],
    revoke: ["revoke", "resetlink", "newlink"],
    subject: ["subject", "setname", "groupname", "title"],
    desc: ["desc", "description", "setdesc", "bio"],
    tagall: ["tagall", "all", "everyone", "mentionall"],
    hidetag: ["hidetag", "ht", "hiddenall"],
    admins: ["admins", "adminlist", "listadmins", "staff"],
    groupinfo: ["groupinfo", "gcinfo", "infogroup", "ginfo"],
    leave: ["leave", "exit", "bye", "quit"]
  };

  const decorators = ["", "group", "gc", "admin", "now", "fast"];
  let aliasCounter = 0;

  for (const [canonical, seeds] of Object.entries(baseCommands)) {
    const expanded = new Set();
    for (const seed of seeds) {
      expanded.add(seed);
      for (const deco of decorators) {
        expanded.add(`${seed}${deco}`);
        expanded.add(`${deco}${seed}`);
      }
      for (let i = 1; i <= 5; i += 1) {
        expanded.add(`${seed}${i}`);
      }
    }

    registerAliases(aliasMap, canonical, expanded);
    aliasCounter += expanded.size;
  }

  return { aliasMap, aliasCounter };
}

const { aliasMap: COMMAND_ALIASES, aliasCounter: TOTAL_ALIASES } = buildAliasMap();

function jidFromNumber(raw) {
  const onlyDigits = (raw || "").replace(/\D/g, "");
  if (!onlyDigits) return null;
  return `${onlyDigits}@s.whatsapp.net`;
}

function extractTargets(sock, message, args) {
  const targets = new Set();
  const mentioned = message.message?.extendedTextMessage?.contextInfo?.mentionedJid || [];
  for (const jid of mentioned) targets.add(jid);

  const quoted = message.message?.extendedTextMessage?.contextInfo?.participant;
  if (quoted) targets.add(quoted);

  for (const arg of args) {
    const jid = jidFromNumber(arg);
    if (jid) targets.add(jid);
  }

  targets.delete(sock.user?.id);
  return [...targets];
}

async function isGroupAdmin(sock, groupJid, senderJid) {
  const metadata = await sock.groupMetadata(groupJid);
  const me = sock.user?.id?.split(":")[0] + "@s.whatsapp.net";
  const meInfo = metadata.participants.find((p) => p.id === me);
  const senderInfo = metadata.participants.find((p) => p.id === senderJid);
  return {
    metadata,
    isSenderAdmin: !!senderInfo?.admin,
    isBotAdmin: !!meInfo?.admin
  };
}

function getSenderNumber(senderJid = "") {
  return senderJid.split("@")[0].split(":")[0];
}

function isOwner(senderJid) {
  const senderNumber = getSenderNumber(senderJid);
  return ownerNumbers.includes(senderNumber);
}

function isAiAllowed(senderJid) {
  const senderNumber = getSenderNumber(senderJid);
  return aiAllowedNumbers.includes(senderNumber);
}

async function generateAiReply(userText) {
  if (!aiApiKey) {
    throw new Error("AI_API_KEY is missing. Add AI env vars on your host.");
  }
  if (typeof fetch !== "function") {
    throw new Error("Runtime does not support fetch. Use Node.js 18+.");
  }

  const response = await fetch(`${aiBaseUrl.replace(/\/$/, "")}/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${aiApiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model: aiModel,
      messages: [
        { role: "system", content: aiSystemPrompt },
        { role: "user", content: userText }
      ],
      temperature: 0.7
    })
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const providerMessage = payload?.error?.message || payload?.message || "Provider request failed.";
    throw new Error(providerMessage);
  }

  const output = payload?.choices?.[0]?.message?.content?.trim();
  if (!output) {
    throw new Error("AI response was empty.");
  }

  return output;
}

function createHeloxSessionId(sock) {
  const identity = sock.user?.id || "unknown";
  const salt = `${identity}|${Date.now()}|helox-md`;
  const digest = crypto.createHash("sha256").update(salt).digest("hex").slice(0, 20).toUpperCase();
  return `HELOX-${digest}`;
}

function saveSessionId(sessionId, ownerJid) {
  fs.mkdirSync("auth_info", { recursive: true });
  fs.writeFileSync(
    sessionFilePath,
    JSON.stringify(
      {
        project: "helox-md",
        sessionId,
        ownerJid: ownerJid || null,
        createdAt: new Date().toISOString()
      },
      null,
      2
    )
  );
}

async function startBot() {
  const { state, saveCreds } = await useMultiFileAuthState("auth_info");
  const { version } = await fetchLatestBaileysVersion();

  const sock = makeWASocket({
    auth: state,
    version,
    printQRInTerminal: false,
    logger: pino({ level: "silent" })
  });

  sock.ev.on("creds.update", saveCreds);

  sock.ev.on("connection.update", async (update) => {
    const { connection, qr, lastDisconnect } = update;

    if (qr && loginMode === "qr") {
      qrcode.generate(qr, { small: true });
      console.log("QR is ready. Scan from WhatsApp > Linked devices.");
    }

    if (connection === "close") {
      const shouldReconnect =
        (lastDisconnect?.error instanceof Boom
          ? lastDisconnect.error.output.statusCode
          : null) !== DisconnectReason.loggedOut;

      console.log("Connection closed:", lastDisconnect?.error?.message || "Unknown");
      if (shouldReconnect) {
        console.log("Reconnecting...");
        startBot();
      } else {
        console.log("Logged out. Delete auth_info to login again.");
      }
    }

    if (connection === "open") {
      console.log(`Bot is online. Loaded ${TOTAL_ALIASES}+ command aliases.`);
      if (!fs.existsSync(sessionFilePath)) {
        const sessionId = createHeloxSessionId(sock);
        saveSessionId(sessionId, sock.user?.id);
        console.log(`HELOX-MD Session ID: ${sessionId}`);
      } else {
        try {
          const data = JSON.parse(fs.readFileSync(sessionFilePath, "utf8"));
          if (data?.sessionId) {
            console.log(`HELOX-MD Session ID: ${data.sessionId}`);
          }
        } catch {
          const sessionId = createHeloxSessionId(sock);
          saveSessionId(sessionId, sock.user?.id);
          console.log(`HELOX-MD Session ID: ${sessionId}`);
        }
      }
    }
  });

  if (loginMode === "pair" && !sock.authState.creds.registered) {
    if (!phoneNumber) {
      console.log("Set PHONE_NUMBER env first, e.g. 25261XXXXXXX");
      process.exit(1);
    }

    const code = await sock.requestPairingCode(phoneNumber);
    const formattedCode = code?.match(/.{1,4}/g)?.join("-") || code;
    console.log(`Your pairing code: ${formattedCode}`);
    console.log("Enter this code in WhatsApp > Linked devices > Link with phone number.");
  }

  sock.ev.on("messages.upsert", async (m) => {
    const message = m.messages?.[0];
    if (!message?.message || message.key.fromMe) return;
    const chatJid = message.key.remoteJid;
    const isGroup = chatJid?.endsWith("@g.us");
    const senderJid = message.key.participant || chatJid;
    const text = getTextFromMessage(message).trim();
    if (!text) return;

    if (isGroup && antiLinkState.get(chatJid) && /(https?:\/\/\S+|wa\.me\/\S+|chat\.whatsapp\.com\/\S+)/i.test(text)) {
      try {
        const { isSenderAdmin, isBotAdmin } = await isGroupAdmin(sock, chatJid, senderJid);
        if (!isSenderAdmin && !isOwner(senderJid) && isBotAdmin) {
          await sock.sendMessage(chatJid, {
            text: `Link detected from @${getSenderNumber(senderJid)}. User will be removed.`,
            mentions: [senderJid]
          });
          await sock.groupParticipantsUpdate(chatJid, [senderJid], "remove");
          return;
        }
      } catch (error) {
        await sock.sendMessage(chatJid, { text: `Anti-link error: ${error?.message || "Unknown error"}` });
      }
    }

    if (!text.startsWith(commandPrefix)) {
      if (!isGroup && isAiAllowed(senderJid)) {
        try {
          const aiReply = await generateAiReply(text);
          await sock.sendMessage(chatJid, { text: aiReply });
        } catch (error) {
          await sock.sendMessage(chatJid, {
            text: `AI error: ${error?.message || "Unknown AI error"}`
          });
        }
      }
      return;
    }
    const args = text.split(/\s+/);
    const commandToken = normalizeCommandToken((args.shift() || "").slice(commandPrefix.length));
    const canonical = COMMAND_ALIASES.get(commandToken);
    if (!canonical) return;

    if (canonical === "ping") {
      await sock.sendMessage(chatJid, { text: "pong" });
      return;
    }

    if (canonical === "help") {
      await sock.sendMessage(chatJid, {
        text: [
          "*Admin Group Commands*",
          "",
          "AI commands:",
          `- ${commandPrefix}ai <your question>`,
          `- ${commandPrefix}aistatus`,
          "",
          "Core commands:",
          "- kick/remove @user or number",
          "- add number",
          "- promote/demote @user",
          "- mute/unmute (close/open group)",
          "- link/revoke",
          "- subject <text>",
          "- desc <text>",
          "- tagall",
          "- hidetag <text>",
          "- admins",
          "- groupinfo",
          "- leave",
          "",
          `Prefix: ${commandPrefix}`,
          "Owner-only: owner, antilink on/off, join <invite_link>",
          `This bot supports ${TOTAL_ALIASES}+ command aliases`
        ].join("\n")
      });
      return;
    }

    if (canonical === "aistatus") {
      const senderNumber = getSenderNumber(senderJid);
      const statusLines = [
        "*HELOX-MD AI Status*",
        `- Sender: ${senderNumber}`,
        `- Allowed: ${isAiAllowed(senderJid) ? "YES" : "NO"}`,
        `- AI_API_KEY: ${aiApiKey ? "SET" : "MISSING"}`,
        `- AI_BASE_URL: ${aiBaseUrl}`,
        `- AI_MODEL: ${aiModel}`,
        `- Auto-DM AI: ${!isGroup && isAiAllowed(senderJid) ? "ACTIVE" : "INACTIVE"}`
      ];
      await sock.sendMessage(chatJid, { text: statusLines.join("\n") });
      return;
    }

    if (canonical === "ai") {
      if (!isAiAllowed(senderJid)) {
        await sock.sendMessage(chatJid, {
          text: "AI is locked for this number. Ask owner to whitelist your number."
        });
        return;
      }
      const prompt = args.join(" ").trim();
      if (!prompt) {
        await sock.sendMessage(chatJid, {
          text: `Usage: ${commandPrefix}ai Explain quantum computing in simple words`
        });
        return;
      }
      await sock.sendMessage(chatJid, { text: "Thinking..." });
      try {
        const aiReply = await generateAiReply(prompt);
        await sock.sendMessage(chatJid, { text: aiReply });
      } catch (error) {
        await sock.sendMessage(chatJid, {
          text: `AI error: ${error?.message || "Unknown AI error"}`
        });
      }
      return;
    }

    if (canonical === "owner") {
      const numbers = ownerNumbers.length ? ownerNumbers : ["Not configured"];
      await sock.sendMessage(chatJid, {
        text: `Owner numbers:\n${numbers.map((n) => `- ${n}`).join("\n")}`
      });
      return;
    }

    if (canonical === "join") {
      if (!isOwner(senderJid)) {
        await sock.sendMessage(chatJid, { text: "This is an owner-only command." });
        return;
      }
      const inviteLink = args.join(" ").trim();
      const inviteCode = inviteLink.match(/chat\.whatsapp\.com\/([A-Za-z0-9]+)/i)?.[1] || inviteLink;
      if (!inviteCode) {
        await sock.sendMessage(chatJid, {
          text: `Usage: ${commandPrefix}join https://chat.whatsapp.com/INVITE_CODE`
        });
        return;
      }
      await sock.groupAcceptInvite(inviteCode);
      await sock.sendMessage(chatJid, { text: "Joined group from invite link." });
      return;
    }

    if (canonical === "setantilink") {
      if (!isOwner(senderJid)) {
        await sock.sendMessage(chatJid, { text: "This is an owner-only command." });
        return;
      }
      if (!isGroup) {
        await sock.sendMessage(chatJid, { text: "Use this command inside a group." });
        return;
      }
      const stateArg = (args[0] || "").toLowerCase();
      if (!["on", "off"].includes(stateArg)) {
        await sock.sendMessage(chatJid, { text: `Usage: ${commandPrefix}antilink on/off` });
        return;
      }
      antiLinkState.set(chatJid, stateArg === "on");
      await sock.sendMessage(chatJid, {
        text: `Anti-link is now ${stateArg.toUpperCase()} for this group.`
      });
      return;
    }

    if (!isGroup) {
      await sock.sendMessage(chatJid, { text: "This command only works in groups." });
      return;
    }

    try {
      const { metadata, isSenderAdmin, isBotAdmin } = await isGroupAdmin(sock, chatJid, senderJid);
      if (!isSenderAdmin) {
        await sock.sendMessage(chatJid, { text: "Only group admins can use this command." });
        return;
      }

      const needsBotAdmin = [
        "kick",
        "add",
        "promote",
        "demote",
        "mute",
        "unmute",
        "revoke",
        "subject",
        "desc"
      ];
      if (needsBotAdmin.includes(canonical) && !isBotAdmin) {
        await sock.sendMessage(chatJid, { text: "I need admin role first." });
        return;
      }

      const targets = extractTargets(sock, message, args);

      if (canonical === "kick") {
        if (!targets.length) {
          await sock.sendMessage(chatJid, { text: "Mention/reply to users or provide numbers." });
          return;
        }
        await sock.groupParticipantsUpdate(chatJid, targets, "remove");
        await sock.sendMessage(chatJid, { text: `Removed ${targets.length} participant(s).` });
        return;
      }

      if (canonical === "add") {
        if (!targets.length) {
          await sock.sendMessage(chatJid, { text: "Provide numbers to add." });
          return;
        }
        await sock.groupParticipantsUpdate(chatJid, targets, "add");
        await sock.sendMessage(chatJid, { text: `Added ${targets.length} participant(s).` });
        return;
      }

      if (canonical === "promote") {
        if (!targets.length) {
          await sock.sendMessage(chatJid, { text: "Mention/reply to users to promote." });
          return;
        }
        await sock.groupParticipantsUpdate(chatJid, targets, "promote");
        await sock.sendMessage(chatJid, { text: `Promoted ${targets.length} participant(s).` });
        return;
      }

      if (canonical === "demote") {
        if (!targets.length) {
          await sock.sendMessage(chatJid, { text: "Mention/reply to users to demote." });
          return;
        }
        await sock.groupParticipantsUpdate(chatJid, targets, "demote");
        await sock.sendMessage(chatJid, { text: `Demoted ${targets.length} participant(s).` });
        return;
      }

      if (canonical === "mute") {
        await sock.groupSettingUpdate(chatJid, "announcement");
        await sock.sendMessage(chatJid, { text: "Group closed. Only admins can send messages now." });
        return;
      }

      if (canonical === "unmute") {
        await sock.groupSettingUpdate(chatJid, "not_announcement");
        await sock.sendMessage(chatJid, { text: "Group opened. Everyone can send messages now." });
        return;
      }

      if (canonical === "link") {
        const inviteCode = await sock.groupInviteCode(chatJid);
        await sock.sendMessage(chatJid, { text: `https://chat.whatsapp.com/${inviteCode}` });
        return;
      }

      if (canonical === "revoke") {
        const inviteCode = await sock.groupRevokeInvite(chatJid);
        await sock.sendMessage(chatJid, { text: `New link: https://chat.whatsapp.com/${inviteCode}` });
        return;
      }

      if (canonical === "subject") {
        const nextSubject = args.join(" ").trim();
        if (!nextSubject) {
          await sock.sendMessage(chatJid, { text: `Usage: ${commandPrefix}subject New Group Name` });
          return;
        }
        await sock.groupUpdateSubject(chatJid, nextSubject);
        await sock.sendMessage(chatJid, { text: "Group subject updated." });
        return;
      }

      if (canonical === "desc") {
        const nextDescription = args.join(" ").trim();
        if (!nextDescription) {
          await sock.sendMessage(chatJid, { text: `Usage: ${commandPrefix}desc New group description` });
          return;
        }
        await sock.groupUpdateDescription(chatJid, nextDescription);
        await sock.sendMessage(chatJid, { text: "Group description updated." });
        return;
      }

      if (canonical === "tagall") {
        const mentions = metadata.participants.map((p) => p.id);
        const lines = mentions.map((jid, idx) => `${idx + 1}. @${jid.split("@")[0]}`);
        await sock.sendMessage(chatJid, { text: lines.join("\n"), mentions });
        return;
      }

      if (canonical === "hidetag") {
        const mentions = metadata.participants.map((p) => p.id);
        const body = args.join(" ").trim() || "Hidden tag for everyone.";
        await sock.sendMessage(chatJid, { text: body, mentions });
        return;
      }

      if (canonical === "admins") {
        const admins = metadata.participants.filter((p) => !!p.admin).map((p) => p.id);
        const textBody =
          admins.length > 0
            ? admins.map((jid, idx) => `${idx + 1}. @${jid.split("@")[0]}`).join("\n")
            : "No admins found.";
        await sock.sendMessage(chatJid, { text: textBody, mentions: admins });
        return;
      }

      if (canonical === "groupinfo") {
        const adminCount = metadata.participants.filter((p) => !!p.admin).length;
        await sock.sendMessage(chatJid, {
          text: [
            `Name: ${metadata.subject || "-"}`,
            `Owner: ${metadata.owner || "-"}`,
            `Members: ${metadata.participants.length}`,
            `Admins: ${adminCount}`,
            `Aliases loaded: ${TOTAL_ALIASES}+`
          ].join("\n")
        });
        return;
      }

      if (canonical === "leave") {
        await sock.sendMessage(chatJid, { text: "Leaving group. Bye!" });
        await sock.groupLeave(chatJid);
      }
    } catch (error) {
      await sock.sendMessage(chatJid, {
        text: `Command failed: ${error?.message || "Unknown error"}`
      });
    }
  });
}

startBot().catch((err) => {
  console.error("Bot start error:", err);
  process.exit(1);
});
