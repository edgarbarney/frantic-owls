// FranticDreamer 2026
"use strict";

const Lang = require("./Lang.js");

// ========================
// Request Results
// ========================

/// <summary>
/// Build a successful request result.
/// Results are plain return values, never thrown; the request dispatcher sends them back to the client as-is.
/// </summary>
/// <param name="data">Payload handed to the page (optional)</param>
/// <returns>{ ok: true, data }</returns>
function Ok(data = null)
{
	return { ok: true, data };
}

/// <summary>
/// Build a failed request result.
/// The problem is shown to the player, so phrase its text for them rather than for the server log.
///
/// <para>
/// NOTE: The page shows errorKey in the player's own language; error is the same text in the server's default language,
/// for logs and for the "api" export, whose callers expect readable text rather than a key.
/// </para>
///
/// </summary>
/// <param name="problem">Text key, or { key, params } from Lang.Problem</param>
/// <param name="data">Extra payload, such as a remaining cooldown (optional)</param>
/// <returns>{ ok: false, error, errorKey, errorParams, data }</returns>
function Fail(problem, data = null)
{
	const { key, params } = typeof problem === "string" ? { key: problem, params: {} } : { key: String(problem.key), params: problem.params || {} };
	return { ok: false, error: Lang.Translate("", key, params), errorKey: key, errorParams: params, data };
}

/// <summary>
/// Fail with a problem, or pass on a failed result another part already built (a parcel rule's refusal, worded by the resource behind it), adding data.
/// </summary>
/// <param name="problem">A Fail problem, or a failed result</param>
/// <param name="data">Data to carry (optional)</param>
/// <returns>Failed result</returns>
function FailWith(problem, data = null)
{
	return problem && typeof problem === "object" && problem.ok === false ? { ...problem, data } : Fail(problem, data);
}

module.exports = { Ok, Fail, FailWith };
