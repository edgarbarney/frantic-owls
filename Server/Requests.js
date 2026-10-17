// FranticDreamer 2026
"use strict";

const { Logger } = require("./Logger.js");
const { Fail } = require("./Result.js");

/// <summary>
/// Longest accepted request ID. The page generates short counters, so anything longer is junk.
/// </summary>
const maxRequestIdLength = 32;

/// <summary>
/// Largest raw request accepted from a client, in characters. A maximum-length owl fits comfortably.
/// </summary>
const maxRequestLength = 16384;

// ========================
// Request Dispatcher
// ========================

/// <summary>
/// Single entry point for everything the phone page asks the server to do.
///
/// <para>
/// NOTE: Every client request travels as { requestId, action, data } on one network event and is answered with a
/// "response" outbox item carrying the same requestId. One channel means one place to check shape, rate and
/// whether the player has an owl loaded at all, instead of repeating those checks in a dozen Events.onClient handlers.
/// </para>
///
/// </summary>
class RequestDispatcher
{
	/// <summary>
	/// OwlDirectory instance.
	/// </summary>
	#directory;

	/// <summary>
	/// Outbox instance, for replies.
	/// </summary>
	#outbox;

	/// <summary>
	/// Per-player request rate limiter, keyed by player ID.
	/// </summary>
	#limiter;

	/// <summary>
	/// Rate limiter window, kept for sweeping.
	/// </summary>
	#windowMs;

	/// <summary>
	/// Registered handlers by action name.
	/// </summary>
	#handlers = new Map();

	/// <summary>
	/// Turn whatever arrived on the network into a request object.
	/// </summary>
	/// <param name="raw">JSON text or an already parsed value</param>
	/// <returns>{ requestId, action, data }, or null if it is not a well-formed request</returns>
	#Parse(raw)
	{
		let value = raw;

		if (typeof raw === "string")
		{
			if (raw.length > maxRequestLength)
			{
				return null;
			}

			// JSON.parse throws on malformed text, which a client can send at will.
			try
			{
				value = JSON.parse(raw);
			}
			catch (error)
			{
				return null;
			}
		}

		if (!value || typeof value !== "object" || Array.isArray(value))
		{
			return null;
		}

		const requestId = String(value.requestId ?? "");
		const action = String(value.action ?? "");
		const data = value.data && typeof value.data === "object" && !Array.isArray(value.data) ? value.data : {};

		if (requestId.length === 0 || requestId.length > maxRequestIdLength || !/^[A-Za-z0-9_-]+$/.test(requestId))
		{
			return null;
		}

		return { requestId, action, data };
	}

	/// <summary>
	/// Queue the reply to one request.
	/// </summary>
	/// <param name="player">Requesting player</param>
	/// <param name="requestId">ID the page is waiting on</param>
	/// <param name="result">Result built with Ok() or Fail()</param>
	#Reply(player, requestId, result)
	{
		this.#outbox.Push(player, "response", { requestId, ok: result.ok, error: result.error || "", errorKey: result.errorKey || "", errorParams: result.errorParams || {}, data: result.data ?? null });
	}

	/// <summary>
	/// Constructor.
	/// </summary>
	/// <param name="hmp">hmp-lib server import</param>
	/// <param name="directory">OwlDirectory instance</param>
	/// <param name="outbox">Outbox instance</param>
	/// <param name="networkConfig">The "network" section of the server config</param>
	constructor(hmp, directory, outbox, networkConfig)
	{
		this.#directory = directory;
		this.#outbox = outbox;
		this.#windowMs = networkConfig.requestRateLimitWindowMs;
		this.#limiter = hmp.rateLimit.create({ limit: networkConfig.requestRateLimitCount, windowMs: networkConfig.requestRateLimitWindowMs });
	}

	/// <summary>
	/// Register the handler for one action.
	/// </summary>
	/// <param name="action">Action name the page sends (e.g. "messages.send")</param>
	/// <param name="handler">(entry, data) => Result or Promise of a Result. Must not throw.</param>
	Register(action, handler)
	{
		this.#handlers.set(action, handler);
	}

	/// <summary>
	/// Drop rate-limit buckets nobody has used for a while. Call from a maintenance tick.
	/// </summary>
	Sweep()
	{
		this.#limiter.sweep(this.#windowMs * 4);
	}

	/// <summary>
	/// Forget a disconnected player's rate-limit bucket.
	/// </summary>
	/// <param name="playerId">Player ID</param>
	Forget(playerId)
	{
		this.#limiter.reset(playerId);
	}

	/// <summary>
	/// Validate and run one client request, then queue its reply.
	/// Malformed requests are dropped silently: the page never sends them, so only a tampered client sees no answer.
	/// </summary>
	/// <param name="player">Requesting player</param>
	/// <param name="raw">Network payload</param>
	async Handle(player, raw)
	{
		const request = this.#Parse(raw);

		if (!request)
		{
			return;
		}

		if (!this.#limiter.allow(player.id))
		{
			this.#Reply(player, request.requestId, Fail("error.slowDown"));
			return;
		}

		const handler = this.#handlers.get(request.action);

		if (!handler)
		{
			this.#Reply(player, request.requestId, Fail("error.unknownAction"));
			return;
		}

		const entry = this.#directory.GetByPlayerId(player.id);

		if (!entry)
		{
			this.#Reply(player, request.requestId, Fail("error.noOwl"));
			return;
		}

		// Handlers return results instead of throwing; this only guards against a genuine bug taking the resource down.
		let result = null;

		try
		{
			result = await handler(entry, request.data);
		}
		catch (error)
		{
			Logger.LogError("Requests", `Handler for "${request.action}" failed: ${Logger.Describe(error)}`);
			result = Fail("error.unexpected");
		}

		this.#Reply(player, request.requestId, result || Fail("error.unexpected"));
	}
}

module.exports = { RequestDispatcher };
