import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

const crons = cronJobs();

crons.interval(
  "send nightly reminders",
  { minutes: 1 },
  internal.notifications.sendDueReminders,
  {},
);

export default crons;
