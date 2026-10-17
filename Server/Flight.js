// FranticDreamer 2026
"use strict";

const { GetDistanceMetres } = require("./Directory.js");

// ========================
// Flight Planner
// ========================

/// <summary>
/// Optional owl flight time: an owl lands some seconds after it is sent instead of at once (flight.enabled).
///
/// <para>
/// One-to-one owls fly for minSeconds plus secondsPerHundredMetres for every 100 m between the two characters, capped at maxSeconds.
/// An owl to someone offline, or in another virtual world, takes maxSeconds. Bulk owls take groupSeconds, since their members are all over the map.
/// Until it lands the recipient sees nothing at all: not the owl, not a preview, not an unread badge. The sender sees it marked "in flight".
/// </para>
///
/// </summary>
class FlightPlanner
{
	/// <summary>
	/// hmp-lib server import, for positions.
	/// </summary>
	#hmp;

	/// <summary>
	/// OwlDirectory instance.
	/// </summary>
	#directory;

	/// <summary>
	/// The "flight" section of the server config.
	/// </summary>
	#config;

	/// <summary>
	/// Constructor.
	/// </summary>
	/// <param name="hmp">hmp-lib server import</param>
	/// <param name="directory">OwlDirectory instance</param>
	/// <param name="flightConfig">The "flight" section of the server config</param>
	constructor(hmp, directory, flightConfig)
	{
		this.#hmp = hmp;
		this.#directory = directory;
		this.#config = flightConfig;
	}

	/// <summary>
	/// When an owl a player sends now should land.
	/// </summary>
	/// <param name="sender">Directory entry of the sending owl</param>
	/// <param name="chat">Chat it is sent to ({ kind, members })</param>
	/// <returns>Epoch milliseconds, or 0 to deliver at once</returns>
	GetDeliverAt(sender, chat)
	{
		if (!this.#config.enabled)
		{
			return 0;
		}

		let seconds = this.#config.groupSeconds;

		if (chat.kind === "direct")
		{
			const recipient = this.#directory.GetByNumber(chat.members.find((member) => member !== sender.number) || "");
			const distance = recipient ? GetDistanceMetres(this.#hmp, sender, recipient) : Infinity;

			seconds = Number.isFinite(distance)
				? Math.min(this.#config.maxSeconds, this.#config.minSeconds + (distance / 100) * this.#config.secondsPerHundredMetres)
				: this.#config.maxSeconds;
		}

		return seconds > 0 ? Date.now() + Math.round(seconds * 1000) : 0;
	}
}

module.exports = { FlightPlanner };
