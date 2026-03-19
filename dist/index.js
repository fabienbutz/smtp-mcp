#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import nodemailer from "nodemailer";
import { ImapFlow } from "imapflow";
import { simpleParser } from "mailparser";
// --- Shared utilities ---
function errorResponse(message) {
    return { content: [{ type: "text", text: message }], isError: true };
}
function sanitizeName(name) {
    return name.replace(/["\\<>\r\n]/g, "");
}
function formatAddr(addr) {
    if (addr.name && addr.address)
        return `${addr.name} <${addr.address}>`;
    return addr.address || addr.name || "–";
}
function formatSize(bytes) {
    if (bytes < 1024)
        return `${bytes} B`;
    if (bytes < 1024 * 1024)
        return `${(bytes / 1024).toFixed(0)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
// --- SMTP ---
let transporter = null;
function getTransporter() {
    if (transporter)
        return transporter;
    const host = process.env.SMTP_HOST;
    const port = parseInt(process.env.SMTP_PORT || "465", 10);
    const user = process.env.SMTP_USER;
    const pass = process.env.SMTP_PASS;
    if (!host || !user || !pass) {
        throw new Error("SMTP_HOST, SMTP_USER, and SMTP_PASS environment variables are required");
    }
    transporter = nodemailer.createTransport({
        host, port, secure: port === 465,
        auth: { user, pass },
        pool: true, maxConnections: 3,
    });
    return transporter;
}
function getSmtpUser() {
    const user = process.env.SMTP_USER;
    if (!user)
        throw new Error("SMTP_USER environment variable is required");
    return user;
}
// --- IMAP ---
async function withImap(fn) {
    const host = process.env.IMAP_HOST;
    const port = parseInt(process.env.IMAP_PORT || "993", 10);
    const user = process.env.IMAP_USER || process.env.SMTP_USER;
    const pass = process.env.IMAP_PASS || process.env.SMTP_PASS;
    if (!host || !user || !pass) {
        throw new Error("IMAP_HOST is required. IMAP_USER/IMAP_PASS default to SMTP credentials if not set.");
    }
    const client = new ImapFlow({
        host, port, secure: port === 993,
        auth: { user, pass },
        logger: false,
    });
    await client.connect();
    try {
        return await fn(client);
    }
    finally {
        await client.logout();
    }
}
// --- Server ---
const server = new McpServer({ name: "email", version: "1.0.0" });
// ===================== SMTP TOOLS =====================
server.tool("email_send", "Send an email via SMTP. Supports text and HTML body, CC, BCC, reply-to, and file attachments (via URL or base64 only).", {
    to: z.union([z.string().email(), z.array(z.string().email())]).describe("Recipient email(s) (required)"),
    subject: z.string().describe("Email subject (required)"),
    text: z.string().optional().describe("Plain text body"),
    html: z.string().optional().describe("HTML body (alternative to text)"),
    cc: z.union([z.string().email(), z.array(z.string().email())]).optional().describe("CC recipient(s)"),
    bcc: z.union([z.string().email(), z.array(z.string().email())]).optional().describe("BCC recipient(s)"),
    reply_to: z.string().email().optional().describe("Reply-to address"),
    from_name: z.string().optional().describe("Sender display name (default: SMTP_FROM_NAME or SMTP_USER)"),
    attachments: z.array(z.object({
        filename: z.string().describe("Attachment filename"),
        url: z.string().url().optional().describe("URL to download attachment from"),
        content: z.string().optional().describe("Base64 encoded content (alternative to url)"),
        content_type: z.string().optional().describe("MIME type (e.g. application/pdf)"),
    })).optional().describe("File attachments (via URL or base64)"),
}, async (params) => {
    try {
        const smtp = getTransporter();
        const user = getSmtpUser();
        const fromName = sanitizeName(params.from_name || process.env.SMTP_FROM_NAME || user);
        if (!params.text && !params.html) {
            return errorResponse("Fehler: text oder html Body ist erforderlich.");
        }
        const attachments = params.attachments?.map((a) => {
            const att = { filename: a.filename };
            if (a.url)
                att.path = a.url;
            if (a.content)
                att.content = Buffer.from(a.content, "base64");
            if (a.content_type)
                att.contentType = a.content_type;
            return att;
        });
        const info = await smtp.sendMail({
            from: `"${fromName}" <${user}>`,
            to: Array.isArray(params.to) ? params.to.join(", ") : params.to,
            cc: params.cc ? (Array.isArray(params.cc) ? params.cc.join(", ") : params.cc) : undefined,
            bcc: params.bcc ? (Array.isArray(params.bcc) ? params.bcc.join(", ") : params.bcc) : undefined,
            replyTo: params.reply_to,
            subject: params.subject,
            text: params.text,
            html: params.html,
            attachments,
        });
        const to = Array.isArray(params.to) ? params.to.join(", ") : params.to;
        return {
            content: [{
                    type: "text",
                    text: [
                        "Email gesendet!",
                        `An: ${to}`,
                        params.cc ? `CC: ${params.cc}` : null,
                        params.bcc ? `BCC: ${params.bcc}` : null,
                        `Betreff: ${params.subject}`,
                        `Message-ID: ${info.messageId}`,
                    ].filter(Boolean).join("\n"),
                }],
        };
    }
    catch (err) {
        return errorResponse(`Fehler beim Senden: ${err instanceof Error ? err.message : String(err)}`);
    }
});
server.tool("email_verify", "Test the SMTP connection. Returns success if credentials and server are working.", {}, async () => {
    try {
        const smtp = getTransporter();
        await smtp.verify();
        return {
            content: [{
                    type: "text",
                    text: `SMTP-Verbindung erfolgreich!\nServer: ${process.env.SMTP_HOST}:${process.env.SMTP_PORT || 465}\nUser: ${process.env.SMTP_USER}`,
                }],
        };
    }
    catch (err) {
        return errorResponse(`SMTP-Verbindung fehlgeschlagen: ${err instanceof Error ? err.message : String(err)}`);
    }
});
// ===================== IMAP TOOLS =====================
server.tool("email_folders", "List all email folders/mailboxes (e.g. INBOX, Sent, Trash, Drafts).", {}, async () => {
    try {
        return await withImap(async (client) => {
            const folders = await client.list();
            const lines = folders.map((f) => {
                const flags = [];
                if (f.specialUse === "\\Sent")
                    flags.push("Gesendet");
                if (f.specialUse === "\\Trash")
                    flags.push("Papierkorb");
                if (f.specialUse === "\\Drafts")
                    flags.push("Entwürfe");
                if (f.specialUse === "\\Junk")
                    flags.push("Spam");
                if (f.specialUse === "\\Archive")
                    flags.push("Archiv");
                const info = flags.length ? ` [${flags.join(", ")}]` : "";
                return `  • ${f.path}${info}`;
            });
            return { content: [{ type: "text", text: `${folders.length} Ordner:\n${lines.join("\n")}` }] };
        });
    }
    catch (err) {
        return errorResponse(`Fehler: ${err instanceof Error ? err.message : String(err)}`);
    }
});
server.tool("email_list", "List recent emails in a folder. Returns newest first with UID, date, sender, subject, and read status.", {
    folder: z.string().optional().describe("Folder path (default: INBOX)"),
    limit: z.number().optional().describe("Max emails to return (default 20, max 100)"),
}, async (params) => {
    try {
        return await withImap(async (client) => {
            const folder = params.folder || "INBOX";
            const limit = Math.min(params.limit || 20, 100);
            const mailbox = await client.mailboxOpen(folder);
            const total = mailbox.exists;
            if (total === 0) {
                return { content: [{ type: "text", text: `${folder}: Keine Emails vorhanden.` }] };
            }
            const start = Math.max(1, total - limit + 1);
            const messages = [];
            for await (const msg of client.fetch(`${start}:*`, { envelope: true, flags: true, uid: true })) {
                const env = msg.envelope;
                const flagList = [];
                if (msg.flags && !msg.flags.has("\\Seen"))
                    flagList.push("ungelesen");
                if (msg.flags?.has("\\Answered"))
                    flagList.push("beantwortet");
                if (msg.flags?.has("\\Flagged"))
                    flagList.push("★");
                messages.push({
                    uid: msg.uid,
                    date: env?.date?.toISOString().split("T")[0] || "–",
                    from: env?.from?.[0] ? formatAddr(env.from[0]) : "–",
                    subject: env?.subject || "(kein Betreff)",
                    flags: flagList.length ? ` [${flagList.join(", ")}]` : "",
                });
            }
            messages.reverse();
            const lines = messages.map((m) => `  • [UID ${m.uid}] ${m.date} | ${m.from} | ${m.subject}${m.flags}`);
            return {
                content: [{
                        type: "text",
                        text: `${folder} (${total} gesamt, zeige ${messages.length}):\n${lines.join("\n")}`,
                    }],
            };
        });
    }
    catch (err) {
        return errorResponse(`Fehler: ${err instanceof Error ? err.message : String(err)}`);
    }
});
server.tool("email_read", "Read a specific email by UID. Returns headers, text body, and attachment list. Use email_list first to get UIDs.", {
    uid: z.number().describe("Email UID (required, from email_list)"),
    folder: z.string().optional().describe("Folder path (default: INBOX)"),
    mark_read: z.boolean().optional().describe("Mark as read after opening (default true)"),
}, async (params) => {
    try {
        return await withImap(async (client) => {
            const folder = params.folder || "INBOX";
            await client.mailboxOpen(folder);
            const uidStr = String(params.uid);
            let source;
            for await (const msg of client.fetch({ uid: uidStr }, { source: true })) {
                source = msg.source;
            }
            if (!source) {
                return errorResponse(`Email mit UID ${params.uid} nicht gefunden.`);
            }
            const parsed = await simpleParser(source);
            if (params.mark_read !== false) {
                await client.messageFlagsAdd({ uid: uidStr }, ["\\Seen"]);
            }
            const lines = [
                `Email [UID ${params.uid}]`,
                `Von: ${parsed.from ? formatAddr(parsed.from.value[0]) : "–"}`,
                `An: ${parsed.to ? (Array.isArray(parsed.to) ? parsed.to.map(a => a.text).join(", ") : parsed.to.text) : "–"}`,
                parsed.cc ? `CC: ${Array.isArray(parsed.cc) ? parsed.cc.map(a => a.text).join(", ") : parsed.cc.text}` : null,
                `Datum: ${parsed.date?.toLocaleString("de-DE") || "–"}`,
                `Betreff: ${parsed.subject || "(kein Betreff)"}`,
                parsed.messageId ? `Message-ID: ${parsed.messageId}` : null,
                "",
                "--- Inhalt ---",
                parsed.text || (typeof parsed.html === "string" ? parsed.html.replace(/<[^>]+>/g, " ").substring(0, 5000) : "(kein Inhalt)"),
            ];
            if (parsed.attachments?.length) {
                lines.push("", "--- Anhänge ---");
                for (const att of parsed.attachments) {
                    lines.push(`  • ${att.filename || "unbenannt"} (${att.contentType}, ${formatSize(att.size)})`);
                }
            }
            return { content: [{ type: "text", text: lines.filter((l) => l !== null).join("\n") }] };
        });
    }
    catch (err) {
        return errorResponse(`Fehler: ${err instanceof Error ? err.message : String(err)}`);
    }
});
server.tool("email_search", "Search emails by sender, subject, body text, date range, or read status. Returns matching UIDs with summary.", {
    folder: z.string().optional().describe("Folder to search (default: INBOX)"),
    from: z.string().optional().describe("Search in sender"),
    to: z.string().optional().describe("Search in recipient"),
    subject: z.string().optional().describe("Search in subject"),
    body: z.string().optional().describe("Search in email body"),
    since: z.string().optional().describe("Emails since date (YYYY-MM-DD)"),
    before: z.string().optional().describe("Emails before date (YYYY-MM-DD)"),
    unseen: z.boolean().optional().describe("Only unread emails"),
    flagged: z.boolean().optional().describe("Only flagged/starred emails"),
    limit: z.number().optional().describe("Max results (default 50)"),
}, async (params) => {
    try {
        return await withImap(async (client) => {
            const folder = params.folder || "INBOX";
            await client.mailboxOpen(folder);
            const query = {};
            if (params.from)
                query.from = params.from;
            if (params.to)
                query.to = params.to;
            if (params.subject)
                query.subject = params.subject;
            if (params.body)
                query.body = params.body;
            if (params.since)
                query.since = new Date(params.since);
            if (params.before)
                query.before = new Date(params.before);
            if (params.unseen)
                query.seen = false;
            if (params.flagged)
                query.flagged = true;
            if (Object.keys(query).length === 0) {
                return errorResponse("Mindestens ein Suchkriterium ist erforderlich.");
            }
            const searchResult = await client.search(query, { uid: true });
            const uidList = Array.isArray(searchResult) ? searchResult : [];
            const limit = Math.min(params.limit || 50, 100);
            const limitedUids = uidList.slice(-limit);
            if (limitedUids.length === 0) {
                return { content: [{ type: "text", text: `Keine Ergebnisse in ${folder}.` }] };
            }
            const messages = [];
            const uidRange = limitedUids.join(",");
            for await (const msg of client.fetch({ uid: uidRange }, { envelope: true, uid: true })) {
                const env = msg.envelope;
                messages.push({
                    uid: msg.uid,
                    date: env?.date?.toISOString().split("T")[0] || "–",
                    from: env?.from?.[0] ? formatAddr(env.from[0]) : "–",
                    subject: env?.subject || "(kein Betreff)",
                });
            }
            messages.reverse();
            const lines = messages.map((m) => `  • [UID ${m.uid}] ${m.date} | ${m.from} | ${m.subject}`);
            return {
                content: [{
                        type: "text",
                        text: `${uidList.length} Treffer in ${folder} (zeige ${messages.length}):\n${lines.join("\n")}`,
                    }],
            };
        });
    }
    catch (err) {
        return errorResponse(`Fehler: ${err instanceof Error ? err.message : String(err)}`);
    }
});
server.tool("email_move", "Move an email to another folder.", {
    uid: z.number().describe("Email UID to move (required)"),
    folder: z.string().optional().describe("Source folder (default: INBOX)"),
    destination: z.string().describe("Destination folder (required, e.g. 'Archiv', 'Trash')"),
}, async (params) => {
    try {
        return await withImap(async (client) => {
            const folder = params.folder || "INBOX";
            await client.mailboxOpen(folder);
            await client.messageMove({ uid: String(params.uid) }, params.destination);
            return {
                content: [{
                        type: "text",
                        text: `Email [UID ${params.uid}] verschoben: ${folder} → ${params.destination}`,
                    }],
            };
        });
    }
    catch (err) {
        return errorResponse(`Fehler: ${err instanceof Error ? err.message : String(err)}`);
    }
});
server.tool("email_delete", "Delete an email. Moves to Trash by default, or permanently deletes if permanent=true.", {
    uid: z.number().describe("Email UID to delete (required)"),
    folder: z.string().optional().describe("Source folder (default: INBOX)"),
    permanent: z.boolean().optional().describe("Permanently delete instead of moving to Trash (default false)"),
}, async (params) => {
    try {
        return await withImap(async (client) => {
            const folder = params.folder || "INBOX";
            await client.mailboxOpen(folder);
            if (params.permanent) {
                await client.messageDelete({ uid: String(params.uid) });
                return { content: [{ type: "text", text: `Email [UID ${params.uid}] endgültig gelöscht.` }] };
            }
            // Find Trash folder
            const folders = await client.list();
            const trash = folders.find((f) => f.specialUse === "\\Trash");
            const trashPath = trash?.path || "Trash";
            await client.messageMove({ uid: String(params.uid) }, trashPath);
            return { content: [{ type: "text", text: `Email [UID ${params.uid}] in Papierkorb verschoben.` }] };
        });
    }
    catch (err) {
        return errorResponse(`Fehler: ${err instanceof Error ? err.message : String(err)}`);
    }
});
server.tool("email_reply", "Reply to an email. Reads the original via IMAP, then sends the reply via SMTP with proper headers (In-Reply-To, References, Re: subject).", {
    uid: z.number().describe("UID of the email to reply to (required)"),
    folder: z.string().optional().describe("Folder of the original email (default: INBOX)"),
    text: z.string().optional().describe("Reply text body"),
    html: z.string().optional().describe("Reply HTML body"),
    reply_all: z.boolean().optional().describe("Reply to all recipients (default false)"),
    from_name: z.string().optional().describe("Sender display name"),
}, async (params) => {
    try {
        if (!params.text && !params.html) {
            return errorResponse("Fehler: text oder html Body ist erforderlich.");
        }
        // Read original via IMAP
        const original = await withImap(async (client) => {
            const folder = params.folder || "INBOX";
            await client.mailboxOpen(folder);
            let source;
            for await (const msg of client.fetch({ uid: String(params.uid) }, { source: true })) {
                source = msg.source;
            }
            if (!source)
                throw new Error(`Email mit UID ${params.uid} nicht gefunden.`);
            return simpleParser(source);
        });
        // Build reply
        const smtp = getTransporter();
        const user = getSmtpUser();
        const fromName = sanitizeName(params.from_name || process.env.SMTP_FROM_NAME || user);
        const replyTo = original.replyTo?.value?.[0]?.address || original.from?.value?.[0]?.address;
        if (!replyTo)
            return errorResponse("Absenderadresse des Originals nicht gefunden.");
        const toAddresses = [replyTo];
        if (params.reply_all && original.to) {
            const tos = Array.isArray(original.to) ? original.to : [original.to];
            for (const group of tos) {
                for (const addr of group.value) {
                    if (addr.address && addr.address.toLowerCase() !== user.toLowerCase() && !toAddresses.includes(addr.address)) {
                        toAddresses.push(addr.address);
                    }
                }
            }
        }
        let ccAddresses;
        if (params.reply_all && original.cc) {
            const ccs = Array.isArray(original.cc) ? original.cc : [original.cc];
            ccAddresses = [];
            for (const group of ccs) {
                for (const addr of group.value) {
                    if (addr.address && addr.address.toLowerCase() !== user.toLowerCase()) {
                        ccAddresses.push(addr.address);
                    }
                }
            }
            if (ccAddresses.length === 0)
                ccAddresses = undefined;
        }
        const subject = original.subject?.startsWith("Re:") ? original.subject : `Re: ${original.subject || ""}`;
        const references = original.references
            ? [...(Array.isArray(original.references) ? original.references : [original.references])]
            : [];
        if (original.messageId)
            references.push(original.messageId);
        const quotedText = original.text
            ? `\n\n--- Ursprüngliche Nachricht ---\nVon: ${original.from?.text || "–"}\nDatum: ${original.date?.toLocaleString("de-DE") || "–"}\nBetreff: ${original.subject || ""}\n\n${original.text}`
            : "";
        const info = await smtp.sendMail({
            from: `"${fromName}" <${user}>`,
            to: toAddresses.join(", "),
            cc: ccAddresses?.join(", "),
            subject,
            text: params.text ? params.text + quotedText : undefined,
            html: params.html,
            inReplyTo: original.messageId || undefined,
            references: references.length ? references.join(" ") : undefined,
        });
        return {
            content: [{
                    type: "text",
                    text: [
                        "Antwort gesendet!",
                        `An: ${toAddresses.join(", ")}`,
                        ccAddresses ? `CC: ${ccAddresses.join(", ")}` : null,
                        `Betreff: ${subject}`,
                        `Message-ID: ${info.messageId}`,
                    ].filter(Boolean).join("\n"),
                }],
        };
    }
    catch (err) {
        return errorResponse(`Fehler: ${err instanceof Error ? err.message : String(err)}`);
    }
});
// ===================== MAIN =====================
async function main() {
    const transport = new StdioServerTransport();
    await server.connect(transport);
}
main().catch((error) => {
    console.error("Fatal error:", error);
    process.exit(1);
});
//# sourceMappingURL=index.js.map