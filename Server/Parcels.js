// FranticDreamer 2026
"use strict";

const { Ok, Fail } = require("./Result.js");
const { Logger } = require("./Logger.js");
const Lang = require("./Lang.js");
const { ParcelState, ParcelItemState, MapParcel, ReadParcelContents } = require("./Database.js");

// ========================
// Parcel Service
// ========================

/// <summary>
/// One day, in milliseconds: the window of attachments.dailyGalleonsCap and the unit of attachments.returnAfterDays.
/// </summary>
const dayMs = 24 * 60 * 60 * 1000;

/// <summary>
/// Parcels handled per journal step in one sweep, so one sweep never holds the server for long.
/// </summary>
const sweepBatchSize = 100;

/// <summary>
/// Longest item key a page may send ("n:" + an item name and its variation, or "c:" + a slot).
/// </summary>
const maxItemKeyLength = 200;

/// <summary>
/// Item kinds an owl can carry, and the attachments switch that allows each. Tools and mounts live in holders of their own and are never carried.
/// </summary>
const carriedKinds = Object.freeze({ item: "items", gear: "gear" });

/// <summary>
/// The hmp-inventory container a parcel's custom items wait in.
/// </summary>
/// <param name="parcelId">Parcel row ID</param>
/// <returns>Container key</returns>
function GetContainerKey(parcelId)
{
	return `frantic-owls:parcel:${parcelId}`;
}

/// <summary>
/// A refusal whose text another resource wrote (a parcel rule), shown to the player as it is.
/// </summary>
/// <param name="text">Player-facing reason</param>
/// <returns>Failed result</returns>
function Refuse(text)
{
	return { ok: false, error: String(text), errorKey: "error.parcel.refused", errorParams: {}, data: null };
}

/// <summary>
/// Parcels: Galleons, items and gear sent on an owl (a phone owl or one copy of a letter), held by the server until the recipient collects them.
///
/// <para>
/// What a parcel does:
/// - Everything it carries (and any postage) leaves the sender when the owl is sent, so nothing can be spent or sent twice.
/// - The recipient collects it by hand once the owl has landed, so nothing lands in an inventory unasked.
/// - A parcel nobody collects within attachments.returnAfterDays goes back to the sender, paid the next time they are online. Unsending the owl sends it back at once.
/// - Neither side is ever told who the other is: a returned parcel says only that it went back to the sender, which keeps unsigned letters anonymous.
/// - Postage pays the owl and is never returned.
/// - Other resources can refuse items through rules (RegisterRules), for what a server must keep: worn or lent clothes, quest items, a gear limit.
/// </para>
///
/// <para>
/// NOTE: Galleons and every other game item live in the game's own inventory, and hmp-inventory's atomic transfers refuse them.
/// So each of them is journalled on its own row (see ParcelItemState) before it moves, and a crash in between is settled the way that never duplicates anything.
/// Custom items (registered by other resources) do move atomically, into a container of the parcel's own, which is then their record.
/// hmp-inventory is optional; without it parcels are simply off.
/// </para>
///
/// </summary>
class ParcelService
{
	/// <summary>
	/// OwlDatabase instance.
	/// </summary>
	#database;

	/// <summary>
	/// OwlDirectory instance, for whether a sender or recipient is online.
	/// </summary>
	#directory;

	/// <summary>
	/// Outbox instance, for parcel updates and notices.
	/// </summary>
	#outbox;

	/// <summary>
	/// AuditLog instance.
	/// </summary>
	#audit;

	/// <summary>
	/// The "attachments" section of the server config.
	/// </summary>
	#config;

	/// <summary>
	/// Function returning the hmp-inventory import, or null when it is not running.
	/// </summary>
	#GetInventory;

	/// <summary>
	/// Function (number) => string naming an owl for the audit log.
	/// </summary>
	#Describe;

	/// <summary>
	/// Owl numbers whose returns are being paid right now, so a load and a sweep never pay the same sender at once.
	/// </summary>
	#paying = new Set();

	/// <summary>
	/// Parcel rules registered by other resources, by resource name: { CanAttach, CanCollect, OnTaken }.
	/// </summary>
	#rules = new Map();

	/// <summary>
	/// hmp-inventory, when it is running with everything parcels use; otherwise null.
	/// </summary>
	/// <returns>hmp-inventory import, or null</returns>
	#GetApi()
	{
		const inventory = this.#GetInventory();
		const api = inventory && inventory.inventory;
		const isComplete = api && ["add", "remove", "count", "get"].every((name) => typeof api[name] === "function")
			&& inventory.transfers && typeof inventory.transfers.move === "function"
			&& inventory.containers && ["create", "get", "remove"].every((name) => typeof inventory.containers[name] === "function");
		return isComplete ? inventory : null;
	}

	/// <summary>
	/// Add an item (or Galleons) to an online player. hmp-inventory rejects on failure; that counts as nothing added.
	/// </summary>
	/// <param name="player">Player to give to</param>
	/// <param name="name">hmp-inventory item name</param>
	/// <param name="amount">How many</param>
	/// <param name="variation">Native variation, or an empty string</param>
	/// <returns>How many were added</returns>
	async #Give(player, name, amount, variation = "")
	{
		const inventory = this.#GetApi();

		if (!inventory || amount <= 0)
		{
			return 0;
		}

		try
		{
			return Math.max(0, Number(await inventory.inventory.add(player, name, amount, variation ? { variation } : undefined)) || 0);
		}
		catch (error)
		{
			Logger.LogError("Parcels", `Adding ${amount} ${name} to player ${player.id} failed: ${Logger.Describe(error)}`);
			return 0;
		}
	}

	/// <summary>
	/// Take an item (or Galleons) from an online player. hmp-inventory rejects on failure; that counts as nothing taken.
	/// </summary>
	/// <param name="player">Player to take from</param>
	/// <param name="name">hmp-inventory item name</param>
	/// <param name="amount">How many</param>
	/// <param name="variation">Native variation, or an empty string</param>
	/// <returns>How many were taken</returns>
	async #Take(player, name, amount, variation = "")
	{
		const inventory = this.#GetApi();

		if (!inventory || amount <= 0)
		{
			return 0;
		}

		try
		{
			return Math.max(0, Number(await inventory.inventory.remove(player, name, amount, variation ? { variation } : undefined)) || 0);
		}
		catch (error)
		{
			Logger.LogError("Parcels", `Taking ${amount} ${name} from player ${player.id} failed: ${Logger.Describe(error)}`);
			return 0;
		}
	}

	/// <summary>
	/// Galleons an online player carries, or -1 when they cannot be counted.
	/// </summary>
	/// <param name="player">Player</param>
	/// <returns>Galleons, or -1</returns>
	async #CountGalleons(player)
	{
		const inventory = this.#GetApi();

		try
		{
			return inventory ? Math.max(0, Number(await inventory.inventory.count(player, this.#config.galleonsItem)) || 0) : -1;
		}
		catch (error)
		{
			Logger.LogError("Parcels", `Counting the Galleons of player ${player.id} failed: ${Logger.Describe(error)}`);
			return -1;
		}
	}

	/// <summary>
	/// A player's inventory as hmp-inventory shows it, or null when it cannot be read.
	/// </summary>
	/// <param name="player">Player</param>
	/// <returns>HmpInventoryView, or null</returns>
	async #ReadInventory(player)
	{
		const inventory = this.#GetApi();

		try
		{
			return inventory ? await inventory.inventory.get(player) : null;
		}
		catch (error)
		{
			Logger.LogError("Parcels", `Reading the inventory of player ${player.id} failed: ${Logger.Describe(error)}`);
			return null;
		}
	}

	/// <summary>
	/// Move every stack in a parcel's container to an online player. Each move is atomic; one that does not fit stops the rest, which stay in the container.
	/// </summary>
	/// <param name="parcelId">Parcel row ID</param>
	/// <param name="player">Player to give to</param>
	/// <returns>{ ok, full } where full means the player had no room</returns>
	async #EmptyContainer(parcelId, player)
	{
		const inventory = this.#GetApi();
		const key = GetContainerKey(parcelId);

		try
		{
			const container = await inventory.containers.get(key);

			for (const row of container ? [...container.items] : [])
			{
				await inventory.transfers.move({ from: key, to: player, fromSlot: row.slot });
			}

			if (container)
			{
				await inventory.containers.remove(key);
			}

			return { ok: true, full: false };
		}
		catch (error)
		{
			const full = error && (error.code === "HMP_INVENTORY_FULL" || error.code === "HMP_INVENTORY_OVERWEIGHT");

			if (!full)
			{
				Logger.LogError("Parcels", `Emptying parcel ${parcelId}'s container for player ${player.id} failed: ${Logger.Describe(error)}`);
			}

			return { ok: false, full };
		}
	}

	/// <summary>
	/// Whether a parcel's container still holds anything. Unreadable counts as holding something, so nothing is marked done that may not be.
	/// </summary>
	/// <param name="parcelId">Parcel row ID</param>
	/// <returns>True when it holds anything or cannot be read</returns>
	async #ContainerHolds(parcelId)
	{
		const inventory = this.#GetApi();

		try
		{
			const container = inventory ? await inventory.containers.get(GetContainerKey(parcelId)) : null;
			return inventory === null || (container !== null && container.items.length > 0);
		}
		catch
		{
			return true;
		}
	}

	/// <summary>
	/// Ask every registered rule about an item or a parcel, in registration order. The first refusal wins.
	/// A rule that fails refuses too: a resource that cannot answer must not let something through it meant to keep.
	/// </summary>
	/// <param name="hook">"CanAttach" or "CanCollect"</param>
	/// <param name="context">What the rule is asked about</param>
	/// <returns>The refusal text, or null when every rule lets it through</returns>
	async #AskRules(hook, context)
	{
		for (const [resource, rules] of this.#rules)
		{
			if (typeof rules[hook] !== "function")
			{
				continue;
			}

			try
			{
				const reason = await rules[hook](context);

				if (typeof reason === "string" && reason.trim().length > 0)
				{
					return reason.trim().slice(0, 300);
				}
			}
			catch (error)
			{
				Logger.LogError("Parcels", `The ${hook} parcel rule of "${resource}" failed: ${Logger.Describe(error)}`);
				return Lang.Translate("", "error.parcel.ruleFailed");
			}
		}

		return null;
	}

	/// <summary>
	/// Tell every registered rule that items left a sender, for resources that count what a player gives away.
	/// </summary>
	/// <param name="context">{ player, characterId, items }</param>
	#TellTaken(context)
	{
		for (const [resource, rules] of this.#rules)
		{
			if (typeof rules.OnTaken !== "function")
			{
				continue;
			}

			// The callback belongs to another resource; whatever it does, it must not break the parcel.
			Promise.resolve().then(() => rules.OnTaken(context)).catch((error) => Logger.LogError("Parcels", `The OnTaken parcel rule of "${resource}" failed: ${Logger.Describe(error)}`));
		}
	}

	/// <summary>
	/// An inventory row in the shape pages and rules see.
	/// </summary>
	/// <param name="row">HmpInventoryCustomRow or HmpInventoryNativeViewRow</param>
	/// <returns>{ key, source, slot, name, itemId, variation, kind, label, icon, amount, equipped }</returns>
	#ToItem(row)
	{
		const source = row.source === "custom" ? "custom" : "native";
		const variation = source === "native" ? String(row.variation || "") : "";

		return {
			key: source === "custom" ? `c:${Number(row.slot)}` : `n:${String(row.name)}|${variation}`,
			source,
			slot: source === "custom" ? Number(row.slot) : 0,
			name: String(row.name),
			itemId: source === "native" ? String(row.itemId || "") : "",
			variation,
			kind: String(row.kind || "item"),
			label: String(row.label || row.name),
			icon: String(row.icon || ""),
			amount: Number(row.amount) || 0,
			equipped: row.equipped === true,
		};
	}

	/// <summary>
	/// Every row of an inventory an owl could carry, each with the reason it cannot when it cannot.
	/// Galleons are left out (they have their own field), and so are tools, mounts and worn gear, which never travel.
	/// </summary>
	/// <param name="entry">Directory entry of the sender</param>
	/// <param name="view">HmpInventoryView</param>
	/// <returns>[{ key, source, slot, name, itemId, variation, kind, label, icon, amount, reason }]</returns>
	async #GetCarriable(entry, view)
	{
		const language = entry.settings ? entry.settings.language : "";
		const rows = [...(view.custom || []), ...(view.native || [])].map((row) => this.#ToItem(row));

		// A piece worn while another copy is stored cannot be told apart by name when taken, so neither copy travels.
		const worn = new Set(rows.filter((item) => item.equipped).map((item) => item.name.toLowerCase()));
		const items = [];

		for (const item of rows)
		{
			if (item.equipped || item.amount <= 0 || !carriedKinds[item.kind] || item.name.toLowerCase() === this.#config.galleonsItem.toLowerCase())
			{
				continue;
			}

			let reason = !this.#config[carriedKinds[item.kind]] ? Lang.Translate(language, item.kind === "gear" ? "error.parcel.gearOff" : "error.parcel.itemsOff")
				: worn.has(item.name.toLowerCase()) ? Lang.Translate(language, "error.parcel.worn")
				: null;

			if (!reason)
			{
				reason = await this.#AskRules("CanAttach", { player: entry.player, characterId: entry.characterId, item: this.#ForRules(item) });
			}

			items.push({ ...item, reason: reason || "" });
		}

		return items.sort((left, right) => left.label.localeCompare(right.label) || left.key.localeCompare(right.key));
	}

	/// <summary>
	/// An item as rules see it.
	/// </summary>
	/// <param name="item">Item record</param>
	/// <returns>{ source, name, itemId, variation, kind, label, amount }</returns>
	#ForRules(item)
	{
		return { source: item.source, name: item.name, itemId: item.itemId, variation: item.variation, kind: item.kind, label: item.label, amount: item.amount };
	}

	/// <summary>
	/// Tell whoever is online of the sender and the recipient that a parcel's status changed, so both their pages redraw it.
	/// </summary>
	/// <param name="parcel">Parcel record</param>
	/// <param name="chatId">Chat the owl is in; 0 when unknown (the page then finds the owl by its ID)</param>
	/// <param name="state">ParcelState it is at now</param>
	#PushUpdate(parcel, chatId, state)
	{
		const data = { chatId, messageId: parcel.messageId, parcel: MapParcel(state, parcel.galleons, parcel.contents) };

		for (const number of new Set([parcel.sender, parcel.recipient]))
		{
			const entry = this.#directory.GetByNumber(number);

			if (entry)
			{
				this.#outbox.Push(entry.player, "parcel:update", data);
			}
		}
	}

	/// <summary>
	/// Constructor.
	/// </summary>
	/// <param name="services">{ database, directory, outbox, audit, config (the "attachments" section), GetInventory, Describe }</param>
	constructor(services)
	{
		this.#database = services.database;
		this.#directory = services.directory;
		this.#outbox = services.outbox;
		this.#audit = services.audit;
		this.#config = services.config;
		this.#GetInventory = services.GetInventory;
		this.#Describe = services.Describe;
	}

	// ========================
	// Rules
	// ========================

	/// <summary>
	/// Let another resource refuse items. Rules are dropped when that resource stops; registering again replaces them.
	/// </summary>
	/// <param name="resource">Name of the registering resource</param>
	/// <param name="rules">{ CanAttach?(context), CanCollect?(context), OnTaken?(context) }; see the README's "Parcel rules"</param>
	/// <returns>{ ok, error }</returns>
	RegisterRules(resource, rules)
	{
		const name = String(resource || "").trim();

		if (!name || !rules || typeof rules !== "object" || !["CanAttach", "CanCollect", "OnTaken"].some((hook) => typeof rules[hook] === "function"))
		{
			return { ok: false, error: "RegisterParcelRules needs a resource name and at least one of CanAttach, CanCollect or OnTaken." };
		}

		this.#rules.set(name, { CanAttach: rules.CanAttach, CanCollect: rules.CanCollect, OnTaken: rules.OnTaken });
		return { ok: true, error: "" };
	}

	/// <summary>
	/// Drop the rules of a resource (it stopped, or asked).
	/// </summary>
	/// <param name="resource">Resource name</param>
	/// <returns>True if it had rules</returns>
	UnregisterRules(resource)
	{
		return this.#rules.delete(String(resource || "").trim());
	}

	// ========================
	// Sending
	// ========================

	/// <summary>
	/// Whether owls can carry anything right now: hmp-inventory is running with everything parcels use.
	/// </summary>
	/// <returns>True when it is</returns>
	IsRunning()
	{
		return this.#GetApi() !== null;
	}

	/// <summary>
	/// Read a Galleons amount a page sent. Anything that is not a whole number of at least 1 means none.
	/// </summary>
	/// <param name="value">Client-supplied value</param>
	/// <returns>Galleons, 0 for none, or -1 when it is not a valid amount</returns>
	ReadGalleons(value)
	{
		if (value === undefined || value === null || value === "" || value === 0)
		{
			return 0;
		}

		const amount = Number(value);
		return Number.isInteger(amount) && amount > 0 ? amount : -1;
	}

	/// <summary>
	/// Read the parcel a page asks to send: { galleons, items: [{ key, amount }] }.
	/// </summary>
	/// <param name="value">Client-supplied value</param>
	/// <returns>{ galleons, items }, null when it carries nothing, or undefined when it is malformed</returns>
	ReadRequest(value)
	{
		if (value === undefined || value === null)
		{
			return null;
		}

		if (typeof value !== "object")
		{
			return undefined;
		}

		const galleons = this.ReadGalleons(value.galleons);
		const raw = Array.isArray(value.items) ? value.items : [];

		if (galleons < 0 || raw.length > 20)
		{
			return undefined;
		}

		const items = [];

		for (const item of raw)
		{
			const key = item && typeof item.key === "string" ? item.key : "";
			const amount = Number(item && item.amount);

			if (!key || key.length > maxItemKeyLength || !Number.isInteger(amount) || amount <= 0)
			{
				return undefined;
			}

			items.push({ key, amount });
		}

		return galleons > 0 || items.length > 0 ? { galleons, items } : null;
	}

	/// <summary>
	/// What a player could put on an owl, for the page's item picker.
	/// </summary>
	/// <param name="entry">Directory entry of the sender</param>
	/// <returns>Result carrying { items: [{ key, kind, label, icon, amount, reason }] }</returns>
	async ListCarriable(entry)
	{
		if (!this.IsRunning() || (!this.#config.items && !this.#config.gear))
		{
			return Fail("error.parcel.unavailable");
		}

		const view = await this.#ReadInventory(entry.player);

		if (!view)
		{
			return Fail("error.parcel.unavailable");
		}

		const items = await this.#GetCarriable(entry, view);
		return Ok({ items: items.map((item) => ({ key: item.key, kind: item.kind, label: item.label, icon: item.icon, amount: item.amount, reason: item.reason })) });
	}

	/// <summary>
	/// Check, before anything is sent, that a player can send this parcel on this many owls, and find the items it names in their inventory.
	/// </summary>
	/// <param name="entry">Directory entry of the sender</param>
	/// <param name="request">Read with ReadRequest, not null</param>
	/// <param name="copies">How many owls carry it (a letter's recipients)</param>
	/// <returns>{ problem, items } where problem is a Fail problem or a refusal result, and items the resolved stacks</returns>
	async Check(entry, request, copies)
	{
		if (!this.IsRunning())
		{
			return { problem: "error.parcel.unavailable", items: [] };
		}

		const { galleons } = request;

		if (galleons > 0 && !this.#config.galleons)
		{
			return { problem: "error.parcel.galleonsOff", items: [] };
		}

		if (galleons > this.#config.maxGalleons)
		{
			return { problem: { key: "error.parcel.tooMany", params: { max: this.#config.maxGalleons } }, items: [] };
		}

		if (galleons > 0 && this.#config.dailyGalleonsCap > 0)
		{
			const sent = await this.#database.SumGalleonsSent(entry.number, Date.now() - dayMs);

			if (sent < 0)
			{
				return { problem: "error.sendFailed", items: [] };
			}

			if (sent + galleons * copies > this.#config.dailyGalleonsCap)
			{
				return { problem: { key: "error.parcel.dailyCap", params: { max: this.#config.dailyGalleonsCap, left: Math.max(0, this.#config.dailyGalleonsCap - sent) } }, items: [] };
			}
		}

		let items = [];

		if (request.items.length > 0)
		{
			// Items cannot be copied, so a letter carrying them goes to one recipient.
			if (copies > 1)
			{
				return { problem: "error.parcel.oneRecipient", items: [] };
			}

			const resolved = await this.#Resolve(entry, request.items);

			if (resolved.problem)
			{
				return resolved;
			}

			items = resolved.items;
		}

		const needed = (galleons + this.#config.postageGalleons) * copies;

		if (needed > 0)
		{
			const carried = await this.#CountGalleons(entry.player);

			if (carried < 0)
			{
				return { problem: "error.parcel.unavailable", items: [] };
			}

			if (carried < needed)
			{
				return { problem: { key: "error.parcel.notEnough", params: { count: needed } }, items: [] };
			}
		}

		return { problem: null, items };
	}

	/// <summary>
	/// Find the items a page asked for in the sender's inventory as it is now, and check each may travel.
	/// </summary>
	/// <param name="entry">Directory entry of the sender</param>
	/// <param name="requested">[{ key, amount }]</param>
	/// <returns>{ problem, items: [{ source, slot, name, itemId, variation, kind, label, icon, amount }] }</returns>
	async #Resolve(entry, requested)
	{
		if (requested.length > this.#config.maxItemStacks)
		{
			return { problem: { key: "error.parcel.tooManyItems", params: { max: this.#config.maxItemStacks } }, items: [] };
		}

		const view = await this.#ReadInventory(entry.player);

		if (!view)
		{
			return { problem: "error.parcel.unavailable", items: [] };
		}

		const carriable = new Map((await this.#GetCarriable(entry, view)).map((item) => [item.key, item]));
		const seen = new Set();
		const items = [];

		for (const { key, amount } of requested)
		{
			const item = carriable.get(key);

			if (!item || seen.has(key) || amount > item.amount)
			{
				return { problem: "error.parcel.itemGone", items: [] };
			}

			if (item.reason)
			{
				return { problem: Refuse(`${item.label}: ${item.reason}`), items: [] };
			}

			seen.add(key);
			items.push({ source: item.source, slot: item.slot, name: item.name, itemId: item.itemId, variation: item.variation, kind: item.kind, label: item.label, icon: item.icon, amount });
		}

		return { problem: null, items };
	}

	/// <summary>
	/// Take everything a parcel carries, and its postage, from the sender before its owl is stored. Follow with Attach once the owl is stored, or Cancel if it is not.
	/// </summary>
	/// <param name="entry">Directory entry of the sender</param>
	/// <param name="recipientNumber">Owl number of the recipient</param>
	/// <param name="galleons">Galleons, already checked with Check</param>
	/// <param name="items">Items Check resolved</param>
	/// <returns>{ parcel, error } where error is a Fail problem when nothing left the sender</returns>
	async Prepare(entry, recipientNumber, galleons, items = [])
	{
		const postage = this.#config.postageGalleons;
		const stored = await this.#database.InsertParcel(entry.number, recipientNumber, galleons, postage, items);

		if (!stored)
		{
			return { parcel: null, error: "error.sendFailed" };
		}

		const parcel = { id: stored.id, galleons, postage, items: stored.items, contents: items.length > 0 ? JSON.stringify(items.map((item) => ({ label: item.label, amount: item.amount, kind: item.kind, icon: item.icon || "" }))) : null };
		let postageTaken = false;

		if (galleons + postage > 0)
		{
			const total = galleons + postage;
			const taken = await this.#Take(entry.player, this.#config.galleonsItem, total);

			if (taken < total)
			{
				if (taken > 0 && await this.#Give(entry.player, this.#config.galleonsItem, taken) < taken)
				{
					Logger.LogError("Parcels", `Parcel ${parcel.id}: ${taken} Galleons were taken from ${entry.number} and could not all be put back.`);
				}

				await this.#Abandon(entry, parcel, false);
				return { parcel: null, error: { key: "error.parcel.notEnough", params: { count: total } } };
			}

			postageTaken = true;
			const row = parcel.items.find((item) => item.source === "galleons");

			if (row)
			{
				await this.#database.MoveParcelItem(row.id, ParcelItemState.Pending, ParcelItemState.Held);
				row.state = ParcelItemState.Held;
			}
		}

		for (const row of parcel.items)
		{
			if (row.source === "galleons")
			{
				continue;
			}

			if (!await this.#TakeItem(entry, parcel, row))
			{
				await this.#Abandon(entry, parcel, postageTaken);
				return { parcel: null, error: "error.parcel.itemGone" };
			}

			row.state = ParcelItemState.Held;
		}

		if (items.length > 0)
		{
			this.#TellTaken({ player: entry.player, characterId: entry.characterId, items: items.map((item) => this.#ForRules(item)) });
		}

		return { parcel, error: null };
	}

	/// <summary>
	/// Take one item of a parcel from its sender: a game item through the journal, a custom item into the parcel's container.
	/// </summary>
	/// <param name="entry">Directory entry of the sender</param>
	/// <param name="parcel">Parcel being prepared</param>
	/// <param name="row">Its item row (with slot for a custom item)</param>
	/// <returns>True when all of it left the sender</returns>
	async #TakeItem(entry, parcel, row)
	{
		if (row.source === "native")
		{
			const taken = await this.#Take(entry.player, row.name, row.amount, row.variation);

			if (taken < row.amount)
			{
				if (taken > 0 && await this.#Give(entry.player, row.name, taken, row.variation) < taken)
				{
					Logger.LogError("Parcels", `Parcel ${parcel.id}: ${taken} ${row.name} were taken from ${entry.number} and could not all be put back.`);
				}

				return false;
			}

			await this.#database.MoveParcelItem(row.id, ParcelItemState.Pending, ParcelItemState.Held);
			return true;
		}

		const inventory = this.#GetApi();
		const key = GetContainerKey(parcel.id);

		try
		{
			if (!await inventory.containers.get(key))
			{
				await inventory.containers.create({ key, label: "Owl parcel", slots: Math.max(1, this.#config.maxItemStacks) });
			}

			await inventory.transfers.move({ from: entry.player, to: key, fromSlot: row.slot, amount: row.amount });
		}
		catch (error)
		{
			Logger.LogWarning("Parcels", `Parcel ${parcel.id}: ${row.amount} ${row.name} could not leave ${entry.number}: ${Logger.Describe(error)}`);
			return false;
		}

		await this.#database.MoveParcelItem(row.id, ParcelItemState.Pending, ParcelItemState.Held);
		return true;
	}

	/// <summary>
	/// Give back everything of a parcel that left the sender, because it could not all leave or its owl could not be sent, and close its journal.
	/// </summary>
	/// <param name="entry">Directory entry of the sender</param>
	/// <param name="parcel">Parcel record from Prepare</param>
	/// <param name="postageTaken">Whether the Galleons and postage left the sender</param>
	/// <param name="state">ParcelState to close it at: Failed (never left) or Refunded (its owl failed)</param>
	async #Abandon(entry, parcel, postageTaken, state = ParcelState.Failed)
	{
		if (postageTaken)
		{
			const total = parcel.galleons + parcel.postage;
			const given = await this.#Give(entry.player, this.#config.galleonsItem, total);

			if (given < total)
			{
				Logger.LogError("Parcels", `Parcel ${parcel.id}: only ${given} of ${total} Galleons went back to ${entry.number}.`);
			}
		}

		for (const row of parcel.items)
		{
			if (row.source === "native" && row.state === ParcelItemState.Held && await this.#Give(entry.player, row.name, row.amount, row.variation) < row.amount)
			{
				Logger.LogError("Parcels", `Parcel ${parcel.id}: ${row.amount} ${row.name} could not all go back to ${entry.number}.`);
			}
		}

		if (parcel.items.some((row) => row.source === "custom") && !(await this.#EmptyContainer(parcel.id, entry.player)).ok)
		{
			Logger.LogError("Parcels", `Parcel ${parcel.id}: its items could not all go back to ${entry.number}; they wait in container ${GetContainerKey(parcel.id)}.`);
		}

		for (const row of parcel.items)
		{
			await this.#database.MoveParcelItem(row.id, row.state, ParcelItemState.Void);
		}

		await this.#database.MoveParcel(parcel.id, ParcelState.Pending, state);
	}

	/// <summary>
	/// Put a prepared parcel on its owl, now that the owl is stored. Sets message.parcel for the pages.
	/// </summary>
	/// <param name="entry">Directory entry of the sender</param>
	/// <param name="parcel">Record Prepare returned</param>
	/// <param name="message">Stored message record</param>
	async Attach(entry, parcel, message)
	{
		if (!await this.#database.MoveParcel(parcel.id, ParcelState.Pending, ParcelState.Held, message.id))
		{
			// Everything left and the owl is stored, but the journal could not say so. The start-up check sends it back and logs it for staff.
			Logger.LogError("Parcels", `Parcel ${parcel.id} from ${entry.number} could not be put on owl ${message.id}.`);
			return;
		}

		message.parcel = MapParcel(ParcelState.Held, parcel.galleons, parcel.contents);
		const contents = ReadParcelContents(parcel.contents).map((item) => `${item.amount} × ${item.label}`);
		const what = [parcel.galleons > 0 ? `${parcel.galleons} Galleons` : "", ...contents].filter(Boolean).join(", ");
		this.#audit.Log("parcels", "Parcel sent", `${this.#Describe(entry.number)} sent ${what} on owl ${message.id}${parcel.postage > 0 ? ` (${parcel.postage} postage)` : ""}.`);
	}

	/// <summary>
	/// Give a prepared parcel back, because its owl could not be stored or sent.
	/// </summary>
	/// <param name="entry">Directory entry of the sender</param>
	/// <param name="parcel">Record Prepare returned</param>
	async Cancel(entry, parcel)
	{
		await this.#Abandon(entry, parcel, parcel.galleons + parcel.postage > 0, ParcelState.Refunded);
	}

	// ========================
	// Collecting and Returning
	// ========================

	/// <summary>
	/// Hand what a parcel still holds to an online player: the recipient collecting it, or the sender it went back to.
	/// Galleons and game items are journalled one by one; custom items leave the container stack by stack.
	/// </summary>
	/// <param name="parcel">Parcel record</param>
	/// <param name="player">Player to give to</param>
	/// <returns>{ ok, full } where ok means nothing is left in the parcel and full that the player had no room</returns>
	async #Deliver(parcel, player)
	{
		const rows = await this.#database.ListParcelItems(parcel.id);

		if (!rows)
		{
			return { ok: false, full: false };
		}

		for (const row of rows)
		{
			if (row.source === "custom" || row.state !== ParcelItemState.Held)
			{
				continue;
			}

			if (!await this.#database.MoveParcelItem(row.id, ParcelItemState.Held, ParcelItemState.Moving))
			{
				return { ok: false, full: false };
			}

			const name = row.source === "galleons" ? this.#config.galleonsItem : row.name;
			const given = await this.#Give(player, name, row.amount, row.variation);

			if (given === 0)
			{
				await this.#database.MoveParcelItem(row.id, ParcelItemState.Moving, ParcelItemState.Held);
				return { ok: false, full: false };
			}

			if (given < row.amount)
			{
				Logger.LogError("Parcels", `Parcel ${parcel.id}: only ${given} of ${row.amount} ${name} reached player ${player.id}.`);
			}

			await this.#database.MoveParcelItem(row.id, ParcelItemState.Moving, ParcelItemState.Done);
		}

		const custom = rows.filter((row) => row.source === "custom" && row.state === ParcelItemState.Held);

		if (custom.length > 0)
		{
			const emptied = await this.#EmptyContainer(parcel.id, player);

			if (!emptied.ok)
			{
				return emptied;
			}

			for (const row of custom)
			{
				await this.#database.MoveParcelItem(row.id, ParcelItemState.Held, ParcelItemState.Done);
			}
		}

		return { ok: true, full: false };
	}

	/// <summary>
	/// What a parcel still holds, as rules see it, for CanCollect.
	/// </summary>
	/// <param name="parcel">Parcel record</param>
	/// <returns>{ galleons, items: [{ source, name, itemId, variation, kind, label, amount }] }, or null when it cannot be read</returns>
	async #DescribeHeld(parcel)
	{
		const rows = await this.#database.ListParcelItems(parcel.id);

		if (!rows)
		{
			return null;
		}

		// Item rows come in the order their contents were written, Galleons first and left out of the contents.
		const contents = ReadParcelContents(parcel.contents);
		const stacks = rows.filter((row) => row.source !== "galleons");
		const galleons = rows.filter((row) => row.source === "galleons" && row.state === ParcelItemState.Held).reduce((sum, row) => sum + row.amount, 0);
		const items = stacks.map((row, index) => ({ row, described: contents[index] || { label: row.name, kind: "item" } }))
			.filter(({ row }) => row.state === ParcelItemState.Held)
			.map(({ row, described }) => ({ source: row.source, name: row.name, itemId: row.source === "native" ? row.name.replace(/^native:/i, "") : "", variation: row.variation, kind: described.kind, label: described.label, amount: row.amount }));
		return { galleons, items };
	}

	/// <summary>
	/// Collect the parcel on an owl the player received.
	/// </summary>
	/// <param name="entry">Directory entry of the recipient</param>
	/// <param name="data">{ chatId, messageId }</param>
	/// <returns>Result carrying { chatId, messageId, parcel }</returns>
	async Collect(entry, data)
	{
		const chatId = Number(data.chatId);
		const messageId = Number(data.messageId);

		if (!Number.isInteger(chatId) || chatId <= 0 || !Number.isInteger(messageId) || messageId <= 0)
		{
			return Fail("error.parcel.gone");
		}

		if (!this.IsRunning())
		{
			return Fail("error.parcel.unavailable");
		}

		// Visibility covers everything a page could not see: an owl still in flight, one from someone blocked, one deleted.
		const message = await this.#database.GetVisibleMessage(chatId, entry.number, messageId);
		const parcel = message ? await this.#database.GetParcelByMessage(messageId) : null;

		if (!parcel || parcel.recipient !== entry.number || parcel.sender === entry.number)
		{
			return Fail("error.parcel.gone");
		}

		if (parcel.state !== ParcelState.Held)
		{
			return Fail(parcel.state === ParcelState.Collected ? "error.parcel.collected" : "error.parcel.gone");
		}

		const held = await this.#DescribeHeld(parcel);

		if (!held)
		{
			return Fail("error.parcel.collectFailed");
		}

		const refusal = await this.#AskRules("CanCollect", { player: entry.player, characterId: entry.characterId, galleons: held.galleons, items: held.items });

		if (refusal)
		{
			return Refuse(refusal);
		}

		if (!await this.#database.MoveParcel(parcel.id, ParcelState.Held, ParcelState.Collecting))
		{
			return Fail("error.parcel.gone");
		}

		const delivered = await this.#Deliver(parcel, entry.player);

		if (!delivered.ok)
		{
			// Whatever arrived stays arrived; the rest waits on the owl for another try.
			await this.#database.MoveParcel(parcel.id, ParcelState.Collecting, ParcelState.Held);
			return Fail(delivered.full ? "error.parcel.inventoryFull" : "error.parcel.collectFailed");
		}

		await this.#database.MoveParcel(parcel.id, ParcelState.Collecting, ParcelState.Collected);
		this.#PushUpdate(parcel, chatId, ParcelState.Collected);
		this.#audit.Log("parcels", "Parcel collected", `${this.#Describe(entry.number)} collected the parcel from ${this.#Describe(parcel.sender)} (owl ${messageId}).`);
		return Ok({ chatId, messageId, parcel: MapParcel(ParcelState.Collected, parcel.galleons, parcel.contents) });
	}

	/// <summary>
	/// Send the parcel on an owl back to its sender, if one still waits on it (the owl was unsent).
	/// </summary>
	/// <param name="chatId">Chat the owl is in</param>
	/// <param name="messageId">Message row ID</param>
	async ReturnOwl(chatId, messageId)
	{
		const parcel = await this.#database.GetParcelByMessage(messageId);

		if (parcel && parcel.state === ParcelState.Held)
		{
			await this.#Return(parcel, chatId);
		}
	}

	/// <summary>
	/// Mark a waiting parcel as going back, and pay it straight away if its sender is online.
	/// </summary>
	/// <param name="parcel">Parcel record at ParcelState.Held</param>
	/// <param name="chatId">Chat the owl is in; 0 when unknown</param>
	async #Return(parcel, chatId)
	{
		if (!await this.#database.MoveParcel(parcel.id, ParcelState.Held, ParcelState.Returning))
		{
			return;
		}

		this.#PushUpdate(parcel, chatId, ParcelState.Returning);
		const sender = this.#directory.GetByNumber(parcel.sender);

		if (sender)
		{
			await this.PayReturns(sender);
		}
	}

	/// <summary>
	/// Pay an online sender every parcel on its way back to them. Called when their owl loads, after a parcel of theirs is returned, and from the sweep.
	/// A parcel that does not fit (a full inventory) waits for the next try.
	/// </summary>
	/// <param name="entry">Directory entry of the sender</param>
	async PayReturns(entry)
	{
		if (!this.IsRunning() || this.#paying.has(entry.number))
		{
			return;
		}

		this.#paying.add(entry.number);

		try
		{
			let returned = 0;
			let isFull = false;

			for (const parcel of await this.#database.ListReturningParcels(entry.number))
			{
				if (!await this.#database.MoveParcel(parcel.id, ParcelState.Returning, ParcelState.Repaying))
				{
					continue;
				}

				const delivered = await this.#Deliver(parcel, entry.player);

				if (!delivered.ok)
				{
					isFull = isFull || delivered.full;
					await this.#database.MoveParcel(parcel.id, ParcelState.Repaying, ParcelState.Returning);
					continue;
				}

				await this.#database.MoveParcel(parcel.id, ParcelState.Repaying, ParcelState.Returned);
				this.#audit.Log("parcels", "Parcel returned", `The parcel on owl ${parcel.messageId} went back to ${this.#Describe(entry.number)}.`);
				++returned;
			}

			if (this.#directory.GetByNumber(entry.number) !== entry)
			{
				return;
			}

			if (returned > 0)
			{
				this.#outbox.Push(entry.player, "notify", { kind: "info", titleKey: "app.name", bodyKey: "parcel.returnedToYou", params: { count: returned } });
			}

			if (isFull)
			{
				this.#outbox.Push(entry.player, "notify", { kind: "error", titleKey: "app.name", bodyKey: "parcel.returnWaiting" });
			}
		}
		finally
		{
			this.#paying.delete(entry.number);
		}
	}

	/// <summary>
	/// Send back every parcel nobody collected in time, then pay the returns of senders who are online.
	/// </summary>
	async Sweep()
	{
		if (!this.IsRunning())
		{
			return;
		}

		const cutoff = Date.now() - this.#config.returnAfterDays * dayMs;

		for (const parcel of await this.#database.ListParcels(ParcelState.Held, cutoff, sweepBatchSize))
		{
			await this.#Return(parcel, 0);
		}

		const senders = new Set((await this.#database.ListParcels(ParcelState.Returning, 0, sweepBatchSize)).map((parcel) => parcel.sender));

		for (const number of senders)
		{
			const entry = this.#directory.GetByNumber(number);

			if (entry)
			{
				await this.PayReturns(entry);
			}
		}
	}

	/// <summary>
	/// Settle parcels a crash left between two steps, at start-up before any owl loads.
	///
	/// <para>
	/// NOTE: An item caught moving is counted as arrived, and one caught pending (not yet known to have left the sender) as never sent: neither can duplicate anything, and both are logged with the amount for staff.
	/// A parcel caught leaving goes back to the sender with whatever is known to have left (held rows, and anything in its container); one caught arriving or going back resumes from where it stopped.
	/// </para>
	///
	/// </summary>
	async Recover()
	{
		const interrupted = [ParcelState.Pending, ParcelState.Collecting, ParcelState.Repaying];

		for (const state of interrupted)
		{
			for (const parcel of await this.#database.ListParcels(state, 0, 1000))
			{
				await this.#RecoverParcel(parcel);
			}
		}
	}

	/// <summary>
	/// Settle one interrupted parcel. See Recover.
	/// </summary>
	/// <param name="parcel">Parcel record at Pending, Collecting or Repaying</param>
	async #RecoverParcel(parcel)
	{
		const rows = await this.#database.ListParcelItems(parcel.id);

		if (!rows)
		{
			return;
		}

		for (const row of rows)
		{
			const settled = row.state === ParcelItemState.Moving ? ParcelItemState.Done : row.state === ParcelItemState.Pending && row.source !== "custom" ? ParcelItemState.Void : null;

			if (settled && await this.#database.MoveParcelItem(row.id, row.state, settled))
			{
				Logger.LogError("Parcels", `Parcel ${parcel.id} was interrupted: ${row.amount} ${row.source === "galleons" ? "Galleons" : row.name} ${settled === ParcelItemState.Done ? "may not have arrived" : `may have been taken from ${parcel.sender}`}. Marked ${settled}; check it by hand.`);
				row.state = settled;
			}
		}

		const isLeft = rows.some((row) => row.state === ParcelItemState.Held) || (rows.some((row) => row.source === "custom") && await this.#ContainerHolds(parcel.id));
		const to = parcel.state === ParcelState.Collecting ? (isLeft ? ParcelState.Held : ParcelState.Collected)
			: isLeft ? ParcelState.Returning : parcel.state === ParcelState.Repaying ? ParcelState.Returned : ParcelState.Void;

		// A custom item caught pending may already sit in the container; it goes wherever the container goes.
		for (const row of rows.filter((item) => item.source === "custom" && item.state === ParcelItemState.Pending))
		{
			await this.#database.MoveParcelItem(row.id, ParcelItemState.Pending, ParcelItemState.Held);
		}

		if (await this.#database.MoveParcel(parcel.id, parcel.state, to))
		{
			this.#audit.Log("parcels", "Parcel interrupted", `Parcel ${parcel.id} (from ${this.#Describe(parcel.sender)} to ${this.#Describe(parcel.recipient)}) was interrupted at "${parcel.state}" and marked "${to}".`);
		}
	}
}

module.exports = { ParcelService, GetContainerKey };
