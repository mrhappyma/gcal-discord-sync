import path from "path";
const fs = require("fs").promises;
import process from "process";
import { authenticate } from "./auth";
import { google } from "googleapis";
import { OAuth2Client } from "google-auth-library";
import env from "./env";
import {
  Client,
  GuildScheduledEventEntityType,
  GuildScheduledEventPrivacyLevel,
} from "discord.js";
import Cron from "croner";
import { PrismaClient } from "@prisma/client";

const SCOPES = ["https://www.googleapis.com/auth/calendar"];
const TOKEN_PATH = path.join(process.cwd(), "token.json");

const loadSavedCredentialsIfExist = async () => {
  try {
    const content = await fs.readFile(TOKEN_PATH);
    const credentials = JSON.parse(content);
    return google.auth.fromJSON(credentials) as OAuth2Client;
  } catch (err) {
    return null;
  }
};

const saveCredentials = async (client: OAuth2Client) => {
  const payload = JSON.stringify({
    type: "authorized_user",
    client_id: env.CLIENT_ID,
    client_secret: env.CLIENT_SECRET,
    refresh_token: client.credentials.refresh_token,
  });
  await fs.writeFile(TOKEN_PATH, payload);
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
});
await bot.login(env.BOT_TOKEN);
const guild = await bot.guilds.fetch(env.GUILD_ID);
const prisma = new PrismaClient();

const createMissingEvents = async () => {
  const res = await calendar.events.list({
    calendarId: "admin@hersheytroop203.org",
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

  const discordEvents = await guild.scheduledEvents.fetch();

  let linkedEvents = await prisma.event.findMany();
  // events that dont exist in discord anymore - delete and remove from linkedEvents
  const eventsToDelete = linkedEvents.filter((event) => {
    return !discordEvents.has(event.discordId);
  });
  for (const event of eventsToDelete) {
    await prisma.event.delete({
      where: {
        discordId: event.discordId,
      },
    });
    linkedEvents = linkedEvents.filter((e) => e.discordId !== event.discordId);
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

createMissingEvents();

Cron("0 */3 * * *", createMissingEvents);