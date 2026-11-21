import { getAgentDir } from "@oh-my-pi/pi-utils/dirs";
import * as path from "node:path";
import { readHandoffRole, setupHandoffRole } from "./setup";

interface PendingSwitch {
	source: "manual" | "auto";
	original: Model;
	target: Model;
}

function parseSlashInvocation(text: string): { name: string; args: string } | undefined {
	if (!text.startsWith("/")) return undefined;
	const body = text.slice(1);
	if (!body) return undefined;
	const whitespace = body.search(/\s/);
	const colon = body.indexOf(":");
	const separator = whitespace === -1 ? colon : colon === -1 ? whitespace : Math.min(whitespace, colon);
	if (separator === -1) return { name: body, args: "" };
	return { name: body.slice(0, separator), args: body.slice(separator + 1).trim() };
}

function isHandoffCommand(text: string): boolean {
	const invocation = parseSlashInvocation(text);
	if (!invocation) return false;
	if (invocation.name === "handoff") return true;
	if (invocation.name !== "compact") return false;
	return invocation.args.split(/\s+/, 1)[0]?.toLowerCase() === "handoff";
}

export default async function handoffRole(pi: ExtensionAPI): Promise<void> {
	const configPath = path.join(getAgentDir(), "handoff-switch.yml");
	if (!(await Bun.file(configPath).exists())) await setupHandoffRole();
	const role = await readHandoffRole();
	const pending = new Map<string, PendingSwitch>();
	const modelKey = (m: Model) => `${m.provider}/${m.id}`;

	const pruneOtherSessions = (sessionId: string) => {
		for (const key of pending.keys()) {
			if (key !== sessionId) pending.delete(key);
		}
	};

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
		if (target.provider === original.provider && target.id === original.id) return false;
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
		if (!isHandoffCommand(event.text)) return;
		if (!ctx.isIdle()) return; // mid-turn: leave the built-in preflight untouched
		const messageCount = ctx.sessionManager.getBranch().filter(entry => entry.type === "message").length;
		if (messageCount < 2) return; // nothing to hand off; native preflight will say so
		// Returning { handled: true } would swallow native /handoff's focus argument and generation.
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
