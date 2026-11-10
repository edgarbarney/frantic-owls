// FranticDreamer 2026
"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const { ParcelService } = require("../Server/Parcels.js");
const { ParcelState, ParcelItemState, ReadStats } = require("../Server/Database.js");

// ========================
// Fixtures
// ========================

const gearId = "Neck_001_Legendary";
const gearName = "native:neck_001_legendary";
const roll = { level: 34, offense: 120, defense: 80, cooldown: 0, upgrades: 2, traits: ["Trait_A", "Trait_B"] };

/// <summary>
/// An online player whose game inventory holds the given rows and records every patch it is sent.
/// </summary>
function MakePlayer(id, rows)
{
	const player =
	{
		id,
		rows,
		patches: [],
		inventory:
		{
			list: () => player.rows.map((row) => ({ ...row })),
			patch(operations, options, callback)
			{
				player.patches.push(operations);

				for (const operation of operations)
				{
					player.rows.push({ itemId: operation.itemId, holder: "Gear", count: operation.count, variation: operation.variation, stats: operation.stats, kind: "gear" });
				}

				callback(null, { revision: player.patches.length, rows: player.rows.length });
			},
			waitForRevision: async () => ({}),
		},
	};

	return player;
}

/// <summary>
/// hmp-inventory as parcels use it, over the players' game rows. The plain add gives no roll, as the real one does.
/// </summary>
function MakeInventory(log)
{
	const ToView = (player) => ({
		custom: [],
		native: player.rows.map((row) => ({ source: "native", name: `native:${row.itemId.toLowerCase()}`, itemId: row.itemId, variation: row.variation || "", kind: row.kind || "item", label: row.itemId, icon: "", amount: row.count, equipped: row.equipped === true })),
	});

	return {
		inventory:
		{
			get: async (player) => ToView(player),
			count: async () => 1000,
			add: async (player, name, amount, options) =>
			{
				log.push({ add: name, amount, options });
				player.rows.push({ itemId: name.replace(/^native:/, ""), holder: "Gear", count: amount, variation: options && options.variation, kind: "gear" });
				return amount;
			},
			remove: async (player, name, amount) =>
			{
				const index = player.rows.findIndex((row) => `native:${row.itemId.toLowerCase()}` === name && row.equipped !== true);

				if (index < 0)
				{
					return 0;
				}

				player.rows.splice(index, 1);
				log.push({ remove: name, amount });
				return amount;
			},
		},
		transfers: { move: async () => ({}) },
		containers: { create: async () => ({}), get: async () => null, remove: async () => true },
		native: { save: async (player) => { log.push({ save: player.id }); return true; } },
	};
}

/// <summary>
/// The journal parcels write, kept in memory: one parcel on one owl.
/// </summary>
function MakeDatabase()
{
	const database =
	{
		parcel: null,
		items: [],
		async InsertParcel(sender, recipient, galleons, postage, items)
		{
			database.parcel = { id: 1, sender, recipient, galleons, postage, state: ParcelState.Pending, contents: JSON.stringify(items.map((item) => ({ label: item.label, amount: item.amount, kind: item.kind }))) };
			database.items = items.map((item, index) => ({ ...item, id: index + 1, parcelId: 1, state: ParcelItemState.Pending, nativeId: item.stats ? item.itemId : "", stats: item.stats || null }));
			return { id: 1, items: database.items.map((item) => ({ ...item })) };
		},
		async ListParcelItems()
		{
			return database.items.map((item) => ({ ...item }));
		},
		async MoveParcelItem(id, from, to)
		{
			const item = database.items.find((row) => row.id === id && row.state === from);

			if (item)
			{
				item.state = to;
			}

			return Boolean(item);
		},
		async MoveParcel(id, from, to, messageId)
		{
			if (database.parcel.state !== from)
			{
				return false;
			}

			database.parcel.state = to;
			database.parcel.messageId = messageId || database.parcel.messageId;
			return true;
		},
		async SumGalleonsSent()
		{
			return 0;
		},
		async GetVisibleMessage()
		{
			return { id: 9 };
		},
		async GetParcelByMessage()
		{
			return database.parcel;
		},
	};

	return database;
}

/// <summary>
/// A parcel service between a sender and a recipient, both online.
/// </summary>
function MakeService(senderRows)
{
	const log = [];
	const sender = MakePlayer(1, senderRows);
	const recipient = MakePlayer(2, []);
	const database = MakeDatabase();
	const inventory = MakeInventory(log);
	const entries = { "11111111": { number: "11111111", player: sender, characterId: 1, settings: {} }, "22222222": { number: "22222222", player: recipient, characterId: 2, settings: {} } };
	const service = new ParcelService(
	{
		database,
		directory: { GetByNumber: (number) => entries[number] || null },
		outbox: { Push: () => {} },
		audit: { Log: () => {} },
		config: { items: true, gear: true, maxItemStacks: 8, maxGalleons: 1000, dailyGalleonsCap: 0, postageGalleons: 0, galleonsItem: "native:galleons" },
		GetInventory: () => inventory,
		Describe: (number) => number,
	});

	return { service, database, log, sender, recipient, senderEntry: entries["11111111"], recipientEntry: entries["22222222"] };
}

/// <summary>
/// Send one gear piece from the sender and put it on owl 9.
/// </summary>
async function SendGear(world)
{
	const checked = await world.service.Check(world.senderEntry, { galleons: 0, items: [{ key: `n:${gearName}|`, amount: 1 }] }, 1);
	assert.equal(checked.problem, null);
	const prepared = await world.service.Prepare(world.senderEntry, "22222222", 0, checked.items);
	assert.equal(prepared.error, null);
	return prepared.parcel;
}

// ========================
// Tests
// ========================

test("a gear piece keeps its roll from the sender to the recipient", async () =>
{
	const world = MakeService([{ itemId: gearId, holder: "Gear", count: 1, kind: "gear", stats: roll }]);
	const parcel = await SendGear(world);
	await world.service.Attach(world.senderEntry, parcel, { id: 9 });

	assert.equal(world.sender.rows.length, 0);
	assert.deepEqual(world.database.items[0].stats, roll);

	const collected = await world.service.Collect(world.recipientEntry, { chatId: 3, messageId: 9 });
	assert.equal(collected.ok, true);
	assert.deepEqual(world.recipient.patches, [[{ op: "give", itemId: gearId, count: 1, identified: true, unique: true, stats: roll }]]);
	assert.ok(!world.log.some((entry) => entry.add), "gear must not go through the roll-less add");
	assert.deepEqual(world.recipient.rows[0].stats, roll);
});

test("a cancelled gear parcel gives the sender back the same roll", async () =>
{
	const world = MakeService([{ itemId: gearId, holder: "Gear", count: 1, kind: "gear", stats: roll }]);
	const parcel = await SendGear(world);
	await world.service.Cancel(world.senderEntry, parcel);

	assert.deepEqual(world.sender.patches, [[{ op: "give", itemId: gearId, count: 1, identified: true, unique: true, stats: roll }]]);
	assert.deepEqual(world.sender.rows[0].stats, roll);
});

test("two stored copies with different rolls cannot travel, since the take cannot pick one", async () =>
{
	const world = MakeService([{ itemId: gearId, holder: "Gear", count: 1, kind: "gear", stats: roll }, { itemId: gearId, holder: "Gear", count: 1, kind: "gear", stats: { ...roll, level: 1, upgrades: 0 } }]);
	const listed = await world.service.ListCarriable(world.senderEntry);
	assert.notEqual(listed.data.items[0].reason, "");

	const checked = await world.service.Check(world.senderEntry, { galleons: 0, items: [{ key: `n:${gearName}|`, amount: 1 }] }, 1);
	assert.notEqual(checked.problem, null);
	assert.equal(world.sender.rows.length, 2);
});

test("an item the game holds no roll for still travels through hmp-inventory", async () =>
{
	const world = MakeService([{ itemId: "Dittany", holder: "Ingredients", count: 3, kind: "item" }]);
	const checked = await world.service.Check(world.senderEntry, { galleons: 0, items: [{ key: "n:native:dittany|", amount: 3 }] }, 1);
	const prepared = await world.service.Prepare(world.senderEntry, "22222222", 0, checked.items);
	await world.service.Attach(world.senderEntry, prepared.parcel, { id: 9 });
	await world.service.Collect(world.recipientEntry, { chatId: 3, messageId: 9 });

	assert.deepEqual(world.recipient.patches, []);
	assert.ok(world.log.some((entry) => entry.add === "native:dittany" && entry.amount === 3));
});

test("a stored roll reads back, and anything else reads as none", () =>
{
	assert.deepEqual(ReadStats(JSON.stringify(roll)), roll);

	for (const value of [null, "", "not json", "[1,2]", "5"])
	{
		assert.equal(ReadStats(value), null);
	}
});
