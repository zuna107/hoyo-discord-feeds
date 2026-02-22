import cron, { type ScheduledTask } from "node-cron"
import pLimit from "p-limit"
import { env } from "../config/env.js"
import { deliveryRepo, feedRepo } from "../db/repositories.js"
import { nowIso } from "../utils/time.js"
import { audit } from "./audit.js"
import { DiscordDispatcher } from "./discordDispatcher.js"
import { FeedProcessor } from "./feedProcessor.js"

export class SchedulerService {
  private task: ScheduledTask | null = null
  private inFlight = false
  private readonly feedProcessor = new FeedProcessor()
  private readonly dispatch = new DiscordDispatcher()

  public getDispatcher(): DiscordDispatcher {
    return this.dispatch
  }

  public start(): void {
    if (this.task) {
      return
    }
    this.task = cron.schedule(env.SCHEDULER_TICK_CRON, async () => {
      await this.tick()
    })
    audit("info", "scheduler", "Scheduler started", { cron: env.SCHEDULER_TICK_CRON })
  }

  public stop(): void {
    if (!this.task) {
      return
    }
    this.task.stop()
    this.task.destroy()
    this.task = null
    audit("info", "scheduler", "Scheduler stopped")
  }

  public async tick(): Promise<void> {
    if (this.inFlight) {
      return
    }
    this.inFlight = true
    try {
      const now = nowIso()
      const dueFeeds = feedRepo.listDue(now)
      const feedLimit = pLimit(3)
      await Promise.all(dueFeeds.map((feed) => feedLimit(async () => this.feedProcessor.processFeed(feed))))

      let drained = 0
      for (let i = 0; i < 4; i += 1) {
        const processed = await this.dispatch.dispatchDueBatch()
        drained += processed
        if (processed < env.DISPATCH_BATCH_SIZE) {
          break
        }
      }
      const deliveryCounts = deliveryRepo.countsByStatus()
      if (dueFeeds.length > 0 || drained > 0) {
        audit("info", "scheduler", "Tick complete", {
          dueFeeds: dueFeeds.length,
          dispatched: drained,
          deliveryCounts,
        })
      }
    } finally {
      this.inFlight = false
    }
  }
}
