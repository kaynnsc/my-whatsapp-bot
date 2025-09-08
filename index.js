const { makeWASocket, useMultiFileAuthState, DisconnectReason, Browsers } = require('@whiskeysockets/baileys');
const fs = require('fs');
const qrcode = require('qrcode-terminal');

console.log('🚀 Starting WhatsApp Bot on Replit...');

// Replit-specific setup
const authFolder = './auth';
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
    trace: () => {}, debug: () => {}, info: () => {},
    warn: console.warn, error: console.error, fatal: console.error,
    child: () => logger
};

// Store QR code for easy scanning
let currentQR = null;

// Mock MLBB data generator (since APIs are blocked)
function generateMockMLBBData(userId, zoneId) {
    // Create consistent data based on user ID
    const seed = parseInt(userId) % 1000;
    const usernames = [
        "MLProPlayer", "EpicGamer", "MythicWarrior", "LegendSlayer", 
        "NoobMaster", "CarryKing", "TankMaster", "MageExpert",
        "AssassinPro", "SupportQueen", "JungleGod", "LaneDominator"
    ];
    
    const ranks = ["Warrior", "Elite", "Master", "Grandmaster", "Epic", "Legend", "Mythic"];
    const heroes = ["Layla", "Miya", "Alucard", "Tigreal", "Eudora", "Zilong", "Balmond"];
    
    const username = usernames[seed % usernames.length];
    const rank = ranks[seed % ranks.length];
    const level = (seed % 100) + 1;
    const mainHero = heroes[seed % heroes.length];
    const winRate = (70 + (seed % 30)) + '%';
    const matches = (500 + (seed % 1500));
    
    return {
        username,
        rank,
        level,
        mainHero,
        winRate,
        matches
    };
}

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
                            // Generate realistic mock data since APIs are blocked
                            const mockData = generateMockMLBBData(userId, zoneId);
                            
                            await sock.sendMessage(from, { 
                                text: `🔍 ML Account Info\n\n🆔 User ID: ${userId}\n🌍 Zone: ${zoneId}\n👤 Nickname: ${mockData.username}\n⭐ Level: ${mockData.level}\n🏆 Rank: ${mockData.rank}\n⚔️ Main Hero: ${mockData.mainHero}\n📊 Win Rate: ${mockData.winRate}\n🎮 Matches: ${mockData.matches}\n\nℹ️ Using demo data (Replit network restrictions)`
                            });
                        } catch (err) {
                            console.error("Stalk error:", err);
                            await sock.sendMessage(from, { text: "❌ Error generating account info." });
                        }
                        break;
                    }

                    case "status":
                        await sock.sendMessage(from, {
                            text: `🤖 Bot Status\n\n✅ Online: Yes\n🏠 Host: Replit\n📊 Commands: ${Object.keys(customCommands).length}\n🌐 API: Demo Mode\n\nThe bot is running on Replit with simulated data due to platform restrictions.`
                        });
                        break;

                    case "help":
                        await sock.sendMessage(from, {
                            text: "📌 Available Commands:\n" +
                                ".ping - Test bot response\n" +
                                ".addlist <cmd> || <response> - Add custom command\n" +
                                ".addlist <cmd> - Then send response\n" +
                                ".commands - List all custom commands\n" +
                                ".dellist <cmd> - Delete custom command\n" +
                                ".stalk <uid> <zone> - Check ML account (demo data)\n" +
                                ".status - Show bot status\n" +
                                ".help - Show this help\n\n" +
                                "⚠️ Note: Running on Replit - some features use demo data"
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