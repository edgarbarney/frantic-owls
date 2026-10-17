// FranticDreamer 2026
"use strict";

const { Ok, Fail } = require("./Result.js");
const { IsSenderNumber } = require("./Database.js");

// ========================
// Block Service
// ========================

/// <summary>
/// Blocking: an owl can refuse everything from another owl.
///
/// <para>
/// What a block does:
/// - The blocked owl cannot send one-to-one owls to the blocker; they are told it "could not be delivered", not that they were blocked.
/// - Their owls in shared bulk owls are hidden from the blocker (history, previews, unread counts and pushes).
/// - They cannot Inform the blocker of their owl.
/// The blocker can still read old one-to-one history, but cannot send to someone they blocked until they unblock them.
/// System senders (the Ministry, other resources) cannot be blocked; their chats can be muted instead.
/// </para>
///
/// </summary>
class BlockService
{
	/// <summary>
	/// OwlDatabase instance.
	/// </summary>
	#database;

	/// <summary>
	/// Read an owl number out of client data.
	/// </summary>
	/// <param name="value">Client-supplied value</param>
	/// <returns>The 8-digit number, or an empty string if it is not one</returns>
	#ReadNumber(value)
	{
		const number = String(value ?? "");
		return /^\d{8}$/.test(number) ? number : "";
	}

	/// <summary>
	/// Constructor.
	/// </summary>
	/// <param name="database">OwlDatabase instance</param>
	constructor(database)
	{
		this.#database = database;
	}

	/// <summary>
	/// Every owl number an owl has blocked.
	/// </summary>
	/// <param name="number">Blocking owl's number</param>
	/// <returns>Blocked numbers; empty when the read failed</returns>
	async List(number)
	{
		return (await this.#database.ListBlocks(number)) || [];
	}

	/// <summary>
	/// Whether one owl has blocked another.
	/// </summary>
	/// <param name="owner">Owl that may have blocked</param>
	/// <param name="other">Owl that may be blocked</param>
	/// <returns>True or false, or null when the check failed (callers should then refuse rather than guess)</returns>
	async HasBlocked(owner, other)
	{
		const blockers = await this.#database.ListBlockersAmong(other, [owner]);
		return blockers ? blockers.has(owner) : null;
	}

	/// <summary>
	/// Which of several owls have blocked one owl.
	/// </summary>
	/// <param name="blocked">Owl that may be blocked</param>
	/// <param name="owners">Owls to check</param>
	/// <returns>Set of owners that blocked it; empty when the read failed</returns>
	async ListBlockersAmong(blocked, owners)
	{
		return (await this.#database.ListBlockersAmong(blocked, owners)) || new Set();
	}

	/// <summary>
	/// Block an owl.
	/// </summary>
	/// <param name="entry">Directory entry of the requesting owl</param>
	/// <param name="data">{ number }</param>
	/// <returns>Result carrying { number }</returns>
	async Add(entry, data)
	{
		const number = this.#ReadNumber(data.number);

		if (!number || number === entry.number)
		{
			return Fail("error.cannotBlock");
		}

		if (IsSenderNumber(number))
		{
			return Fail("error.officialBlock");
		}

		if (!await this.#database.AddBlock(entry.number, number))
		{
			return Fail("error.blockFailed");
		}

		return Ok({ number });
	}

	/// <summary>
	/// Unblock an owl.
	/// </summary>
	/// <param name="entry">Directory entry of the requesting owl</param>
	/// <param name="data">{ number }</param>
	/// <returns>Result carrying { number }</returns>
	async Remove(entry, data)
	{
		const number = this.#ReadNumber(data.number);

		if (!number || !await this.#database.RemoveBlock(entry.number, number))
		{
			return Fail("error.unblockFailed");
		}

		return Ok({ number });
	}
}

module.exports = { BlockService };
