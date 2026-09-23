import { afterAll, beforeAll, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { getActiveProfile, getAgentDir, setAgentDir, setProfile } from "@oh-my-pi/pi-utils/dirs";
import handoffRole from "../src/index";

const originalAgentDir = getAgentDir();
const originalProfile = getActiveProfile();
const originalOverride = process.env.PI_CODING_AGENT_DIR;
let testAgentDir: string;

beforeAll(async () => {
	testAgentDir = await mkdtemp(path.join(tmpdir(), "handoff-handlers-"));
	await writeFile(path.join(testAgentDir, "handoff-switch.yml"), "handoff:\n  model: smol\n");
	setAgentDir(testAgentDir);
});

afterAll(async () => {
	if (originalProfile) setProfile(originalProfile);
	else setAgentDir(originalAgentDir);
	if (originalOverride === undefined) delete process.env.PI_CODING_AGENT_DIR;
	else process.env.PI_CODING_AGENT_DIR = originalOverride;
	await rm(testAgentDir, { recursive: true, force: true });
});

type Model = { provider: string; id: string };
type Handler = (event: never, ctx: never) => Promise<unknown>;
const original: Model = { provider: "local", id: "primary" };
const handoff: Model = { provider: "remote", id: "smol" };
const other: Model = { provider: "local", id: "other" };

async function setup() {
	let current = original;
	let sessionId = "first";
	let idle = true;
	let messages = 2;
	const changes: string[] = [];
	const handlers = new Map<string, Handler>();
	const ctx = {
		sessionManager: {
			getSessionId: () => sessionId,
			getBranch: () => Array.from({ length: messages }, () => ({ type: "message" })),
		},
		models: { current: () => current, resolve: (role: string) => role === "@smol" ? handoff : undefined },
		isIdle: () => idle,
		ui: { notify: () => {} },
	};
	await handoffRole({
		on: (name: string, handler: Handler) => { handlers.set(name, handler); },
		setModel: async (model: Model) => { current = model; changes.push(`${model.provider}/${model.id}`); return true; },
		logger: { debug: () => {} },
	} as never);
	const emit = async (name: string, event: object) => {
		const handler = handlers.get(name);
		if (!handler) throw new Error(`No handler for ${name}`);
		return handler(event as never, ctx as never);
	};
	return { emit, changes, current: () => current, select: (model: Model) => { current = model; }, setIdle: (value: boolean) => { idle = value; }, setMessages: (count: number) => { messages = count; }, setSession: (id: string) => { sessionId = id; } };
}

const manual = { text: "/handoff focus", source: "interactive" };
const compact = { compactionEntry: { method: "handoff" } };
const start = { action: "handoff", reason: "threshold" };
const end = { action: "handoff", aborted: false };
const switchSequence = ["remote/smol", "local/primary"];

test("manual handoff switches model and restores it after compaction without consuming input", async () => {
	const t = await setup();
	expect(await t.emit("input", manual)).toBeUndefined();
	await t.emit("session_compact", compact);
	expect(t.changes).toEqual(switchSequence);
});

test("automatic handoff restores model even when no compaction commits", async () => {
	const t = await setup();
	await t.emit("auto_compaction_start", start);
	await t.emit("auto_compaction_end", { ...end, aborted: true });
	expect(t.changes).toEqual(switchSequence);
});

test("unrelated compaction cannot switch or restore a handoff model", async () => {
	const t = await setup();
	await t.emit("auto_compaction_start", { action: "soft", reason: "threshold" });
	await t.emit("auto_compaction_end", { action: "soft" });
	await t.emit("session_compact", { compactionEntry: { method: "soft" } });
	expect(t.changes).toEqual([]);
});

test("manual preflight leaves noninteractive and unavailable handoffs on current model", async () => {
	const t = await setup();
	await t.emit("input", { ...manual, source: "rpc" });
	await t.emit("input", { ...manual, text: "/handoffs focus" });
	t.setIdle(false);
	await t.emit("input", manual);
	t.setIdle(true);
	t.setMessages(1);
	await t.emit("input", manual);
	expect(t.changes).toEqual([]);
});

test("manual completion does not overwrite a model chosen during handoff", async () => {
	const t = await setup();
	await t.emit("input", manual);
	t.select(other);
	await t.emit("session_compact", compact);
	expect(t.current()).toBe(other);
	expect(t.changes).toEqual(["remote/smol"]);
});

test("a second handoff cannot replace the pending original model", async () => {
	const t = await setup();
	await t.emit("input", manual);
	await t.emit("input", manual);
	await t.emit("session_compact", compact);
	expect(t.changes).toEqual(switchSequence);
});

test("changing session discards the previous session's pending restore", async () => {
	const t = await setup();
	await t.emit("input", manual);
	t.setSession("second");
	await t.emit("session_compact", compact);
	expect(t.changes).toEqual(["remote/smol"]);
});
