// FranticDreamer 2026
"use strict";

const { Ok, Fail } = require("./Result.js");
const { Logger } = require("./Logger.js");
const { invalidId, ParcelState, MapParcel } = require("./Database.js");

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
/// Parcels: Galleons sent on an owl (a phone owl or one copy of a letter), held by the server until the recipient collects them.
///
/// <para>
/// What a parcel does:
/// - The Galleons (and any postage) leave the sender when the owl is sent, so they cannot be spent twice.
/// - The recipient collects them by hand once the owl has landed, so nothing lands in an inventory unasked.
/// - A parcel nobody collects within attachments.returnAfterDays goes back to the sender, paid the next time they are online. Unsending the owl sends it back at once.
/// - Neither side is ever told who the other is: a returned parcel says only that it went back to the sender, which keeps unsigned letters anonymous.
/// - Postage pays the owl and is never returned.
/// </para>
///
/// <para>
/// NOTE: Galleons are a framework-native item, and hmp-inventory's atomic transfers refuse native items: they live in the game's own inventory, not in one MySQL row.
/// So every move is journalled in frantic_owls_parcels before it happens (see ParcelState), and a crash in between is settled the way that never duplicates Galleons.
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
	/// The inventory API parcels use, or null when hmp-inventory is not running or lacks it.
	/// </summary>
	/// <returns>hmp-inventory's "inventory" API, or null</returns>
	#GetInventoryApi()
	{
		const inventory = this.#GetInventory();
		const api = inventory && inventory.inventory;
		return api && typeof api.add === "function" && typeof api.remove === "function" && typeof api.count === "function" ? api : null;
	}

	/// <summary>
	/// Add Galleons to an online player. hmp-inventory rejects on failure; that counts as nothing added.
	/// </summary>
	/// <param name="player">Player to pay</param>
	/// <param name="amount">Galleons</param>
	/// <returns>Galleons actually added</returns>
	async #Give(player, amount)
	{
		const api = this.#GetInventoryApi();

		if (!api || amount <= 0)
		{
			return 0;
		}

		try
		{
			return Math.max(0, Number(await api.add(player, this.#config.galleonsItem, amount)) || 0);
		}
		catch (error)
		{
			Logger.LogError("Parcels", `Adding ${amount} Galleons to player ${player.id} failed: ${Logger.Describe(error)}`);
			return 0;
		}
	}

	/// <summary>
	/// Take Galleons from an online player. hmp-inventory rejects on failure; that counts as nothing taken.
	/// </summary>
	/// <param name="player">Player to take from</param>
	/// <param name="amount">Galleons</param>
	/// <returns>Galleons actually taken</returns>
	async #Take(player, amount)
	{
		const api = this.#GetInventoryApi();

		if (!api || amount <= 0)
		{
			return 0;
		}

		try
		{
			return Math.max(0, Number(await api.remove(player, this.#config.galleonsItem, amount)) || 0);
		}
		catch (error)
		{
			Logger.LogError("Parcels", `Taking ${amount} Galleons from player ${player.id} failed: ${Logger.Describe(error)}`);
			return 0;
		}
	}

	/// <summary>
	/// Galleons an online player carries, or -1 when they cannot be counted.
	/// </summary>
	/// <param name="player">Player</param>
	/// <returns>Galleons, or -1</returns>
	async #Count(player)
	{
		const api = this.#GetInventoryApi();

		try
		{
			return api ? Math.max(0, Number(await api.count(player, this.#config.galleonsItem)) || 0) : -1;
		}
		catch (error)
		{
			Logger.LogError("Parcels", `Counting the Galleons of player ${player.id} failed: ${Logger.Describe(error)}`);
			return -1;
		}
	}

	/// <summary>
	/// Tell whoever is online of the sender and the recipient that a parcel's status changed, so both their pages redraw it.
	/// </summary>
	/// <param name="parcel">Parcel record</param>
	/// <param name="chatId">Chat the owl is in; 0 when unknown (the page then finds the owl by its ID)</param>
	/// <param name="state">ParcelState it is at now</param>
	#PushUpdate(parcel, chatId, state)
	{
		const data = { chatId, messageId: parcel.messageId, parcel: MapParcel(state, parcel.galleons) };

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

	/// <summary>
	/// Whether owls can carry Galleons right now: they are switched on and hmp-inventory is running.
	/// </summary>
	/// <returns>True when they can</returns>
	IsAvailable()
	{
		return this.#config.galleons && this.#GetInventoryApi() !== null;
	}

	/// <summary>
	/// Read the Galleons a page asks to send. Anything that is not a whole number of at least 1 means none.
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
	/// Check, before anything is sent, that a player can send Galleons on this many owls.
	/// </summary>
	/// <param name="entry">Directory entry of the sender</param>
	/// <param name="galleons">Galleons per owl, already read with ReadGalleons and above 0</param>
	/// <param name="copies">How many owls carry a parcel (a letter's recipients)</param>
	/// <returns>A Fail problem ({ key, params } or a key), or null when it may go</returns>
	async Check(entry, galleons, copies)
	{
		if (!this.IsAvailable())
		{
			return "error.parcel.unavailable";
		}

		if (galleons < 0 || galleons > this.#config.maxGalleons)
		{
			return { key: "error.parcel.tooMany", params: { max: this.#config.maxGalleons } };
		}

		if (this.#config.dailyGalleonsCap > 0)
		{
			const sent = await this.#database.SumGalleonsSent(entry.number, Date.now() - dayMs);

			if (sent < 0)
			{
				return "error.sendFailed";
			}

			if (sent + galleons * copies > this.#config.dailyGalleonsCap)
			{
				return { key: "error.parcel.dailyCap", params: { max: this.#config.dailyGalleonsCap, left: Math.max(0, this.#config.dailyGalleonsCap - sent) } };
			}
		}

		const needed = (galleons + this.#config.postageGalleons) * copies;
		const carried = await this.#Count(entry.player);

		if (carried < 0)
		{
			return "error.parcel.unavailable";
		}

		if (carried < needed)
		{
			return { key: "error.parcel.notEnough", params: { count: needed } };
		}

		return null;
	}

	/// <summary>
	/// Take a parcel's Galleons and postage from the sender, before its owl is stored. Follow with Attach once the owl is stored, or Cancel if it is not.
	/// </summary>
	/// <param name="entry">Directory entry of the sender</param>
	/// <param name="recipientNumber">Owl number of the recipient</param>
	/// <param name="galleons">Galleons, already checked with Check</param>
	/// <returns>{ parcel, error } where parcel is { id, galleons, postage } and error a Fail problem when it could not be taken</returns>
	async Prepare(entry, recipientNumber, galleons)
	{
		const postage = this.#config.postageGalleons;
		const id = await this.#database.InsertParcel(entry.number, recipientNumber, galleons, postage);

		if (id === invalidId)
		{
			return { parcel: null, error: "error.sendFailed" };
		}

		const total = galleons + postage;
		const taken = await this.#Take(entry.player, total);

		if (taken < total)
		{
			// Only part of it came out (spent meanwhile): put that part back and keep the owl at home.
			if (taken > 0 && await this.#Give(entry.player, taken) < taken)
			{
				Logger.LogError("Parcels", `Parcel ${id}: ${taken} Galleons were taken from ${entry.number} and could not all be put back.`);
			}

			await this.#database.MoveParcel(id, ParcelState.Pending, ParcelState.Failed);
			return { parcel: null, error: { key: "error.parcel.notEnough", params: { count: total } } };
		}

		return { parcel: { id, galleons, postage }, error: null };
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
			// The Galleons are gone and the owl is stored, but the journal could not say so. The start-up check settles it as void and logs it for staff.
			Logger.LogError("Parcels", `Parcel ${parcel.id} of ${parcel.galleons} Galleons from ${entry.number} could not be put on owl ${message.id}.`);
			return;
		}

		message.parcel = MapParcel(ParcelState.Held, parcel.galleons);
		this.#audit.Log("parcels", "Parcel sent", `${this.#Describe(entry.number)} sent ${parcel.galleons} Galleons on owl ${message.id}${parcel.postage > 0 ? ` (${parcel.postage} postage)` : ""}.`);
	}

	/// <summary>
	/// Give a prepared parcel's Galleons and postage back, because its owl could not be stored or sent.
	/// </summary>
	/// <param name="entry">Directory entry of the sender</param>
	/// <param name="parcel">Record Prepare returned</param>
	async Cancel(entry, parcel)
	{
		const total = parcel.galleons + parcel.postage;
		const given = await this.#Give(entry.player, total);

		if (given < total)
		{
			Logger.LogError("Parcels", `Parcel ${parcel.id}: only ${given} of ${total} Galleons went back to ${entry.number} after its owl failed.`);
		}

		await this.#database.MoveParcel(parcel.id, ParcelState.Pending, ParcelState.Refunded);
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

		if (!this.IsAvailable())
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

		if (!await this.#database.MoveParcel(parcel.id, ParcelState.Held, ParcelState.Collecting))
		{
			return Fail(parcel.state === ParcelState.Collected ? "error.parcel.collected" : "error.parcel.gone");
		}

		const given = await this.#Give(entry.player, parcel.galleons);

		if (given === 0)
		{
			await this.#database.MoveParcel(parcel.id, ParcelState.Collecting, ParcelState.Held);
			return Fail("error.parcel.collectFailed");
		}

		if (given < parcel.galleons)
		{
			Logger.LogError("Parcels", `Parcel ${parcel.id}: ${entry.number} collected only ${given} of ${parcel.galleons} Galleons.`);
		}

		await this.#database.MoveParcel(parcel.id, ParcelState.Collecting, ParcelState.Collected);
		this.#PushUpdate(parcel, chatId, ParcelState.Collected);
		this.#audit.Log("parcels", "Parcel collected", `${this.#Describe(entry.number)} collected ${given} Galleons from ${this.#Describe(parcel.sender)} (owl ${messageId}).`);
		return Ok({ chatId, messageId, parcel: MapParcel(ParcelState.Collected, parcel.galleons) });
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
	/// Pay an online sender every parcel on its way back to them. Called when their owl loads and after a parcel of theirs is returned.
	/// </summary>
	/// <param name="entry">Directory entry of the sender</param>
	async PayReturns(entry)
	{
		if (!this.IsAvailable() || this.#paying.has(entry.number))
		{
			return;
		}

		this.#paying.add(entry.number);

		try
		{
			let total = 0;

			for (const parcel of await this.#database.ListReturningParcels(entry.number))
			{
				if (!await this.#database.MoveParcel(parcel.id, ParcelState.Returning, ParcelState.Repaying))
				{
					continue;
				}

				const given = await this.#Give(entry.player, parcel.galleons);

				if (given === 0)
				{
					// Nothing reached them: try again next time.
					await this.#database.MoveParcel(parcel.id, ParcelState.Repaying, ParcelState.Returning);
					continue;
				}

				if (given < parcel.galleons)
				{
					Logger.LogError("Parcels", `Parcel ${parcel.id}: only ${given} of ${parcel.galleons} Galleons went back to ${entry.number}.`);
				}

				await this.#database.MoveParcel(parcel.id, ParcelState.Repaying, ParcelState.Returned);
				this.#audit.Log("parcels", "Parcel returned", `${parcel.galleons} Galleons on owl ${parcel.messageId} went back to ${this.#Describe(entry.number)}.`);
				total += given;
			}

			if (total > 0 && this.#directory.GetByNumber(entry.number) === entry)
			{
				this.#outbox.Push(entry.player, "notify", { kind: "info", titleKey: "app.name", bodyKey: "parcel.returnedToYou", params: { count: total } });
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
		if (!this.IsAvailable())
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
	/// Settle parcels a crash left between two steps, at start-up before any owl loads. See ParcelState for why each goes where it does.
	/// </summary>
	async Recover()
	{
		const settle =
		[
			{ from: ParcelState.Pending, to: ParcelState.Void, what: "may have been taken from" },
			{ from: ParcelState.Collecting, to: ParcelState.Collected, what: "may not have reached the recipient of" },
			{ from: ParcelState.Repaying, to: ParcelState.Returned, what: "may not have gone back to" },
		];

		for (const { from, to, what } of settle)
		{
			for (const parcel of await this.#database.ListParcels(from, 0, 1000))
			{
				if (await this.#database.MoveParcel(parcel.id, from, to))
				{
					Logger.LogError("Parcels", `Parcel ${parcel.id} was interrupted (${from}): ${parcel.galleons + (from === ParcelState.Pending ? parcel.postage : 0)} Galleons ${what} ${parcel.sender}. Marked ${to}; check this owl by hand.`);
					this.#audit.Log("parcels", "Parcel interrupted", `Parcel ${parcel.id} (${parcel.galleons} Galleons from ${this.#Describe(parcel.sender)} to ${this.#Describe(parcel.recipient)}) was interrupted at "${from}" and marked "${to}".`);
				}
			}
		}
	}
}

module.exports = { ParcelService };
