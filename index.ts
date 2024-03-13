console.log("Starting");

import { authenticate } from "./auth";
import { google } from "googleapis";
import { OAuth2Client } from "google-auth-library";
import env from "./env";
import {
  Client,
  GuildScheduledEventEntityType,
  GuildScheduledEventPrivacyLevel,
  WebhookClient,
} from "discord.js";
import Cron from "croner";
import { PrismaClient } from "@prisma/client";

export const webhook = new WebhookClient({ url: env.ERROR_WEBHOOK_URL });
const error = async (err: any, context?: any) => {
  await webhook.send(
    `oh geez, an error. killing the process. \n\`\`\`${err}\`\`\`${
      context ? `\n\`\`\`${context}\`\`\`` : ""
    }`
  );
  process.exit(1);
};

const prisma = new PrismaClient();

const SCOPES = ["https://www.googleapis.com/auth/calendar"];

const loadSavedCredentialsIfExist = async () => {
  const credentials = await prisma.token.findFirst();
  if (!credentials) return null;
  return google.auth.fromJSON(credentials) as OAuth2Client;
};

const saveCredentials = async (client: OAuth2Client) => {
  await prisma.token.upsert({
    where: {
      id: 1,
    },
    create: {
      id: 1,
      type: "authorized_user",
      client_id: env.CLIENT_ID,
      client_secret: env.CLIENT_SECRET,
      refresh_token: client.credentials.refresh_token!,
    },
    update: {
      type: "authorized_user",
      client_id: env.CLIENT_ID,
      client_secret: env.CLIENT_SECRET,
      refresh_token: client.credentials.refresh_token!,
    },
  });
};

const authorize = async () => {
  try {
    let client = await loadSavedCredentialsIfExist();
    if (client) {
      return client;
    }
    webhook.send("do you have a google account 🥺👉👈");
    client = await authenticate({
      scopes: SCOPES,
      clientId: env.CLIENT_ID,
      clientSecret: env.CLIENT_SECRET,
      projectId: env.PROJECT_ID,
      redirectUrl: env.REDIRECT_URL,
    });
    if (client?.credentials) {
      await saveCredentials(client);
    }
    return client;
  } catch (e) {
    error(e);
  }
};

const auth = await authorize();
const calendar = google.calendar({ version: "v3", auth });
const bot = new Client({
  intents: ["GuildScheduledEvents"],
  presence: {
    status: "invisible",
  },
});
await bot.login(env.BOT_TOKEN);
const guild = await bot.guilds.fetch(env.GUILD_ID);

bot.on("guildScheduledEventDelete", async (event) => {
  const googleEvent = await prisma.event.findFirst({
    where: {
      discordId: event.id,
    },
  });
  if (!googleEvent) return;
  await calendar.events.delete({
    calendarId: env.CALENDAR_ID,
    eventId: googleEvent.googleId,
  });
  await webhook.send(`deleting event ${googleEvent.googleId} from gcal, as instructed...`)
});

const syncFromGoogle = async () => {
  try {
    const res = await calendar.events.list({
      calendarId: env.CALENDAR_ID,
      timeMin: new Date().toISOString(),
      maxResults: 10,
      singleEvents: true,
      orderBy: "startTime",
    });

    // filter out events over a month away
    let events = res.data.items!.filter((event) => {
      const eventDate = new Date(
        event.start?.dateTime ?? event.start?.date ?? ""
      );
      const now = new Date();
      const month = new Date();
      month.setDate(now.getDate() + 30);
      return eventDate < month;
    });

    const linkedEvents = await prisma.event.findMany();
    // events that no longer exist in google - remove from db and discord
    const eventsToRemove = linkedEvents.filter((event) => {
      return !events.find((e) => e.id === event.googleId);
    });
    for (const event of eventsToRemove) {
      const devent = await guild.scheduledEvents.fetch(event.discordId);
      await devent.delete();
      await prisma.event.delete({
        where: {
          discordId: event.discordId,
        },
      });
      linkedEvents.splice(linkedEvents.indexOf(event), 1);
    }

    // events that exist in discord - remove from events
    const eventsToIgnore = linkedEvents.map((event) => event.googleId);
    events = events.filter((event) => {
      return !eventsToIgnore.includes(event.id!);
    });

    for (const event of events) {
      try {
        const devent = await guild.scheduledEvents.create({
          entityType: GuildScheduledEventEntityType.External,
          name: event.summary!,
          scheduledStartTime:
            event.start!.dateTime ?? `${event.start!.date}T00:00:00-05:00`,
          scheduledEndTime:
            event.end!.dateTime! ?? `${event.end!.date}T23:59:59-05:00`,
          description: event.description ?? undefined,
          entityMetadata: {
            location: event.location ?? "",
          },
          privacyLevel: GuildScheduledEventPrivacyLevel.GuildOnly,
        });
        await prisma.event.create({
          data: {
            discordId: devent.id,
            googleId: event.id!,
          },
        });
      } catch (e) {
        error(e, JSON.stringify(event));
      }
    }

    console.log(`Created ${events.length} events`);
  } catch (e) {
    error(e);
  }
};

syncFromGoogle();
Cron("0 */3 * * *", syncFromGoogle);
