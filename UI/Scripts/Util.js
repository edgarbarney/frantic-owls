// FranticDreamer 2026
"use strict";

window.Owls = window.Owls || {};

// ========================
// Util
// ========================

/// <summary>
/// Small DOM and formatting helpers shared by every screen.
///
/// <para>
/// NOTE: Everything players type (names, messages, picture links) reaches the page as data.
/// It is only ever placed with textContent or as an attribute value, never through innerHTML, so it can never become markup.
/// </para>
///
/// </summary>
Owls.Util = (() =>
{
	const dayMs = 24 * 60 * 60 * 1000;

	let locale = "en-GB";
	let clockFormat = null;
	let weekdayFormat = null;
	let dateFormat = null;
	let longDateFormat = null;
	let keyCounter = 0;

	/// <summary>
	/// Format dates and order names the way a language does. Called whenever the player's language changes.
	/// </summary>
	/// <param name="id">Language ID, used as the locale (e.g. "de", "pt-BR")</param>
	function SetLocale(id)
	{
		// Intl throws a RangeError for a locale it cannot parse; British formatting is the fallback.
		try
		{
			clockFormat = new Intl.DateTimeFormat(id, { hour: "2-digit", minute: "2-digit" });
			locale = id;
		}
		catch (error)
		{
			locale = "en-GB";
			clockFormat = new Intl.DateTimeFormat(locale, { hour: "2-digit", minute: "2-digit" });
		}

		weekdayFormat = new Intl.DateTimeFormat(locale, { weekday: "short" });
		dateFormat = new Intl.DateTimeFormat(locale, { day: "2-digit", month: "2-digit", year: "2-digit" });
		longDateFormat = new Intl.DateTimeFormat(locale, { weekday: "long", day: "numeric", month: "long" });
	}

	SetLocale(locale);

	/// <summary>
	/// Midnight (local time) of the day a timestamp falls on.
	/// </summary>
	/// <param name="time">Epoch milliseconds</param>
	/// <returns>Epoch milliseconds of that day's start</returns>
	function GetDayStart(time)
	{
		const date = new Date(time);
		date.setHours(0, 0, 0, 0);
		return date.getTime();
	}

	/// <summary>
	/// Create an element in one call.
	/// </summary>
	/// <param name="tag">Tag name</param>
	/// <param name="options">{ className, text, title, attributes, on: { event: handler } } (all optional)</param>
	/// <param name="children">Child nodes; null and false entries are skipped</param>
	/// <returns>The new element</returns>
	function Element(tag, options = {}, children = [])
	{
		const element = document.createElement(tag);

		if (options.className)
		{
			element.className = options.className;
		}

		if (options.text !== undefined && options.text !== null)
		{
			element.textContent = String(options.text);
		}

		if (options.title)
		{
			element.title = options.title;
		}

		for (const [name, value] of Object.entries(options.attributes || {}))
		{
			element.setAttribute(name, String(value));
		}

		for (const [name, handler] of Object.entries(options.on || {}))
		{
			element.addEventListener(name, handler);
		}

		for (const child of children)
		{
			if (child)
			{
				element.appendChild(child);
			}
		}

		return element;
	}

	/// <summary>
	/// Up to two initials of a name, for avatars without a picture.
	/// </summary>
	/// <param name="name">Display name</param>
	/// <returns>Initials (e.g. "HP"), or "?" for an empty name</returns>
	function GetInitials(name)
	{
		const words = String(name || "").trim().split(/\s+/).filter((word) => word.length > 0);

		if (words.length === 0)
		{
			return "?";
		}

		const first = words[0][0];
		const last = words.length > 1 ? words[words.length - 1][0] : "";
		return (first + last).toUpperCase();
	}

	/// <summary>
	/// A stable, soft background colour derived from any string, so each owl keeps its colour.
	/// </summary>
	/// <param name="seed">Any string (usually an owl number)</param>
	/// <returns>CSS colour</returns>
	function GetColour(seed)
	{
		let hash = 0;

		for (const character of String(seed))
		{
			hash = (hash * 31 + character.charCodeAt(0)) | 0;
		}

		return `hsl(${Math.abs(hash) % 360}, 45%, 68%)`;
	}

	/// <summary>
	/// A stable text colour for a sender's name, readable on the current theme's bubbles (lightness comes from --name-lightness).
	/// </summary>
	/// <param name="seed">Any string (usually an owl number)</param>
	/// <returns>CSS colour</returns>
	function GetNameColour(seed)
	{
		let hash = 0;

		for (const character of String(seed))
		{
			hash = (hash * 31 + character.charCodeAt(0)) | 0;
		}

		return `hsl(${Math.abs(hash) % 360}, 55%, var(--name-lightness))`;
	}

	/// <summary>
	/// Build an avatar: the picture when one is set and loads, initials on a coloured disc otherwise.
	/// GIF links animate like any other image.
	/// </summary>
	/// <param name="name">Display name, for initials</param>
	/// <param name="url">Picture link (may be empty)</param>
	/// <param name="seed">Colour seed</param>
	/// <param name="sizeClass">Extra class ("is-small", "is-large" or "")</param>
	/// <param name="iconSvg">Optional icon markup (trusted, from Owls.Icons) shown instead of initials</param>
	/// <returns>Avatar element</returns>
	function CreateAvatar(name, url, seed, sizeClass = "", iconSvg = "")
	{
		const avatar = Element("span", { className: `avatar ${sizeClass}`.trim() });
		avatar.style.background = GetColour(seed);

		if (iconSvg)
		{
			avatar.innerHTML = iconSvg;
		}
		else
		{
			avatar.textContent = GetInitials(name);
		}

		if (url)
		{
			const image = Element("img", { attributes: { alt: "", referrerpolicy: "no-referrer", src: url } });
			image.addEventListener("error", () => image.remove());
			avatar.appendChild(image);
		}

		return avatar;
	}

	/// <summary>
	/// Clock time of a timestamp (e.g. "14:05").
	/// </summary>
	/// <param name="time">Epoch milliseconds</param>
	/// <returns>Formatted time</returns>
	function FormatClock(time)
	{
		return clockFormat.format(new Date(time));
	}

	/// <summary>
	/// Compact time for list rows: the clock today, the weekday this week, the date before that.
	/// </summary>
	/// <param name="time">Epoch milliseconds</param>
	/// <returns>Formatted time, or an empty string for 0</returns>
	function FormatListTime(time)
	{
		if (!time)
		{
			return "";
		}

		const today = GetDayStart(Date.now());

		if (time >= today)
		{
			return FormatClock(time);
		}

		if (time >= today - 6 * dayMs)
		{
			return weekdayFormat.format(new Date(time));
		}

		return dateFormat.format(new Date(time));
	}

	/// <summary>
	/// Day heading inside a chat ("Today", "Yesterday", or the long date).
	/// </summary>
	/// <param name="time">Epoch milliseconds</param>
	/// <returns>Formatted day</returns>
	function FormatDay(time)
	{
		const today = GetDayStart(Date.now());
		const day = GetDayStart(time);

		if (day === today)
		{
			return Owls.Lang.T("time.today");
		}

		if (day === today - dayMs)
		{
			return Owls.Lang.T("time.yesterday");
		}

		return longDateFormat.format(new Date(time));
	}

	/// <summary>
	/// The weekday and date of a timestamp in words (e.g. "Sunday 25 October"), for the lock screen.
	/// </summary>
	/// <param name="time">Epoch milliseconds</param>
	/// <returns>Formatted date</returns>
	function FormatLongDate(time)
	{
		return longDateFormat.format(new Date(time));
	}

	/// <summary>
	/// Length of a call, like a phone's call timer ("0:42", "12:05" or "1:02:05").
	/// </summary>
	/// <param name="durationMs">Milliseconds</param>
	/// <returns>Formatted length</returns>
	function FormatDuration(durationMs)
	{
		const total = Math.max(0, Math.floor(Number(durationMs) / 1000) || 0);
		const hours = Math.floor(total / 3600);
		const minutes = Math.floor(total / 60) % 60;
		const seconds = String(total % 60).padStart(2, "0");
		return hours > 0 ? `${hours}:${String(minutes).padStart(2, "0")}:${seconds}` : `${minutes}:${seconds}`;
	}

	/// <summary>
	/// Unique key for matching a sent owl to the server's reply. Never reused within a page session.
	/// </summary>
	/// <returns>Short alphanumeric key</returns>
	function NewKey()
	{
		keyCounter += 1;
		return `${Date.now().toString(36)}${keyCounter.toString(36)}${Math.floor(Math.random() * 1296).toString(36)}`;
	}

	/// <summary>
	/// Case- and accent-insensitive name ordering, like a phone's contact list.
	/// </summary>
	/// <param name="first">Name</param>
	/// <param name="second">Name</param>
	/// <returns>Comparator result</returns>
	function CompareNames(first, second)
	{
		return String(first).localeCompare(String(second), locale, { sensitivity: "base" });
	}

	/// <summary>
	/// Whether a name or text matches a search query (case-insensitive substring).
	/// </summary>
	/// <param name="text">Text to search in</param>
	/// <param name="query">Search query; empty matches everything</param>
	/// <returns>True on a match</returns>
	function Matches(text, query)
	{
		const needle = String(query || "").trim().toLowerCase();
		return needle.length === 0 || String(text || "").toLowerCase().includes(needle);
	}

	return { Element, GetInitials, GetColour, GetNameColour, CreateAvatar, FormatClock, FormatListTime, FormatDay, FormatLongDate, FormatDuration, GetDayStart, NewKey, CompareNames, Matches, SetLocale };
})();
