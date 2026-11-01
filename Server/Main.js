// FranticDreamer 2026
"use strict";

const { Logger } = require("./Logger.js");
const Lang = require("./Lang.js");
const { LoadConfig, LoadPosts, GetClientConfig, postIdPattern } = require("./Config.js");
const { OwlDatabase } = require("./Database.js");
const { OwlDirectory, EnsureNumber, CreateCandidateNumber } = require("./Directory.js");
const { Outbox } = require("./Outbox.js");
const { SettingsService } = require("./Settings.js");
const { ContactService } = require("./Contacts.js");
const { ChatService } = require("./Chats.js");
const { InformService } = require("./Inform.js");
const { CallService } = require("./Calls.js");
const { ProfileService } = require("./Profiles.js");
const { BlockService } = require("./Blocks.js");
const { FlightPlanner } = require("./Flight.js");
const { SenderRegistry } = require("./Senders.js");
const { AuditLog } = require("./AuditLog.js");
const { LocationService, ReadArea } = require("./Locations.js");
const { NumberDialler } = require("./Numbers.js");
const { PostService } = require("./Posts.js");
const { MailService, ToDeskContact } = require("./Mail.js");
const { OwlRoster } = require("./Roster.js");
const { CreateApi } = require("./Api.js");
const { RequestDispatcher } = require("./Requests.js");
const { ParcelService } = require("./Parcels.js");
const { Ok } = require("./Result.js");

const resourceName = "frantic-owls";

/// <summary>
/// Key of the built-in sender that posts announcements.
/// </summary>
const ministryKey = "ministry";

/// <summary>
/// Entries per chunk when sending the contact and chat lists, so each fits the outbox's batch budget.
/// </summary>
const contactChunkSize = 25;
const chatChunkSize = 15;
const profileChunkSize = 40;
const languageChunkSize = 120;
const callChunkSize = 25;

/// <summary>
/// Characters numbered per round when backfilling owl numbers at start (backfillNumbers).
/// </summary>
const backfillBatchSize = 500;

/// <summary>
/// How often rate-limit buckets and expired cooldowns are swept.
/// </summary>
const maintenanceIntervalMs = 60000;

/// <summary>
/// How often owls older than storage.messageRetentionDays are pruned, when it is set.
/// </summary>
const pruneIntervalMs = 3600000;

const dayMs = 24 * 60 * 60 * 1000;

// ========================
// Imports & Services
// ========================

/// <summary>
/// Import an optional resource, which may not be installed or running.
/// </summary>
/// <param name="name">Resource name</param>
/// <returns>Its exports, or null</returns>
function ImportOptional(name)
{
	// Imports.get may throw for a resource that is not running; an optional integration simply stays off.
	try
	{
		const imported = Imports.get(name);
		return imported && Object.keys(imported).length > 0 ? imported : null;
	}
	catch (error)
	{
		return null;
	}
}

const hmp = Imports.get("hmp-lib");
const mysql = Imports.get("hmp-mysql");
const core = Imports.get("hmp-core");

Logger.Initialise(hmp.logger.create(resourceName));

const config = LoadConfig(hmp);
Lang.Load(config.defaultLanguage);

const clientConfig = GetClientConfig(config, Lang.List());
const database = new OwlDatabase(mysql, config.storage);
const directory = new OwlDirectory();
const outbox = new Outbox(config.network.flushIntervalMs, config.network.maxBatchBytes);
const audit = new AuditLog(config.logging);
const blocks = new BlockService(database);
const flight = new FlightPlanner(hmp, directory, config.flight);
const dialler = new NumberDialler(database, hmp, config.phonemode_numbers);
const settings = new SettingsService(database, config.phonemode_ui, directory, config.avatars);
const contacts = new ContactService(database, hmp, config.contacts, config.avatars, dialler);
const profiles = new ProfileService(database, directory, outbox, config.avatars);
const senders = new SenderRegistry(database, hmp, config.avatars, PushSendersToAll);
const locations = new LocationService(database, outbox, hmp, config.phonemode_locations, () => ImportOptional("hmp-blips"));
const parcels = new ParcelService({ database, directory, outbox, audit, config: config.attachments, GetInventory: () => ImportOptional("hmp-inventory"), Describe });
const chats = new ChatService({ database, directory, outbox, hmp, config, blocks, senders, flight, audit, locations, settings, dialler, parcels, hooks: { Describe, OnSent } });
const inform = new InformService({ directory, contacts, profiles, outbox, hmp, config: config.phonemode_inform, blocks, audit });
const calls = new CallService({ database, directory, outbox, hmp, config: config.phonemode_calls, blocks, audit, dialler, hooks: { Describe, OnCall } });
const requests = new RequestDispatcher(hmp, directory, outbox, config.network);
const posts = new PostService(hmp, config.immersivemode_posts, () => ImportOptional("hmp-interact"), OpenAtPost, Lang.Translate("", "mail.post.prompt"), () => ImportOptional("hmp-blips"));
const roster = new OwlRoster();
const mail = new MailService({ database, directory, chats, contacts, posts, senders, roster, audit, hmp, config, CanPostOfficial, parcels });

/// <summary>
/// True when players get the immersive letter desk instead of the phone (mode "immersive").
/// </summary>
const isImmersive = config.mode === "immersive";

/// <summary>
/// True once the database is migrated. Until then no owl is registered and every request is refused.
/// </summary>
let isReady = false;

/// <summary>
/// Settles with isReady once start-up finishes, so API calls made during start-up can wait for it.
/// </summary>
let ResolveReady = null;
const whenReady = new Promise((resolve) =>
{
	ResolveReady = resolve;
});

/// <summary>
/// Maintenance and pruning interval handles.
/// </summary>
let maintenanceTimer = null;
let pruneTimer = null;

/// <summary>
/// Activity IDs (hmp-activities) that silence notifications while they run; "*" means any activity.
/// </summary>
const quietActivities = new Set(config.notifications.quietActivities);

/// <summary>
/// Character load attempts in flight, keyed by player ID, so a stale load cannot register over a newer one.
/// </summary>
const loadTokens = new Map();

// ========================
// Helpers
// ========================

/// <summary>
/// Name an owl number for the Discord log: the character when online, the sender for official owls, otherwise just the number.
/// </summary>
/// <param name="number">Owl number</param>
/// <returns>Label</returns>
function Describe(number)
{
	const entry = directory.GetByNumber(number);

	if (entry)
	{
		return `${entry.characterName} (${number})`;
	}

	const senderName = senders.GetName(number);
	return senderName ? `${senderName} (official)` : `owl ${number || "?"}`;
}

/// <summary>
/// A text in the language of a player's owl, or in the server default when they have none loaded.
/// </summary>
/// <param name="player">Player</param>
/// <param name="key">Text key</param>
/// <param name="params">Parameters (optional)</param>
/// <returns>Translated text</returns>
function T(player, key, params = {})
{
	const entry = player ? directory.GetByPlayerId(player.id) : null;
	return Lang.Translate(entry ? entry.settings.language : "", key, params);
}

/// <summary>
/// Send a player every string of their language, then tell the page to redraw in it.
/// </summary>
/// <param name="entry">Directory entry</param>
function PushLanguage(entry)
{
	const table = Lang.GetTable(entry.settings.language);
	outbox.PushChunked(entry.player, "lang:chunk", "strings", Object.entries(table.strings), languageChunkSize);
	outbox.Push(entry.player, "lang:ready", { id: table.id });
}

/// <summary>
/// The running activity that keeps a player's phone quiet, if any (a duel, by default).
/// </summary>
/// <param name="playerId">Player ID</param>
/// <returns>{ label } of the activity, or null</returns>
function GetQuietActivity(playerId)
{
	const activities = quietActivities.size > 0 ? ImportOptional("hmp-activities") : null;

	if (!activities || !activities.sessions)
	{
		return null;
	}

	// Another resource's API; if it fails, the phone simply is not kept quiet.
	try
	{
		const session = activities.sessions.forPlayer(playerId).find((candidate) => candidate.state === "running" && (quietActivities.has("*") || quietActivities.has(candidate.activityId)));
		return session ? { label: String(session.activityLabel || session.title || "") } : null;
	}
	catch (error)
	{
		return null;
	}
}

/// <summary>
/// Tell the pages of some players whether a quiet activity is running for them.
/// </summary>
/// <param name="playerIds">Player IDs to check</param>
function PushQuiet(playerIds)
{
	for (const playerId of new Set(playerIds))
	{
		const entry = directory.GetByPlayerId(playerId);

		if (entry)
		{
			const activity = GetQuietActivity(playerId);
			outbox.Push(entry.player, "quiet:update", { active: !!activity, label: activity ? activity.label : "" });
		}
	}
}

/// <summary>
/// Retire the owl of a deleted character: its number is never given out again, it leaves its bulk owls and announcements,
/// and every related owl online is told it no longer flies. Its own data goes too when storage.disableSoftDelete is set.
/// </summary>
/// <param name="characterId">hmp-core character ID</param>
async function RetireCharacter(characterId)
{
	const number = await database.RetireNumber(characterId);

	if (!number)
	{
		return;
	}

	roster.Remove(number);
	const related = await database.ListRelatedNumbers(number) || [];
	const left = await chats.RetireOwl(number);
	await database.LeaveChannels(number);

	if (!database.IsSoftDelete())
	{
		await database.PurgeOwnData(number);
	}

	for (const other of related)
	{
		const target = directory.GetByNumber(other);

		if (target)
		{
			outbox.Push(target.player, "owl:retired", { number });
		}
	}

	audit.Log("system", "Owl retired", `The character of owl ${number} (character ${characterId}) was deleted; it left ${Math.max(0, left)} bulk owl(s).`);
	Logger.LogMessage("Main", `Retired owl ${number} of deleted character ${characterId}.`);
}

/// <summary>
/// Prune owls and call log entries older than storage.messageRetentionDays.
/// </summary>
async function PruneOldOwls()
{
	const days = config.storage.messageRetentionDays;

	if (days <= 0)
	{
		return;
	}

	const before = Date.now() - days * dayMs;
	const pruned = await database.PruneMessages(before);
	const prunedCalls = await database.PruneCalls(before);

	if (pruned > 0 || prunedCalls > 0)
	{
		Logger.LogMessage("Main", `${database.IsSoftDelete() ? "Hid" : "Deleted"} ${Math.max(0, pruned)} owl(s) and ${Math.max(0, prunedCalls)} call(s) older than ${days} day(s).`);
	}
}

/// <summary>
/// Let other server resources hear about every owl sent ("frantic-owls:sent").
/// </summary>
/// <param name="info">{ chatId, chatKind, messageId, sender, origin, recipients, body, sentAt, deliverAt }</param>
function OnSent(info)
{
	Events.emit("frantic-owls:sent", info).catch((error) => Logger.LogWarning("Main", `A "frantic-owls:sent" listener failed: ${Logger.Describe(error)}`));
}

/// <summary>
/// Let other server resources follow calls ("frantic-owls:call"), e.g. to carry their audio.
/// </summary>
/// <param name="info">{ callId, state, outcome, caller, callee, callerPlayerId, calleePlayerId, startedAt, answeredAt }</param>
function OnCall(info)
{
	Events.emit("frantic-owls:call", info).catch((error) => Logger.LogWarning("Main", `A "frantic-owls:call" listener failed: ${Logger.Describe(error)}`));
}

/// <summary>
/// Send the current system sender list to every owl online.
/// </summary>
function PushSendersToAll()
{
	const list = senders.GetClientList();

	for (const entry of directory.All())
	{
		outbox.Push(entry.player, "senders:update", { senders: list });
	}
}

/// <summary>
/// Whether a player passes a permission rule: the hmp-admin capability when hmp-admin is running, otherwise the hmp-core group.
/// </summary>
/// <param name="player">Player asking</param>
/// <param name="rule">{ capability, fallbackGroup, fallbackMinimumGrade }</param>
/// <param name="what">What is being checked, for the log</param>
/// <returns>True when allowed</returns>
async function HasPermission(player, rule, what)
{
	const admin = ImportOptional("hmp-admin");

	// Permission backends reject on internal failures; a failed check simply means "no".
	try
	{
		if (admin && admin.permissions && rule.capability)
		{
			return await admin.permissions.has(player, rule.capability);
		}

		if (rule.fallbackGroup)
		{
			return await core.groups.has(player, rule.fallbackGroup, rule.fallbackMinimumGrade);
		}
	}
	catch (error)
	{
		Logger.LogWarning("Main", `Could not check ${what} permission for player ${player.id}: ${Logger.Describe(error)}`);
	}

	return false;
}

/// <summary>
/// Whether a player may post announcements (announcements.capability).
/// </summary>
/// <param name="player">Player asking</param>
/// <returns>True when allowed</returns>
async function CanAnnounce(player)
{
	return HasPermission(player, config.announcements, "announcement");
}

/// <summary>
/// Whether a player may write official letters from immersive mode's desk: the same permission as /owl_announce, while announcements are on.
/// </summary>
/// <param name="player">Player asking</param>
/// <returns>True when allowed</returns>
async function CanPostOfficial(player)
{
	return config.announcements.enabled && await CanAnnounce(player);
}

/// <summary>
/// Show a contact on its owner's page straight away, if they are online, after another resource added it (see Api.AddContact).
/// </summary>
/// <param name="ownerNumber">Owl number of the owner</param>
/// <param name="contact">New contact record</param>
function OnContactAdded(ownerNumber, contact)
{
	const owner = directory.GetByNumber(ownerNumber);

	if (owner)
	{
		outbox.Push(owner.player, "contact:upsert", { contact: isImmersive ? ToDeskContact(contact, config.immersivemode_avatars) : contact });
	}
}

// ========================
// Owl Lifecycle
// ========================

/// <summary>
/// Send a player the complete phone state: who they are, their settings, blocks, senders, contacts, chat list, call log, the call they are in and informs awaiting their answer.
/// Sent after a character loads and whenever the client (re)starts and says hello.
/// </summary>
/// <param name="entry">Directory entry</param>
async function SendBootstrap(entry)
{
	if (isImmersive)
	{
		await SendImmersiveBootstrap(entry);
		return;
	}

	const [contactList, chatList, ownAvatar, visibleProfiles, blockList, retired, callLog] = await Promise.all([contacts.List(entry.number), chats.List(entry.number), profiles.GetOwnAvatar(entry.number), profiles.ListVisible(entry.number), blocks.List(entry.number), database.ListRetiredRelated(entry.number), calls.ListLog(entry.number)]);

	// The player may have switched character while the queries ran.
	if (directory.GetByPlayerId(entry.playerId) !== entry)
	{
		return;
	}

	// The strings go first, so the page draws its first screen in the player's language.
	PushLanguage(entry);

	if (!contactList || !chatList)
	{
		outbox.Push(entry.player, "notify", { kind: "error", titleKey: "app.name", bodyKey: "error.bootstrapFailed" });
	}

	const quiet = GetQuietActivity(entry.playerId);

	outbox.Push(entry.player, "state:reset",
	{
		me: { number: entry.number, name: entry.characterName, avatarUrl: ownAvatar },
		settings: entry.settings,
		config: clientConfig,
		blocks: blockList,
		retired,
		quiet: { active: !!quiet, label: quiet ? quiet.label : "" },
		senders: senders.GetClientList(),
		serverNow: Date.now(),
	});
	outbox.PushChunked(entry.player, "profiles:chunk", "profiles", visibleProfiles, profileChunkSize);
	outbox.PushChunked(entry.player, "contacts:chunk", "contacts", contactList || [], contactChunkSize);
	outbox.PushChunked(entry.player, "chats:chunk", "chats", chatList || [], chatChunkSize);
	outbox.PushChunked(entry.player, "calls:chunk", "entries", callLog || [], callChunkSize);
	outbox.Push(entry.player, "call:current", { call: calls.GetCurrent(entry.number) });
	outbox.Push(entry.player, "inform:requests", { requests: inform.ListPending(entry.number) });
	outbox.Push(entry.player, "state:ready", {});
}

/// <summary>
/// Send a player the state of immersive mode's letter desk: who they are, their settings, correspondents and how many letters wait unread.
/// Letters themselves are fetched a page at a time when the desk opens, since only the server may decide which can be read where.
/// </summary>
/// <param name="entry">Directory entry</param>
async function SendImmersiveBootstrap(entry)
{
	const [contactList, unread, canPostOfficial] = await Promise.all([contacts.List(entry.number), mail.CountUnread(entry.number), CanPostOfficial(entry.player)]);

	// The player may have switched character while the queries ran.
	if (directory.GetByPlayerId(entry.playerId) !== entry)
	{
		return;
	}

	PushLanguage(entry);

	if (!contactList)
	{
		outbox.Push(entry.player, "notify", { kind: "error", titleKey: "app.name", bodyKey: "error.bootstrapFailed" });
	}

	const quiet = GetQuietActivity(entry.playerId);

	// The owl number stays on the server: immersive pages address owls by name and the server checks every number they send.
	outbox.Push(entry.player, "state:reset",
	{
		me: { name: entry.characterName, canPostOfficial },
		settings: entry.settings,
		config: clientConfig,
		quiet: { active: !!quiet, label: quiet ? quiet.label : "" },
		unread,
		serverNow: Date.now(),
	});
	outbox.PushChunked(entry.player, "contacts:chunk", "contacts", (contactList || []).map((contact) => ToDeskContact(contact, config.immersivemode_avatars)), contactChunkSize);
	outbox.Push(entry.player, "state:ready", {});
}

/// <summary>
/// Open the letter desk for a player who used an owl post's prompt (hmp-interact).
/// </summary>
/// <param name="player">Player at the post</param>
/// <param name="post">Post record</param>
function OpenAtPost(player, post)
{
	if (!isReady || !directory.GetByPlayerId(player.id))
	{
		player.sendChat(`[${T(player, "app.name")}] ${T(player, "error.noOwl")}`);
		return;
	}

	outbox.Push(player, "ui:open", { post: { id: post.id, label: post.label } });
}

/// <summary>
/// Give a freshly loaded character their owl: assign or read the number, load settings, register and bootstrap.
/// </summary>
/// <param name="player">Owning player</param>
/// <param name="character">hmp-core character record</param>
async function LoadOwl(player, character)
{
	if (!isReady || !player || !character)
	{
		return;
	}

	const token = Symbol(character.id);
	loadTokens.set(player.id, token);

	const characterName = String(character.name || "Unknown Wizard");
	const number = await EnsureNumber(database, character.id);
	const loadedSettings = number ? await settings.Load(number) : null;

	// Every character is on the roster from its first load, so letters can find it by name from then on, online or not.
	if (number)
	{
		roster.Set(number, characterName);
		await database.SetNumberName(character.id, characterName);
	}

	// Another load or an unload happened while we were waiting on the database.
	if (loadTokens.get(player.id) !== token)
	{
		return;
	}

	loadTokens.delete(player.id);

	if (!number)
	{
		player.sendChat(`[${T(player, "app.name")}] ${T(player, "command.noNumber")}`);
		return;
	}

	const entry = directory.Register(player, character.id, characterName, number, loadedSettings);
	await SendBootstrap(entry);

	// Parcels that went back while this character was away are paid now they are here to receive them.
	parcels.PayReturns(entry).catch((error) => Logger.LogError("Main", `Paying returned parcels to ${entry.number} failed: ${Logger.Describe(error)}`));
}

/// <summary>
/// Take a player's owl offline (character unloaded or player left) and close their phone.
/// </summary>
/// <param name="player">Player whose owl goes offline</param>
/// <param name="notifyClient">Whether to tell the client to close and clear the phone</param>
function UnloadOwl(player, notifyClient)
{
	if (!player)
	{
		return;
	}

	loadTokens.delete(player.id);
	locations.Forget(player.id);
	const entry = directory.Unregister(player.id);

	if (entry)
	{
		calls.Drop(entry.number);
		mail.Forget(entry.number);
	}

	if (entry && notifyClient)
	{
		outbox.Push(player, "state:clear", {});
	}
}

/// <summary>
/// The "api" export, also behind the "frantic-owls:addContact" event.
/// </summary>
const api = CreateApi({ whenReady, senders, chats, directory, database, contacts, parcels, OnContactAdded });

// ========================
// Requests
// ========================

requests.Register("state.refresh", async (entry) =>
{
	await SendBootstrap(entry);
	return Ok();
});
requests.Register("contacts.delete", (entry, data) => contacts.Delete(entry, data));
requests.Register("settings.update", async (entry, data) =>
{
	const before = Lang.Resolve(entry.settings.language);
	const result = await settings.Update(entry, data);

	if (result.ok && Lang.Resolve(entry.settings.language) !== before)
	{
		PushLanguage(entry);
	}

	return result;
});

/// <summary>
/// The phone's requests, registered only in phone mode so an immersive page cannot reach features it does not offer.
/// </summary>
function RegisterPhoneRequests()
{
	requests.Register("parcels.collect", (entry, data) => parcels.Collect(entry, data));
	requests.Register("parcels.carriable", (entry) => parcels.ListCarriable(entry));
	requests.Register("contacts.update", (entry, data) => contacts.Update(entry, data));
	requests.Register("contacts.saveFromChat", (entry, data) => contacts.SaveFromChat(entry, data));
	requests.Register("contacts.favourite", (entry, data) => contacts.SetFavourite(entry, data));
	requests.Register("contacts.addByNumber", (entry, data) => contacts.AddByNumber(entry, data));
	requests.Register("chats.openDirect", (entry, data) => chats.OpenDirect(entry, data));
	requests.Register("chats.openNumber", (entry, data) => chats.OpenNumber(entry, data));
	requests.Register("chats.search", (entry, data) => chats.Search(entry, data));
	requests.Register("chats.createGroup", (entry, data) => chats.CreateGroup(entry, data));
	requests.Register("chats.history", (entry, data) => chats.History(entry, data));
	requests.Register("chats.read", (entry, data) => chats.MarkRead(entry, data));
	requests.Register("chats.leave", (entry, data) => chats.Leave(entry, data));
	requests.Register("chats.mute", (entry, data) => chats.Mute(entry, data));
	requests.Register("chats.pin", (entry, data) => chats.PinChat(entry, data));
	requests.Register("chats.typing", (entry, data) => chats.Typing(entry, data));
	requests.Register("groups.rename", (entry, data) => chats.Rename(entry, data));
	requests.Register("groups.picture", (entry, data) => chats.SetPicture(entry, data));
	requests.Register("groups.addMembers", (entry, data) => chats.AddMembers(entry, data));
	requests.Register("groups.removeMember", (entry, data) => chats.RemoveMember(entry, data));
	requests.Register("groups.setAdmin", (entry, data) => chats.SetAdmin(entry, data));
	requests.Register("messages.send", (entry, data) => chats.Send(entry, data));
	requests.Register("messages.sendLocation", (entry, data) => chats.SendLocation(entry, data));
	requests.Register("messages.unsend", (entry, data) => chats.Unsend(entry, data));
	requests.Register("messages.hide", (entry, data) => chats.Hide(entry, data));
	requests.Register("messages.pin", (entry, data) => chats.PinMessage(entry, data));
	requests.Register("messages.forward", (entry, data) => chats.Forward(entry, data));
	requests.Register("messages.sendPoll", (entry, data) => chats.SendPoll(entry, data));
	requests.Register("polls.vote", (entry, data) => chats.Vote(entry, data));
	requests.Register("locations.show", (entry, data) => locations.Show(entry, data));
	requests.Register("locations.hide", (entry, data) => locations.Hide(entry, data));
	requests.Register("inform.nearby", (entry) => inform.ListNearby(entry));
	requests.Register("inform.send", (entry, data) => inform.Send(entry, data));
	requests.Register("inform.respond", (entry, data) => inform.Respond(entry, data));
	requests.Register("calls.start", (entry, data) => calls.Start(entry, data));
	requests.Register("calls.answer", (entry, data) => calls.Answer(entry, data));
	requests.Register("calls.hangup", (entry, data) => calls.Hangup(entry, data));
	requests.Register("calls.mute", (entry, data) => calls.SetMuted(entry, data));
	requests.Register("calls.seen", (entry) => calls.MarkSeen(entry));
	requests.Register("calls.clear", (entry, data) => calls.Clear(entry, data));
	requests.Register("profile.update", (entry, data) => profiles.Update(entry, data));
	requests.Register("profiles.lookup", (entry, data) => profiles.Lookup(entry, data));

	requests.Register("blocks.add", async (entry, data) =>
	{
		const result = await blocks.Add(entry, data);

		if (result.ok)
		{
			calls.EndBetween(entry.number, result.data.number);
			audit.Log("blocks", "Owl blocked", `${Describe(entry.number)} blocked ${Describe(result.data.number)}.`);
		}

		return result;
	});

	requests.Register("blocks.remove", async (entry, data) =>
	{
		const result = await blocks.Remove(entry, data);

		if (result.ok)
		{
			audit.Log("blocks", "Owl unblocked", `${Describe(entry.number)} unblocked ${Describe(result.data.number)}.`);
		}

		return result;
	});
}

/// <summary>
/// The letter desk's requests, registered only in immersive mode.
/// </summary>
function RegisterImmersiveRequests()
{
	// A letter's parcel follows its text's reading rules (owl posts), so the desk collects through the mail service.
	requests.Register("parcels.collect", (entry, data) => mail.Collect(entry, data));
	requests.Register("parcels.carriable", (entry) => parcels.ListCarriable(entry));
	requests.Register("mail.list", (entry, data) => mail.List(entry, data));
	requests.Register("mail.open", (entry, data) => mail.Open(entry, data));
	requests.Register("mail.send", (entry, data) => mail.Send(entry, data));
	requests.Register("mail.place", (entry) => mail.GetPlace(entry));
	requests.Register("mail.search", (entry, data) => mail.Search(entry, data));
	requests.Register("mail.addCorrespondent", (entry, data) => mail.AddCorrespondent(entry, data));
	requests.Register("mail.officialSenders", (entry) => mail.ListOfficialSenders(entry));
	requests.Register("mail.sendOfficial", (entry, data) => mail.SendOfficial(entry, data));

	// Staff rights can change while a character stays loaded (an /admin unlock, a promotion), so the desk asks again each time it opens.
	requests.Register("me.refresh", async (entry) => Ok({ canPostOfficial: await CanPostOfficial(entry.player) }));
	requests.Register("contacts.favourite", (entry, data) => contacts.SetFavourite(entry, data));

	// Correspondents are renamed like the phone's contacts, but never moved to another number, and only get pictures where the server allows them.
	requests.Register("contacts.update", async (entry, data) =>
	{
		const result = await contacts.Update(entry, { contactId: data.contactId, name: data.name, avatarUrl: config.immersivemode_avatars ? data.avatarUrl : undefined });
		return result.ok ? Ok({ contact: ToDeskContact(result.data.contact, config.immersivemode_avatars) }) : result;
	});
}

if (isImmersive)
{
	RegisterImmersiveRequests();
}
else
{
	RegisterPhoneRequests();
}

// ========================
// Commands
// ========================

// Descriptions and the prefix are shared by everyone, so they use the server's default language; replies use each player's own.
const commands = hmp.command.createRouter({ prefix: `[${Lang.Translate("", "app.name")}]` });

commands.register(config.command, { description: Lang.Translate("", "command.openDescription"), usage: `/${config.command}` }, ({ player, reply }) =>
{
	if (!isReady)
	{
		return reply(T(player, "command.closed"));
	}

	if (!directory.GetByPlayerId(player.id))
	{
		return reply(T(player, "error.noOwl"));
	}

	// Standing at an owl post counts even when the desk is opened with the command rather than the post's prompt.
	outbox.Push(player, "ui:open", isImmersive ? { post: mail.GetPost(player) } : {});
	return true;
});

if (isImmersive)
{
	const postHereUsage = `/${config.command}_posthere <id> [label]`;

	// Prints the immersivemode_posts entry for where the admin stands, to paste into the configuration.
	commands.register(`${config.command}_posthere`, { description: Lang.Translate("", "command.postHereDescription"), usage: postHereUsage }, async ({ player, args, reply }) =>
	{
		if (!await HasPermission(player, config.immersivemode_postadmin, "owl post"))
		{
			return reply(T(player, "command.adminDenied"));
		}

		const id = String(args[0] || "").trim().toLowerCase();

		if (!id)
		{
			return reply(T(player, "command.usage", { usage: postHereUsage }));
		}

		if (!postIdPattern.test(id))
		{
			return reply(T(player, "command.postHereBadId"));
		}

		// player.location() also carries the heading and the map; hmp.position is the fallback for the coordinates alone.
		const location = typeof player.location === "function" ? player.location() : null;
		const position = location && [location.x, location.y, location.z].every(Number.isFinite) ? location : hmp.position.read(player);

		if (!position)
		{
			return reply(T(player, "command.postHereNoPosition"));
		}

		const label = args.slice(1).join(" ").trim().slice(0, 64);
		const { areaId, regionId } = ReadArea(player);
		const definition = { id, label: label || id, position: { x: Math.round(position.x), y: Math.round(position.y), z: Math.round(position.z) } };

		// Coordinates only mean a place within their own map, so the post is tied to the map it was made on.
		if (areaId)
		{
			definition.areaId = areaId;
		}

		if (regionId)
		{
			definition.regionId = regionId;
		}

		definition.radiusMetres = 3;
		definition.yaw = location && Number.isFinite(location.yaw) ? Math.round(location.yaw * 10) / 10 : 0;

		const json = JSON.stringify(definition);
		const isTaken = posts.GetPosts().some((post) => post.id === id);
		Logger.LogMessage("Posts", `Owl post definition from ${player.nickname} (player ${player.id}): ${json}`);

		// Shown on the desk in a box with a copy button, since chat text cannot be copied in game.
		if (isReady && directory.GetByPlayerId(player.id))
		{
			outbox.Push(player, "ui:open", { post: mail.GetPost(player) });
			outbox.Push(player, "admin:postDefinition", { id, json: JSON.stringify(definition, null, "\t"), isTaken });
			return true;
		}

		// Without an owl there is no desk to show it on, so it goes to chat (and the server log) instead.
		if (isTaken)
		{
			reply(T(player, "command.postHereTaken", { id }));
		}

		reply(T(player, "command.postHereDone"));
		return reply(json);
	});

	// Reads immersivemode_posts from the file again and puts the posts up in the world, without restarting the resource.
	commands.register(`${config.command}_reloadposts`, { description: Lang.Translate("", "command.reloadPostsDescription"), usage: `/${config.command}_reloadposts` }, async ({ player, reply }) =>
	{
		if (!await HasPermission(player, config.immersivemode_postadmin, "owl post"))
		{
			return reply(T(player, "command.adminDenied"));
		}

		if (!isReady)
		{
			return reply(T(player, "command.closed"));
		}

		const list = LoadPosts(hmp);

		if (list === null)
		{
			return reply(T(player, "command.reloadPostsFailed"));
		}

		config.immersivemode_posts = list;
		posts.SetPosts(list);
		Logger.LogMessage("Posts", `${player.nickname} (player ${player.id}) reloaded the owl posts: ${list.length} loaded.`);

		if (list.length === 0 && (config.immersivemode_readmode !== "free" || config.immersivemode_writemode !== "free"))
		{
			reply(T(player, "command.reloadPostsNone"));
		}

		return reply(T(player, "command.reloadPostsDone", { count: list.length }));
	});
}

// The letter desk always sits in the middle of the screen; only the phone can be moved.
if (!isImmersive)
{
	commands.register(`${config.command}_resetpos`, { description: Lang.Translate("", "command.resetDescription"), usage: `/${config.command}_resetpos` }, async ({ player, reply }) =>
	{
		const entry = directory.GetByPlayerId(player.id);

		if (!entry)
		{
			return reply(T(player, "error.noOwl"));
		}

		if (!await settings.ResetLayout(entry))
		{
			return reply(T(player, "command.resetFailed"));
		}

		outbox.Push(player, "settings:update", { settings: entry.settings });
		return reply(T(player, "command.resetDone"));
	});
}

if (config.announcements.enabled)
{
	const usage = `/${config.announcements.command} <message>`;

	commands.register(config.announcements.command, { description: Lang.Translate("", "command.announceDescription", { sender: config.announcements.senderName }), usage }, async ({ player, message, reply }) =>
	{
		if (!await CanAnnounce(player))
		{
			return reply(T(player, "command.announceDenied"));
		}

		// The whole line after the command, so spacing inside the announcement is kept.
		const spaceIndex = message.indexOf(" ");
		const body = spaceIndex < 0 ? "" : message.slice(spaceIndex + 1).trim();

		if (!body)
		{
			return reply(T(player, "command.usage", { usage }));
		}

		const ministry = senders.Get(ministryKey);

		if (!isReady || !ministry)
		{
			return reply(T(player, "command.announceClosed"));
		}

		const result = await chats.Broadcast(ministry, body);

		if (!result.ok)
		{
			return reply(T(player, "command.announceFailed", { error: result.error }));
		}

		audit.Log("announcements", "Announcement sent", `Sent by ${player.nickname} (player ${player.id}) as ${config.announcements.senderName}.`);
		return reply(T(player, "command.announceSent", { sender: config.announcements.senderName }));
	});
}

// ========================
// Events
// ========================

Events.on("chatCommand", commands.handle);

Events.on("hmp:character:loaded", ({ session, character }) =>
{
	LoadOwl(session.player, character).catch((error) => Logger.LogError("Main", `Loading the owl of player ${session.playerId} failed: ${Logger.Describe(error)}`));
});

Events.on("hmp:character:unloading", ({ session }) => UnloadOwl(session.player, true));

// Other resources can add contacts without importing the API: Events.emit("frantic-owls:addContact", { owner, contact, name?, revealName? }) with the same fields as Api.AddContact.
Events.on("frantic-owls:addContact", (request) =>
{
	api.AddContact(request).then((result) =>
	{
		if (!result.ok)
		{
			Logger.LogWarning("Main", `A "frantic-owls:addContact" event was refused: ${result.error}`);
		}
	});
});

Events.on("hmp:character:deleted", ({ character }) =>
{
	if (!isReady || !character)
	{
		return;
	}

	RetireCharacter(Number(character.id)).catch((error) => Logger.LogError("Main", `Retiring the owl of character ${character.id} failed: ${Logger.Describe(error)}`));
});

// Duels (and any other activity in notifications.quietActivities) keep the phone quiet while they run.
for (const eventName of ["hmp:activities:started", "hmp:activities:joined", "hmp:activities:left", "hmp:activities:completed", "hmp:activities:cancelled"])
{
	Events.on(eventName, (payload) =>
	{
		if (!isReady || quietActivities.size === 0 || !payload || !payload.session)
		{
			return;
		}

		const participants = Array.isArray(payload.session.participants) ? payload.session.participants.map((participant) => participant.playerId) : [];
		PushQuiet(payload.player ? [...participants, payload.player.id] : participants);
	});
}

Events.on("playerDisconnect", (player) =>
{
	UnloadOwl(player, false);
	outbox.Forget(player.id);
	requests.Forget(player.id);
});

Events.onClient("frantic-owls:hello", (player) =>
{
	const entry = directory.GetByPlayerId(player.id);

	if (entry)
	{
		SendBootstrap(entry).catch((error) => Logger.LogError("Main", `Bootstrap for player ${player.id} failed: ${Logger.Describe(error)}`));
	}
});

// Voice skips the request dispatcher on purpose: it is fire-and-forget, needs no reply, and arrives about 17 times a second per talking player.
Events.onClient("frantic-owls:voice", (player, raw) => calls.RelayVoice(player, raw));

Events.onClient("frantic-owls:request", (player, raw) =>
{
	requests.Handle(player, raw).catch((error) => Logger.LogError("Main", `Request from player ${player.id} failed: ${Logger.Describe(error)}`));
});

/// <summary>
/// Bring the owl post up: database, senders, logging, flights, then every character already loaded.
/// </summary>
/// <returns>True when ready</returns>
async function Start()
{
	if (!await database.Initialise())
	{
		Logger.LogError("Main", "Owl Post is disabled until the database is available.");
		return false;
	}

	await senders.Load();

	if (config.announcements.enabled)
	{
		let result = await senders.Register({ resource: resourceName, key: ministryKey, name: config.announcements.senderName, avatarUrl: config.announcements.avatarUrl });

		// A bad picture link in the config should not cost the server its announcements.
		if (!result.ok && config.announcements.avatarUrl)
		{
			Logger.LogWarning("Main", `announcements.avatarUrl was refused (${result.error}); the Ministry will use initials.`);
			result = await senders.Register({ resource: resourceName, key: ministryKey, name: config.announcements.senderName, avatarUrl: "" });
		}

		if (!result.ok)
		{
			Logger.LogError("Main", `The Ministry sender could not be registered: ${result.error}`);
		}
	}

	audit.Start(ImportOptional("hmp-webhooks"));

	// A crash between a parcel's journal step and its Galleons moving is settled before any owl loads (see ParcelState).
	await parcels.Recover();

	// Pages offer parcels only when owls can carry something here: switched on, and hmp-inventory running.
	if (!parcels.IsRunning())
	{
		clientConfig.parcels = null;
	}

	isReady = true;
	outbox.Start();
	await chats.RestoreFlights();

	maintenanceTimer = setInterval(() =>
	{
		chats.Sweep();
		inform.Sweep();
		calls.Sweep();
		dialler.Sweep();
		mail.Sweep();
		requests.Sweep();
		parcels.Sweep().catch((error) => Logger.LogError("Main", `Returning parcels failed: ${Logger.Describe(error)}`));
	}, maintenanceIntervalMs);

	// Characters deleted while the owl post was closed never raised hmp:character:deleted for us.
	for (const characterId of await database.ListDeletedCharacters())
	{
		await RetireCharacter(characterId);
	}

	// Names changed while the owl post was closed, and numbers from before names were kept, are caught up from hmp-core.
	await database.SyncNumberNames();

	// Characters that have not loaded since the owl post was installed get their number now, so they can be found and written to like anyone else.
	if (config.backfillNumbers)
	{
		const numbered = await database.BackfillNumbers(CreateCandidateNumber, backfillBatchSize);

		if (numbered > 0)
		{
			Logger.LogMessage("Main", `Gave owl numbers to ${numbered} character(s) that had not loaded since the owl post was installed.`);
		}
	}

	if (isImmersive)
	{
		roster.Load(await database.ListNamedNumbers() || []);
	}

	if (config.storage.messageRetentionDays > 0)
	{
		await PruneOldOwls();
		pruneTimer = setInterval(() => PruneOldOwls().catch((error) => Logger.LogError("Main", `Pruning old owls failed: ${Logger.Describe(error)}`)), pruneIntervalMs);
	}

	// Characters loaded before this resource (re)started never raised hmp:character:loaded for us.
	for (const session of core.sessions.all())
	{
		if (session.character)
		{
			await LoadOwl(session.player, session.character);
		}
	}

	if (isImmersive)
	{
		posts.Register();
	}

	const rosterNote = isImmersive ? ` and ${roster.GetCount()} on the roster` : "";
	Logger.LogSuccess("Main", `Owl Post is open in ${config.mode} mode with ${directory.GetCount()} owl(s) online${rosterNote}. Players use /${config.command}.`);
	return true;
}

Events.on("resourceStart", async (name) =>
{
	// Re-publish post markers when the optional marker registry becomes available again.
	if (name === "hmp-blips" && isImmersive && isReady)
	{
		posts.RefreshBlips();
		return;
	}

	// hmp-interact forgets every prompt when it restarts, so the owl posts are offered again.
	if (name === "hmp-interact" && isImmersive && isReady)
	{
		posts.Register();
		return;
	}

	if (name !== resourceName)
	{
		return;
	}

	ResolveReady(await Start());
});

Events.on("resourceStop", (name) =>
{
	if (name !== resourceName)
	{
		// Senders and parcel rules belong to the resource that registered them.
		senders.UnregisterResource(name);
		parcels.UnregisterRules(name);

		if (name === "hmp-blips")
		{
			posts.ClearBlips();
		}

		// hmp-interact takes its prompts with it when it stops.
		if (name === "hmp-interact")
		{
			posts.Forget();
		}

		return;
	}

	if (maintenanceTimer !== null)
	{
		clearInterval(maintenanceTimer);
		maintenanceTimer = null;
	}

	if (pruneTimer !== null)
	{
		clearInterval(pruneTimer);
		pruneTimer = null;
	}

	chats.StopFlights();
	calls.Stop();
	posts.Unregister();
	audit.Stop();
	outbox.Stop();
});

// ========================
// Exports
// ========================

/// <summary>
/// Report the resource's state, for admin tooling and health checks.
/// </summary>
/// <returns>{ ready, owlsOnline, mode } where mode is the front end players get ("phone" or "immersive")</returns>
function GetStatus()
{
	return { ready: isReady, owlsOnline: directory.GetCount(), mode: config.mode };
}

Exports.register("status", GetStatus);
Exports.register("api", api);
