// FranticDreamer 2026
"use strict";

const { Logger } = require("./Logger.js");

/// <summary>
/// HogwartsMP world units per metre (positions are in centimetres).
/// </summary>
const unitsPerMetre = 100;

/// <summary>
/// Time between two position updates of a flying owl.
/// Every update is a network message to everyone nearby, so this is the smoothness bought against traffic.
/// </summary>
const stepMs = 250;

/// <summary>
/// Prefix of every world object key used for letter owls. Keys are shared by every resource, so they carry the resource's name.
/// </summary>
const keyPrefix = "frantic-owls.flight.";

/// <summary>
/// Most letter owls in the air at once, server-wide. A busy moment (a bulk owl landing for a whole guild) skips the owls past this rather than flooding the world.
/// </summary>
const maxOwlsInAir = 32;

/// <summary>
/// Departure: The owl leaves from just in front of the sender at shoulder height, then flies on and climbs.
/// </summary>
const departureMs = 4500;
const departureStartMetres = 1.5;
const departureStartHeightMetres = 1.6;
const departureDistanceMetres = 28;
const departureClimbMetres = 12;

/// <summary>
/// Arrival: The owl swoops down from high up, passes just beside the recipient's head, and climbs away on the far side.
/// </summary>
const arrivalMs = 7000;
const arrivalReachMetres = 35;
const arrivalHeightMetres = 14;
const arrivalPassHeightMetres = 2.2;
const arrivalPassSideMetres = 1.5;

// ========================
// Helpers
// ========================

/// <summary>
/// Where a player is and which way they face.
/// player.location() carries the heading and the map; hmp.position is the fallback for the coordinates alone.
/// </summary>
/// <param name="hmp">hmp-lib server import</param>
/// <param name="player">Player to read</param>
/// <returns>{ x, y, z, yaw, areaId }, or null when the position cannot be read</returns>
function ReadPlacement(hmp, player)
{
	const location = typeof player.location === "function" ? player.location() : null;
	const position = location && [location.x, location.y, location.z].every(Number.isFinite) ? location : hmp.position.read(player);

	if (!position)
	{
		return null;
	}

	return {
		x: position.x,
		y: position.y,
		z: position.z,
		yaw: location && Number.isFinite(location.yaw) ? location.yaw : 0,
		areaId: location && location.areaId ? String(location.areaId) : "",
	};
}

/// <summary>
/// Unit direction on the ground plane for a heading in degrees.
/// </summary>
/// <param name="yaw">Heading in degrees</param>
/// <returns>{ x, y }</returns>
function DirectionFromYaw(yaw)
{
	const radians = (yaw * Math.PI) / 180;
	return { x: Math.cos(radians), y: Math.sin(radians) };
}

/// <summary>
/// Unit direction on the ground plane from one place to another.
/// </summary>
/// <param name="from">{ x, y }</param>
/// <param name="to">{ x, y }</param>
/// <returns>{ x, y }, or null when the two are within a metre of each other</returns>
function DirectionBetween(from, to)
{
	const dx = to.x - from.x;
	const dy = to.y - from.y;
	const length = Math.hypot(dx, dy);
	return length < unitsPerMetre ? null : { x: dx / length, y: dy / length };
}

/// <summary>
/// Heading in degrees of a ground plane direction.
/// </summary>
/// <param name="direction">{ x, y }</param>
/// <returns>Degrees</returns>
function YawOf(direction)
{
	return (Math.atan2(direction.y, direction.x) * 180) / Math.PI;
}

/// <summary>
/// Whether two players share a map, so the way from one to the other means something.
/// </summary>
/// <param name="first">Player</param>
/// <param name="second">Player</param>
/// <param name="firstPlace">First player's placement</param>
/// <param name="secondPlace">Second player's placement</param>
/// <returns>True when they are in the same virtual world and area</returns>
function IsSameMap(first, second, firstPlace, secondPlace)
{
	return (first.virtualWorld || 0) === (second.virtualWorld || 0) && (!firstPlace.areaId || !secondPlace.areaId || firstPlace.areaId === secondPlace.areaId);
}

// ========================
// Owl Flier
// ========================

/// <summary>
/// Flies world objects along paths by position updates, each under its own key.
///
/// <para>
/// NOTE: A world object's rotation can only be set when it is created, so an owl faces one way for its whole flight.
/// Every path here is drawn to suit that: It goes on in roughly the direction the owl faces, rising or falling, and never turns back.
/// </para>
///
/// </summary>
class OwlFlier
{
	/// <summary>
	/// Flights in progress by key: { object, timer }.
	/// </summary>
	#flights = new Map();

	/// <summary>
	/// Put an owl in the world and fly it, or hold it in place.
	/// An owl already flying under the same key is replaced.
	/// </summary>
	/// <param name="key">World object key</param>
	/// <param name="model">Model path</param>
	/// <param name="options">{ start, yaw, world, isSimulated, delayMs, durationMs, PositionAt }: PositionAt(progress 0 - 1) gives { x, y, z }; without it the owl stays at start for durationMs</param>
	/// <returns>True when the owl is out</returns>
	Launch(key, model, options)
	{
		this.Stop(key);

		const start = options.start;
		let object;

		// WorldObject.create throws for a model path it cannot parse, and returns undefined for one it cannot place.
		try
		{
			object = WorldObject.create(key, model, { x: start.x, y: start.y, z: start.z, yaw: options.yaw, collision: false, simulated: options.isSimulated === true });
		}
		catch (error)
		{
			Logger.LogWarning("Flight", `${model} was refused: ${Logger.Describe(error)}`);
			return false;
		}

		if (!object)
		{
			Logger.LogWarning("Flight", `${model} could not be created.`);
			return false;
		}

		// Objects start in world 0, which a player in another world would not see.
		if (options.world && typeof object.setVirtualWorld === "function")
		{
			object.setVirtualWorld(options.world);
		}

		const flight = { object, timer: null };
		this.#flights.set(key, flight);

		if (typeof options.PositionAt !== "function")
		{
			flight.timer = setTimeout(() => this.Stop(key), options.durationMs);
			return true;
		}

		flight.timer = setTimeout(() => this.#Fly(key, flight, options), options.delayMs || 0);
		return true;
	}

	/// <summary>
	/// Move an owl along its path a step at a time, then take it away.
	/// </summary>
	/// <param name="key">World object key</param>
	/// <param name="flight">The flight Launch() made</param>
	/// <param name="options">Options given to Launch()</param>
	#Fly(key, flight, options)
	{
		const startedAt = Date.now();

		flight.timer = setInterval(() =>
		{
			// Replaced or stopped since the last step.
			if (this.#flights.get(key) !== flight)
			{
				clearInterval(flight.timer);
				return;
			}

			const progress = Math.min(1, (Date.now() - startedAt) / options.durationMs);
			const position = options.PositionAt(progress);
			flight.object.position = new Vector3(position.x, position.y, position.z);

			if (progress >= 1)
			{
				this.Stop(key);
			}
		}, stepMs);
	}

	/// <summary>
	/// Take an owl away.
	/// </summary>
	/// <param name="key">World object key</param>
	/// <returns>True when there was one</returns>
	Stop(key)
	{
		const flight = this.#flights.get(key);

		if (!flight)
		{
			return false;
		}

		this.#flights.delete(key);
		clearTimeout(flight.timer);
		clearInterval(flight.timer);
		WorldObject.destroy(key);
		return true;
	}

	/// <summary>
	/// Take every owl away, when the resource stops.
	/// </summary>
	StopAll()
	{
		for (const key of [...this.#flights.keys()])
		{
			this.Stop(key);
		}
	}

	/// <summary>
	/// Count the owls out, or those whose key starts with a prefix.
	/// </summary>
	/// <param name="prefix">Key prefix (optional)</param>
	/// <returns>Number of owls</returns>
	GetCount(prefix = "")
	{
		let count = 0;

		for (const key of this.#flights.keys())
		{
			if (key.startsWith(prefix))
			{
				++count;
			}
		}

		return count;
	}
}

// ========================
// Letter Owls
// ========================

/// <summary>
/// The owls players see carrying letters when owl flight is on (flight.owl): One leaves the sender, and one reaches each recipient who is online when the letter lands.
///
/// <para>
/// NOTE: The owl does not fly the whole way, since a world object is only seen near it and the two players are usually far apart, or one of them is offline.
/// Each end gets its own short scene instead, and the flight time between them (flight.minSeconds and the rest) stands for the journey.
/// Where both players are on the same map the owl leaves towards the recipient and arrives from the sender's side, so the two scenes still line up.
/// The owls have no collision and fly a fixed path, so indoors they pass through walls and ceilings.
/// </para>
///
/// </summary>
class OwlFlightScenes
{
	/// <summary>
	/// hmp-lib server import, for positions.
	/// </summary>
	#hmp;

	/// <summary>
	/// OwlFlier instance.
	/// </summary>
	#flier;

	/// <summary>
	/// The "flight" section of the server config.
	/// </summary>
	#config;

	/// <summary>
	/// Constructor.
	/// </summary>
	/// <param name="hmp">hmp-lib server import</param>
	/// <param name="flier">OwlFlier instance</param>
	/// <param name="flightConfig">The "flight" section of the server config</param>
	constructor(hmp, flier, flightConfig)
	{
		this.#hmp = hmp;
		this.#flier = flier;
		this.#config = flightConfig;
	}

	/// <summary>
	/// Whether a scene may start now: Flight and its owls are on, and there is room in the sky.
	/// </summary>
	/// <param name="scene">"departure" or "arrival"</param>
	/// <returns>True when allowed</returns>
	#CanShow(scene)
	{
		const owl = this.#config.owl;
		return this.#config.enabled && owl.enabled && owl[scene] && this.#flier.GetCount(keyPrefix) < maxOwlsInAir;
	}

	/// <summary>
	/// Show an owl taking a letter away from its sender.
	/// </summary>
	/// <param name="sender">Sending player</param>
	/// <param name="recipient">Receiving player, when there is one online; the owl leaves towards them if they share a map</param>
	/// <returns>True when an owl took off</returns>
	Depart(sender, recipient)
	{
		if (!this.#CanShow("departure"))
		{
			return false;
		}

		const from = ReadPlacement(this.#hmp, sender);

		if (!from)
		{
			return false;
		}

		const to = recipient ? ReadPlacement(this.#hmp, recipient) : null;
		const direction = (to && IsSameMap(sender, recipient, from, to) && DirectionBetween(from, to)) || DirectionFromYaw(from.yaw);
		const start =
		{
			x: from.x + direction.x * departureStartMetres * unitsPerMetre,
			y: from.y + direction.y * departureStartMetres * unitsPerMetre,
			z: from.z + departureStartHeightMetres * unitsPerMetre,
		};

		// Climbing harder as it goes, the way a bird leaves a perch.
		const PositionAt = (progress) =>
		{
			const along = progress * departureDistanceMetres * unitsPerMetre;
			return { x: start.x + direction.x * along, y: start.y + direction.y * along, z: start.z + progress * progress * departureClimbMetres * unitsPerMetre };
		};

		return this.#flier.Launch(`${keyPrefix}depart.${sender.id}`, this.#config.owl.model, { start, yaw: YawOf(direction), world: sender.virtualWorld || 0, durationMs: departureMs, PositionAt });
	}

	/// <summary>
	/// Show an owl bringing a letter to its recipient.
	/// </summary>
	/// <param name="recipient">Receiving player</param>
	/// <param name="sender">Sending player, when they are online; the owl comes from their side if they share a map</param>
	/// <returns>True when an owl is on its way</returns>
	Arrive(recipient, sender)
	{
		if (!this.#CanShow("arrival"))
		{
			return false;
		}

		const at = ReadPlacement(this.#hmp, recipient);

		if (!at)
		{
			return false;
		}

		const from = sender ? ReadPlacement(this.#hmp, sender) : null;
		const direction = (from && IsSameMap(sender, recipient, from, at) && DirectionBetween(from, at)) || DirectionFromYaw(Math.random() * 360);
		const side = { x: -direction.y, y: direction.x };
		const reach = arrivalReachMetres * unitsPerMetre;
		const start = { x: at.x - direction.x * reach, y: at.y - direction.y * reach, z: at.z + arrivalHeightMetres * unitsPerMetre };
		const end = { x: at.x + direction.x * reach, y: at.y + direction.y * reach, z: start.z };
		const pass = { x: at.x + side.x * arrivalPassSideMetres * unitsPerMetre, y: at.y + side.y * arrivalPassSideMetres * unitsPerMetre, z: at.z + arrivalPassHeightMetres * unitsPerMetre };

		// A quadratic curve from start to end through the pass point halfway: Its control point is where the halfway point lands on pass.
		const control = { x: 2 * pass.x - (start.x + end.x) / 2, y: 2 * pass.y - (start.y + end.y) / 2, z: 2 * pass.z - (start.z + end.z) / 2 };
		const PositionAt = (progress) =>
		{
			const a = (1 - progress) * (1 - progress);
			const b = 2 * (1 - progress) * progress;
			const c = progress * progress;
			return { x: a * start.x + b * control.x + c * end.x, y: a * start.y + b * control.y + c * end.y, z: a * start.z + b * control.z + c * end.z };
		};

		return this.#flier.Launch(`${keyPrefix}arrive.${recipient.id}`, this.#config.owl.model, { start, yaw: YawOf(direction), world: recipient.virtualWorld || 0, durationMs: arrivalMs, PositionAt });
	}

	/// <summary>
	/// Take a player's letter owls away, when they leave.
	/// </summary>
	/// <param name="playerId">Player ID</param>
	Forget(playerId)
	{
		this.#flier.Stop(`${keyPrefix}depart.${playerId}`);
		this.#flier.Stop(`${keyPrefix}arrive.${playerId}`);
	}
}

module.exports = { OwlFlier, OwlFlightScenes, ReadPlacement, DirectionFromYaw };
