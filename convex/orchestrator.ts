"use node";
import { v } from "convex/values";
import { internalAction } from "./_generated/server";
import { internal, components } from "./_generated/api";
import { Workpool } from "@convex-dev/workpool";
import { downloadRepo, chunkFiles } from "./repo";
import { ANGLES } from "./prompts";

const pool = new Workpool(components.agentPool, {
  maxParallelism: 20,
});

export const run = internalAction({
  args: { scanId: v.id("scans") },
  handler: async (ctx, { scanId }) => {
    try {
      await ctx.runMutation(internal.scans.setStatus, { scanId, status: "cloning" });
      const scan = await ctx.runQuery(internal.scans_internal.getInternal, { scanId });
      if (!scan) throw new Error("Scan disappeared");

      const { files, sha } = await downloadRepo(scan.repoUrl);
      if (files.length === 0) throw new Error("No source files found in repo");
      if (sha) {
        await ctx.runMutation(internal.scans.setClonedSha, { scanId, sha });
      }

      type Task = { angleId: string; files: { path: string; content: string }[] };
      const tasks: Task[] = [];
      for (const angle of ANGLES) {
        const chunks = chunkFiles(files, angle.extensions);
        for (const chunk of chunks) {
          if (chunk.length > 0) tasks.push({ angleId: angle.id, files: chunk });
        }
      }
      if (tasks.length === 0) throw new Error("No applicable files for any angle");

      await ctx.runMutation(internal.scans.setTotalAgents, { scanId, total: tasks.length });
      await ctx.runMutation(internal.scans.setStatus, { scanId, status: "scanning" });

      for (const task of tasks) {
        await pool.enqueueAction(ctx, internal.agents.audit, {
          scanId,
          angleId: task.angleId,
          files: task.files,
        });
      }
    } catch (err: any) {
      await ctx.runMutation(internal.scans.setStatus, {
        scanId,
        status: "error",
        error: err?.message ?? String(err),
      });
    }
  },
});
