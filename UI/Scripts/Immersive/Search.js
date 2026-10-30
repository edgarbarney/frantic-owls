// FranticDreamer 2026
"use strict";

window.Owls = window.Owls || {};

// ========================
// Name Search
// ========================

/// <summary>
/// Finding characters by name as the player types, for the recipient field and for adding correspondents.
///
/// <para>
/// NOTE: The server keeps every character's name in memory (Server/Roster.js), so a search costs it no database query; this side keeps the number of searches down too.
/// It waits for a pause in typing, remembers answers for a minute, and when an answer held every match (isComplete), narrows it for a longer search without asking again:
/// typing "seb", then "seba", then "sebastian" asks the server once.
/// Fold and Rank here must match the server's, or a narrowed answer would differ from the server's own.
/// </para>
///
/// </summary>
Owls.MailSearch = (() =>
{
	/// <summary>
	/// Shortest search the server answers; must match minQueryLength in Server/Roster.js.
	/// </summary>
	const minQueryLength = 2;

	/// <summary>
	/// Pause in typing before asking the server.
	/// </summary>
	const debounceMs = 220;

	/// <summary>
	/// How long an answer is reused. New characters join the roster as they first load, so answers do not live long.
	/// </summary>
	const cacheMs = 60000;

	/// <summary>
	/// Answers by folded search: { owls, isComplete, at }.
	/// </summary>
	const cache = new Map();

	/// <summary>
	/// Fold a name or a search for comparing; same as the server's.
	/// </summary>
	/// <param name="text">Name or search</param>
	/// <returns>Folded text</returns>
	function Fold(text)
	{
		return String(text || "").normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/ı/g, "i").toLowerCase().replace(/\s+/g, " ").trim();
	}

	/// <summary>
	/// How well a name matches a search; same as the server's.
	/// </summary>
	/// <param name="name">Name (not folded)</param>
	/// <param name="query">Folded search</param>
	/// <returns>0 when the name starts with it, 1 when every word searched starts a word of the name, 2 when it is anywhere in the name, -1 when it does not match</returns>
	function Rank(name, query)
	{
		const folded = Fold(name);

		if (folded.startsWith(query))
		{
			return 0;
		}

		const words = folded.split(" ");

		if (query.split(" ").every((queryWord) => words.some((word) => word.startsWith(queryWord))))
		{
			return 1;
		}

		return folded.includes(query) ? 2 : -1;
	}

	/// <summary>
	/// Whether a name matches what was typed. Anything matches an empty search.
	/// </summary>
	/// <param name="name">Name</param>
	/// <param name="query">What was typed</param>
	/// <returns>True when it matches</returns>
	function Matches(name, query)
	{
		const folded = Fold(query);
		return folded.length === 0 || (!!name && Rank(name, folded) >= 0);
	}

	/// <summary>
	/// An answer already known for a search: its own, or one held complete for a shorter search it extends, narrowed.
	/// </summary>
	/// <param name="folded">Folded search</param>
	/// <returns>{ owls, isComplete }, or null when the server must be asked</returns>
	function FindKnown(folded)
	{
		const now = Date.now();
		let best = null;

		for (const [key, answer] of cache)
		{
			if (now - answer.at > cacheMs)
			{
				cache.delete(key);
			}
			else if (key === folded)
			{
				return answer;
			}
			else if (answer.isComplete && folded.startsWith(key) && (!best || key.length > best.key.length))
			{
				best = { key, answer };
			}
		}

		if (!best)
		{
			return null;
		}

		const owls = best.answer.owls.map((owl) => ({ owl, rank: Rank(owl.name, folded) })).filter((match) => match.rank >= 0);
		owls.sort((first, second) => first.rank - second.rank || Fold(first.owl.name).localeCompare(Fold(second.owl.name)));
		return { owls: owls.map((match) => match.owl), isComplete: true };
	}

	/// <summary>
	/// Make a searcher for one text box: each Find replaces the search before it, and only the latest answer is reported.
	/// </summary>
	/// <param name="OnAnswer">Function ({ query, owls, isPending }) called with each answer, and with isPending true while the server is being asked</param>
	/// <returns>{ Find(query), Cancel() }</returns>
	function CreateSearcher(OnAnswer)
	{
		let timer = null;
		let latest = "";

		/// <summary>
		/// Search for what was typed.
		/// </summary>
		/// <param name="query">What was typed</param>
		function Find(query)
		{
			clearTimeout(timer);
			const folded = Fold(query);
			latest = folded;

			if (folded.length < minQueryLength)
			{
				OnAnswer({ query: folded, owls: [], isPending: false });
				return;
			}

			const known = FindKnown(folded);

			if (known)
			{
				OnAnswer({ query: folded, owls: known.owls, isPending: false });
				return;
			}

			OnAnswer({ query: folded, owls: [], isPending: true });
			timer = setTimeout(async () =>
			{
				const result = await Owls.Bridge.Request("mail.search", { query: folded });

				if (result.ok)
				{
					cache.set(folded, { owls: Array.isArray(result.data.owls) ? result.data.owls : [], isComplete: !!result.data.isComplete, at: Date.now() });
				}

				// A newer search has been typed since; its own answer will follow.
				if (latest !== folded)
				{
					return;
				}

				const answer = cache.get(folded);
				OnAnswer({ query: folded, owls: answer ? answer.owls : [], isPending: false });
			}, debounceMs);
		}

		return {
			Find,
			Cancel: () =>
			{
				clearTimeout(timer);
				latest = "";
			},
		};
	}

	/// <summary>
	/// Forget every answer, e.g. when the character changes.
	/// </summary>
	function Clear()
	{
		cache.clear();
	}

	return { minQueryLength, Fold, Matches, CreateSearcher, Clear };
})();
