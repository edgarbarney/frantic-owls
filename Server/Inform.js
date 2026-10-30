// FranticDreamer 2026
"use strict";

const { Ok, Fail } = require("./Result.js");
const { Problem } = require("./Lang.js");
const { ClampInteger } = require("./Config.js");
const { AddContactStatus } = require("./Contacts.js");
const { GetDistanceMetres } = require("./Directory.js");

/// <summary>
/// Most informs one owl can have waiting for an answer at once, so a crowd cannot bury them in requests.
/// </summary>
const maxPendingPerReceiver = 10;

/// <summary>
/// Answers a receiver can give to an inform that asks for consent.
/// </summary>
const InformChoice = Object.freeze
({
	Accept: "accept",
	Exchange: "exchange",
	Decline: "decline",
});

// ========================
// Inform Service
// ========================

/// <summary>
/// Inform: hand your owl (contact) to a player standing near you.
/// With inform.requireConsent (the default) the receiver is asked first and may accept it, exchange owls (accept and give theirs back) or decline.
/// Without it, the owl lands in their contacts under your character's name straight away.
///
/// <para>
/// NOTE: The cooldown is per sender and receiver pair, so informing a whole room at once is fine,
/// but repeatedly informing the same person is not; that would be a notification spam vector.
/// A failed, declined or already-known inform still starts the cooldown for the same reason.
/// </para>
///
/// <para>
/// NOTE: Waiting requests live in memory only. They expire after inform.requestSeconds anyway,
/// and a restart losing them just means the sender informs again.
/// </para>
///
/// </summary>
class InformService
{
	/// <summary>
	/// OwlDirectory instance.
	/// </summary>
	#directory;

	/// <summary>
	/// ContactService instance.
	/// </summary>
	#contacts;

	/// <summary>
	/// ProfileService instance, for the sender's picture on a request.
	/// </summary>
	#profiles;

	/// <summary>
	/// Outbox instance.
	/// </summary>
	#outbox;

	/// <summary>
	/// hmp-lib server import, for positions.
	/// </summary>
	#hmp;

	/// <summary>
	/// The "phonemode_inform" section of the server config.
	/// </summary>
	#config;

	/// <summary>
	/// BlockService instance.
	/// </summary>
	#blocks;

	/// <summary>
	/// AuditLog instance.
	/// </summary>
	#audit;

	/// <summary>
	/// When each sender last informed each receiver: "sender>receiver" owl numbers to epoch milliseconds.
	/// </summary>
	#lastShared = new Map();

	/// <summary>
	/// Informs waiting for the receiver's answer, by request ID: { id, fromNumber, fromName, toNumber, toName, avatarUrl, expiresAt }.
	/// </summary>
	#requests = new Map();

	/// <summary>
	/// ID of the next request. IDs are never reused while the resource runs, so a stale answer cannot hit a newer request.
	/// </summary>
	#nextRequestId = 1;

	/// <summary>
	/// Seconds left before a sender may inform a receiver again.
	/// </summary>
	/// <param name="senderNumber">Sender's owl number</param>
	/// <param name="receiverNumber">Receiver's owl number</param>
	/// <returns>Whole seconds remaining, 0 when allowed</returns>
	#GetCooldownSeconds(senderNumber, receiverNumber)
	{
		const last = this.#lastShared.get(`${senderNumber}>${receiverNumber}`);

		if (last === undefined)
		{
			return 0;
		}

		const remainingMs = last + this.#config.cooldownSeconds * 1000 - Date.now();
		return remainingMs > 0 ? Math.ceil(remainingMs / 1000) : 0;
	}

	/// <summary>
	/// The page's view of a waiting request.
	/// </summary>
	/// <param name="request">Stored request</param>
	/// <returns>{ id, name, avatarUrl, expiresAt, canExchange }</returns>
	#ToClient(request)
	{
		return { id: request.id, name: request.fromName, avatarUrl: request.avatarUrl, expiresAt: request.expiresAt, canExchange: this.#config.allowExchange };
	}

	/// <summary>
	/// Tell an owl, if online, something about an inform they were part of.
	/// The page words the pop-up in the player's language from bodyKey.
	/// </summary>
	/// <param name="number">Owl number to tell</param>
	/// <param name="bodyKey">Text key of the pop-up's line</param>
	/// <param name="params">Parameters of that text</param>
	/// <param name="contact">Contact that was added for them, if any; it is pushed and the pop-up opens it</param>
	#Tell(number, bodyKey, params = {}, contact = null)
	{
		const target = this.#directory.GetByNumber(number);

		if (!target)
		{
			return;
		}

		if (contact)
		{
			this.#outbox.Push(target.player, "contact:upsert", { contact });
		}

		this.#outbox.Push(target.player, "notify", { kind: "inform", title: contact ? contact.name : "", titleKey: contact ? "" : "inform.title", bodyKey, params, contactId: contact ? contact.id : 0 });
	}

	/// <summary>
	/// Add the sender's owl to the receiver's contacts without asking (inform.requireConsent off).
	/// </summary>
	/// <param name="entry">Sender's directory entry</param>
	/// <param name="target">Receiver's directory entry</param>
	/// <param name="key">Cooldown key, released again if the database fails</param>
	/// <param name="name">Receiver's name as the sender may see it</param>
	/// <returns>Result carrying { status, name, cooldownSeconds }</returns>
	async #AddDirectly(entry, target, key, name)
	{
		const cooldownSeconds = this.#config.cooldownSeconds;
		const result = await this.#contacts.AddOnBehalf(target.number, entry.number, entry.characterName, true);

		switch (result.status)
		{
		case AddContactStatus.Added:
			this.#audit.Log("informs", "Inform", `${entry.characterName} (${entry.number}) informed ${target.characterName} (${target.number}) of their owl.`);
			this.#Tell(target.number, "inform.tell.informed", {}, result.contact);
			return Ok({ status: result.status, name, cooldownSeconds });
		case AddContactStatus.AlreadyKnown:
			return Ok({ status: result.status, name, cooldownSeconds });
		case AddContactStatus.Full:
			return Fail("error.theirContactsFull", { cooldownSeconds });
		default:
			this.#lastShared.delete(key);
			return Fail("error.shareFailed");
		}
	}

	/// <summary>
	/// Constructor.
	/// </summary>
	/// <param name="services">{ directory, contacts, profiles, outbox, hmp, config (the "phonemode_inform" section), blocks, audit }</param>
	constructor(services)
	{
		this.#directory = services.directory;
		this.#contacts = services.contacts;
		this.#profiles = services.profiles;
		this.#outbox = services.outbox;
		this.#hmp = services.hmp;
		this.#config = services.config;
		this.#blocks = services.blocks;
		this.#audit = services.audit;
	}

	/// <summary>
	/// Drop cooldown records and requests that have already expired. Call from a maintenance tick.
	/// </summary>
	Sweep()
	{
		const now = Date.now();
		const expiry = now - this.#config.cooldownSeconds * 1000;

		for (const [key, time] of this.#lastShared)
		{
			if (time <= expiry)
			{
				this.#lastShared.delete(key);
			}
		}

		for (const [id, request] of this.#requests)
		{
			if (request.expiresAt <= now)
			{
				this.#requests.delete(id);
			}
		}
	}

	/// <summary>
	/// The informs still waiting for an owl's answer, for the phone's bootstrap.
	/// </summary>
	/// <param name="number">Receiver's owl number</param>
	/// <returns>Requests as the page sees them</returns>
	ListPending(number)
	{
		const now = Date.now();
		return [...this.#requests.values()].filter((request) => request.toNumber === number && request.expiresAt > now).map((request) => this.#ToClient(request));
	}

	/// <summary>
	/// List the owls close enough to be informed, nearest first.
	/// </summary>
	/// <param name="entry">Directory entry of the requesting owl</param>
	/// <returns>Result carrying { players: [{ playerId, name, distance, cooldownSeconds }] }</returns>
	ListNearby(entry)
	{
		const players = [];

		for (const other of this.#directory.All())
		{
			if (other.playerId === entry.playerId)
			{
				continue;
			}

			const distance = GetDistanceMetres(this.#hmp, entry, other);

			if (distance > this.#config.rangeMetres)
			{
				continue;
			}

			players.push
			({
				playerId: other.playerId,
				name: this.#config.revealNames ? other.characterName : "",
				distance: Math.round(distance * 10) / 10,
				cooldownSeconds: this.#GetCooldownSeconds(entry.number, other.number),
			});
		}

		players.sort((first, second) => first.distance - second.distance);
		return Ok({ players, rangeMetres: this.#config.rangeMetres });
	}

	/// <summary>
	/// Inform one nearby player of your owl: ask them, or add it straight away when consent is off.
	/// </summary>
	/// <param name="entry">Directory entry of the requesting owl</param>
	/// <param name="data">{ playerId }</param>
	/// <returns>Result carrying { status, name, cooldownSeconds } where status is an AddContactStatus or "requested"</returns>
	async Send(entry, data)
	{
		const target = this.#directory.GetByPlayerId(ClampInteger(data.playerId, -1, Number.MAX_SAFE_INTEGER, -1));

		if (!target || target.playerId === entry.playerId)
		{
			return Fail("error.wizardGone");
		}

		// The list the player picked from may be a refresh old, so allow a little slack for people moving about.
		if (GetDistanceMetres(this.#hmp, entry, target) > this.#config.rangeMetres + this.#config.rangeToleranceMetres)
		{
			return Fail("error.wizardFar");
		}

		const cooldown = this.#GetCooldownSeconds(entry.number, target.number);

		if (cooldown > 0)
		{
			return Fail(Problem("error.informCooldown", { count: cooldown }), { cooldownSeconds: cooldown });
		}

		// Claim the cooldown before the database round trip so a double click cannot inform twice.
		const key = `${entry.number}>${target.number}`;
		const cooldownSeconds = this.#config.cooldownSeconds;
		const name = this.#config.revealNames ? target.characterName : "";
		this.#lastShared.set(key, Date.now());

		// Someone who blocked you does not get your owl; you are only told it could not be shared, never why.
		if (await this.#blocks.HasBlocked(target.number, entry.number) !== false)
		{
			return Fail("error.shareRefused", { cooldownSeconds });
		}

		if (!this.#config.requireConsent)
		{
			return this.#AddDirectly(entry, target, key, name);
		}

		const existing = await this.#contacts.FindByNumber(target.number, entry.number);

		if (existing === undefined)
		{
			this.#lastShared.delete(key);
			return Fail("error.shareFailed");
		}

		if (existing)
		{
			return Ok({ status: AddContactStatus.AlreadyKnown, name, cooldownSeconds });
		}

		const now = Date.now();
		let waiting = 0;

		// Informing the same person again replaces the earlier request rather than stacking a second one.
		for (const [id, request] of this.#requests)
		{
			if (request.toNumber !== target.number || request.expiresAt <= now)
			{
				continue;
			}

			if (request.fromNumber === entry.number)
			{
				this.#requests.delete(id);
				continue;
			}

			++waiting;
		}

		if (waiting >= maxPendingPerReceiver)
		{
			return Fail("error.informQueueFull", { cooldownSeconds });
		}

		const request =
		{
			id: this.#nextRequestId++,
			fromNumber: entry.number,
			fromName: entry.characterName,
			toNumber: target.number,
			toName: target.characterName,
			avatarUrl: await this.#profiles.GetOwnAvatar(entry.number),
			expiresAt: now + this.#config.requestSeconds * 1000,
		};

		this.#requests.set(request.id, request);
		this.#outbox.Push(target.player, "inform:request", { request: this.#ToClient(request) });
		this.#audit.Log("informs", "Inform offered", `${entry.characterName} (${entry.number}) offered their owl to ${target.characterName} (${target.number}).`);

		return Ok({ status: "requested", name, cooldownSeconds });
	}

	/// <summary>
	/// Answer an inform that asked for consent.
	/// </summary>
	/// <param name="entry">Directory entry of the receiver</param>
	/// <param name="data">{ requestId, choice } where choice is "accept", "exchange" or "decline"</param>
	/// <returns>Result carrying { requestId, choice, contact, exchanged }</returns>
	async Respond(entry, data)
	{
		const requestId = ClampInteger(data.requestId, 0, Number.MAX_SAFE_INTEGER, 0);
		const choice = String(data.choice || "");
		const request = this.#requests.get(requestId);

		if (!Object.values(InformChoice).includes(choice) || (choice === InformChoice.Exchange && !this.#config.allowExchange))
		{
			return Fail("error.informChoice");
		}

		if (!request || request.toNumber !== entry.number)
		{
			return Fail("error.informGone", { requestId });
		}

		// Claim the request before any database round trip so a double click cannot answer twice.
		this.#requests.delete(requestId);

		if (request.expiresAt <= Date.now())
		{
			return Fail("error.informExpired", { requestId });
		}

		// Without revealNames the sender never learns who answered, so the anonymous wording leaves the name out.
		const yourName = this.#config.revealNames ? entry.characterName : "";
		const anonymous = yourName === "" ? "Anonymous" : "";

		if (choice === InformChoice.Decline)
		{
			this.#Tell(request.fromNumber, `inform.tell.declined${anonymous}`, { name: yourName });
			this.#audit.Log("informs", "Inform declined", `${entry.characterName} (${entry.number}) declined the owl of ${request.fromName} (${request.fromNumber}).`);
			return Ok({ requestId, choice, contact: null, exchanged: false });
		}

		const result = await this.#contacts.AddOnBehalf(entry.number, request.fromNumber, request.fromName, true);

		if (result.status === AddContactStatus.Full)
		{
			return Fail("error.informContactsFull", { requestId });
		}

		if (result.status === AddContactStatus.Failed)
		{
			// Nothing was saved, so let them try the same answer again.
			this.#requests.set(requestId, request);
			return Fail("error.informSaveFailed");
		}

		let exchanged = false;
		let returned = null;

		// Giving yours back is skipped, silently, if the sender has since blocked you.
		if (choice === InformChoice.Exchange && await this.#blocks.HasBlocked(request.fromNumber, entry.number) === false)
		{
			returned = await this.#contacts.AddOnBehalf(request.fromNumber, entry.number, entry.characterName, true);
			exchanged = returned.status === AddContactStatus.Added || returned.status === AddContactStatus.AlreadyKnown;
		}

		if (returned && returned.status === AddContactStatus.Added)
		{
			this.#Tell(request.fromNumber, "inform.tell.exchanged", {}, returned.contact);
		}
		else
		{
			this.#Tell(request.fromNumber, `inform.tell.accepted${anonymous}`, { name: yourName });
		}

		this.#audit.Log("informs", exchanged ? "Owls exchanged" : "Inform accepted", `${entry.characterName} (${entry.number}) ${exchanged ? "exchanged owls with" : "took the owl of"} ${request.fromName} (${request.fromNumber}).`);
		return Ok({ requestId, choice, contact: result.contact, exchanged });
	}
}

module.exports = { InformService, InformChoice };
