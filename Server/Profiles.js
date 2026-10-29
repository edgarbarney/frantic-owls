// FranticDreamer 2026
"use strict";

const { Ok, Fail } = require("./Result.js");
const { CheckAvatarUrl } = require("./Avatars.js");

/// <summary>
/// Most numbers one lookup may ask about. The page batches unknown chat members, so a real request is far smaller.
/// </summary>
const maxLookupNumbers = 100;

// ========================
// Profile Service
// ========================

/// <summary>
/// Each owl's own profile picture, set from Settings.
/// A picture is only ever handed to owls related to its owner (contacts in either direction, or a shared chat),
/// so a modified client cannot harvest everyone's pictures by guessing numbers.
/// </summary>
class ProfileService
{
	/// <summary>
	/// OwlDatabase instance.
	/// </summary>
	#database;

	/// <summary>
	/// OwlDirectory instance.
	/// </summary>
	#directory;

	/// <summary>
	/// Outbox instance.
	/// </summary>
	#outbox;

	/// <summary>
	/// The "phonemode_avatars" section of the server config.
	/// </summary>
	#avatarsConfig;

	/// <summary>
	/// Constructor.
	/// </summary>
	/// <param name="database">OwlDatabase instance</param>
	/// <param name="directory">OwlDirectory instance</param>
	/// <param name="outbox">Outbox instance</param>
	/// <param name="avatarsConfig">The "phonemode_avatars" section of the server config</param>
	constructor(database, directory, outbox, avatarsConfig)
	{
		this.#database = database;
		this.#directory = directory;
		this.#outbox = outbox;
		this.#avatarsConfig = avatarsConfig;
	}

	/// <summary>
	/// An owl's own profile picture.
	/// </summary>
	/// <param name="number">Owl number</param>
	/// <returns>Picture link, or an empty string when none is set or the read failed</returns>
	async GetOwnAvatar(number)
	{
		return (await this.#database.GetProfileAvatar(number)) || "";
	}

	/// <summary>
	/// The profile pictures an owl may see: those of every related owl that has one.
	/// </summary>
	/// <param name="number">Owl number</param>
	/// <returns>[{ number, avatarUrl }], empty on failure</returns>
	async ListVisible(number)
	{
		const related = await this.#database.ListRelatedNumbers(number);
		const avatars = related ? await this.#database.ListProfileAvatars(related) : null;

		if (!avatars)
		{
			return [];
		}

		return [...avatars].map(([owner, avatarUrl]) => ({ number: owner, avatarUrl }));
	}

	/// <summary>
	/// Change the requesting owl's own profile picture and tell every related owl that is online.
	/// </summary>
	/// <param name="entry">Directory entry of the requesting owl</param>
	/// <param name="data">{ avatarUrl } where an empty link removes the picture</param>
	/// <returns>Result carrying { avatarUrl }</returns>
	async Update(entry, data)
	{
		const avatar = CheckAvatarUrl(data.avatarUrl, this.#avatarsConfig);

		if (!avatar.ok)
		{
			return Fail(avatar.error);
		}

		if (!await this.#database.SaveProfileAvatar(entry.number, avatar.url))
		{
			return Fail("error.profileSaveFailed");
		}

		for (const related of await this.#database.ListRelatedNumbers(entry.number) || [])
		{
			const target = this.#directory.GetByNumber(related);

			if (target)
			{
				this.#outbox.Push(target.player, "profile:update", { number: entry.number, avatarUrl: avatar.url });
			}
		}

		return Ok({ avatarUrl: avatar.url });
	}

	/// <summary>
	/// Fetch the pictures of specific owls, e.g. members of a chat that arrived after the phone loaded.
	/// Numbers the requester is not related to are silently answered with no picture.
	/// </summary>
	/// <param name="entry">Directory entry of the requesting owl</param>
	/// <param name="data">{ numbers: string[] }</param>
	/// <returns>Result carrying { profiles: [{ number, avatarUrl }] }</returns>
	async Lookup(entry, data)
	{
		const requested = Array.isArray(data.numbers) ? [...new Set(data.numbers.slice(0, maxLookupNumbers).map(String).filter((number) => /^\d{8}$/.test(number)))] : [];

		if (requested.length === 0)
		{
			return Ok({ profiles: [] });
		}

		const related = new Set(await this.#database.ListRelatedNumbers(entry.number) || []);
		const allowed = requested.filter((number) => related.has(number));
		const avatars = await this.#database.ListProfileAvatars(allowed) || new Map();

		return Ok({ profiles: requested.map((number) => ({ number, avatarUrl: avatars.get(number) || "" })) });
	}
}

module.exports = { ProfileService };
