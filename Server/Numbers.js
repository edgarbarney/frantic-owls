// FranticDreamer 2026
"use strict";

const { IsSenderNumber } = require("./Database.js");

// ========================
// Number Dialler
// ========================

/// <summary>
/// Reaching an owl by typing in its number: saving it as a contact, owling it or Floo-Calling it, when phonemode_numbers.dialling is on.
///
/// <para>
/// NOTE: Every number typed in is checked against the database, so a typed number either reaches a real owl or is refused.
/// That also means a player could find out which numbers exist by trying them one by one; numbers.rateLimitCount caps how fast,
/// and only numbers the owl does not already know count against it.
/// </para>
///
/// </summary>
class NumberDialler
{
	/// <summary>
	/// OwlDatabase instance.
	/// </summary>
	#database;

	/// <summary>
	/// The "phonemode_numbers" section of the server config.
	/// </summary>
	#config;

	/// <summary>
	/// Per-owl limiter for numbers typed in, keyed by owl number.
	/// </summary>
	#limiter;

	/// <summary>
	/// Constructor.
	/// </summary>
	/// <param name="database">OwlDatabase instance</param>
	/// <param name="hmp">hmp-lib server import, for rate limiting</param>
	/// <param name="numbersConfig">The "phonemode_numbers" section of the server config</param>
	constructor(database, hmp, numbersConfig)
	{
		this.#database = database;
		this.#config = numbersConfig;
		this.#limiter = hmp.rateLimit.create({ limit: numbersConfig.rateLimitCount, windowMs: numbersConfig.rateLimitWindowMs });
	}

	/// <summary>
	/// Whether players may type numbers in on this server.
	/// </summary>
	/// <returns>True when phonemode_numbers.dialling is on</returns>
	IsEnabled()
	{
		return this.#config.dialling;
	}

	/// <summary>
	/// Drop rate-limit buckets nobody has used for a while. Call from a maintenance tick.
	/// </summary>
	Sweep()
	{
		this.#limiter.sweep(this.#config.rateLimitWindowMs * 2);
	}

	/// <summary>
	/// Read an owl number as a player typed it: spaces and dashes are allowed between the digits ("1234 5678").
	/// </summary>
	/// <param name="raw">Client-supplied number</param>
	/// <returns>The 8-digit number, or "" when it is not one</returns>
	Normalise(raw)
	{
		const number = String(raw ?? "").replace(/[\s-]/g, "");
		return /^\d{8}$/.test(number) ? number : "";
	}

	/// <summary>
	/// Check a number a player typed in and find the owl it belongs to.
	/// </summary>
	/// <param name="entry">Directory entry of the dialling owl</param>
	/// <param name="raw">Client-supplied number</param>
	/// <returns>{ number, error } where error is "" when the number reaches a live owl, otherwise a text key</returns>
	async Resolve(entry, raw)
	{
		if (!this.#config.dialling)
		{
			return { number: "", error: "error.diallingOff" };
		}

		const number = this.Normalise(raw);

		// Official senders' numbers start with 0 and are never dialled; they are reached through their own chats.
		if (!number || IsSenderNumber(number))
		{
			return { number: "", error: "error.numberInvalid" };
		}

		if (number === entry.number)
		{
			return { number: "", error: "error.ownNumber" };
		}

		if (!this.#limiter.allow(entry.number))
		{
			return { number: "", error: "error.diallingTooMany" };
		}

		const state = await this.#database.GetNumberState(number);

		if (state === null)
		{
			return { number: "", error: "error.numberLookupFailed" };
		}

		if (state === "retired")
		{
			return { number: "", error: "error.retired" };
		}

		return state === "live" ? { number, error: "" } : { number: "", error: "error.numberUnknown" };
	}
}

module.exports = { NumberDialler };
