console.log("Starting");

import { authenticate } from "./auth.js";
import { google } from "googleapis";
import { OAuth2Client } from "google-auth-library";
import env from "./env.js";
import {
  Client,
  GuildScheduledEventEntityType,
  GuildScheduledEventPrivacyLevel,
} from "discord.js";
import Cron from "croner";
import { PrismaClient } from "@prisma/client";

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
  let client = await loadSavedCredentialsIfExist();
  if (client) {
    return client;
  }
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

bot.on("guildScheduledEventCreate", async (event) => {
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
});

const syncFromGoogle = async () => {
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
    const devent = await guild.scheduledEvents.create({
      entityType: GuildScheduledEventEntityType.External,
      name: event.summary!,
      scheduledStartTime: event.start!.dateTime!,
      scheduledEndTime: event.end!.dateTime!,
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
  }

  console.log(`Created ${events.length} events`);
};

syncFromGoogle();
Cron("0 */3 * * *", syncFromGoogle);
