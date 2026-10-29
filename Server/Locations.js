// FranticDreamer 2026
"use strict";

const { Ok, Fail } = require("./Result.js");
const { ClampInteger } = require("./Config.js");
const { Logger } = require("./Logger.js");
const { MessageKind } = require("./Database.js");
const Lang = require("./Lang.js");
const { Problem } = Lang;

const resourceName = "frantic-owls";

/// <summary>
/// Native blip key the client uses for its own marker when hmp-blips is not running.
/// </summary>
const nativeMarkerKey = "frantic-owls:location";

/// <summary>
/// Map icon of a shown location: the game's waypoint, a compass style hmp-blips is known to accept.
/// </summary>
const markerIcon = "UI_T_MiniMap_Waypoint";

/// <summary>
/// Longest place name stored with a location and longest marker label.
/// </summary>
const maxPlaceLength = 64;
const maxLabelLength = 60;

// ========================
// Location Parsing
// ========================

/// <summary>
/// Turn a game area or region ID into words for people (e.g. "Hogwarts_SouthWing" becomes "Hogwarts South Wing").
/// </summary>
/// <param name="id">Area or region ID</param>
/// <returns>Readable name, possibly empty</returns>
function DescribePlace(id)
{
	return String(id || "").replace(/([a-z])([A-Z])/g, "$1 $2").replace(/[_\-.:]+/g, " ").replace(/\s+/g, " ").trim().slice(0, maxPlaceLength);
}

/// <summary>
/// Read a stored location owl's body.
/// </summary>
/// <param name="body">Message body (JSON written by LocationService.Capture)</param>
/// <returns>{ x, y, z, areaId, regionId, world, place }, or null if it is not a usable location</returns>
function ParseLocation(body)
{
	let raw = null;

	// JSON.parse throws on malformed text, and a body is only as trustworthy as the database row it came from.
	try
	{
		raw = JSON.parse(String(body || ""));
	}
	catch (error)
	{
		return null;
	}

	if (!raw || typeof raw !== "object")
	{
		return null;
	}

	const location =
	{
		x: Number(raw.x),
		y: Number(raw.y),
		z: Number(raw.z),
		areaId: String(raw.areaId || ""),
		regionId: String(raw.regionId || ""),
		world: ClampInteger(raw.world, 0, Number.MAX_SAFE_INTEGER, 0),
		place: String(raw.place || "").slice(0, maxPlaceLength),
	};

	return [location.x, location.y, location.z].every(Number.isFinite) ? location : null;
}

/// <summary>
/// Where a player's client says they are: the game area and region, or nulls before they reach a playable world.
/// </summary>
/// <param name="player">Player handle</param>
/// <returns>{ areaId, regionId }</returns>
function ReadArea(player)
{
	const current = typeof player.location === "function" ? player.location() : null;
	return { areaId: current ? String(current.areaId || "") : "", regionId: current ? String(current.regionId || "") : "" };
}

// ========================
// Location Service
// ========================

/// <summary>
/// Location owls: reading where a sender stands, and putting a received location on the reader's map with a route to it.
///
/// <para>
/// NOTE: Markers go through hmp-blips when it is running, because hmp-blips replays its whole marker set by clearing every
/// native blip first, which would silently wipe a marker this resource drew itself. Without hmp-blips the client draws the
/// marker natively, which only works in the area the reader is in; hmp-blips instead shows it once they get there.
/// </para>
///
/// <para>
/// NOTE: A shown location stays until the reader reaches it, hides it by showing it again, or locations.markerSeconds runs out when set.
/// The client script keeps the gold route on it, because every hmp-blips replay (one per area change, e.g. walking through a door) removes all native blips and the route with them.
/// Arrival is noticed by the client, which can tell when the marker is actually on its map; it then asks for the marker to be taken down here.
/// </para>
///
/// </summary>
class LocationService
{
	/// <summary>
	/// OwlDatabase instance.
	/// </summary>
	#database;

	/// <summary>
	/// Outbox instance.
	/// </summary>
	#outbox;

	/// <summary>
	/// hmp-lib server import, for positions and text cleaning.
	/// </summary>
	#hmp;

	/// <summary>
	/// The "phonemode_locations" section of the server config.
	/// </summary>
	#config;

	/// <summary>
	/// Returns the hmp-blips import, or null while it is not running. Looked up per use so starting it later still counts.
	/// </summary>
	#GetBlips;

	/// <summary>
	/// The location each player has on their map, by player ID: { chatId, messageId, isBlips }.
	/// isBlips is true when it is an hmp-blips marker of ours that has to be removed through hmp-blips.
	/// </summary>
	#shown = new Map();

	/// <summary>
	/// The hmp-blips marker ID of one player's shown location. Each player has at most one; showing another moves it.
	/// </summary>
	/// <param name="playerId">Player ID</param>
	/// <returns>Marker ID</returns>
	#GetMarkerId(playerId)
	{
		return `location-${playerId}`;
	}

	/// <summary>
	/// Forget a player's shown location, taking its hmp-blips marker down if it has one. A native marker is the client's to remove.
	/// </summary>
	/// <param name="playerId">Player ID</param>
	/// <returns>The forgotten { chatId, messageId, isBlips }, or null when the player had none</returns>
	#Drop(playerId)
	{
		const shown = this.#shown.get(playerId) || null;

		if (!shown)
		{
			return null;
		}

		this.#shown.delete(playerId);
		const blips = shown.isBlips ? this.#GetBlips() : null;

		// Another resource's API; a failure here only leaves a marker its TTL or the player's disconnect will clear.
		try
		{
			if (blips && blips.markers)
			{
				blips.markers.remove(this.#GetMarkerId(playerId), resourceName);
			}
		}
		catch (error)
		{
			Logger.LogWarning("Locations", `Could not remove the location marker of player ${playerId}: ${Logger.Describe(error)}`);
		}

		return shown;
	}

	/// <summary>
	/// Take a player's shown location off their map and tell their client and page why.
	/// </summary>
	/// <param name="entry">Directory entry</param>
	/// <param name="reason">"hidden", "arrived" or "expired"</param>
	/// <returns>True if there was a location to take down</returns>
	#Clear(entry, reason)
	{
		const shown = this.#Drop(entry.playerId);

		if (!shown)
		{
			return false;
		}

		this.#outbox.Push(entry.player, "location:clear", { chatId: shown.chatId, messageId: shown.messageId, reason });
		return true;
	}

	/// <summary>
	/// Constructor.
	/// </summary>
	/// <param name="database">OwlDatabase instance</param>
	/// <param name="outbox">Outbox instance</param>
	/// <param name="hmp">hmp-lib server import</param>
	/// <param name="locationsConfig">The "phonemode_locations" section of the server config</param>
	/// <param name="GetBlips">Function returning the hmp-blips import or null</param>
	constructor(database, outbox, hmp, locationsConfig, GetBlips)
	{
		this.#database = database;
		this.#outbox = outbox;
		this.#hmp = hmp;
		this.#config = locationsConfig;
		this.#GetBlips = GetBlips;
	}

	/// <summary>
	/// Where an owl's character stands right now, as stored in a location owl.
	/// </summary>
	/// <param name="entry">Directory entry</param>
	/// <returns>{ x, y, z, areaId, regionId, world, place }, or null when the server does not know the position</returns>
	Capture(entry)
	{
		const position = this.#hmp.position.read(entry.player);

		if (!position || ![position.x, position.y, position.z].every(Number.isFinite))
		{
			return null;
		}

		const { areaId, regionId } = ReadArea(entry.player);

		return {
			x: Math.round(position.x),
			y: Math.round(position.y),
			z: Math.round(position.z),
			areaId,
			regionId,
			world: Number(entry.player.virtualWorld || 0),
			place: DescribePlace(regionId) || DescribePlace(areaId),
		};
	}

	/// <summary>
	/// Put a location owl on the reader's map and route them to it, or take it off again if it is the one already shown.
	/// </summary>
	/// <param name="entry">Directory entry of the reader</param>
	/// <param name="data">{ chatId, messageId, label } where label is the name the reader's page shows for the sender</param>
	/// <returns>Result carrying { isHidden: true } when it was taken off, otherwise { place, isElsewhere }</returns>
	async Show(entry, data)
	{
		const chatId = ClampInteger(data.chatId, 0, Number.MAX_SAFE_INTEGER, 0);
		const messageId = ClampInteger(data.messageId, 0, Number.MAX_SAFE_INTEGER, 0);
		const current = this.#shown.get(entry.playerId);

		// Showing the shown location again is how the reader hides it. Only IDs checked when it was shown can match.
		if (current && current.chatId === chatId && current.messageId === messageId)
		{
			this.#Clear(entry, "hidden");
			return Ok({ isHidden: true });
		}

		const chat = chatId > 0 ? await this.#database.GetChatForMember(chatId, entry.number) : null;
		const message = chat && messageId > 0 ? await this.#database.GetVisibleMessage(chatId, entry.number, messageId) : null;

		if (message === undefined)
		{
			return Fail("error.locationReadFailed");
		}

		const location = message && message.kind === MessageKind.Location ? ParseLocation(message.body) : null;

		if (!location)
		{
			return Fail("error.locationGone");
		}

		if (location.world !== Number(entry.player.virtualWorld || 0))
		{
			return Fail("error.locationUnreachable");
		}

		const here = ReadArea(entry.player);
		const isElsewhere = location.areaId !== "" && here.areaId !== "" && location.areaId.toLowerCase() !== here.areaId.toLowerCase();
		const name = this.#hmp.text.clean(data.label, maxLabelLength).replace(/\s+/g, " ").trim();
		const label = name ? Lang.Translate(entry.settings.language, "location.markerOf", { name }) : Lang.Translate(entry.settings.language, "location.markerShared");
		const blips = this.#GetBlips();

		if (blips && blips.markers)
		{
			const id = this.#GetMarkerId(entry.playerId);

			// hmp-blips validates and throws on bad definitions or a full marker quota; neither should reach the player as a crash.
			try
			{
				await blips.markers.upsert
				({
					resource: resourceName,
					id,
					kind: "marker",
					position: { x: location.x, y: location.y, z: location.z },
					icon: markerIcon,
					label,
					ttl: this.#config.markerSeconds,
					audience: [entry.player],
					areaId: location.areaId || undefined,
					virtualWorld: location.world,
				});
			}
			catch (error)
			{
				Logger.LogWarning("Locations", `hmp-blips refused the location marker of player ${entry.playerId}: ${Logger.Describe(error)}`);
				return Fail("error.markFailed");
			}

			this.#shown.set(entry.playerId, { chatId, messageId, isBlips: true });
			this.#PushRoute(entry, `hmp:${resourceName}:${id}`, label, chatId, messageId, location, false);
			return Ok({ place: location.place, isElsewhere });
		}

		// A native marker is drawn in whichever area the reader is in, so one from another area would point at the wrong spot.
		if (isElsewhere)
		{
			return Fail(location.place ? Problem("error.locationElsewherePlace", { place: location.place }) : "error.locationElsewhere");
		}

		// A marker of ours left in hmp-blips (it stopped since) goes with it, so only the native one remains to track.
		this.#Drop(entry.playerId);
		this.#shown.set(entry.playerId, { chatId, messageId, isBlips: false });
		this.#PushRoute(entry, nativeMarkerKey, label, chatId, messageId, location, true);
		return Ok({ place: location.place, isElsewhere: false });
	}

	/// <summary>
	/// Tell the reader's client to route them to a shown location and to watch for their arrival.
	/// </summary>
	/// <param name="entry">Directory entry of the reader</param>
	/// <param name="key">Native blip key of the marker</param>
	/// <param name="label">Marker and route label</param>
	/// <param name="chatId">Chat ID of the location owl</param>
	/// <param name="messageId">Message ID of the location owl</param>
	/// <param name="location">Parsed location</param>
	/// <param name="isNative">Whether the client must draw the marker itself</param>
	#PushRoute(entry, key, label, chatId, messageId, location, isNative)
	{
		this.#outbox.Push(entry.player, "location:route",
		{
			key,
			label,
			chatId,
			messageId,
			target: { x: location.x, y: location.y, z: location.z },
			isNative,
			seconds: this.#config.markerSeconds,
			arrivalMetres: this.#config.arrivalMetres,
		});
	}

	/// <summary>
	/// Take the reader's shown location down at their client's word: they reached it, or its time ran out.
	/// </summary>
	/// <param name="entry">Directory entry of the reader</param>
	/// <param name="data">{ chatId, messageId, reason } where reason is "arrived" or "expired"</param>
	/// <returns>Result; Ok even when that location was no longer shown</returns>
	Hide(entry, data)
	{
		const chatId = ClampInteger(data.chatId, 0, Number.MAX_SAFE_INTEGER, 0);
		const messageId = ClampInteger(data.messageId, 0, Number.MAX_SAFE_INTEGER, 0);
		const reason = data.reason === "expired" ? "expired" : "arrived";
		const current = this.#shown.get(entry.playerId);

		// A late report about a location the reader has since replaced must not take the new one down.
		if (current && current.chatId === chatId && current.messageId === messageId)
		{
			this.#Clear(entry, reason);
		}

		return Ok();
	}

	/// <summary>
	/// Remove a player's shown location from hmp-blips when they go offline. A native marker leaves with the client.
	/// </summary>
	/// <param name="playerId">Player ID</param>
	Forget(playerId)
	{
		this.#Drop(playerId);
	}
}

module.exports = { LocationService, ParseLocation, DescribePlace, ReadArea };
