// FranticDreamer 2026
"use strict";

const { Logger } = require("./Logger.js");
const { CheckAvatarUrl } = require("./Avatars.js");
const Lang = require("./Lang.js");

/// <summary>
/// Shape of a sender key: lowercase letters, digits, "_" and "-", 2 to 32 characters (e.g. "ministry", "gringotts").
/// </summary>
const senderKeyPattern = /^[a-z0-9][a-z0-9_-]{1,31}$/;

/// <summary>
/// Longest display name of a system sender.
/// </summary>
const maxSenderNameLength = 64;

// ========================
// Sender Registry
// ========================

/// <summary>
/// System senders: owls that come from the server rather than a character, such as the Ministry of Magic or Gringotts.
///
/// <para>
/// Each sender key gets a permanent owl number of its own ("00000001", ...) the first time it registers, so its chats outlive restarts.
/// Every sender ever registered stays known to pages (its name and picture), even while the resource that registered it is stopped.
/// A sender that passes onReply accepts replies: players can answer its one-to-one owls and the callback receives each answer.
/// Without onReply, its owls are read-only. Registrations made by another resource disappear when that resource stops.
/// </para>
///
/// </summary>
class SenderRegistry
{
	/// <summary>
	/// OwlDatabase instance.
	/// </summary>
	#database;

	/// <summary>
	/// hmp-lib server import, for text cleaning.
	/// </summary>
	#hmp;

	/// <summary>
	/// The "avatars" section of the server config.
	/// </summary>
	#avatarsConfig;

	/// <summary>
	/// Called with no arguments whenever the list pages should show changes.
	/// </summary>
	#onChanged;

	/// <summary>
	/// Live registrations by key: { key, number, name, avatarUrl, resource, onReply }.
	/// </summary>
	#live = new Map();

	/// <summary>
	/// Every sender ever registered, from the database: [{ key, number, name, avatarUrl }].
	/// </summary>
	#known = [];

	/// <summary>
	/// Constructor.
	/// </summary>
	/// <param name="database">OwlDatabase instance</param>
	/// <param name="hmp">hmp-lib server import</param>
	/// <param name="avatarsConfig">The "avatars" section of the server config</param>
	/// <param name="onChanged">Called whenever the sender list changes</param>
	constructor(database, hmp, avatarsConfig, onChanged)
	{
		this.#database = database;
		this.#hmp = hmp;
		this.#avatarsConfig = avatarsConfig;
		this.#onChanged = onChanged;
	}

	/// <summary>
	/// Read every known sender from the database. Call once the database is ready.
	/// </summary>
	async Load()
	{
		this.#known = await this.#database.ListSenders();
	}

	/// <summary>
	/// Register (or re-register) a system sender.
	/// </summary>
	/// <param name="definition">{ resource, key, name, avatarUrl?, onReply? }</param>
	/// <returns>{ ok, error, number }</returns>
	async Register(definition)
	{
		const source = definition && typeof definition === "object" ? definition : {};
		const key = String(source.key || "").trim().toLowerCase();
		const resource = String(source.resource || "").trim();
		const name = this.#hmp.text.clean(source.name, maxSenderNameLength).replace(/\s+/g, " ").trim();
		const avatar = CheckAvatarUrl(source.avatarUrl, this.#avatarsConfig);

		if (!senderKeyPattern.test(key))
		{
			return { ok: false, error: "Sender keys are 2-32 lowercase letters, digits, '_' or '-'.", number: "" };
		}

		if (!resource)
		{
			return { ok: false, error: "A sender needs the name of the resource that owns it.", number: "" };
		}

		if (!name)
		{
			return { ok: false, error: "A sender needs a display name.", number: "" };
		}

		if (!avatar.ok)
		{
			return { ok: false, error: Lang.Describe(avatar.error), number: "" };
		}

		const holder = this.#live.get(key);

		if (holder && holder.resource !== resource)
		{
			return { ok: false, error: `The sender "${key}" belongs to ${holder.resource}.`, number: "" };
		}

		const number = await this.#database.EnsureSender(key, name, avatar.url);

		if (!number)
		{
			return { ok: false, error: "The sender could not be saved.", number: "" };
		}

		this.#live.set(key, { key, number, name, avatarUrl: avatar.url, resource, onReply: typeof source.onReply === "function" ? source.onReply : null });
		this.#known = this.#known.filter((sender) => sender.key !== key).concat([{ key, number, name, avatarUrl: avatar.url }]);
		Logger.LogMessage("Senders", `${resource} registered the sender "${key}" (${name}) as owl ${number}.`);
		this.#onChanged();

		return { ok: true, error: "", number };
	}

	/// <summary>
	/// Remove a live registration. Its chats and name stay; replies to it are refused until it registers again.
	/// </summary>
	/// <param name="key">Sender key</param>
	/// <returns>True if it was registered</returns>
	Unregister(key)
	{
		const removed = this.#live.delete(String(key || "").toLowerCase());

		if (removed)
		{
			this.#onChanged();
		}

		return removed;
	}

	/// <summary>
	/// Remove every sender a stopping resource registered.
	/// </summary>
	/// <param name="resource">Resource name</param>
	/// <returns>Number of senders removed</returns>
	UnregisterResource(resource)
	{
		let removed = 0;

		for (const [key, sender] of this.#live)
		{
			if (sender.resource === resource)
			{
				this.#live.delete(key);
				++removed;
			}
		}

		if (removed > 0)
		{
			this.#onChanged();
		}

		return removed;
	}

	/// <summary>
	/// A live registration by key.
	/// </summary>
	/// <param name="key">Sender key</param>
	/// <returns>Registration, or null</returns>
	Get(key)
	{
		return this.#live.get(String(key || "").toLowerCase()) || null;
	}

	/// <summary>
	/// A live registration by owl number.
	/// </summary>
	/// <param name="number">Sender's owl number</param>
	/// <returns>Registration, or null</returns>
	GetByNumber(number)
	{
		for (const sender of this.#live.values())
		{
			if (sender.number === number)
			{
				return sender;
			}
		}

		return null;
	}

	/// <summary>
	/// Display name of any known sender number.
	/// </summary>
	/// <param name="number">Owl number</param>
	/// <returns>Name, or an empty string when it is not a sender</returns>
	GetName(number)
	{
		const sender = this.#known.find((entry) => entry.number === number);
		return sender ? sender.name : "";
	}

	/// <summary>
	/// The sender list as pages need it.
	/// </summary>
	/// <returns>[{ number, name, avatarUrl, acceptsReplies }]</returns>
	GetClientList()
	{
		return this.#known.map((sender) =>
		{
			const live = this.GetByNumber(sender.number);
			return { number: sender.number, name: sender.name, avatarUrl: sender.avatarUrl, acceptsReplies: !!(live && live.onReply) };
		});
	}
}

module.exports = { SenderRegistry, senderKeyPattern };
