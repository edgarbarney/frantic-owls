// FranticDreamer 2026
"use strict";

const { Logger } = require("./Logger.js");

/// <summary>
/// Network event every batch is delivered on. The client unpacks it item by item.
/// </summary>
const batchEvent = "frantic-owls:batch";

// ========================
// Outbox
// ========================

/// <summary>
/// Per-player queue of outgoing updates, flushed on a fixed interval.
///
/// <para>
/// NOTE: A busy group chat otherwise sends one network event per message per member, and a request reply right behind it.
/// Coalescing everything queued for a player into one event per tick keeps the event count flat under load.
/// The interval is configurable (network.flushIntervalMs) so a laggy server can trade a little latency for fewer, larger events; 0 sends immediately.
/// Batches are split by serialised size so no single event exceeds network.maxBatchBytes.
/// </para>
///
/// </summary>
class Outbox
{
	/// <summary>
	/// Queued items per player ID: { player, items: [{ type, data }] }.
	/// </summary>
	#queues = new Map();

	/// <summary>
	/// Flush period in milliseconds. 0 disables batching.
	/// </summary>
	#flushIntervalMs = 0;

	/// <summary>
	/// Upper bound for one serialised batch.
	/// </summary>
	#maxBatchBytes = 24000;

	/// <summary>
	/// Interval handle while running, null otherwise.
	/// </summary>
	#timer = null;

	/// <summary>
	/// Serialise items into as few events as the size budget allows and send them to one player.
	/// </summary>
	/// <param name="player">Receiving player</param>
	/// <param name="items">Queued { type, data } items, in order</param>
	#Send(player, items)
	{
		if (!player || player.connected === false || items.length === 0)
		{
			return;
		}

		let chunk = [];
		let chunkBytes = 0;

		for (const item of items)
		{
			const text = JSON.stringify(item);
			const bytes = Buffer.byteLength(text, "utf8");

			if (bytes > this.#maxBatchBytes)
			{
				Logger.LogWarning("Outbox", `Item "${item.type}" is ${bytes} bytes, above the ${this.#maxBatchBytes} byte batch budget; sending it alone.`);
			}

			if (chunk.length > 0 && chunkBytes + bytes > this.#maxBatchBytes)
			{
				this.#Emit(player, chunk);
				chunk = [];
				chunkBytes = 0;
			}

			chunk.push(text);
			chunkBytes += bytes + 1;
		}

		this.#Emit(player, chunk);
	}

	/// <summary>
	/// Emit one already-serialised batch.
	/// </summary>
	/// <param name="player">Receiving player</param>
	/// <param name="serialisedItems">JSON text of each item</param>
	#Emit(player, serialisedItems)
	{
		if (serialisedItems.length === 0)
		{
			return;
		}

		// The native emit can throw if the player left between queueing and flushing.
		try
		{
			player.emit(batchEvent, `{"items":[${serialisedItems.join(",")}]}`);
		}
		catch (error)
		{
			Logger.LogWarning("Outbox", `Could not deliver to player ${player.id}: ${Logger.Describe(error)}`);
		}
	}

	/// <summary>
	/// Constructor.
	/// </summary>
	/// <param name="flushIntervalMs">Flush period in milliseconds (0 = send immediately)</param>
	/// <param name="maxBatchBytes">Upper bound for one serialised batch</param>
	constructor(flushIntervalMs, maxBatchBytes)
	{
		this.#flushIntervalMs = flushIntervalMs;
		this.#maxBatchBytes = maxBatchBytes;
	}

	/// <summary>
	/// Start the flush timer. Does nothing when batching is disabled.
	/// </summary>
	Start()
	{
		if (this.#timer !== null || this.#flushIntervalMs <= 0)
		{
			return;
		}

		this.#timer = setInterval(() => this.FlushAll(), this.#flushIntervalMs);
	}

	/// <summary>
	/// Flush everything still queued and stop the timer.
	/// </summary>
	Stop()
	{
		if (this.#timer !== null)
		{
			clearInterval(this.#timer);
			this.#timer = null;
		}

		this.FlushAll();
	}

	/// <summary>
	/// Queue one update for a player.
	/// </summary>
	/// <param name="player">Receiving player</param>
	/// <param name="type">Item type the client dispatches on (e.g. "message:new")</param>
	/// <param name="data">JSON-serialisable payload</param>
	Push(player, type, data)
	{
		if (!player)
		{
			return;
		}

		if (this.#timer === null)
		{
			this.#Send(player, [{ type, data }]);
			return;
		}

		let queue = this.#queues.get(player.id);

		if (!queue)
		{
			queue = { player, items: [] };
			this.#queues.set(player.id, queue);
		}

		queue.player = player;
		queue.items.push({ type, data });
	}

	/// <summary>
	/// Queue a long list as several items so each fits the batch budget.
	/// The first item carries reset: true so the client knows to drop what it had.
	/// </summary>
	/// <param name="player">Receiving player</param>
	/// <param name="type">Item type for every chunk</param>
	/// <param name="key">Property name the list is stored under in each chunk</param>
	/// <param name="list">Full list to send</param>
	/// <param name="chunkSize">Entries per chunk</param>
	PushChunked(player, type, key, list, chunkSize)
	{
		if (list.length === 0)
		{
			this.Push(player, type, { reset: true, [key]: [] });
			return;
		}

		for (let start = 0; start < list.length; start += chunkSize)
		{
			this.Push(player, type, { reset: start === 0, [key]: list.slice(start, start + chunkSize) });
		}
	}

	/// <summary>
	/// Drop everything queued for a player, e.g. after they disconnect.
	/// </summary>
	/// <param name="playerId">Player ID</param>
	Forget(playerId)
	{
		this.#queues.delete(playerId);
	}

	/// <summary>
	/// Send every queued item now.
	/// </summary>
	FlushAll()
	{
		if (this.#queues.size === 0)
		{
			return;
		}

		const queues = [...this.#queues.values()];
		this.#queues.clear();

		for (const queue of queues)
		{
			this.#Send(queue.player, queue.items);
		}
	}
}

module.exports = { Outbox };
