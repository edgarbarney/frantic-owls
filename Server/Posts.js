// FranticDreamer 2026
"use strict";

const { Logger } = require("./Logger.js");
const { ReadArea } = require("./Locations.js");

/// <summary>
/// HogwartsMP world units per metre (positions are in centimetres).
/// </summary>
const unitsPerMetre = 100;

/// <summary>
/// Extra distance allowed on top of a post's radius when the server checks a request, so a player who opened the desk at the edge of the zone is not refused a moment later.
/// </summary>
const toleranceMetres = 1;

/// <summary>
/// Prefix of every interaction this resource registers with hmp-interact. Interaction IDs are global, so they carry the resource's name.
/// </summary>
const interactionPrefix = "frantic-owls.post.";

/// <summary>
/// Native perched owl Blueprint placed above enabled posts.
/// </summary>
const owlModel = "/Game/Gameplay/Stations/Interaction/MailInteraction/BP_PropOwl_OwlStation.BP_PropOwl_OwlStation_C";

/// <summary>
/// Native Field Guide page icon; the game's asset names it Waypoint.
/// </summary>
const postBlipIcon = "UI_T_MiniMap_Waypoint";

// ========================
// Owl Posts
// ========================

/// <summary>
/// The owl posts of immersive mode (immersivemode_posts): places where letters may be read and written when the server only allows that there.
///
/// <para>
/// NOTE: A post is offered in the world through hmp-interact (walk up and press its key), which opens the writing desk there.
/// That prompt is only a convenience: every read and write is checked against the player's position again on the server, so a page cannot claim to be at a post.
/// hmp-interact is optional; without it posts still count, but players open the desk with the command while standing at one.
/// </para>
///
/// </summary>
class PostService
{
	/// <summary>
	/// Clean posts from the configuration.
	/// </summary>
	#posts;

	/// <summary>
	/// hmp-lib server import, for positions.
	/// </summary>
	#hmp;

	/// <summary>
	/// Returns the hmp-interact import, or null when it is not running.
	/// </summary>
	#GetInteract;

	/// <summary>
	/// Called with (player, post) when a player uses a post's prompt.
	/// </summary>
	#OnUse;

	/// <summary>
	/// Prompt text shown at every post, in the server's default language.
	/// </summary>
	#promptLabel;

	/// <summary>
	/// Disposers of the interactions registered with hmp-interact.
	/// </summary>
	#registered = [];

	/// <summary>
	/// Owl props owned by this resource, independently of hmp-interact.
	/// </summary>
	#owls = [];

	/// <summary>
	/// Returns hmp-blips while it is running.
	/// </summary>
	#GetBlips;

	/// <summary>
	/// Marker registrations owned by the posts, separate from shared-location markers.
	/// </summary>
	#blips = [];

	/// <summary>
	/// Serialises asynchronous marker publication so an older reload cannot remove a newer marker with the same ID.
	/// </summary>
	#blipQueue = Promise.resolve();

	/// <summary>
	/// Invalidates queued work when posts reload, the dependency restarts or the resource stops.
	/// </summary>
	#blipRevision = 0;

	/// <summary>
	/// Constructor.
	/// </summary>
	/// <param name="hmp">hmp-lib server import</param>
	/// <param name="posts">The "immersivemode_posts" list of the server config, already cleaned</param>
	/// <param name="GetInteract">Function returning the hmp-interact import, or null</param>
	/// <param name="OnUse">Function receiving (player, post) when a post's prompt is used</param>
	/// <param name="promptLabel">Prompt text shown at every post</param>
	/// <param name="GetBlips">Function returning the optional hmp-blips import</param>
	constructor(hmp, posts, GetInteract, OnUse, promptLabel, GetBlips = () => null)
	{
		this.#hmp = hmp;
		this.#posts = posts;
		this.#GetInteract = GetInteract;
		this.#OnUse = OnUse;
		this.#promptLabel = promptLabel;
		this.#GetBlips = GetBlips;
	}

	/// <summary>
	/// Replace the posts, e.g. after they were reloaded from the configuration, and offer the new ones in the world.
	/// </summary>
	/// <param name="posts">Clean list of posts</param>
	SetPosts(posts)
	{
		this.#posts = posts;
		this.Register();
	}

	/// <summary>
	/// Every post, as configured.
	/// </summary>
	/// <returns>Post records (not to be modified)</returns>
	GetPosts()
	{
		return this.#posts;
	}

	/// <summary>
	/// Whether any post is configured.
	/// </summary>
	/// <returns>True when there is at least one</returns>
	HasPosts()
	{
		return this.#posts.length > 0;
	}

	/// <summary>
	/// Replace owl props and blips, and offer every post through hmp-interact when it is running.
	/// </summary>
	Register()
	{
		this.Unregister();
		this.RefreshBlips();

		for (const post of this.#posts)
		{
			if (post.spawnOwl)
			{
				this.#SpawnOwl(post);
			}
		}

		const interact = this.#posts.length > 0 ? this.#GetInteract() : null;

		if (!interact || typeof interact.register !== "function")
		{
			if (this.#posts.length > 0)
			{
				Logger.LogMessage("Posts", "hmp-interact is not running, so owl posts have no prompt; players open the desk with the command while standing at one.");
			}

			return;
		}

		for (const post of this.#posts)
		{
			const registration =
			{
				id: `${interactionPrefix}${post.id}`,
				resource: "frantic-owls",
				label: this.#promptLabel,
				description: post.label,
				position: { ...post.position },
				radius: post.radiusMetres * unitsPerMetre,
				requirements: { character: true },
				handler: ({ player }) => this.#OnUse(player, post),
			};

			if (post.areaId)
			{
				registration.areaId = post.areaId;
			}

			if (post.regionId)
			{
				registration.regionId = post.regionId;
			}

			if (post.model)
			{
				registration.object = { model: post.model, yaw: post.yaw, collision: true };
			}

			// hmp-interact throws on a malformed registration (e.g. a model path not in /Root/Dir/Name.Name form); one bad post should not cost the others theirs.
			try
			{
				const unregister = interact.register(registration);
				this.#registered.push(typeof unregister === "function" ? unregister : () => interact.unregister(registration.id));
			}
			catch (error)
			{
				Logger.LogWarning("Posts", `Owl post "${post.id}" could not be offered through hmp-interact: ${Logger.Describe(error)}`);
			}
		}

		Logger.LogMessage("Posts", `${this.#registered.length} owl post(s) offered through hmp-interact.`);
	}

	/// <summary>
	/// Replace post markers through hmp-blips without changing props or interaction prompts.
	/// </summary>
	/// <returns>Promise settled after this refresh, for callers that need to wait for publication</returns>
	RefreshBlips()
	{
		this.ClearBlips();
		const revision = this.#blipRevision;
		const posts = this.#posts.filter((post) => post.showBlip);

		this.#blipQueue = this.#blipQueue.then(async () =>
		{
			if (revision !== this.#blipRevision || posts.length === 0)
			{
				return;
			}

			const blips = this.#GetBlips();

			if (!blips || !blips.markers)
			{
				Logger.LogWarning("Posts", "hmp-blips is not running, so enabled owl post blips cannot be shown.");
				return;
			}

			for (const post of posts)
			{
				const id = `post.${post.id}`;

				// Track before awaiting: a reload or stop must also remove a marker whose publication is still in progress.
				this.#blips.push({ api: blips.markers, id });

				try
				{
					await blips.markers.upsert
					({
						resource: "frantic-owls",
						id,
						kind: "marker",
						position: { ...post.position },
						icon: postBlipIcon,
						label: post.label,
						ttl: 0,
						// Keep the marker visible outside the post's region, but only within its own map.
						areaId: post.areaId || "Overland",
						virtualWorld: 0,
						showOnHud: false,
						showDistance: false,
					});
				}
				catch (error)
				{
					Logger.LogWarning("Posts", `Blip for owl post "${post.id}" could not be placed: ${Logger.Describe(error)}`);
				}

				if (revision !== this.#blipRevision)
				{
					// A dependency can finish publishing after removal; remove again before the next refresh reuses this ID.
					this.#RemoveBlip({ api: blips.markers, id });
					return;
				}
			}
		}).catch((error) => Logger.LogWarning("Posts", `Owl post blips could not be refreshed: ${Logger.Describe(error)}`));

		return this.#blipQueue;
	}

	/// <summary>
	/// Remove only owl post markers and cancel pending publication, including when hmp-blips stops.
	/// </summary>
	ClearBlips()
	{
		this.#blipRevision++;

		for (const blip of this.#blips)
		{
			this.#RemoveBlip(blip);
		}

		this.#blips = [];
	}

	/// <summary>
	/// Remove one owned marker without letting a stopped dependency interrupt other cleanup.
	/// </summary>
	/// <param name="blip">Marker API and local ID</param>
	#RemoveBlip(blip)
	{
		try
		{
			blip.api.remove(blip.id, "frantic-owls");
		}
		catch (error)
		{
			Logger.LogWarning("Posts", `An owl post blip could not be removed: ${Logger.Describe(error)}`);
		}
	}

	/// <summary>
	/// Place an owl at the post position plus its world-axis offset.
	/// </summary>
	/// <param name="post">Clean post record</param>
	#SpawnOwl(post)
	{
		try
		{
			const owl = WorldObject.create(`${interactionPrefix}${post.id}.owl`, owlModel,
			{
				x: post.position.x + post.owlOffset.x,
				y: post.position.y + post.owlOffset.y,
				z: post.position.z + post.owlOffset.z,
				yaw: post.yaw,
				collision: false,
			});

			if (!owl)
			{
				Logger.LogWarning("Posts", `Owl prop for post "${post.id}" could not be created.`);
				return;
			}

			// Keep the handle before setting the map so a failed map assignment can still be cleaned up.
			this.#owls.push(owl);
			owl.setVirtualWorld(0, post.areaId || "Overland");
		}
		catch (error)
		{
			Logger.LogWarning("Posts", `Owl prop for post "${post.id}" could not be placed: ${Logger.Describe(error)}`);
		}
	}

	/// <summary>
	/// Take every post's prompt, owl prop and blip down again.
	/// </summary>
	Unregister()
	{
		this.ClearBlips();

		for (const owl of this.#owls)
		{
			try
			{
				owl.destroy();
			}
			catch (error)
			{
				Logger.LogWarning("Posts", `An owl prop could not be removed: ${Logger.Describe(error)}`);
			}
		}

		this.#owls = [];

		for (const unregister of this.#registered)
		{
			// The interaction may already be gone (hmp-interact stopped first); there is nothing left to take down then.
			try
			{
				unregister();
			}
			catch (error)
			{
				Logger.LogWarning("Posts", `An owl post prompt could not be removed: ${Logger.Describe(error)}`);
			}
		}

		this.#registered = [];
	}

	/// <summary>
	/// Forget the registrations without calling hmp-interact, for when it stopped and took them with it.
	/// </summary>
	Forget()
	{
		this.#registered = [];
	}

	/// <summary>
	/// The post a player is standing at, if any.
	/// </summary>
	/// <param name="player">Player handle</param>
	/// <returns>Post record, or null when they stand at none (or their position is unknown)</returns>
	GetPostAt(player)
	{
		if (!player || this.#posts.length === 0)
		{
			return null;
		}

		const position = this.#hmp.position.read(player);

		if (!position)
		{
			return null;
		}

		const { areaId, regionId } = ReadArea(player);

		for (const post of this.#posts)
		{
			// Coordinates only mean a place within their own map, so a post tied to an area (or region) only counts there.
			if ((post.areaId && post.areaId !== areaId) || (post.regionId && post.regionId !== regionId))
			{
				continue;
			}

			if (this.#hmp.position.distance(position, post.position) / unitsPerMetre <= post.radiusMetres + toleranceMetres)
			{
				return post;
			}
		}

		return null;
	}
}

module.exports = { PostService };
