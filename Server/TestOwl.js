// FranticDreamer 2026
"use strict";

const { Logger } = require("./Logger.js");
const { modelPathPattern } = require("./Config.js");
const { ReadPlacement, DirectionFromYaw } = require("./OwlFlights.js");

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
	/// OwlFlier instance, shared with the letter owls.
	/// </summary>
	#flier;

	/// <summary>
	/// Constructor.
	/// </summary>
	/// <param name="hmp">hmp-lib server import</param>
	/// <param name="flier">OwlFlier instance</param>
	constructor(hmp, flier)
	{
		this.#hmp = hmp;
		this.#flier = flier;
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

		const placement = ReadPlacement(this.#hmp, player);

		if (!placement)
		{
			return "command.testOwlNoPosition";
		}

		const forward = DirectionFromYaw(placement.yaw);
		const start =
		{
			x: placement.x + forward.x * spawnDistanceMetres * unitsPerMetre,
			y: placement.y + forward.y * spawnDistanceMetres * unitsPerMetre,
			z: placement.z + spawnHeightMetres * unitsPerMetre,
		};

		// Climbing harder as it goes, the way a bird leaves a perch.
		const PositionAt = (progress) =>
		{
			const along = progress * flightDistanceMetres * unitsPerMetre;
			return { x: start.x + forward.x * along, y: start.y + forward.y * along, z: start.z + progress * progress * flightClimbMetres * unitsPerMetre };
		};

		const isHeld = options.isHeld === true;
		const flight = isHeld ? { durationMs: holdMs } : { delayMs: hoverMs, durationMs: flightMs, PositionAt };

		// Facing the way it will fly, since an object's rotation is only set when it is created.
		if (!this.#flier.Launch(`${keyPrefix}${player.id}`, model, { start, yaw: placement.yaw, world: player.virtualWorld || 0, isSimulated: options.isSimulated === true, ...flight }))
		{
			return "command.testOwlRefused";
		}

		Logger.LogMessage("TestOwl", `${player.nickname} (player ${player.id}) is testing ${model}${options.isSimulated === true ? " (simulated)" : ""}${isHeld ? ", held" : ""}.`);
		return "";
	}

	/// <summary>
	/// Take a player's test owl away.
	/// </summary>
	/// <param name="playerId">Admin whose owl it is</param>
	/// <returns>True when there was one</returns>
	Stop(playerId)
	{
		return this.#flier.Stop(`${keyPrefix}${playerId}`);
	}
}

module.exports = { TestOwlService };
