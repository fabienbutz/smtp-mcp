#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import nodemailer from "nodemailer";
import type Mail from "nodemailer/lib/mailer/index.js";

let transporter: nodemailer.Transporter | null = null;

function getTransporter(): nodemailer.Transporter {
  if (transporter) return transporter;

  const host = process.env.SMTP_HOST;
  const port = parseInt(process.env.SMTP_PORT || "465", 10);
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;

  if (!host || !user || !pass) {
    throw new Error("SMTP_HOST, SMTP_USER, and SMTP_PASS environment variables are required");
  }

  transporter = nodemailer.createTransport({
    host,
    port,
    secure: port === 465,
    auth: { user, pass },
    pool: true,
    maxConnections: 3,
  });

  return transporter;
}

function getSmtpUser(): string {
  const user = process.env.SMTP_USER;
  if (!user) throw new Error("SMTP_USER environment variable is required");
  return user;
}

function sanitizeName(name: string): string {
  return name.replace(/["\\<>\r\n]/g, "");
}

function errorResponse(message: string) {
  return { content: [{ type: "text" as const, text: message }], isError: true };
}

const server = new McpServer({
  name: "smtp",
  version: "1.0.0",
});

server.tool(
  "email_send",
  "Send an email via SMTP. Supports text and HTML body, CC, BCC, reply-to, and file attachments (via URL or base64 only, no local file paths).",
  {
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
  },
  async (params) => {
    try {
      const smtp = getTransporter();
      const user = getSmtpUser();
      const fromName = sanitizeName(params.from_name || process.env.SMTP_FROM_NAME || user);

      if (!params.text && !params.html) {
        return errorResponse("Fehler: text oder html Body ist erforderlich.");
      }

      const attachments: Mail.Attachment[] | undefined = params.attachments?.map((a) => {
        const att: Mail.Attachment = { filename: a.filename };
        if (a.url) att.path = a.url;
        if (a.content) att.content = Buffer.from(a.content, "base64");
        if (a.content_type) att.contentType = a.content_type;
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
    } catch (err) {
      return errorResponse(`Fehler beim Senden: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
);

server.tool(
  "email_verify",
  "Test the SMTP connection. Returns success if credentials and server are working.",
  {},
  async () => {
    try {
      const smtp = getTransporter();
      await smtp.verify();
      return {
        content: [{
          type: "text",
          text: `SMTP-Verbindung erfolgreich!\nServer: ${process.env.SMTP_HOST}:${process.env.SMTP_PORT || 465}\nUser: ${process.env.SMTP_USER}`,
        }],
      };
    } catch (err) {
      return errorResponse(`SMTP-Verbindung fehlgeschlagen: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
);

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
