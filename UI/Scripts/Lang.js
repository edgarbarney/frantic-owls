// FranticDreamer 2026
"use strict";

window.Owls = window.Owls || {};

// ========================
// Lang
// ========================

/// <summary>
/// The page's strings, in the language the player picked in Settings (or the server's default).
///
/// <para>
/// NOTE: Language files live on the server (Lang/*.json) rather than in UI/, so a server owner adds a language without players downloading anything.
/// The server sends the whole table, with English filled in for anything a translation lacks, before the phone's state and again whenever the player switches language.
/// Until it arrives T() returns the key itself, which is harmless because the phone cannot be opened before its state has arrived either.
/// </para>
///
/// </summary>
Owls.Lang = (() =>
{
	/// <summary>
	/// Language in effect; also the locale dates and names are formatted with.
	/// </summary>
	let languageId = "en-GB";

	/// <summary>
	/// Strings by key: text, or { one, other, ... } for plurals.
	/// </summary>
	let strings = {};

	/// <summary>
	/// Table being received chunk by chunk; it replaces strings once complete, so a half-sent table is never drawn.
	/// </summary>
	let incoming = null;

	/// <summary>
	/// Plural rules of the language in effect, or null when the browser cannot build them.
	/// </summary>
	let pluralRules = null;

	/// <summary>
	/// Put parameters into a text: "{name} left." with { name: "Bram" } becomes "Bram left.".
	/// </summary>
	/// <param name="text">Text with {placeholders}</param>
	/// <param name="params">Parameter values</param>
	/// <returns>Finished text</returns>
	function Interpolate(text, params)
	{
		return String(text).replace(/\{(\w+)\}/g, (match, name) => (params[name] === undefined || params[name] === null ? match : String(params[name])));
	}

	/// <summary>
	/// Translate a key. A plural string picks its form from params.count.
	/// </summary>
	/// <param name="key">Text key (e.g. "chat.placeholder")</param>
	/// <param name="params">Parameters for its placeholders (optional)</param>
	/// <returns>Translated text, or the key itself when the table has no such string</returns>
	function T(key, params = {})
	{
		const value = strings[key];

		if (value === undefined)
		{
			return key;
		}

		if (typeof value === "string")
		{
			return Interpolate(value, params);
		}

		const category = pluralRules ? pluralRules.select(Number(params.count) || 0) : "other";
		return Interpolate(value[category] ?? value.other ?? "", params);
	}

	/// <summary>
	/// Whether the table has a string, for optional wording (e.g. a theme a translation may not name).
	/// </summary>
	/// <param name="key">Text key</param>
	/// <returns>True when present</returns>
	function Has(key)
	{
		return strings[key] !== undefined;
	}

	/// <summary>
	/// Fill in the static text of Index.html: data-lang (text), data-lang-title (tooltip) and data-lang-placeholder.
	/// </summary>
	function ApplyStatic()
	{
		for (const element of document.querySelectorAll("[data-lang]"))
		{
			element.textContent = T(element.dataset.lang);
		}

		for (const element of document.querySelectorAll("[data-lang-title]"))
		{
			element.title = T(element.dataset.langTitle);
		}

		for (const element of document.querySelectorAll("[data-lang-placeholder]"))
		{
			element.placeholder = T(element.dataset.langPlaceholder);
		}
	}

	/// <summary>
	/// Take one chunk of the table from the server.
	/// </summary>
	/// <param name="data">{ reset, strings: [[key, value]] }</param>
	function ApplyChunk(data)
	{
		if (data.reset || incoming === null)
		{
			incoming = {};
		}

		for (const pair of Array.isArray(data.strings) ? data.strings : [])
		{
			if (Array.isArray(pair) && typeof pair[0] === "string")
			{
				incoming[pair[0]] = pair[1];
			}
		}
	}

	/// <summary>
	/// Switch to the table just received.
	/// </summary>
	/// <param name="data">{ id } of the language</param>
	function Finish(data)
	{
		strings = incoming || strings;
		incoming = null;
		languageId = String(data.id || languageId);
		document.documentElement.lang = languageId;

		// Intl throws a RangeError for a locale it cannot parse; plurals then fall back to the "other" form.
		try
		{
			pluralRules = new Intl.PluralRules(languageId);
		}
		catch (error)
		{
			pluralRules = null;
		}

		ApplyStatic();
	}

	/// <summary>
	/// The language in effect.
	/// </summary>
	/// <returns>Language ID (e.g. "en-GB")</returns>
	function GetId()
	{
		return languageId;
	}

	return { T, Has, ApplyStatic, ApplyChunk, Finish, GetId };
})();
