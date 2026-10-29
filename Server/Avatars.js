// FranticDreamer 2026
"use strict";

const { Problem } = require("./Lang.js");

// ========================
// Avatar Links
// ========================

/// <summary>
/// Check a picture link, used both for a player's own profile picture and for contact overrides.
/// Any direct image link works, GIFs included (e.g. https://i.imgur.com/abc123.gif).
///
/// <para>
/// NOTE: Pages load these links straight from each player's machine, so the image host sees the IP address of everyone who views the picture.
/// Profile pictures are shown to every owl that has you as a contact or shares a chat with you, which is why the scheme is limited to https
/// by default and an optional host allow-list exists (avatars.allowedHosts).
/// </para>
///
/// </summary>
/// <param name="raw">Client-supplied URL (may be empty to clear the picture)</param>
/// <param name="avatarsConfig">The "phonemode_avatars" section of the server config</param>
/// <returns>{ ok, url, error } where error is a Lang.Problem (null when ok)</returns>
function CheckAvatarUrl(raw, avatarsConfig)
{
	const text = String(raw === undefined || raw === null ? "" : raw).trim();

	if (text.length === 0)
	{
		return { ok: true, url: "", error: null };
	}

	if (text.length > avatarsConfig.maxUrlLength)
	{
		return { ok: false, url: "", error: Problem("error.pictureTooLong", { count: avatarsConfig.maxUrlLength }) };
	}

	// The URL constructor throws on malformed input; this is the one way to parse it robustly.
	let parsed = null;

	try
	{
		parsed = new URL(text);
	}
	catch (error)
	{
		return { ok: false, url: "", error: Problem("error.pictureInvalid") };
	}

	const isSecure = parsed.protocol === "https:";
	const isInsecureAllowed = parsed.protocol === "http:" && avatarsConfig.allowInsecure;

	if (!isSecure && !isInsecureAllowed)
	{
		return { ok: false, url: "", error: Problem("error.pictureHttps") };
	}

	if (parsed.username || parsed.password)
	{
		return { ok: false, url: "", error: Problem("error.pictureCredentials") };
	}

	const hosts = avatarsConfig.allowedHosts;
	const hostname = parsed.hostname.toLowerCase();

	if (hosts.length > 0 && !hosts.some((host) => hostname === host || hostname.endsWith(`.${host}`)))
	{
		return { ok: false, url: "", error: Problem("error.pictureHost", { hosts: hosts.join(", ") }) };
	}

	return { ok: true, url: parsed.href, error: null };
}

module.exports = { CheckAvatarUrl };
