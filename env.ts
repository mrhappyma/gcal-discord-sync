import z from "zod";

const envSchema = z.object({
  CLIENT_ID: z.string(),
  CLIENT_SECRET: z.string(),
  PROJECT_ID: z.string(),
  CALENDAR_ID: z.string(),
  BOT_TOKEN: z.string(),
  GUILD_ID: z.string(),
  DATABASE_URL: z.string(),
  REDIRECT_URL: z.string().optional(),
});
export default envSchema.parse(process.env);
