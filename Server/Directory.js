// FranticDreamer 2026
"use strict";

const { Logger } = require("./Logger.js");

/// <summary>
/// Lowest and highest owl number handed out. Starting at 10000000 keeps every number exactly 8 digits with no leading zero.
/// </summary>
const lowestNumber = 10000000;
const highestNumber = 99999999;

/// <summary>
/// How many random numbers are tried before giving up. Collisions are rare until tens of millions are in use.
/// </summary>
const numberAttempts = 12;

/// <summary>
/// HogwartsMP world units per metre (positions are in centimetres).
/// </summary>
const unitsPerMetre = 100;

// ========================
// Distances
// ========================

/// <summary>
/// Distance between two online owls.
/// </summary>
/// <param name="hmp">hmp-lib server import, for positions</param>
/// <param name="first">Directory entry</param>
/// <param name="second">Directory entry</param>
/// <returns>Distance in metres, or Infinity when either position is unknown or they are in different virtual worlds</returns>
function GetDistanceMetres(hmp, first, second)
{
	if ((first.player.virtualWorld || 0) !== (second.player.virtualWorld || 0))
	{
		return Infinity;
	}

	const from = hmp.position.read(first.player);
	const to = hmp.position.read(second.player);

	if (!from || !to)
	{
		return Infinity;
	}

	return hmp.position.distance(from, to) / unitsPerMetre;
}

// ========================
// Owl Numbers
// ========================

/// <summary>
/// A random owl number to try. It may already be taken or retired; whoever stores it must check.
/// </summary>
/// <returns>8-digit number</returns>
function CreateCandidateNumber()
{
	return String(lowestNumber + Math.floor(Math.random() * (highestNumber - lowestNumber + 1)));
}

/// <summary>
/// Return the owl number of a character, assigning a fresh random one the first time it loads.
///
/// <para>
/// NOTE: Numbers belong to characters, not accounts: two characters on one account are two different people in roleplay.
/// The number is hidden from players for now, but every contact, chat and message is already keyed by it.
/// </para>
///
/// </summary>
/// <param name="database">OwlDatabase instance</param>
/// <param name="characterId">hmp-core character ID</param>
/// <returns>The 8-digit number, or an empty string on failure</returns>
async function EnsureNumber(database, characterId)
{
	const existing = await database.GetNumberForCharacter(characterId);

	if (existing === null)
	{
		return "";
	}

	if (existing.length > 0)
	{
		return existing;
	}

	for (let attempt = 0; attempt < numberAttempts; ++attempt)
	{
		const candidate = CreateCandidateNumber();

		if (await database.TryInsertNumber(characterId, candidate))
		{
			return candidate;
		}

		// The insert also fails when this character was given a number concurrently (e.g. a quick reconnect), so look again.
		const raced = await database.GetNumberForCharacter(characterId);

		if (raced)
		{
			return raced;
		}
	}

	Logger.LogError("Directory", `Could not assign an owl number to character ${characterId} after ${numberAttempts} attempts`);
	return "";
}

// ========================
// Directory
// ========================

/// <summary>
/// Registry of the owls currently online: which player holds which owl number right now.
/// An entry exists only while a player has a character loaded and their number is known.
/// </summary>
class OwlDirectory
{
	/// <summary>
	/// Entries keyed by owl number.
	/// </summary>
	#byNumber = new Map();

	/// <summary>
	/// Entries keyed by player ID.
	/// </summary>
	#byPlayerId = new Map();

	/// <summary>
	/// Constructor.
	/// </summary>
	constructor()
	{
	}

	/// <summary>
	/// Record that a player is now acting as an owl number, replacing anything that player held before.
	/// </summary>
	/// <param name="player">Connected player</param>
	/// <param name="characterId">hmp-core character ID</param>
	/// <param name="characterName">Character's full name</param>
	/// <param name="number">Character's owl number</param>
	/// <param name="settings">Sanitised settings object</param>
	/// <returns>The new entry</returns>
	Register(player, characterId, characterName, number, settings)
	{
		this.Unregister(player.id);

		const entry = { player, playerId: player.id, characterId, characterName, number, settings };

		this.#byNumber.set(number, entry);
		this.#byPlayerId.set(player.id, entry);

		return entry;
	}

	/// <summary>
	/// Forget whatever a player was registered as.
	/// </summary>
	/// <param name="playerId">Player ID</param>
	/// <returns>The removed entry, or null if there was none</returns>
	Unregister(playerId)
	{
		const entry = this.#byPlayerId.get(playerId);

		if (!entry)
		{
			return null;
		}

		this.#byPlayerId.delete(playerId);

		// Only drop the number mapping if it still points at this player; another session may have taken it over.
		if (this.#byNumber.get(entry.number) === entry)
		{
			this.#byNumber.delete(entry.number);
		}

		return entry;
	}

	/// <summary>
	/// Find the entry of a connected player.
	/// </summary>
	/// <param name="playerId">Player ID</param>
	/// <returns>Entry, or null when the player has no owl loaded</returns>
	GetByPlayerId(playerId)
	{
		return this.#byPlayerId.get(playerId) || null;
	}

	/// <summary>
	/// Find who is online as an owl number.
	/// </summary>
	/// <param name="number">Owl number</param>
	/// <returns>Entry, or null when that owl is offline</returns>
	GetByNumber(number)
	{
		return this.#byNumber.get(number) || null;
	}

	/// <summary>
	/// Every online entry.
	/// </summary>
	/// <returns>Array of entries (a copy; safe to iterate while registering)</returns>
	All()
	{
		return [...this.#byPlayerId.values()];
	}

	/// <summary>
	/// Number of owls online.
	/// </summary>
	/// <returns>Entry count</returns>
	GetCount()
	{
		return this.#byPlayerId.size;
	}
}

module.exports = { OwlDirectory, EnsureNumber, CreateCandidateNumber, GetDistanceMetres };
