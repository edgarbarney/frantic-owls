// FranticDreamer 2026
"use strict";

/// <summary>
/// Shortest search the roster answers. One letter would match most of the server.
/// </summary>
const minQueryLength = 2;

/// <summary>
/// Most names one search returns.
/// </summary>
const maxResults = 12;

// ========================
// Name Matching
// ========================

/// <summary>
/// Fold a name or a search for comparing: lower case, accents dropped, spaces squeezed, so "Sebastian" is found by typing "sébastian" and the other way round.
/// </summary>
/// <param name="text">Name or search</param>
/// <returns>Folded text</returns>
function Fold(text)
{
	return String(text || "").normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/ı/g, "i").toLowerCase().replace(/\s+/g, " ").trim();
}

/// <summary>
/// How well a folded name matches a folded search: 0 when the name starts with it, 1 when every word searched starts a word of the name, 2 when it is anywhere in the name.
/// </summary>
/// <param name="name">Folded name</param>
/// <param name="words">Words of the name</param>
/// <param name="query">Folded search</param>
/// <param name="queryWords">Words of the search</param>
/// <returns>Rank, or -1 when the name does not match</returns>
function Rank(name, words, query, queryWords)
{
	if (name.startsWith(query))
	{
		return 0;
	}

	if (queryWords.every((queryWord) => words.some((word) => word.startsWith(queryWord))))
	{
		return 1;
	}

	return name.includes(query) ? 2 : -1;
}

// ========================
// Roster
// ========================

/// <summary>
/// Every character with an owl, by name, so a letter can be addressed to anyone on the server, online or not.
///
/// <para>
/// NOTE: The roster lives in memory so that finding a name as it is typed costs no database query at all.
/// It is read once from frantic_owls_numbers when the owl post opens, and kept up to date as characters load (new characters, renames) and are deleted.
/// Each entry is a number and two short strings, so even tens of thousands of characters take a few megabytes, and a search walks them in well under a millisecond.
/// </para>
///
/// </summary>
class OwlRoster
{
	/// <summary>
	/// Entries keyed by owl number: { number, name, folded, words }.
	/// </summary>
	#byNumber = new Map();

	/// <summary>
	/// Constructor.
	/// </summary>
	constructor()
	{
	}

	/// <summary>
	/// Replace the roster with every named owl number.
	/// </summary>
	/// <param name="list">[{ number, name }]</param>
	Load(list)
	{
		this.#byNumber.clear();

		for (const entry of list)
		{
			this.Set(entry.number, entry.name);
		}
	}

	/// <summary>
	/// Add an owl, or rename it.
	/// </summary>
	/// <param name="number">Owl number</param>
	/// <param name="name">Character's full name</param>
	Set(number, name)
	{
		const clean = String(name || "").trim();

		if (!number || !clean)
		{
			return;
		}

		const folded = Fold(clean);
		this.#byNumber.set(number, { number, name: clean, folded, words: folded.split(" ") });
	}

	/// <summary>
	/// Forget an owl whose character was deleted.
	/// </summary>
	/// <param name="number">Owl number</param>
	Remove(number)
	{
		this.#byNumber.delete(number);
	}

	/// <summary>
	/// Whether an owl number belongs to a character on the roster.
	/// </summary>
	/// <param name="number">Owl number</param>
	/// <returns>True when it does</returns>
	Has(number)
	{
		return this.#byNumber.has(number);
	}

	/// <summary>
	/// The character name of an owl number.
	/// </summary>
	/// <param name="number">Owl number</param>
	/// <returns>Name, or "" when it is not on the roster</returns>
	GetName(number)
	{
		const entry = this.#byNumber.get(number);
		return entry ? entry.name : "";
	}

	/// <summary>
	/// Number of owls on the roster.
	/// </summary>
	/// <returns>Entry count</returns>
	GetCount()
	{
		return this.#byNumber.size;
	}

	/// <summary>
	/// Find characters by a part of their name, best matches first.
	/// </summary>
	/// <param name="query">What the player typed</param>
	/// <param name="excludeNumber">Owl number to leave out (the one searching)</param>
	/// <returns>{ owls: [{ number, name }], isComplete } where isComplete is true when every match fits in the results, so a longer search can be filtered from them without asking again</returns>
	Search(query, excludeNumber)
	{
		const folded = Fold(query);

		if (folded.length < minQueryLength)
		{
			return { owls: [], isComplete: false };
		}

		const queryWords = folded.split(" ");
		const matches = [];

		for (const entry of this.#byNumber.values())
		{
			if (entry.number === excludeNumber)
			{
				continue;
			}

			const rank = Rank(entry.folded, entry.words, folded, queryWords);

			if (rank >= 0)
			{
				matches.push({ rank, entry });
			}
		}

		matches.sort((first, second) => first.rank - second.rank || first.entry.folded.localeCompare(second.entry.folded));
		return { owls: matches.slice(0, maxResults).map((match) => ({ number: match.entry.number, name: match.entry.name })), isComplete: matches.length <= maxResults };
	}
}

module.exports = { OwlRoster, minQueryLength };
