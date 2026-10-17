// FranticDreamer 2026
"use strict";

const { EnsureNumber } = require("./Directory.js");
const { IsSenderNumber } = require("./Database.js");

// ========================
// Public API
// ========================

/// <summary>
/// Build the "api" export other server resources use to send owls.
///
/// <para>
/// Usage from another resource (declare frantic-owls as a dependency first):
///   const Owls = Imports.get("frantic-owls").api;
///   await Owls.RegisterSender({ resource: "my-bank", key: "gringotts", name: "Gringotts Wizarding Bank", onReply: (reply) => { ... } });
///   await Owls.SendOwl({ sender: "gringotts", to: { characterId: 42 }, body: "Your vault is ready." });
///   await Owls.SendAnnouncement({ sender: "gringotts", body: "The bank closes early tonight." });
/// Every call resolves with { ok, error, ... } and never rejects, in keeping with the rest of the resource.
/// Calls made before the database is ready wait for it, so a resource may register its senders as it starts.
/// </para>
///
/// </summary>
/// <param name="services">{ whenReady: Promise of boolean, senders, chats, directory, database }</param>
/// <returns>The API object</returns>
function CreateApi(services)
{
	const { whenReady, senders, chats, directory, database } = services;
	let isReady = false;

	whenReady.then((ready) =>
	{
		isReady = ready;
	});

	/// <summary>
	/// Find the owl number a call addresses.
	/// </summary>
	/// <param name="to">{ number } | { characterId } | { playerId }</param>
	/// <returns>8-digit number, or an empty string when the target is unknown</returns>
	async function ResolveRecipient(to)
	{
		const target = to && typeof to === "object" ? to : {};

		if (target.number !== undefined)
		{
			const number = String(target.number);
			return /^\d{8}$/.test(number) && !IsSenderNumber(number) ? number : "";
		}

		if (target.characterId !== undefined)
		{
			const characterId = Math.trunc(Number(target.characterId));
			return Number.isSafeInteger(characterId) && characterId > 0 ? EnsureNumber(database, characterId) : "";
		}

		if (target.playerId !== undefined)
		{
			const entry = directory.GetByPlayerId(Math.trunc(Number(target.playerId)));
			return entry ? entry.number : "";
		}

		return "";
	}

	/// <summary>
	/// Wait for the database, then find a live sender.
	/// </summary>
	/// <param name="key">Sender key</param>
	/// <returns>{ sender, error }</returns>
	async function GetSender(key)
	{
		if (!await whenReady)
		{
			return { sender: null, error: "The owl post is not running (its database is unavailable)." };
		}

		const sender = senders.Get(key);
		return sender ? { sender, error: "" } : { sender: null, error: `No sender "${key}" is registered. Call RegisterSender first.` };
	}

	return Object.freeze
	({
		/// <summary>
		/// Whether the owl post is running and its database ready.
		/// </summary>
		/// <returns>True once ready</returns>
		IsReady()
		{
			return isReady;
		},

		/// <summary>
		/// Register a system sender owned by the calling resource. It is removed again when that resource stops.
		/// </summary>
		/// <param name="definition">{ resource, key, name, avatarUrl?, onReply?(reply) } where reply is { sender, fromNumber, characterId, characterName, playerId, body, chatId, messageId }</param>
		/// <returns>Promise of { ok, error, number }</returns>
		async RegisterSender(definition)
		{
			if (!await whenReady)
			{
				return { ok: false, error: "The owl post is not running (its database is unavailable).", number: "" };
			}

			return senders.Register(definition);
		},

		/// <summary>
		/// Remove a sender registration early (it is removed automatically when its resource stops).
		/// </summary>
		/// <param name="key">Sender key</param>
		/// <returns>True if it was registered</returns>
		UnregisterSender(key)
		{
			return senders.Unregister(key);
		},

		/// <summary>
		/// Send a one-to-one owl from a registered sender to one character. Offline characters find it when they next load.
		/// </summary>
		/// <param name="request">{ sender, to: { characterId } | { number } | { playerId }, body, delaySeconds? }</param>
		/// <returns>Promise of { ok, error, chatId, messageId }</returns>
		async SendOwl(request)
		{
			const source = request && typeof request === "object" ? request : {};
			const { sender, error } = await GetSender(source.sender);

			if (!sender)
			{
				return { ok: false, error, chatId: 0, messageId: 0 };
			}

			const number = await ResolveRecipient(source.to);

			if (!number)
			{
				return { ok: false, error: "The recipient has no owl (unknown character, number or player).", chatId: 0, messageId: 0 };
			}

			return chats.SendFromSender(sender, number, source.body, source.delaySeconds);
		},

		/// <summary>
		/// Post an announcement from a registered sender to every character with an owl.
		/// </summary>
		/// <param name="request">{ sender, body }</param>
		/// <returns>Promise of { ok, error, chatId, messageId }</returns>
		async SendAnnouncement(request)
		{
			const source = request && typeof request === "object" ? request : {};
			const { sender, error } = await GetSender(source.sender);

			if (!sender)
			{
				return { ok: false, error, chatId: 0, messageId: 0 };
			}

			return chats.Broadcast(sender, source.body);
		},

		/// <summary>
		/// The owl number of a character, assigned now if it never had one.
		/// </summary>
		/// <param name="characterId">hmp-core character ID</param>
		/// <returns>Promise of the 8-digit number, or an empty string</returns>
		async GetOwlNumber(characterId)
		{
			if (!await whenReady)
			{
				return "";
			}

			return ResolveRecipient({ characterId });
		},
	});
}

module.exports = { CreateApi };
