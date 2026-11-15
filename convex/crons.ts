import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

const crons = cronJobs();

crons.interval(
  "revive stalled world generations",
  { minutes: 1 },
  internal.pipeline.watchdog,
  {},
);

export default crons;
