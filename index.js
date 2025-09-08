const { makeWASocket, useMultiFileAuthState, DisconnectReason, Browsers } = require('@whiskeysockets/baileys');
const fs = require('fs');
const fetch = require('node-fetch');
const qrcode = require('qrcode-terminal');

console.log('🚀 Starting WhatsApp Bot on Replit...');

// Replit-specific setup
const authFolder = './auth'; // Use local folder for persistence
const COMMANDS_FILE = "commands.json";

// Load saved commands
let customCommands = {};
if (fs.existsSync(COMMANDS_FILE)) {
  try {
    customCommands = JSON.parse(fs.readFileSync(COMMANDS_FILE, "utf8"));
  } catch (err) {
    console.error("⚠️ Error loading commands:", err);
    customCommands = {};
  }
}

// Save helper
function saveCommands() {
  fs.writeFileSync(COMMANDS_FILE, JSON.stringify(customCommands, null, 2));
}

// Track pending replies
let waitingForResponse = {};

// Logger for Replit
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

// Store QR code for easy scanning
let currentQR = null;

async function startBot() {
    try {
        const { state, saveCreds } = await useMultiFileAuthState(authFolder);
        
        const sock = makeWASocket({
            auth: state,
            logger: logger,
            browser: Browsers.ubuntu('Chrome'),
            printQRInTerminal: false
        });

        sock.ev.on('creds.update', saveCreds);
        
        sock.ev.on('connection.update', (update) => {
            const { connection, lastDisconnect, qr } = update;
            
            if (qr) {
                console.log('\n📲 SCAN THIS QR CODE WITH WHATSAPP:');
                console.log('====================================');
                qrcode.generate(qr, { small: true });
                console.log('====================================');
                currentQR = qr;
            }
            
            if (connection === 'close') {
                const shouldReconnect = lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut;
                console.log('🔌 Connection closed, reconnecting...');
                if (shouldReconnect) {
                    setTimeout(startBot, 3000);
                }
            } else if (connection === 'open') {
                console.log('✅ Bot is ready and connected!');
                currentQR = null;
            }
        });

        sock.ev.on('messages.upsert', async ({ messages }) => {
            try {
                const msg = messages[0];
                if (!msg.message || msg.key.fromMe) return;
                
                const from = msg.key.remoteJid;
                const text = msg.message.conversation || 
                             msg.message.extendedTextMessage?.text || 
                             msg.message.buttonsResponseMessage?.selectedButtonId || 
                             "";

                console.log('📩 Received message:', text);

                if (!text.startsWith(".")) return;

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
                            // For Replit, we'll use mock data since outgoing connections are limited
                            const mockData = {
                                username: `MLBB_Player_${userId.slice(-4)}`,
                                level: Math.floor(Math.random() * 100) + 1,
                                rank: ["Warrior", "Elite", "Master", "Grandmaster", "Epic", "Legend", "Mythic"][Math.floor(Math.random() * 7)]
                            };

                            await sock.sendMessage(from, { 
                                text: `🔍 ML Account Info\n\n🆔 User ID: ${userId}\n🌍 Zone: ${zoneId}\n👤 Nickname: ${mockData.username}\n⭐ Level: ${mockData.level}\n🏆 Rank: ${mockData.rank}\n\n⚠️ Running in demo mode (Replit network restrictions)`
                            });
                        } catch (err) {
                            console.error("Stalk error:", err);
                            await sock.sendMessage(from, { text: "❌ Error fetching account info." });
                        }
                        break;
                    }

                    case "help":
                        await sock.sendMessage(from, {
                            text: "📌 Commands:\n" +
                                ".ping - Test bot response\n" +
                                ".addlist <cmd> || <response> - Add custom command\n" +
                                ".addlist <cmd> - Then send response\n" +
                                ".commands - List all custom commands\n" +
                                ".dellist <cmd> - Delete custom command\n" +
                                ".stalk <uid> <zone> - Check ML account (demo)\n" +
                                ".help - Show this help\n\n" +
                                "➡️ Custom commands: .hello, .bye, etc."
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

        // Keep Repl alive
        console.log('🤖 Bot is running...');
        setInterval(() => {
            console.log('💓 Heartbeat - Keeping repl alive');
        }, 60000);

    } catch (err) {
        console.error('❌ Failed to start bot:', err);
        setTimeout(startBot, 5000);
    }
}

// Start the bot
startBot();

// Handle Replit shutdown
process.on('SIGINT', () => {
    console.log('🛑 Shutting down bot...');
    process.exit(0);
});