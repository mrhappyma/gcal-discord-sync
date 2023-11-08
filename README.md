# gcal-discord-sync
syncs upcoming google calendar events in the next 2 weeks to discord (cron every 3 hours)

a little clunky but does the job

## Setup

[Create a Google Cloud project](https://console.cloud.google.com/), and [enable the calendar API](https://console.cloud.google.com/flows/enableapi?apiid=calendar-json.googleapis.com). [Configure the consent screen](https://console.cloud.google.com/apis/credentials/consent), you don't need any scopes and you should add yourself as a test user. Most of the other fields don't matter. [Create an OAuth client ID](https://console.cloud.google.com/apis/credentials) for a desktop application. Click OK through most of the prompts, and store your client ID and secret somewhere.

[Create your Discord bot](https://discord.com/developers/applications), and add it to your server.

Set your environment variables:
```
CLIENT_ID = # google client id
PROJECT_ID = # google project id
CLIENT_SECRET = # google client secret
CALENDAR_ID = # source google calendar id
BOT_TOKEN = # discord bot token
GUILD_ID = # target discord guild id
```

`bun install` and `bun .` and you're good to go.