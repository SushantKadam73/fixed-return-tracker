/**
 * Scheduled jobs (times are UTC; IST = UTC + 5:30).
 * Bank-page collection itself runs on GitHub Actions (see ops/workflows); Convex keeps
 * watch over freshness and housekeeping so problems surface even if a runner stops.
 */
import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

const crons = cronJobs();

// 09:00 IST daily — flag sources that have gone quiet.
crons.daily("check stale sources", { hourUTC: 3, minuteUTC: 30 }, internal.monitor.checkStaleness);

// 03:30 IST daily — trim the fetch log.
crons.daily("prune fetch log", { hourUTC: 22, minuteUTC: 0 }, internal.monitor.pruneCaptures);

// 05:30 IST daily — pull reviewed datasets (lineage, schemes, history) from the repo.
crons.daily("import committed datasets", { hourUTC: 0, minuteUTC: 0 }, internal.seed.importAll);

export default crons;
