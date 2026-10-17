// FranticDreamer 2026
"use strict";

// ========================
// Call Screen
// ========================

/// <summary>
/// One call, from dialling to hanging up: who it is with, how it is going, and the buttons that fit it
/// (Hang Up while calling; Mute and Hang Up while talking; Decline and Answer while it rings for you).
/// While talking, a line under the timer says what is wrong with the voice, if anything (no microphone, someone muted),
/// and the picture glows while the other owl speaks.
/// Going back keeps the call going; the status bar then shows it, and tapping it there comes back here.
/// Once the call ends the screen says how for a moment, then closes itself.
///
/// <para>
/// NOTE: Opened with params.start ({ contactId } or { number }) it places the call itself, then forgets params.start,
/// so rebuilding the screen (e.g. after a language change) shows the call rather than placing a second one.
/// </para>
///
/// </summary>
Owls.Screens.Call = (() =>
{
	const { Element } = Owls.Util;
	const Widgets = Owls.Widgets;
	const T = Owls.Lang.T;

	/// <summary>
	/// How long the screen shows how a call ended before closing.
	/// </summary>
	const endedLingerMs = 2200;

	/// <summary>
	/// How often the talk timer is redrawn.
	/// </summary>
	const tickMs = 500;

	/// <summary>
	/// The line saying how a call ended, from this player's side of it.
	/// </summary>
	/// <param name="end">Store.state.callEnd</param>
	/// <param name="direction">"out" when this player called, "in" when they were called</param>
	/// <param name="name">Name of the other owl</param>
	/// <returns>Text</returns>
	function GetEndText(end, direction, name)
	{
		if (end.errorText)
		{
			return end.errorText;
		}

		const isOutgoing = direction === "out";

		switch (end.outcome)
		{
		case "answered":
			return T("call.ended", { duration: Owls.Util.FormatDuration(end.durationMs) });
		case "declined":
			return isOutgoing ? T("call.declinedByThem", { name }) : T("call.declinedByYou");
		case "cancelled":
			return isOutgoing ? T("call.cancelled") : T("call.missed");
		case "missed":
			return isOutgoing ? T("call.noAnswer") : T("call.missed");
		default:
			return T("call.endedPlain");
		}
	}

	/// <summary>
	/// The line under the talk timer: why there is no sound, or who is muted. Empty when all is well.
	/// </summary>
	/// <param name="call">The call in progress</param>
	/// <param name="name">Name of the other owl</param>
	/// <returns>Text, or ""</returns>
	function GetVoiceText(call, name)
	{
		const voice = Owls.Voice.GetState();

		if (voice.hearProblem)
		{
			return T(voice.hearProblem);
		}

		if (voice.micProblem)
		{
			return T(voice.micProblem);
		}

		if (call.isOtherMuted)
		{
			return T("call.otherMuted", { name });
		}

		if (voice.isMuted)
		{
			return T("call.youMuted");
		}

		return voice.micState === Owls.Voice.MicState.Starting ? T("call.voice.starting") : "";
	}

	/// <summary>
	/// Round call button with an icon and a label under it.
	/// </summary>
	/// <param name="icon">Icon markup</param>
	/// <param name="label">Label</param>
	/// <param name="className">"is-answer" or "is-hangup"</param>
	/// <param name="onClick">Click handler</param>
	/// <returns>Button element</returns>
	function CallButton(icon, label, className, onClick)
	{
		const circle = Element("span", { className: "call-button-circle" });
		circle.innerHTML = icon;
		return Element("button", { className: `call-button ${className}`, on: { click: onClick } }, [circle, Element("span", { className: "call-button-label", text: label })]);
	}

	/// <summary>
	/// Create the screen.
	/// </summary>
	/// <param name="params">{ start } to place a call ({ contactId } or { number }); {} to show the call the player is in</param>
	/// <returns>Screen instance, or null when there is no call to show</returns>
	function Create(params)
	{
		const Store = Owls.Store;
		const current = Store.state.call;
		const start = !current && params.start ? params.start : null;
		params.start = null;

		let number = current ? current.number : "";
		let direction = current ? current.direction : "out";
		let callId = current ? current.id : 0;

		if (start)
		{
			const contact = start.contactId ? Store.state.contacts.get(start.contactId) : null;
			number = contact ? contact.number : String(start.number || "");
		}

		if (!number)
		{
			return null;
		}

		let isDialling = !!start;
		let isBusy = false;
		let endText = "";
		let tickTimer = null;
		let closeTimer = null;

		const avatarHolder = Element("div", { className: "call-avatar" });
		const nameLine = Element("div", { className: "call-name" });
		const statusLine = Element("div", { className: "call-status" });
		const hintLine = Element("div", { className: "call-hint" });
		const error = Element("div", { className: "form-error call-error" });
		const answerButton = CallButton(Owls.Icons.flame, T("call.answer"), "is-answer", () => Act("calls.answer"));
		const declineButton = CallButton(Owls.Icons.snowflake, T("call.decline"), "is-hangup", () => Act("calls.hangup"));
		const hangUpButton = CallButton(Owls.Icons.snowflake, T("call.hangUp"), "is-hangup", () => Act("calls.hangup"));
		const muteButton = CallButton(Owls.Icons.microphone, T("call.mute"), "is-mute", () => ToggleMute());

		const element = Element("div", { className: "screen" },
		[
			Widgets.Header(T("call.title")).element,
			Element("div", { className: "screen-body call" },
			[
				Element("div", { className: "call-who" }, [avatarHolder, nameLine, statusLine, hintLine]),
				error,
				Element("div", { className: "call-buttons" }, [muteButton, declineButton, hangUpButton, answerButton]),
			]),
		]);

		/// <summary>
		/// The call this screen shows, while it lasts.
		/// </summary>
		/// <returns>Call record, or null</returns>
		function GetCall()
		{
			const call = Store.state.call;
			return call && callId > 0 && call.id === callId ? call : null;
		}

		/// <summary>
		/// Redraw everything from the call's state.
		/// </summary>
		function Render()
		{
			const call = GetCall();
			const name = Store.GetDisplayName(number);
			const contact = Store.state.contactsByNumber.get(number);
			const isRingingForMe = !!call && call.state === "ringing" && call.direction === "in";
			const isActive = !!call && call.state === "active";
			const isOver = endText !== "";

			avatarHolder.replaceChildren(Owls.Util.CreateAvatar(contact ? contact.name : "", Store.GetAvatarUrl(number), number, "is-large", contact ? "" : Owls.Icons.owl));
			nameLine.textContent = name;
			element.classList.toggle("is-ringing", isRingingForMe);
			element.classList.toggle("is-over", isOver);
			element.classList.toggle("is-speaking", isActive && !isOver && Owls.Voice.GetState().isOtherSpeaking);

			if (isOver)
			{
				statusLine.textContent = endText;
			}
			else if (isDialling)
			{
				statusLine.textContent = T("call.dialling");
			}
			else if (isActive)
			{
				statusLine.textContent = Owls.Util.FormatDuration(Store.GetServerNow() - call.answeredAt);
			}
			else if (call)
			{
				statusLine.textContent = isRingingForMe ? T("call.incoming") : T("call.ringing");
			}

			hintLine.textContent = isActive && !isOver ? GetVoiceText(call, name) : "";
			hintLine.hidden = hintLine.textContent === "";

			// Muting only means something when there is a microphone to mute.
			const voice = Owls.Voice.GetState();
			const isMuted = voice.isMuted;
			muteButton.hidden = !isActive || isOver || voice.micState === Owls.Voice.MicState.Unavailable;
			muteButton.classList.toggle("is-active", isMuted);
			muteButton.querySelector(".call-button-circle").innerHTML = isMuted ? Owls.Icons.microphoneSlash : Owls.Icons.microphone;
			muteButton.querySelector(".call-button-label").textContent = isMuted ? T("call.unmute") : T("call.mute");
			muteButton.disabled = isBusy;
			answerButton.hidden = !isRingingForMe || isOver;
			declineButton.hidden = !isRingingForMe || isOver;
			hangUpButton.hidden = isRingingForMe || isOver;
			hangUpButton.disabled = isBusy || isDialling;
			answerButton.disabled = isBusy;
			declineButton.disabled = isBusy;

			// The talk timer only needs redrawing while there is a call in progress.
			if (isActive && tickTimer === null)
			{
				tickTimer = setInterval(Render, tickMs);
			}
			else if (!isActive && tickTimer !== null)
			{
				clearInterval(tickTimer);
				tickTimer = null;
			}
		}

		/// <summary>
		/// Show how the call ended, then close the screen after a moment.
		/// </summary>
		/// <param name="text">Line to show</param>
		function ShowEnded(text)
		{
			endText = text;
			isDialling = false;
			Render();

			clearTimeout(closeTimer);
			closeTimer = setTimeout(() =>
			{
				closeTimer = null;
				Owls.App.DismissCall(instance);
			}, endedLingerMs);
		}

		/// <summary>
		/// Place the call this screen was opened for.
		/// </summary>
		/// <param name="target">{ contactId } or { number }</param>
		async function Dial(target)
		{
			// Opened from a click, which is when the browser lets audio start; voice needs it once the call is answered.
			Owls.Voice.Prime();
			Render();
			const result = await Owls.Bridge.Request("calls.start", target.contactId ? { contactId: target.contactId } : { number });
			isDialling = false;

			if (!result.ok)
			{
				// A callee who is busy or unreachable still leaves the attempt in the log.
				if (result.data && result.data.entry)
				{
					Store.AddCallEntry(result.data.entry);
				}

				ShowEnded(result.error);
				return;
			}

			callId = result.data.call.id;
			direction = result.data.call.direction;
			Store.SetCall(result.data.call);
		}

		/// <summary>
		/// Answer or hang up.
		/// </summary>
		/// <param name="action">"calls.answer" or "calls.hangup"</param>
		async function Act(action)
		{
			if (isBusy || callId === 0 || endText)
			{
				return;
			}

			if (action === "calls.answer")
			{
				Owls.Voice.Prime();
			}

			isBusy = true;
			error.textContent = "";
			Render();
			const result = await Owls.Bridge.Request(action, { callId });
			isBusy = false;

			if (!result.ok)
			{
				// The call ended on the other side first; there is nothing left to answer or hang up.
				if (result.errorKey === "error.callGone")
				{
					Store.EndCall({ callId, errorText: result.error });
					return;
				}

				error.textContent = result.error;
				Render();
				return;
			}

			// Hanging up is confirmed by the server's "call:ended", which every phone in the call receives.
			if (action === "calls.answer")
			{
				Store.SetCall(result.data.call);
			}

			Render();
		}

		/// <summary>
		/// Turn the microphone off or on. The page stops sending at once; the server is told so the other owl sees it.
		/// </summary>
		async function ToggleMute()
		{
			const call = GetCall();

			if (isBusy || !call || call.state !== "active")
			{
				return;
			}

			const muted = !Owls.Voice.GetState().isMuted;
			Owls.Voice.SetMuted(muted);
			const result = await Owls.Bridge.Request("calls.mute", { callId, muted });

			if (!result.ok)
			{
				// The call ended meanwhile; "call:ended" closes the screen.
				return;
			}

			Store.SetCall(result.data.call);
		}

		/// <summary>
		/// Follow the call: answered, ended, or the other owl's name or picture changing.
		/// </summary>
		/// <param name="reason">Change reason</param>
		function Refresh(reason)
		{
			if (reason === "call" || reason === "reset")
			{
				const end = Store.state.callEnd;

				if (!endText && callId > 0 && end && end.callId === callId)
				{
					ShowEnded(GetEndText(end, direction, Store.GetDisplayName(number)));
					return;
				}

				// The page was cleared (character unloaded) under a call that never ended here.
				if (!endText && !isDialling && !GetCall())
				{
					ShowEnded(T("call.endedPlain"));
					return;
				}
			}

			if (reason === "call" || reason === "voice" || reason === "reset" || reason === "ready" || reason === "contacts" || reason === "profiles")
			{
				Render();
			}
		}

		/// <summary>
		/// Release the timers. Leaving the screen does not end the call.
		/// </summary>
		function Destroy()
		{
			clearInterval(tickTimer);
			clearTimeout(closeTimer);
			tickTimer = null;
			closeTimer = null;
		}

		const instance = { element, Refresh, Destroy };

		if (start)
		{
			Dial(start);
		}
		else
		{
			Render();
		}

		return instance;
	}

	return { Create };
})();
