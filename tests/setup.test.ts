import { expect, test } from "bun:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { readHandoffRole, setupHandoffRole } from "../src/setup";

async function withAgentDir(run: (dir: string) => Promise<void>) {
	const dir = await mkdtemp(path.join(tmpdir(), "handoff-switch-"));
	try {
		await run(dir);
	} finally {
		await rm(dir, { recursive: true, force: true });
	}
}

test("first load creates the packaged config in the active agent directory", async () => {
	await withAgentDir(async dir => {
		await setupHandoffRole(dir);
		expect(await readFile(path.join(dir, "handoff-switch.yml"), "utf8"))
			.toBe(await Bun.file(path.join(import.meta.dir, "..", "handoff-switch.yml")).text());
	});
});

test("an existing profile role is read without setup", async () => {
	await withAgentDir(async dir => {
		const configPath = path.join(dir, "handoff-switch.yml");
		const custom = "handoff:\n  model: slow\n";
		await writeFile(configPath, custom);
		expect(await readHandoffRole(dir)).toBe("slow");
		expect(await readFile(configPath, "utf8")).toBe(custom);
	});
});

test("two profile directories keep independent handoff roles", async () => {
	await withAgentDir(async first => {
		await withAgentDir(async second => {
			await writeFile(path.join(first, "handoff-switch.yml"), "handoff:\n  model: slow\n");
			expect(await readHandoffRole(first)).toBe("slow");
			await setupHandoffRole(second);
			expect(await readHandoffRole(second)).toBe("smol");
			expect(await readFile(path.join(second, "handoff-switch.yml"), "utf8")).toBe("handoff:\n  model: smol\n");
		});
	});
});

test("invalid existing config fails without replacing user content", async () => {
	await withAgentDir(async dir => {
		const configPath = path.join(dir, "handoff-switch.yml");
		const invalid = "handoff:\n  model: '@smol'\n";
		await writeFile(configPath, invalid);
		expect(readHandoffRole(dir)).rejects.toThrow(configPath);
		expect(await readFile(configPath, "utf8")).toBe(invalid);
	});
});


test("two profile directories keep independent handoff roles", async () => {
	await withAgentDir(async first => {
		await withAgentDir(async second => {
			await writeFile(path.join(first, "handoff-switch.yml"), "handoff:\n  model: slow\n");
			expect(await readHandoffRole(first)).toBe("slow");
			await setupHandoffRole(second);
			expect(await readHandoffRole(second)).toBe("smol");
			expect(await readFile(path.join(second, "handoff-switch.yml"), "utf8")).toBe("handoff:\n  model: smol\n");
		});
	});
});

test("invalid existing config fails without replacing user content", async () => {
	await withAgentDir(async dir => {
		const configPath = path.join(dir, "handoff-switch.yml");
		const invalid = "handoff:\n  model: '@smol'\n";
		await writeFile(configPath, invalid);
		expect(readHandoffRole(dir)).rejects.toThrow(configPath);
		expect(await readFile(configPath, "utf8")).toBe(invalid);
	});
});

