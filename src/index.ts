/**
 * handoff-role (v0, best-effort)
 *
 * Temporarily switches the live session model to a configured model role for
 * handoff compaction, then restores the previous model when the handoff ends.
 *
 * Triggers (the v0 contract — exactly four, no other listeners):
 * - `input`                 : interactive `/handoff` submissions switch before
 *                             native dispatch; the handler always returns
 *                             undefined so native `/handoff` keeps the original
 *                             focus argument and performs generation/commit.
 * - `session_compact`       : successful manual handoff
 *                             (`compactionEntry.method === "handoff"`) restores.
 * - `auto_compaction_start` : non-speculative automatic handoff
 *                             (`action === "handoff"`) switches.
 * - `auto_compaction_end`   : automatic handoff end (any outcome) restores.
 *
 * Prerequisite: `compaction.asyncEnabled: false` in the effective OMP settings
 * (otherwise a speculative handoff can generate before the switch lands).
 *
 * Config: `handoff-switch.yml` in the active OMP profile's agent directory:
 *   handoff:
 *     model: smol
 * Created from the packaged default on first load; restart or reload plugins
 * after editing the profile file.
 * `"model"` is a model role name without `@`; `"handoff"` selects an assigned
 * custom handoff role. The role is resolved at each trigger so later
 * role/model assignments take effect.
 *
 * Explicit v0 limitations (best effort — NOT request-scoped isolation):
 * - a failed manual handoff, Esc cancellation, blocked native precondition
 *   after the switch, or a concurrent user model change can leave the target
 *   model selected until extension reload/restart;
 * - restoring the original Model does not restore a pre-handoff thinking
 *   selection if the target clamped it;
 * - the current-target guard avoids clobbering a user-selected *different*
 *   model but is not atomic.
 */
import { getAgentDir } from "@oh-my-pi/pi-utils/dirs";
import * as path from "node:path";
import { readHandoffRole, setupHandoffRole } from "./setup";

interface PendingSwitch {
	source: "manual" | "auto";
	original: Model;
	target: Model;
}

const HANDOFF_INPUT = /^\/handoff(?:\s|$)/;

export default async function handoffRole(pi: ExtensionAPI): Promise<void> {
	const configPath = path.join(getAgentDir(), "handoff-switch.yml");
	if (!(await Bun.file(configPath).exists())) await setupHandoffRole();
	const role = await readHandoffRole();
	const pending = new Map<string, PendingSwitch>();
	const modelKey = (m: Model) => `${m.provider}/${m.id}`;

	/** Drop pending records from sessions that are no longer the active one. */
	const pruneOtherSessions = (sessionId: string) => {
		for (const key of pending.keys()) {
			if (key !== sessionId) pending.delete(key);
		}
	};

	/**
	 * Switch the session model to the configured role for a handoff.
	 * Returns true only when the switch landed and a pending record was saved.
	 * On any failure path: notify visibly, record nothing, let native handoff
	 * proceed on the active model (explicit v0 best effort).
	 */
	const switchForHandoff = async (source: "manual" | "auto", ctx: ExtensionContext): Promise<boolean> => {
		const sessionId = ctx.sessionManager.getSessionId();
		pruneOtherSessions(sessionId);
		if (pending.has(sessionId)) return false; // refuse to overwrite an in-flight switch
		const original = ctx.models.current();
		if (!original) return false;
		const target = ctx.models.resolve(`@${role}`);
		if (!target) {
			ctx.ui.notify(`handoff-role: role "${role}" did not resolve; handoff proceeds on ${modelKey(original)}`, "warning");
			return false;
		}
		if (target.provider === original.provider && target.id === original.id) return false; // already on the target model
		const switched = await pi.setModel(target);
		if (!switched) {
			ctx.ui.notify(
				`handoff-role: setModel(${modelKey(target)}) failed (no API key?); handoff proceeds on ${modelKey(original)}`,
				"warning",
			);
			return false;
		}
		pending.set(sessionId, { source, original, target });
		pi.logger.debug("handoff-role: switched to handoff model", { source, from: modelKey(original), to: modelKey(target) });
		return true;
	};

	/**
	 * Restore the pre-handoff model. Deletes the pending record first and only
	 * writes back when the session is still on the handoff target, so a
	 * user-selected different model is not clobbered.
	 */
	const restore = async (source: "manual" | "auto", ctx: ExtensionContext): Promise<void> => {
		const sessionId = ctx.sessionManager.getSessionId();
		pruneOtherSessions(sessionId);
		const record = pending.get(sessionId);
		if (!record || record.source !== source) return;
		pending.delete(sessionId);
		const current = ctx.models.current();
		if (!current || !(current.provider === record.target.provider && current.id === record.target.id))
			return; // user picked a different model
		await pi.setModel(record.original);
		pi.logger.debug("handoff-role: restored original model", { source, to: modelKey(record.original) });
	};

	pi.on("input", async (event, ctx) => {
		if (event.source !== "interactive") return; // RPC/ACP manual handoff is intentionally not rerouted
		if (!HANDOFF_INPUT.test(event.text)) return;
		if (!ctx.isIdle()) return; // mid-turn: leave the built-in preflight untouched
		const messageCount = ctx.sessionManager.getBranch().filter(entry => entry.type === "message").length;
		if (messageCount < 2) return; // nothing to hand off; native preflight will say so
		// Never return { handled: true }: native /handoff must receive the
		// original focus argument and perform generation/commit.
		await switchForHandoff("manual", ctx);
	});

	pi.on("session_compact", async (event, ctx) => {
		if (event.compactionEntry.method !== "handoff") return;
		await restore("manual", ctx);
	});

	pi.on("auto_compaction_start", async (event, ctx) => {
		if (event.action !== "handoff") return; // fallback methods' start events do not switch models
		await switchForHandoff("auto", ctx);
	});

	pi.on("auto_compaction_end", async (event, ctx) => {
		if (event.action !== "handoff") return;
		await restore("auto", ctx);
	});
}
