// FranticDreamer 2026
"use strict";

const { Logger } = require("./Logger.js");

/// <summary>
/// The staff permissions frantic-owls asks about. Each also has its own rule in the configuration, used when no registered resource answers.
/// </summary>
const Permission = Object.freeze
({
	/// <summary>
	/// /owl_announce, and official letters on immersive mode's desk (announcements.*).
	/// </summary>
	Announce: "announce",

	/// <summary>
	/// Reading and handling reports: the phone's Moderation app and the desk's Reports tab (reports.*).
	/// </summary>
	Reports: "reports",

	/// <summary>
	/// Placing and reloading owl posts (immersivemode_postadmin).
	/// </summary>
	PostAdmin: "postadmin",
});

// ========================
// Permission Registry
// ========================

/// <summary>
/// Lets another resource decide who holds frantic-owls' staff permissions, so a server with its own staff roles need not mirror them in hmp-admin or hmp-core groups.
///
/// <para>
/// NOTE: Registered rules are asked in the order they were registered, and the first that answers true or false decides. One that answers anything else (null, undefined)
/// has no opinion, and the next is asked; when none has one, the configuration's own rule (an hmp-admin capability, else an hmp-core group) decides as before.
/// A hook that throws or rejects refuses: a broken permission check must never grant staff rights.
/// </para>
///
/// </summary>
class PermissionRegistry
{
	/// <summary>
	/// Rules by registering resource, in registration order: { Allows }.
	/// </summary>
	#rules = new Map();

	/// <summary>
	/// Let a resource answer frantic-owls' permission checks. Dropped when that resource stops; registering again replaces its rules and keeps their place.
	/// </summary>
	/// <param name="resource">Name of the registering resource</param>
	/// <param name="rules">{ Allows({ player, characterId, permission }) } returning (or resolving to) true, false, or null for no opinion</param>
	/// <returns>{ ok, error }</returns>
	Register(resource, rules)
	{
		const name = String(resource || "").trim();

		if (!name || !rules || typeof rules !== "object" || typeof rules.Allows !== "function")
		{
			return { ok: false, error: "RegisterPermissionRules needs a resource name and an Allows function." };
		}

		this.#rules.set(name, { Allows: rules.Allows });
		return { ok: true, error: "" };
	}

	/// <summary>
	/// Drop the rules of a resource (it stopped, or asked).
	/// </summary>
	/// <param name="resource">Resource name</param>
	/// <returns>True if it had rules</returns>
	Unregister(resource)
	{
		return this.#rules.delete(String(resource || "").trim());
	}

	/// <summary>
	/// What the registered resources say about one player holding one permission.
	/// </summary>
	/// <param name="player">Player asking</param>
	/// <param name="characterId">Their loaded character's ID, or null</param>
	/// <param name="permission">A Permission value</param>
	/// <returns>True or false when a resource decided, null when none has an opinion</returns>
	async Ask(player, characterId, permission)
	{
		for (const [resource, rules] of this.#rules)
		{
			try
			{
				const answer = await rules.Allows({ player, characterId, permission });

				if (answer === true || answer === false)
				{
					return answer;
				}
			}
			catch (error)
			{
				Logger.LogWarning("Permissions", `${resource}'s permission rules failed for "${permission}" (player ${player && player.id}); refusing: ${Logger.Describe(error)}`);
				return false;
			}
		}

		return null;
	}
}

module.exports = { PermissionRegistry, Permission };
