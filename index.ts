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

const createMissingEvents = async () => {
  const res = await calendar.events.list({
    calendarId: "admin@hersheytroop203.org",
    timeMin: new Date().toISOString(),
    maxResults: 10,
    singleEvents: true,
    orderBy: "startTime",
  });

  // filter out events over 2 weeks away
  let events = res.data.items!.filter((event) => {
    const eventDate = new Date(
      event.start?.dateTime ?? event.start?.date ?? ""
    );
    const now = new Date();
    const twoWeeks = new Date();
    twoWeeks.setDate(now.getDate() + 14);
    return eventDate < twoWeeks;
  });

  const existingEvents = await guild.scheduledEvents.fetch();

  // filter out events that already exist (have the event url in the description)
  events = events.filter((event) => {
    return !existingEvents.some((existingEvent) =>
      existingEvent.description?.includes(event.htmlLink!)
    );
  });

  for (const event of events) {
    guild.scheduledEvents.create({
      entityType: GuildScheduledEventEntityType.External,
      name: event.summary!,
      scheduledStartTime: event.start!.dateTime!,
      scheduledEndTime: event.end!.dateTime!,
      description: `${event.description ?? ""}\n\n${event.htmlLink}`,
      entityMetadata: {
        location: event.location ?? "",
      },
      privacyLevel: GuildScheduledEventPrivacyLevel.GuildOnly,
    });
  }
};

createMissingEvents();

Cron("0 */3 * * *", createMissingEvents);
