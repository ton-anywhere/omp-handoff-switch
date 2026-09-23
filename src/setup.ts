import { copyFile, mkdir } from "node:fs/promises";
import * as path from "node:path";
import { getAgentDir } from "@oh-my-pi/pi-utils/dirs";
import { YAML } from "bun";

const seedPath = path.join(import.meta.dir, "..", "handoff-switch.yml");

export async function setupHandoffRole(agentDir: string = getAgentDir()): Promise<void> {
	const configPath = path.join(agentDir, "handoff-switch.yml");
	await mkdir(agentDir, { recursive: true });
	await copyFile(seedPath, configPath);
}

export async function readHandoffRole(agentDir: string = getAgentDir()): Promise<string> {
	return readRole(path.join(agentDir, "handoff-switch.yml"));
}

async function readRole(configPath: string): Promise<string> {
	const text = await Bun.file(configPath).text();
	let raw: unknown;
	try {
		raw = YAML.parse(text);
	} catch (error) {
		throw new Error(`handoff-switch: invalid YAML in ${configPath}`, { cause: error });
	}
	if (typeof raw !== "object" || raw === null || !("handoff" in raw) ||
		typeof raw.handoff !== "object" || raw.handoff === null) {
		throw new Error(`handoff-switch: ${configPath} must contain a handoff mapping`);
	}
	const role = "model" in raw.handoff ? raw.handoff.model : undefined;
	if (typeof role !== "string" || role.length === 0 || role.startsWith("@")) {
		throw new Error(`handoff-switch: handoff.model in ${configPath} must be a non-empty role name without @`);
	}
	return role;
}

