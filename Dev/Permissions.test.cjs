// FranticDreamer 2026
"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const { PermissionRegistry, Permission } = require("../Server/Permissions.js");

const player = { id: 7 };

test("with no rules, or rules without an opinion, the configuration decides", async () =>
{
	const registry = new PermissionRegistry();
	assert.equal(await registry.Ask(player, 1, Permission.Reports), null);

	registry.Register("shrug", { Allows: () => null });
	assert.equal(await registry.Ask(player, 1, Permission.Reports), null);
});

test("the first rule with an answer decides, async answers included", async () =>
{
	const registry = new PermissionRegistry();
	const asked = [];
	registry.Register("first", { Allows: ({ permission }) => { asked.push(permission); return undefined; } });
	registry.Register("second", { Allows: async ({ permission }) => permission === Permission.Reports });
	registry.Register("third", { Allows: () => true });

	assert.equal(await registry.Ask(player, 1, Permission.Reports), true);
	assert.equal(await registry.Ask(player, 1, Permission.Announce), false);
	assert.deepEqual(asked, ["reports", "announce"]);
});

test("a rule that throws refuses, and a stopped resource's rules are gone", async () =>
{
	const registry = new PermissionRegistry();
	registry.Register("broken", { Allows: () => { throw new Error("down"); } });
	registry.Register("generous", { Allows: () => true });
	assert.equal(await registry.Ask(player, 1, Permission.PostAdmin), false);

	assert.equal(registry.Unregister("broken"), true);
	assert.equal(await registry.Ask(player, 1, Permission.PostAdmin), true);
	assert.equal(registry.Register("", { Allows: () => true }).ok, false);
	assert.equal(registry.Register("nohook", {}).ok, false);
});
