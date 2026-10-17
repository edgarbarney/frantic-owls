// FranticDreamer 2026
"use strict";

// ========================
// Calls Screen
// ========================

/// <summary>
/// The Floo-Calls app, a call log: every call made and received, newest first, with missed calls in red.
/// Tapping a call calls that owl back; "New Floo-Call" (bottom right) picks a contact to call.
/// Opening it marks the missed calls as seen, which clears the badge on its home screen app.
/// The bin in the header clears the whole log, on a second tap; the other owl keeps the calls in theirs.
/// </summary>
Owls.Screens.Calls = (() =>
{
	const { Element } = Owls.Util;
	const Widgets = Owls.Widgets;
	const T = Owls.Lang.T;

	/// <summary>
	/// How long the clear button waits for its confirming second tap.
	/// </summary>
	const clearConfirmMs = 3000;

	/// <summary>
	/// Whether a log entry is a call the player missed.
	/// </summary>
	/// <param name="entry">Call log entry</param>
	/// <returns>True for incoming calls nobody answered (declined ones excepted)</returns>
	function IsMissed(entry)
	{
		return entry.direction === "in" && entry.outcome !== "answered" && entry.outcome !== "declined";
	}

	/// <summary>
	/// What happened to a call, in a few words ("Outgoing · 2:13", "Missed", "No answer").
	/// </summary>
	/// <param name="entry">Call log entry</param>
	/// <returns>Text</returns>
	function GetOutcomeText(entry)
	{
		if (entry.outcome === "answered")
		{
			const duration = Owls.Util.FormatDuration(entry.endedAt - entry.answeredAt);
			return entry.direction === "out" ? T("calls.outgoing", { duration }) : T("calls.incoming", { duration });
		}

		if (IsMissed(entry))
		{
			return T("calls.missed");
		}

		switch (entry.outcome)
		{
		case "declined":
			return T("calls.declined");
		case "missed":
			return T("calls.noAnswer");
		case "cancelled":
			return T("calls.cancelled");
		case "busy":
			return T("calls.busy");
		case "unreachable":
			return T("calls.unreachable");
		default:
			return "";
		}
	}

	/// <summary>
	/// Create the screen.
	/// </summary>
	/// <returns>Screen instance</returns>
	function Create()
	{
		let clearArmedTimer = null;
		let isBusy = false;

		const list = Element("div");
		const error = Element("div", { className: "form-error calls-error" });
		const clearButton = Widgets.IconButton(Owls.Icons.trash, T("calls.clear"), () => ClearLog());
		const header = Widgets.Header(T("home.calls"), [clearButton]);
		const fab = Element("button", { className: "fab", on: { click: () => Owls.App.Navigate("ContactPicker", { mode: "call" }) } });
		fab.innerHTML = Owls.Icons.flame;
		fab.appendChild(Element("span", { text: T("calls.newCall") }));

		// The list is padded at the bottom so the last call can scroll clear of the floating button.
		list.style.paddingBottom = "4.5rem";

		const element = Element("div", { className: "screen" }, [header.element, error, Element("div", { className: "screen-body" }, [list]), fab]);

		/// <summary>
		/// Build the row of one call. Tapping it calls that owl back.
		/// </summary>
		/// <param name="entry">Call log entry</param>
		/// <returns>Row element</returns>
		function CreateRow(entry)
		{
			const contact = Owls.Store.state.contactsByNumber.get(entry.number);
			const direction = Element("span", { className: "call-direction" });
			direction.innerHTML = entry.direction === "out" ? Owls.Icons.callOut : Owls.Icons.callIn;

			const flame = Element("span", { className: "call-row-flame" });
			flame.innerHTML = Owls.Icons.flame;

			return Element("button", { className: `list-row call-row${IsMissed(entry) ? " is-missed" : ""}`, on: { click: () => CallBack(entry.number) } },
			[
				contact ? Owls.Util.CreateAvatar(contact.name, Owls.Store.GetAvatarUrl(entry.number), entry.number) : Owls.Util.CreateAvatar("", Owls.Store.GetAvatarUrl(entry.number), entry.number, "", Owls.Icons.owl),
				Element("span", { className: "row-text" },
				[
					Element("span", { className: "row-title", text: Owls.Store.GetDisplayName(entry.number) }),
					Element("span", { className: "row-subtitle" }, [direction, Element("span", { text: GetOutcomeText(entry) })]),
				]),
				Element("span", { className: "row-meta" }, [Element("span", { text: Owls.Util.FormatListTime(entry.startedAt) }), flame]),
			]);
		}

		/// <summary>
		/// Call an owl from the log.
		/// </summary>
		/// <param name="number">Owl number</param>
		function CallBack(number)
		{
			error.textContent = "";
			const result = Owls.App.StartCall({ number });

			if (!result.ok)
			{
				error.textContent = result.error;
			}
		}

		/// <summary>
		/// Clear the whole log, on the second tap within a few seconds.
		/// </summary>
		async function ClearLog()
		{
			if (isBusy || Owls.Store.state.callLog.length === 0)
			{
				return;
			}

			if (clearArmedTimer === null)
			{
				error.textContent = T("calls.clearConfirm");
				clearButton.classList.add("is-armed");
				clearArmedTimer = setTimeout(() =>
				{
					clearArmedTimer = null;
					error.textContent = "";
					clearButton.classList.remove("is-armed");
				}, clearConfirmMs);
				return;
			}

			clearTimeout(clearArmedTimer);
			clearArmedTimer = null;
			clearButton.classList.remove("is-armed");
			error.textContent = "";
			isBusy = true;
			const result = await Owls.Bridge.Request("calls.clear", { callId: 0 });
			isBusy = false;

			if (!result.ok)
			{
				error.textContent = result.error;
				return;
			}

			Owls.Store.RemoveCallEntries(0);
		}

		/// <summary>
		/// Mark missed calls as seen, since the player is looking at them.
		/// A closed phone left on this screen keeps them new until it is opened again.
		/// </summary>
		function MarkSeen()
		{
			if (!Owls.App.IsOpen() || Owls.Store.GetMissedCallCount() === 0)
			{
				return;
			}

			Owls.Store.MarkCallsSeen();
			Owls.Bridge.Request("calls.seen", {});
		}

		/// <summary>
		/// Rebuild the list.
		/// </summary>
		/// <param name="reason">Change reason from the store</param>
		function Refresh(reason)
		{
			if (reason !== "calls" && reason !== "contacts" && reason !== "profiles" && reason !== "senders" && reason !== "reset" && reason !== "ready")
			{
				return;
			}

			MarkSeen();
			const entries = Owls.Store.state.callLog;
			clearButton.hidden = entries.length === 0;
			list.replaceChildren(...(entries.length === 0 ? [Widgets.EmptyState(T("calls.empty"))] : entries.map(CreateRow)));
		}

		Refresh("calls");
		return { element, Refresh, OnOpened: () => Refresh("calls"), Destroy: () => clearTimeout(clearArmedTimer) };
	}

	return { Create };
})();
