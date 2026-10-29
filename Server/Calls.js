// FranticDreamer 2026
"use strict";

const { Ok, Fail } = require("./Result.js");
const { Logger } = require("./Logger.js");
const { ClampInteger } = require("./Config.js");
const { CallOutcome, IsSenderNumber } = require("./Database.js");

/// <summary>
/// States of a call while it lasts. A call that ended is no longer kept; it lives on as a call log entry.
/// </summary>
const CallState = Object.freeze
({
	Ringing: "ringing",
	Active: "active",
});

/// <summary>
/// Longest voice message accepted from a page, in characters. A message carries 60 ms of Opus (a few hundred bytes at most), base64-encoded.
/// </summary>
const maxVoiceMessageLength = 4096;

/// <summary>
/// Shape of a voice message: "callId|sequence|base64 packets". Anything else is dropped unread.
/// </summary>
const voiceMessagePattern = /^(\d{1,12})\|(\d{1,10})\|([A-Za-z0-9+/]+={0,2})$/;

/// <summary>
/// Most voice messages one owl may send per second. An honest page sends about 17 (one every 60 ms) while its player talks.
/// </summary>
const voiceMessagesPerSecond = 40;

// ========================
// Call Service
// ========================

/// <summary>
/// Calls between two owls: ringing, answering, declining, hanging up, and the call log each owl keeps.
///
/// <para>
/// NOTE: Voices travel through this server, not straight between players, so neither ever learns the other's IP address.
/// HogwartsMP's own voice chat is proximity voice and cannot carry one player's voice to one other player far away,
/// so each phone page records its microphone, encodes it as Opus and sends it here; RelayVoice passes it to the other owl of an answered call only.
/// Nothing is decoded, stored or logged on the way. Every change of a call also raises the server event "frantic-owls:call" for other resources.
/// </para>
///
/// <para>
/// NOTE: Calls in progress live in memory only, like waiting informs. A restart drops them without a log entry,
/// which costs nothing more than a call that has to be made again. Each call is written to the log once, when it ends.
/// </para>
///
/// <para>
/// NOTE: A caller someone has blocked is told the callee is unreachable, exactly as if they were offline, and the call stays out of the callee's log.
/// Like owls, the blocked owl is never told it was blocked.
/// </para>
///
/// </summary>
class CallService
{
	/// <summary>
	/// OwlDatabase instance.
	/// </summary>
	#database;

	/// <summary>
	/// OwlDirectory instance.
	/// </summary>
	#directory;

	/// <summary>
	/// Outbox instance.
	/// </summary>
	#outbox;

	/// <summary>
	/// The "phonemode_calls" section of the server config.
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
	/// { Describe(number) => label, OnCall(info) } supplied by Main.
	/// </summary>
	#hooks;

	/// <summary>
	/// NumberDialler instance, for calls to a number typed in.
	/// </summary>
	#dialler;

	/// <summary>
	/// Per-owl limiter for starting calls, keyed by owl number, so nobody can ring someone over and over.
	/// </summary>
	#startLimiter;

	/// <summary>
	/// Per-owl limiter for voice messages, keyed by owl number, so a tampered page cannot flood the other owl.
	/// </summary>
	#voiceLimiter;

	/// <summary>
	/// Calls ringing or in progress, by call ID: { id, caller, callee, state, startedAt, answeredAt, expiresAt, ringTimer, muted }
	/// where muted is the set of owl numbers that turned their microphone off.
	/// </summary>
	#calls = new Map();

	/// <summary>
	/// The call each owl is in, by owl number. An owl is in at most one call at a time, whether calling, ringing or talking.
	/// </summary>
	#byNumber = new Map();

	/// <summary>
	/// ID of the next call. IDs are never reused while the resource runs, so a stale answer cannot hit a newer call.
	/// </summary>
	#nextCallId = 1;

	/// <summary>
	/// The page's view of a call, from one of its two owls.
	/// </summary>
	/// <param name="call">Call record</param>
	/// <param name="viewer">Owl number of the caller or the callee</param>
	/// <returns>{ id, number, direction, state, startedAt, answeredAt, expiresAt, isMuted, isOtherMuted }</returns>
	#ToClient(call, viewer)
	{
		const isOutgoing = call.caller === viewer;
		const other = isOutgoing ? call.callee : call.caller;
		return { id: call.id, number: other, direction: isOutgoing ? "out" : "in", state: call.state, startedAt: call.startedAt, answeredAt: call.answeredAt, expiresAt: call.expiresAt, isMuted: call.muted.has(viewer), isOtherMuted: call.muted.has(other) };
	}

	/// <summary>
	/// Push an item to an owl, if it is online.
	/// </summary>
	/// <param name="number">Owl number</param>
	/// <param name="type">Outbox item type</param>
	/// <param name="data">Payload</param>
	#PushTo(number, type, data)
	{
		const target = this.#directory.GetByNumber(number);

		if (target)
		{
			this.#outbox.Push(target.player, type, data);
		}
	}

	/// <summary>
	/// Tell other resources that a call changed ("frantic-owls:call").
	/// </summary>
	/// <param name="call">Call record</param>
	/// <param name="state">"ringing", "active" or "ended"</param>
	/// <param name="outcome">How it ended (a CallOutcome), or "" while it lasts</param>
	#Announce(call, state, outcome = "")
	{
		const callerEntry = this.#directory.GetByNumber(call.caller);
		const calleeEntry = this.#directory.GetByNumber(call.callee);

		this.#hooks.OnCall
		({
			callId: call.id,
			state,
			outcome,
			caller: call.caller,
			callee: call.callee,
			callerPlayerId: callerEntry ? callerEntry.playerId : -1,
			calleePlayerId: calleeEntry ? calleeEntry.playerId : -1,
			startedAt: call.startedAt,
			answeredAt: call.answeredAt,
		});
	}

	/// <summary>
	/// Write a call that never rang (busy or unreachable) to both logs, and hand back the caller's entry.
	/// </summary>
	/// <param name="caller">Caller's owl number</param>
	/// <param name="callee">Callee's owl number</param>
	/// <param name="outcome">CallOutcome.Busy or CallOutcome.Unreachable</param>
	/// <param name="hideFromCallee">Keep it out of the callee's log (they blocked the caller)</param>
	/// <returns>The caller's log entry, or null when it could not be written</returns>
	async #LogUnconnected(caller, callee, outcome, hideFromCallee)
	{
		const now = Date.now();
		const call = { caller, callee, outcome, startedAt: now, answeredAt: 0, endedAt: now, hideFromCallee };
		const id = await this.#database.InsertCall(call);

		if (id <= 0)
		{
			return null;
		}

		// The callee hears of it as a missed call, unless they blocked the caller.
		if (!hideFromCallee)
		{
			this.#PushTo(callee, "call:logged", { entry: { id, number: caller, direction: "in", outcome, startedAt: now, answeredAt: 0, endedAt: now, isNew: true } });
		}

		this.#audit.Log("calls", outcome === CallOutcome.Busy ? "Call (busy)" : "Call (unreachable)", `${this.#hooks.Describe(caller)} → ${this.#hooks.Describe(callee)}`);
		return { id, number: callee, direction: "out", outcome, startedAt: now, answeredAt: 0, endedAt: now, isNew: false };
	}

	/// <summary>
	/// End a call, tell both owls and log it. Ending a call that already ended does nothing.
	/// </summary>
	/// <param name="call">Call record</param>
	/// <param name="outcome">CallOutcome it ended with</param>
	/// <param name="endedBy">Owl number of who ended it, or "" when nobody did (it rang out)</param>
	async #End(call, outcome, endedBy)
	{
		if (this.#calls.get(call.id) !== call)
		{
			return;
		}

		// Forget it before the database round trip, so a hang-up racing a time-out cannot end it twice.
		this.#calls.delete(call.id);
		this.#byNumber.delete(call.caller);
		this.#byNumber.delete(call.callee);
		clearTimeout(call.ringTimer);

		const endedAt = Date.now();
		const id = await this.#database.InsertCall({ caller: call.caller, callee: call.callee, outcome, startedAt: call.startedAt, answeredAt: call.answeredAt, endedAt, hideFromCallee: false });
		const record = { outcome, startedAt: call.startedAt, answeredAt: call.answeredAt, endedAt };

		// A log entry that failed to save still ends the call on both phones; it just does not appear in the log.
		for (const viewer of [call.caller, call.callee])
		{
			const isOutgoing = viewer === call.caller;
			const isMissed = !isOutgoing && outcome !== CallOutcome.Answered && outcome !== CallOutcome.Declined;
			const entry = id > 0 ? { id, number: isOutgoing ? call.callee : call.caller, direction: isOutgoing ? "out" : "in", ...record, isNew: isMissed } : null;
			this.#PushTo(viewer, "call:ended", { callId: call.id, outcome, endedBy, entry });
		}

		const duration = call.answeredAt > 0 ? Math.round((endedAt - call.answeredAt) / 1000) : 0;
		const detail = outcome === CallOutcome.Answered ? `Talked for ${Math.floor(duration / 60)}m ${duration % 60}s` : `Not answered (${outcome})`;
		this.#audit.Log("calls", "Call", `${this.#hooks.Describe(call.caller)} → ${this.#hooks.Describe(call.callee)}\n${detail}`);
		this.#Announce(call, "ended", outcome);
	}

	/// <summary>
	/// The call an owl is in and may act on, by the ID its page sent.
	/// </summary>
	/// <param name="entry">Directory entry of the requesting owl</param>
	/// <param name="data">{ callId }</param>
	/// <returns>Call record, or null when it is gone or not theirs</returns>
	#GetOwnCall(entry, data)
	{
		const call = this.#calls.get(ClampInteger(data.callId, 0, Number.MAX_SAFE_INTEGER, 0));
		return call && (call.caller === entry.number || call.callee === entry.number) ? call : null;
	}

	/// <summary>
	/// Find who an owl wants to call: one of their contacts, or an owl number they already know (to call back from the log or a chat).
	/// With phonemode_numbers.dialling on, any live owl's number typed in will do as well.
	/// </summary>
	/// <param name="entry">Directory entry of the caller</param>
	/// <param name="data">{ contactId } or { number }</param>
	/// <returns>{ number, error } with the callee's number, or "" and the error's text key</returns>
	async #ReadCallee(entry, data)
	{
		const contactId = ClampInteger(data.contactId, 0, Number.MAX_SAFE_INTEGER, 0);

		if (contactId > 0)
		{
			const contact = await this.#database.GetContact(entry.number, contactId);
			return contact ? { number: contact.number, error: "" } : { number: "", error: "error.contactGone" };
		}

		const number = this.#dialler.Normalise(data.number);

		if (!number)
		{
			return { number: "", error: this.#dialler.IsEnabled() ? "error.numberInvalid" : "error.callUnknown" };
		}

		// Official senders and the owl itself are refused by the caller's checks; only strangers are refused here.
		if (number === entry.number || IsSenderNumber(number))
		{
			return { number, error: "" };
		}

		const related = await this.#database.AreRelated(entry.number, number);

		if (related === null)
		{
			return { number: "", error: "error.callFailed" };
		}

		if (related)
		{
			return { number, error: "" };
		}

		// A stranger's number typed in: only on servers that allow dialling, and only to an owl that exists.
		return this.#dialler.IsEnabled() ? this.#dialler.Resolve(entry, number) : { number: "", error: "error.callUnknown" };
	}

	/// <summary>
	/// Constructor.
	/// </summary>
	/// <param name="services">{ database, directory, outbox, hmp, config (the "phonemode_calls" section), blocks, audit, hooks, dialler }</param>
	constructor(services)
	{
		this.#database = services.database;
		this.#directory = services.directory;
		this.#outbox = services.outbox;
		this.#config = services.config;
		this.#blocks = services.blocks;
		this.#audit = services.audit;
		this.#hooks = services.hooks;
		this.#dialler = services.dialler;
		this.#startLimiter = services.hmp.rateLimit.create({ limit: this.#config.rateLimitCount, windowMs: this.#config.rateLimitWindowMs });
		this.#voiceLimiter = services.hmp.rateLimit.create({ limit: voiceMessagesPerSecond, windowMs: 1000 });
	}

	/// <summary>
	/// Drop rate-limit buckets nobody has used for a while. Call from a maintenance tick.
	/// </summary>
	Sweep()
	{
		this.#startLimiter.sweep(this.#config.rateLimitWindowMs * 4);
		this.#voiceLimiter.sweep(4000);
	}

	/// <summary>
	/// The call an owl is in right now, for the phone's bootstrap (a page that reloaded mid-call picks it up again).
	/// </summary>
	/// <param name="number">Owl number</param>
	/// <returns>The call as the page sees it, or null</returns>
	GetCurrent(number)
	{
		const call = this.#byNumber.get(number);
		return call ? this.#ToClient(call, number) : null;
	}

	/// <summary>
	/// An owl's call log, newest first.
	/// </summary>
	/// <param name="number">Owl number</param>
	/// <returns>Entries, or null on failure</returns>
	async ListLog(number)
	{
		return this.#database.ListCalls(number, this.#config.logSize);
	}

	// ========================
	// Player Requests
	// ========================

	/// <summary>
	/// Call another owl. It rings on their phone until they answer or decline, the caller hangs up, or calls.ringSeconds pass.
	/// A callee who is offline (or blocked the caller) or already on a call is refused straight away, and the attempt is logged.
	/// </summary>
	/// <param name="entry">Directory entry of the caller</param>
	/// <param name="data">{ contactId } or { number }</param>
	/// <returns>Result carrying { call }; a refusal carries { entry } with the caller's log entry when one was written</returns>
	async Start(entry, data)
	{
		if (!this.#config.enabled)
		{
			return Fail("error.callsOff");
		}

		if (!this.#startLimiter.allow(entry.number))
		{
			return Fail("error.callsTooMany");
		}

		if (this.#byNumber.has(entry.number))
		{
			return Fail("error.callAlreadyIn");
		}

		const target = await this.#ReadCallee(entry, data);

		if (target.error)
		{
			return Fail(target.error);
		}

		const callee = target.number;

		if (callee === entry.number)
		{
			return Fail("error.callSelf");
		}

		if (IsSenderNumber(callee))
		{
			return Fail("error.callOfficial");
		}

		if ((await this.#database.ListRetiredAmong([callee])).has(callee))
		{
			return Fail("error.retired");
		}

		const [isBlockedByThem, haveBlockedThem] = await Promise.all([this.#blocks.HasBlocked(callee, entry.number), this.#blocks.HasBlocked(entry.number, callee)]);

		if (isBlockedByThem === null || haveBlockedThem === null)
		{
			return Fail("error.callFailed");
		}

		if (haveBlockedThem)
		{
			return Fail("error.callYouBlocked");
		}

		// Checked again after the database round trips, which a second call or the caller logging off may have raced.
		if (this.#directory.GetByNumber(entry.number) !== entry)
		{
			return Fail("error.noOwl");
		}

		if (this.#byNumber.has(entry.number))
		{
			return Fail("error.callAlreadyIn");
		}

		const calleeEntry = this.#directory.GetByNumber(callee);

		if (!calleeEntry || isBlockedByThem)
		{
			return Fail("error.callUnreachable", { entry: await this.#LogUnconnected(entry.number, callee, CallOutcome.Unreachable, !!isBlockedByThem) });
		}

		if (this.#byNumber.has(callee))
		{
			return Fail("error.callBusy", { entry: await this.#LogUnconnected(entry.number, callee, CallOutcome.Busy, false) });
		}

		const now = Date.now();
		const call = { id: this.#nextCallId++, caller: entry.number, callee, state: CallState.Ringing, startedAt: now, answeredAt: 0, expiresAt: now + this.#config.ringSeconds * 1000, ringTimer: null, muted: new Set() };

		call.ringTimer = setTimeout(() =>
		{
			this.#End(call, CallOutcome.Missed, "").catch((error) => Logger.LogError("Calls", `Ending call ${call.id} failed: ${Logger.Describe(error)}`));
		}, this.#config.ringSeconds * 1000);

		this.#calls.set(call.id, call);
		this.#byNumber.set(call.caller, call);
		this.#byNumber.set(call.callee, call);

		this.#outbox.Push(calleeEntry.player, "call:incoming", { call: this.#ToClient(call, callee) });
		this.#Announce(call, CallState.Ringing);
		return Ok({ call: this.#ToClient(call, entry.number) });
	}

	/// <summary>
	/// Answer a call ringing on your phone.
	/// </summary>
	/// <param name="entry">Directory entry of the callee</param>
	/// <param name="data">{ callId }</param>
	/// <returns>Result carrying { call }</returns>
	Answer(entry, data)
	{
		const call = this.#GetOwnCall(entry, data);

		if (!call || call.callee !== entry.number || call.state !== CallState.Ringing)
		{
			return Fail("error.callGone", { callId: ClampInteger(data.callId, 0, Number.MAX_SAFE_INTEGER, 0) });
		}

		clearTimeout(call.ringTimer);
		call.ringTimer = null;
		call.state = CallState.Active;
		call.answeredAt = Date.now();

		this.#PushTo(call.caller, "call:update", { call: this.#ToClient(call, call.caller) });
		this.#Announce(call, CallState.Active);
		return Ok({ call: this.#ToClient(call, entry.number) });
	}

	/// <summary>
	/// Hang up: the caller cancelling while it rings, the callee declining it, or either one ending a call in progress.
	/// </summary>
	/// <param name="entry">Directory entry of either owl</param>
	/// <param name="data">{ callId }</param>
	/// <returns>Result carrying { callId }</returns>
	async Hangup(entry, data)
	{
		const call = this.#GetOwnCall(entry, data);

		if (!call)
		{
			return Fail("error.callGone", { callId: ClampInteger(data.callId, 0, Number.MAX_SAFE_INTEGER, 0) });
		}

		const outcome = call.state === CallState.Active ? CallOutcome.Answered : call.caller === entry.number ? CallOutcome.Cancelled : CallOutcome.Declined;
		await this.#End(call, outcome, entry.number);
		return Ok({ callId: call.id });
	}

	/// <summary>
	/// Turn the player's microphone off or on for a call in progress, and tell the other owl.
	/// The page stops sending while muted; the server also drops anything a muted owl still sends.
	/// </summary>
	/// <param name="entry">Directory entry of either owl</param>
	/// <param name="data">{ callId, muted }</param>
	/// <returns>Result carrying { call }</returns>
	SetMuted(entry, data)
	{
		const call = this.#GetOwnCall(entry, data);

		if (!call || call.state !== CallState.Active)
		{
			return Fail("error.callGone", { callId: ClampInteger(data.callId, 0, Number.MAX_SAFE_INTEGER, 0) });
		}

		if (data.muted === true)
		{
			call.muted.add(entry.number);
		}
		else
		{
			call.muted.delete(entry.number);
		}

		const other = call.caller === entry.number ? call.callee : call.caller;
		this.#PushTo(other, "call:update", { call: this.#ToClient(call, other) });
		return Ok({ call: this.#ToClient(call, entry.number) });
	}

	/// <summary>
	/// Mark every missed call as seen (the player opened their call log).
	/// </summary>
	/// <param name="entry">Directory entry of the owl</param>
	/// <returns>Result</returns>
	async MarkSeen(entry)
	{
		return await this.#database.MarkCallsSeen(entry.number) ? Ok() : Fail("error.callLogFailed");
	}

	/// <summary>
	/// Remove one call, or the whole log, from the player's call log.
	/// </summary>
	/// <param name="entry">Directory entry of the owl</param>
	/// <param name="data">{ callId } where 0 clears everything</param>
	/// <returns>Result carrying { callId }</returns>
	async Clear(entry, data)
	{
		const callId = ClampInteger(data.callId, 0, Number.MAX_SAFE_INTEGER, 0);
		return await this.#database.ClearCalls(entry.number, callId) ? Ok({ callId }) : Fail("error.callLogFailed");
	}

	// ========================
	// Voice
	// ========================

	/// <summary>
	/// Pass one voice message from a player's page to the other owl of their answered call.
	/// Malformed, oversized, too frequent or stray messages (no call, a call still ringing, a muted owl) are dropped silently;
	/// an honest page never sends them, and answering would only cost bandwidth.
	///
	/// <para>
	/// NOTE: This runs about 17 times a second per talking player, so it touches no database and allocates as little as it can.
	/// The message is forwarded exactly as received; the receiving page checks the call ID again, so a message that crosses a hang-up is ignored there.
	/// </para>
	///
	/// </summary>
	/// <param name="player">Sending player</param>
	/// <param name="raw">"callId|sequence|base64 packets"</param>
	RelayVoice(player, raw)
	{
		if (!this.#config.voiceEnabled || typeof raw !== "string" || raw.length > maxVoiceMessageLength)
		{
			return;
		}

		const entry = this.#directory.GetByPlayerId(player.id);
		const call = entry ? this.#byNumber.get(entry.number) : null;

		if (!call || call.state !== CallState.Active || call.muted.has(entry.number))
		{
			return;
		}

		const match = voiceMessagePattern.exec(raw);

		if (!match || Number(match[1]) !== call.id || !this.#voiceLimiter.allow(entry.number))
		{
			return;
		}

		const target = this.#directory.GetByNumber(call.caller === entry.number ? call.callee : call.caller);

		if (!target)
		{
			return;
		}

		// The native emit can throw if the player left a moment ago; a lost 60 ms of voice is not worth a log line.
		try
		{
			target.player.emit("frantic-owls:voice", JSON.stringify(raw));
		}
		catch (error)
		{
			return;
		}
	}

	// ========================
	// Server Events
	// ========================

	/// <summary>
	/// End whatever call an owl is in because it went offline (character unloaded or player left).
	/// A call it was making counts as cancelled, one ringing for it as missed.
	/// </summary>
	/// <param name="number">Owl number going offline</param>
	Drop(number)
	{
		const call = this.#byNumber.get(number);

		if (!call)
		{
			return;
		}

		const outcome = call.state === CallState.Active ? CallOutcome.Answered : call.caller === number ? CallOutcome.Cancelled : CallOutcome.Missed;
		this.#End(call, outcome, number).catch((error) => Logger.LogError("Calls", `Ending call ${call.id} failed: ${Logger.Describe(error)}`));
	}

	/// <summary>
	/// End the call between two owls, if they are in one together, because one blocked the other.
	/// </summary>
	/// <param name="blocker">Owl number that blocked</param>
	/// <param name="blocked">Owl number that was blocked</param>
	EndBetween(blocker, blocked)
	{
		const call = this.#byNumber.get(blocker);

		if (!call || (call.caller !== blocked && call.callee !== blocked))
		{
			return;
		}

		const outcome = call.state === CallState.Active ? CallOutcome.Answered : call.caller === blocker ? CallOutcome.Cancelled : CallOutcome.Declined;
		this.#End(call, outcome, blocker).catch((error) => Logger.LogError("Calls", `Ending call ${call.id} failed: ${Logger.Describe(error)}`));
	}

	/// <summary>
	/// End every call without logging it, as the resource stops.
	/// </summary>
	Stop()
	{
		for (const call of this.#calls.values())
		{
			clearTimeout(call.ringTimer);
		}

		this.#calls.clear();
		this.#byNumber.clear();
	}
}

module.exports = { CallService, CallState };
