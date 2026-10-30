// FranticDreamer 2026
"use strict";

const { Logger } = require("./Logger.js");

/// <summary>
/// HogwartsMP world units per metre (positions are in centimetres).
/// </summary>
const unitsPerMetre = 100;

/// <summary>
/// How far in front of the admin the test owl appears, and how high above their feet.
/// </summary>
const spawnDistanceMetres = 3;
const spawnHeightMetres = 1.5;

/// <summary>
/// How long the owl stays in place before it flies off, so you can see whether it animates on its own.
/// </summary>
const hoverMs = 3000;

/// <summary>
/// The flight: how long it takes, how far it goes and how much it climbs.
/// </summary>
const flightMs = 6000;
const flightDistanceMetres = 30;
const flightClimbMetres = 10;

/// <summary>
/// Time between two position updates in flight.
/// Every update is a network message to everyone nearby, so this is the smoothness bought against traffic.
/// </summary>
const stepMs = 250;

/// <summary>
/// A held owl is taken away after this long even if nobody stops it, so a forgotten test does not stay in the world.
/// </summary>
const holdMs = 60000;

/// <summary>
/// Prefix of every world object key this resource uses for test owls. Keys are shared by every resource, so they carry the resource's name.
/// </summary>
const keyPrefix = "frantic-owls.testowl.";

/// <summary>
/// Owl Blueprints from the game worth trying, by a short name for the command.
/// </summary>
const testOwlPresets =
{
	delivery: "/Game/Levels/WorldEvents/Blueprints/SpecialDelivery/BP_Delivery_Owl_SplineMover.BP_Delivery_Owl_SplineMover_C",
	glide: "/Game/Levels/WorldEvents/Blueprints/BirdOfPrey/BP_WE_BOP_MoveObjectAlongSpline_Owl.BP_WE_BOP_MoveObjectAlongSpline_Owl_C",
	creature: "/Game/Pawn/NPC/Creature/Owl/BP_Owl_Creature.BP_Owl_Creature_C",
	prop: "/Game/Environment/Universal/Blueprints/BP_PropOwl_Base.BP_PropOwl_Base_C",
	station: "/Game/Gameplay/Stations/Interaction/MailInteraction/BP_OwlStation_Owl.BP_OwlStation_Owl_C",
};

/// <summary>
/// A model path WorldObject.create accepts: /Game/Folder/Name.Name, with _C on the end for a Blueprint class.
/// </summary>
const modelPathPattern = /^\/Game\/[A-Za-z0-9_\/]+\.[A-Za-z0-9_]+$/;

// ========================
// Test Owls
// ========================

/// <summary>
/// Admin test flights for trying owl models from the game before they are used for real letters (/owl_testowl).
///
/// <para>
/// NOTE: An owl appears in front of the admin, stays put for a few seconds, then flies away and climbs by position updates before it is taken away.
/// The pause is there to tell two questions apart: whether the Blueprint animates on its own, and whether it still looks right while the server moves it.
/// Blueprints that follow a spline from their world event have none here, so some may sit still, vanish or jump elsewhere; that is what this is for finding out.
/// </para>
///
/// </summary>
class TestOwlService
{
	/// <summary>
	/// hmp-lib server import, for positions.
	/// </summary>
	#hmp;

	/// <summary>
	/// The test owl each admin has out, by player ID: { key, object, timer }.
	/// </summary>
	#flights = new Map();

	/// <summary>
	/// Constructor.
	/// </summary>
	/// <param name="hmp">hmp-lib server import</param>
	constructor(hmp)
	{
		this.#hmp = hmp;
	}

	/// <summary>
	/// The preset names, for the command's usage line.
	/// </summary>
	/// <returns>Names such as "delivery"</returns>
	GetPresetNames()
	{
		return Object.keys(testOwlPresets);
	}

	/// <summary>
	/// Turn a preset name or a model path into a model path.
	/// </summary>
	/// <param name="name">Preset name, or a /Game/... path</param>
	/// <returns>The model path, or "" when it is neither</returns>
	ResolveModel(name)
	{
		const text = String(name || "").trim();
		const preset = testOwlPresets[text.toLowerCase()];

		if (preset)
		{
			return preset;
		}

		return modelPathPattern.test(text) ? text : "";
	}

	/// <summary>
	/// Put a test owl in front of a player and fly it away.
	/// A player has one test owl at a time; starting another replaces it.
	/// </summary>
	/// <param name="player">Admin the owl appears for</param>
	/// <param name="model">Model path from ResolveModel()</param>
	/// <param name="options">{ isSimulated, isHeld }: Let the nearest player's game run the Blueprint; keep the owl in place instead of flying it</param>
	/// <returns>"" when the owl is out, otherwise the text key of the problem</returns>
	Start(player, model, options)
	{
		this.Stop(player.id);

		// player.location() also carries the heading; hmp.position is the fallback for the coordinates alone.
		const location = typeof player.location === "function" ? player.location() : null;
		const position = location && [location.x, location.y, location.z].every(Number.isFinite) ? location : this.#hmp.position.read(player);

		if (!position)
		{
			return "command.testOwlNoPosition";
		}

		const yaw = location && Number.isFinite(location.yaw) ? location.yaw : 0;
		const radians = (yaw * Math.PI) / 180;
		const forward = { x: Math.cos(radians), y: Math.sin(radians) };
		const start =
		{
			x: position.x + forward.x * spawnDistanceMetres * unitsPerMetre,
			y: position.y + forward.y * spawnDistanceMetres * unitsPerMetre,
			z: position.z + spawnHeightMetres * unitsPerMetre,
		};
		const key = `${keyPrefix}${player.id}`;
		let object;

		// WorldObject.create throws for a model path it cannot parse, and returns undefined for one it cannot place.
		try
		{
			// Facing the way it will fly, since an object's rotation is only set when it is created.
			object = WorldObject.create(key, model, { x: start.x, y: start.y, z: start.z, yaw, collision: false, simulated: options.isSimulated === true });
		}
		catch (error)
		{
			Logger.LogWarning("TestOwl", `${model} was refused: ${Logger.Describe(error)}`);
			return "command.testOwlRefused";
		}

		if (!object)
		{
			Logger.LogWarning("TestOwl", `${model} could not be created for player ${player.id}.`);
			return "command.testOwlRefused";
		}

		// Objects start in world 0, which an admin in another world would not see.
		if (player.virtualWorld && typeof object.setVirtualWorld === "function")
		{
			object.setVirtualWorld(player.virtualWorld);
		}

		const flight = { key, object, timer: null };
		this.#flights.set(player.id, flight);
		Logger.LogMessage("TestOwl", `${player.nickname} (player ${player.id}) is testing ${model}${options.isSimulated === true ? " (simulated)" : ""}${options.isHeld === true ? ", held" : ""}.`);

		if (options.isHeld === true)
		{
			flight.timer = setTimeout(() => this.Stop(player.id), holdMs);
			return "";
		}

		flight.timer = setTimeout(() => this.#Fly(player.id, flight, start, forward), hoverMs);
		return "";
	}

	/// <summary>
	/// Move a test owl along its flight a step at a time, then take it away.
	/// </summary>
	/// <param name="playerId">Admin the owl belongs to</param>
	/// <param name="flight">The flight Start() made</param>
	/// <param name="start">Where the owl appeared</param>
	/// <param name="forward">Unit direction it flies in, on the ground plane</param>
	#Fly(playerId, flight, start, forward)
	{
		const startedAt = Date.now();

		flight.timer = setInterval(() =>
		{
			// Replaced or stopped since the last step.
			if (this.#flights.get(playerId) !== flight)
			{
				clearInterval(flight.timer);
				return;
			}

			const progress = Math.min(1, (Date.now() - startedAt) / flightMs);
			const distance = progress * flightDistanceMetres * unitsPerMetre;

			// Climbing harder as it goes, the way a bird leaves a perch.
			const climb = progress * progress * flightClimbMetres * unitsPerMetre;
			flight.object.position = new Vector3(start.x + forward.x * distance, start.y + forward.y * distance, start.z + climb);

			if (progress >= 1)
			{
				this.Stop(playerId);
			}
		}, stepMs);
	}

	/// <summary>
	/// Take a player's test owl away.
	/// </summary>
	/// <param name="playerId">Admin whose owl it is</param>
	/// <returns>True when there was one</returns>
	Stop(playerId)
	{
		const flight = this.#flights.get(playerId);

		if (!flight)
		{
			return false;
		}

		this.#flights.delete(playerId);
		clearTimeout(flight.timer);
		clearInterval(flight.timer);
		WorldObject.destroy(flight.key);
		return true;
	}

	/// <summary>
	/// Take every test owl away, when the resource stops.
	/// </summary>
	StopAll()
	{
		for (const playerId of [...this.#flights.keys()])
		{
			this.Stop(playerId);
		}
	}
}

module.exports = { TestOwlService };
