const { makeWASocket, useMultiFileAuthState, DisconnectReason, Browsers } = require('@whiskeysockets/baileys');
const fs = require('fs');
const fetch = require('node-fetch');
const qrcode = require('qrcode-terminal');

// Group ID (update if needed)
const TARGET_GROUP = process.env.TARGET_GROUP || "120363401370771222@g.us";
const COMMANDS_FILE = "commands.json";

// Load saved commands
let customCommands = {};
if (fs.existsSync(COMMANDS_FILE)) {
  try {
    customCommands = JSON.parse(fs.readFileSync(COMMANDS_FILE, "utf8"));
  } catch (err) {
    console.error("⚠️ Error loading commands.json:", err);
    customCommands = {};
  }
}

// Save helper
function saveCommands() {
  fs.writeFileSync(COMMANDS_FILE, JSON.stringify(customCommands, null, 2));
}

// Track pending replies
let waitingForResponse = {};

// Create a proper logger object
const logger = {
    level: 'silent',
    trace: () => {},
    debug: () => {},
    info: () => {},
    warn: console.warn,
    error: console.error,
    fatal: console.error,
    child: () => logger
};

// Store QR code for web display
let currentQR = null;

async function startBot() {
    const { state, saveCreds } = await useMultiFileAuthState('auth');
    
    const sock = makeWASocket({
        auth: state,
        logger: logger,
        browser: Browsers.ubuntu('Chrome'),
        printQRInTerminal: false // We'll handle QR manually
    });

    sock.ev.on('creds.update', saveCreds);
    
    sock.ev.on('connection.update', (update) => {
        const { connection, lastDisconnect, qr } = update;
        
        if (qr) {
            console.log('📲 QR Code received');
            currentQR = qr;
            qrcode.generate(qr, { small: true });
        }
        
        if (connection === 'close') {
            const shouldReconnect = lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut;
            console.log('Connection closed due to ', lastDisconnect?.error?.message || 'unknown error');
            
            if (shouldReconnect) {
                console.log('Reconnecting in 3 seconds...');
                setTimeout(startBot, 3000);
            }
        } else if (connection === 'open') {
            console.log('✅ Bot is ready and connected!');
            currentQR = null; // Clear QR after successful connection
        }
    });

    sock.ev.on('messages.upsert', async ({ messages }) => {
        try {
            const msg = messages[0];
            if (!msg.message || msg.key.fromMe) return; // ignore self
            
            const from = msg.key.remoteJid;
            if (from !== TARGET_GROUP) return; // only target group

            // Extract message text
            const text = msg.message.conversation || 
                         msg.message.extendedTextMessage?.text || 
                         msg.message.buttonsResponseMessage?.selectedButtonId || 
                         "";

            if (!text.startsWith(".")) return;

            // Get sender info
            const sender = msg.key.participant || msg.key.remoteJid;

            // If waiting for reply text to save command
            if (waitingForResponse[sender]) {
                const { command } = waitingForResponse[sender];
                customCommands[command] = text;
                saveCommands();
                delete waitingForResponse[sender];
                await sock.sendMessage(from, { text: `✅ Command .${command} added.` });
                return;
            }

            const [cmd, ...args] = text.slice(1).split(" ");
            const lowerCmd = cmd.toLowerCase();

            switch (lowerCmd) {
                case "ping":
                    await sock.sendMessage(from, { text: "pong 🏓" });
                    break;

                case "addlist": {
                    const input = args.join(" ");
                    if (!input) {
                        await sock.sendMessage(from, { text: "❌ Usage: .addlist <command> || <response> OR .addlist <command> (then send response)" });
                        return;
                    }

                    if (input.includes("||")) {
                        const [newCommand, response] = input.split("||").map((s) => s.trim());
                        if (!newCommand || !response) {
                            await sock.sendMessage(from, { text: "❌ Invalid format. Use: .addlist hi || hello" });
                            return;
                        }
                        customCommands[newCommand] = response;
                        saveCommands();
                        await sock.sendMessage(from, { text: `✅ Command .${newCommand} added with response.` });
                    } else {
                        if (customCommands[input]) {
                            await sock.sendMessage(from, { text: `⚠️ Command .${input} already exists.` });
                            return;
                        }
                        waitingForResponse[sender] = { command: input };
                        await sock.sendMessage(from, { text: `✍️ Now send the reply text for .${input}` });
                    }
                    break;
                }

                case "commands":
                    if (Object.keys(customCommands).length === 0) {
                        await sock.sendMessage(from, { text: "📭 No custom commands yet." });
                    } else {
                        const commandList = "📌 Custom commands:\n" +
                            Object.keys(customCommands)
                                .map((c) => `.${c}`)
                                .join("\n");
                        await sock.sendMessage(from, { text: commandList });
                    }
                    break;

                case "dellist": {
                    const delCommand = args.join(" ");
                    if (!delCommand) {
                        await sock.sendMessage(from, { text: "❌ Usage: .dellist <command>" });
                        return;
                    }
                    if (!customCommands[delCommand]) {
                        await sock.sendMessage(from, { text: `❌ Command .${delCommand} not found.` });
                        return;
                    }
                    delete customCommands[delCommand];
                    saveCommands();
                    await sock.sendMessage(from, { text: `🗑️ Deleted command .${delCommand}` });
                    break;
                }

                case "stalk": {
                    if (args.length < 2) {
                        await sock.sendMessage(from, { text: "❌ Usage: .stalk <userId> <zoneId>" });
                        return;
                    }

                    const userId = args[0];
                    const zoneId = args[1];

                    try {
                        const controller = new AbortController();
                        const timeoutId = setTimeout(() => controller.abort(), 10000);

                        const res = await fetch("https://order.codashop.com/id/initPayment.action", {
                            method: "POST",
                            headers: {
                                "Content-Type": "application/x-www-form-urlencoded",
                            },
                            body: new URLSearchParams({
                                voucherPricePointId: "240631",
                                voucherTypeName: "MOBILE_LEGENDS",
                                userId,
                                zoneId,
                                paymentChannelId: "302",
                                checkoutId: Date.now().toString(),
                                iapRefId: "",
                            }),
                            signal: controller.signal
                        });

                        clearTimeout(timeoutId);

                        const data = await res.json();

                        if (!data.confirmationFields || !data.confirmationFields.username) {
                            await sock.sendMessage(from, { text: "❌ Invalid UID or Zone." });
                            return;
                        }

                        await sock.sendMessage(from, { 
                            text: `🔍 ML Account Info\n\n🆔 User ID: ${userId}\n🌍 Zone: ${zoneId}\n👤 Nickname: ${data.confirmationFields.username}`
                        });
                    } catch (err) {
                        console.error("Stalk API error:", err);
                        await sock.sendMessage(from, { text: "❌ Failed to fetch ML account info. Please try again later." });
                    }
                    break;
                }

                case "help":
                    await sock.sendMessage(from, {
                        text: "📌 Commands:\n" +
                            ".ping\n" +
                            ".addlist <command> || <response>\n" +
                            ".addlist <command> (then send response)\n" +
                            ".commands (list all)\n" +
                            ".dellist <command>\n" +
                            ".stalk <userId> <zoneId>\n" +
                            ".help\n\n" +
                            "➡️ And you can use custom commands like .hello, .bye, etc."
                    });
                    break;

                default: {
                    const fullCmd = text.slice(1);
                    if (customCommands[fullCmd]) {
                        await sock.sendMessage(from, { text: customCommands[fullCmd] });
                    }
                    break;
                }
            }
        } catch (err) {
            console.error("⚠️ Error handling message:", err);
        }
    });

    // Keep the process alive
    setInterval(() => {}, 1000);
}

console.log('🚀 Starting WhatsApp Bot on Render...');
startBot().catch(err => {
    console.error('Failed to start bot:', err);
    process.exit(1);
});