// FranticDreamer 2026
"use strict";

window.Owls = window.Owls || {};

// ========================
// Moderation
// ========================

/// <summary>
/// The moderators' view of reports, shared by the phone's Moderation app and the letter desk's Reports tab.
/// Each front end wraps these views in its own screen; they draw only what is inside it and look up their colours from the page's own theme.
///
/// <para>
/// NOTE: Nothing here can write to a chat: a reported chat is a copy the server took when it was reported, and moderators only read it and mark the report.
/// The server checks the moderator permission on every request, so these views simply show its refusal if a player lost it.
/// </para>
///
/// </summary>
Owls.Moderation = (() =>
{
	const { Element } = Owls.Util;
	const T = Owls.Lang.T;

	/// <summary>
	/// Wait after the last keystroke before searching.
	/// </summary>
	const searchDelayMs = 300;

	/// <summary>
	/// Statuses a moderator can filter the list by, in the order the chips show. "" is every report.
	/// </summary>
	const filters = ["open", "resolved", "dismissed", ""];

	/// <summary>
	/// A report's number as players read it: "#0001".
	/// </summary>
	/// <param name="id">Report ID</param>
	/// <returns>Text</returns>
	function FormatReportNumber(id)
	{
		return `#${String(id).padStart(4, "0")}`;
	}

	/// <summary>
	/// An owl number as moderators read it, in two groups of four.
	/// </summary>
	/// <param name="number">8-digit owl number</param>
	/// <returns>Text</returns>
	function FormatOwlNumber(number)
	{
		const text = String(number || "");
		return text.length === 8 ? `${text.slice(0, 4)} ${text.slice(4)}` : text;
	}

	/// <summary>
	/// A Font Awesome icon element.
	/// </summary>
	/// <param name="name">Icon name without "fa-"</param>
	/// <returns>Icon element</returns>
	function Icon(name)
	{
		return Element("i", { className: `fa-solid fa-${name}`, attributes: { "aria-hidden": "true" } });
	}

	/// <summary>
	/// A button of the moderation views.
	/// </summary>
	/// <param name="label">Button text</param>
	/// <param name="onClick">Click handler</param>
	/// <param name="icon">Icon name, or ""</param>
	/// <param name="className">Extra classes</param>
	/// <returns>Button element</returns>
	function Button(label, onClick, icon = "", className = "")
	{
		return Element("button", { className: `mod-button ${className}`.trim(), on: { click: onClick } }, [icon ? Icon(icon) : null, Element("span", { text: label })]);
	}

	/// <summary>
	/// The coloured chip naming a report's status.
	/// </summary>
	/// <param name="status">"open", "resolved" or "dismissed"</param>
	/// <returns>Chip element</returns>
	function StatusChip(status)
	{
		return Element("span", { className: `mod-status is-${status}`, text: T(`report.status.${status}`) });
	}

	/// <summary>
	/// A member's name, or a stand-in for a character whose name was never known.
	/// </summary>
	/// <param name="name">Kept name</param>
	/// <returns>Text</returns>
	function NameOf(name)
	{
		return name || T("report.unnamed");
	}

	// ========================
	// Report List
	// ========================

	/// <summary>
	/// The list of reports: a search over report numbers, members' names and owl numbers, a filter by status, and a page of reports at a time.
	/// </summary>
	/// <param name="options">{ onOpen(reportId) }</param>
	/// <returns>{ element, Reload(), Destroy() }</returns>
	function CreateList(options)
	{
		let status = "open";
		let reports = [];
		let hasMore = false;
		let isLoading = false;
		let searchTimer = null;

		/// <summary>
		/// Counts each load, so an answer to an older search arriving late is dropped.
		/// </summary>
		let generation = 0;

		const search = Element("input", { className: "mod-search", attributes: { type: "text", maxlength: 64, placeholder: T("report.searchPlaceholder") } });
		const chips = Element("div", { className: "mod-filters" });
		const error = Element("div", { className: "mod-error" });
		const list = Element("div", { className: "mod-list" });
		const more = Button(T("report.loadMore"), () => Load(true), "angles-down", "is-quiet");
		const element = Element("div", { className: "mod-view mod-list-view" },
		[
			Element("div", { className: "mod-search-row" }, [Icon("magnifying-glass"), search]),
			chips,
			error,
			list,
			more,
		]);

		more.hidden = true;

		/// <summary>
		/// Draw the status chips, with the chosen one marked.
		/// </summary>
		function RenderFilters()
		{
			chips.replaceChildren(...filters.map((value) => Element("button",
			{
				className: `mod-filter${value === status ? " is-active" : ""}`,
				text: T(value ? `report.status.${value}` : "report.filterAll"),
				on: { click: () =>
				{
					status = value;
					RenderFilters();
					Load(false);
				} },
			})));
		}

		/// <summary>
		/// Build the row of one report.
		/// </summary>
		/// <param name="report">Report summary</param>
		/// <returns>Row element</returns>
		function CreateRow(report)
		{
			const who = T("report.whoLine", { reporter: NameOf(report.reporterName), sender: NameOf(report.senderName) });
			const where = report.chatKind === "group" ? T("report.inGroup", { title: report.chatTitle || T("report.untitledGroup") }) : T(report.source === "letter" ? "report.sourceLetter" : "report.sourcePhone");

			return Element("button", { className: `mod-row is-${report.status}`, on: { click: () => options.onOpen(report.id) } },
			[
				Element("span", { className: "mod-row-text" },
				[
					Element("span", { className: "mod-row-title", text: T("report.chatTitle", { number: FormatReportNumber(report.id) }) }),
					Element("span", { className: "mod-row-subtitle", text: who }),
					Element("span", { className: "mod-row-subtitle", text: `${where} · ${Owls.Util.FormatListTime(report.createdAt)}` }),
				]),
				StatusChip(report.status),
			]);
		}

		/// <summary>
		/// Draw the reports loaded so far.
		/// </summary>
		function Render()
		{
			list.replaceChildren(...(reports.length === 0 && !isLoading ? [Element("div", { className: "mod-empty", text: T(search.value.trim() ? "report.noMatches" : "report.empty") })] : reports.map(CreateRow)));
			more.hidden = !hasMore;
			more.disabled = isLoading;
		}

		/// <summary>
		/// Load the first page again, or the next one.
		/// </summary>
		/// <param name="isNextPage">True to add the next page to what is shown</param>
		async function Load(isNextPage)
		{
			const current = ++generation;
			const beforeId = isNextPage && reports.length > 0 ? reports[reports.length - 1].id : 0;
			isLoading = true;
			error.textContent = "";
			Render();

			const result = await Owls.Bridge.Request("reports.list", { query: search.value.trim(), status, beforeId });

			if (current !== generation)
			{
				return;
			}

			isLoading = false;

			if (!result.ok)
			{
				error.textContent = result.error;
				Render();
				return;
			}

			reports = isNextPage ? [...reports, ...result.data.reports] : result.data.reports;
			hasMore = result.data.hasMore;
			Render();
		}

		search.addEventListener("input", () =>
		{
			clearTimeout(searchTimer);
			searchTimer = setTimeout(() => Load(false), searchDelayMs);
		});

		RenderFilters();
		Load(false);

		return {
			element,
			Reload: () => Load(false),
			Destroy: () => clearTimeout(searchTimer),
		};
	}

	// ========================
	// Reported Chat
	// ========================

	/// <summary>
	/// One reported chat: who reported whom and what became of it, everyone in the chat with their owl numbers, and the copied chat with the reported owl highlighted.
	/// Older and newer owls of the copy load on request.
	/// </summary>
	/// <param name="options">{ reportId, onTitle(text) }</param>
	/// <returns>{ element, Destroy() }</returns>
	function CreateReport(options)
	{
		let report = null;
		let messages = [];
		let hasOlder = false;
		let hasNewer = false;
		let isBusy = false;

		/// <summary>
		/// Names by owl number, from the report's members.
		/// </summary>
		const names = new Map();

		const summary = Element("div", { className: "mod-summary" });
		const members = Element("div", { className: "mod-members" });
		const error = Element("div", { className: "mod-error" });
		const older = Button(T("report.loadOlder"), () => LoadMore("older"), "angles-up", "is-quiet");
		const newer = Button(T("report.loadNewer"), () => LoadMore("newer"), "angles-down", "is-quiet");
		const thread = Element("div", { className: "mod-thread" });
		const actions = Element("div", { className: "mod-actions" });
		const element = Element("div", { className: "mod-view mod-report-view" },
		[
			summary,
			Element("div", { className: "mod-section-title", text: T("report.members") }),
			members,
			Element("div", { className: "mod-section-title", text: T("report.chat") }),
			error,
			Element("div", { className: "mod-thread-holder" }, [older, thread, newer]),
			actions,
		]);

		older.hidden = true;
		newer.hidden = true;
		thread.appendChild(Element("div", { className: "mod-empty", text: T("report.opening") }));

		/// <summary>
		/// A member's name and number, for a line of the copied chat.
		/// </summary>
		/// <param name="number">Owl number</param>
		/// <returns>Text</returns>
		function Describe(number)
		{
			return `${NameOf(names.get(number))} (${FormatOwlNumber(number)})`;
		}

		/// <summary>
		/// Draw the facts at the top: who reported whom, where and when, and what became of it.
		/// </summary>
		function RenderSummary()
		{
			const lines =
			[
				Element("div", { className: "mod-summary-head" }, [Element("span", { className: "mod-summary-title", text: T("report.chatTitle", { number: FormatReportNumber(report.id) }) }), StatusChip(report.status)]),
				Element("div", { className: "mod-summary-line", text: T("report.filedBy", { name: Describe(report.reporter), when: `${Owls.Util.FormatLongDate(report.createdAt)}, ${Owls.Util.FormatClock(report.createdAt)}` }) }),
				Element("div", { className: "mod-summary-line", text: T("report.reportedOwlFrom", { name: Describe(report.sender) }) }),
				Element("div", { className: "mod-summary-line is-dim", text: report.chatKind === "group" ? T("report.inGroup", { title: report.chatTitle || T("report.untitledGroup") }) : T(report.source === "letter" ? "report.sourceLetter" : "report.sourcePhone") }),
			];

			if (report.status !== "open" && report.handledBy)
			{
				lines.push(Element("div", { className: "mod-summary-line is-dim", text: T(`report.handled.${report.status}`, { name: report.handledBy, when: Owls.Util.FormatLongDate(report.handledAt) }) }));
			}

			summary.replaceChildren(...lines);
			options.onTitle(T("report.chatTitle", { number: FormatReportNumber(report.id) }));
		}

		/// <summary>
		/// Draw everyone who was in the chat: full name, owl number, and whether they reported or were reported.
		/// </summary>
		function RenderMembers()
		{
			members.replaceChildren(...report.members.map((member) =>
			{
				const roles = [];

				if (member.number === report.reporter)
				{
					roles.push(Element("span", { className: "mod-role is-reporter", text: T("report.roleReporter") }));
				}

				if (member.number === report.sender)
				{
					roles.push(Element("span", { className: "mod-role is-reported", text: T("report.roleReported") }));
				}

				const name = Element("span", { className: "mod-member-name", text: NameOf(member.name) });
				name.style.color = Owls.Util.GetNameColour(member.number);

				return Element("div", { className: "mod-member" }, [name, Element("span", { className: "mod-member-number", text: FormatOwlNumber(member.number) }), ...roles]);
			}));
		}

		/// <summary>
		/// What an owl of the copy says: its text, or a written-out location or poll.
		/// </summary>
		/// <param name="message">Copied message</param>
		/// <returns>Element</returns>
		function CreateContent(message)
		{
			if (message.unsent)
			{
				return Element("span", { className: "mod-unsent", text: T("report.unsent") });
			}

			try
			{
				if (message.kind === "location")
				{
					const location = JSON.parse(message.body);
					return Element("span", { text: `\u{1F4CD} ${location && location.place ? T("report.locationAt", { place: location.place }) : T("report.location")}` });
				}

				if (message.kind === "poll")
				{
					const poll = JSON.parse(message.body);
					return Element("span", { className: "mod-poll" },
					[
						Element("span", { className: "mod-poll-question", text: `\u{1F4CA} ${poll.question}` }),
						...(Array.isArray(poll.options) ? poll.options : []).map((option) => Element("span", { className: "mod-poll-option", text: `• ${option}` })),
					]);
				}
			}
			catch (parseError)
			{
				// A damaged location or poll is shown as its raw text rather than breaking the view.
			}

			return Element("span", { className: "mod-text", text: message.body });
		}

		/// <summary>
		/// Draw the loaded part of the copy, oldest first. The reporter's owls sit on the right, as they saw them; the reported owl is highlighted.
		/// </summary>
		function RenderThread()
		{
			const byId = new Map(messages.map((message) => [message.id, message]));
			let lastDay = 0;
			const rows = [];

			for (const message of messages)
			{
				const day = Owls.Util.GetDayStart(message.sentAt);

				if (day !== lastDay)
				{
					lastDay = day;
					rows.push(Element("div", { className: "mod-day", text: Owls.Util.FormatDay(message.sentAt) }));
				}

				const isReported = message.id === report.messageId;
				const sender = Element("span", { className: "mod-message-sender", text: Describe(message.sender) });
				sender.style.color = Owls.Util.GetNameColour(message.sender);

				const parts = [sender];

				if (isReported)
				{
					parts.unshift(Element("span", { className: "mod-reported-tag" }, [Icon("flag"), Element("span", { text: T("report.reportedOwl") })]));
				}

				if (message.forwarded && !message.unsent)
				{
					parts.push(Element("span", { className: "mod-message-note" }, [Icon("share"), Element("span", { text: T("report.forwarded") })]));
				}

				if (message.replyToId && !message.unsent)
				{
					const quoted = byId.get(message.replyToId);
					parts.push(Element("span", { className: "mod-quote", text: quoted ? T("report.replyTo", { name: NameOf(names.get(quoted.sender)), text: quoted.unsent ? T("report.unsent") : String(quoted.body).slice(0, 120) }) : T("report.replyToUnknown") }));
				}

				parts.push(CreateContent(message));
				parts.push(Element("span", { className: "mod-message-time", text: Owls.Util.FormatClock(message.sentAt) }));

				const row = Element("div", { className: `mod-message${message.sender === report.reporter ? " is-reporter" : ""}${isReported ? " is-reported" : ""}` }, parts);
				row.dataset.messageId = String(message.id);
				rows.push(row);
			}

			thread.replaceChildren(...(rows.length > 0 ? rows : [Element("div", { className: "mod-empty", text: T("report.chatEmpty") })]));
			older.hidden = !hasOlder;
			newer.hidden = !hasNewer;
		}

		/// <summary>
		/// Draw the buttons that mark the report, which depend on its status.
		/// </summary>
		function RenderActions()
		{
			const buttons = report.status === "open"
				? [Button(T("report.resolve"), () => SetStatus("resolved"), "check", "is-primary"), Button(T("report.dismiss"), () => SetStatus("dismissed"), "xmark")]
				: [Button(T("report.reopen"), () => SetStatus("open"), "rotate-left")];

			for (const button of buttons)
			{
				button.disabled = isBusy;
			}

			actions.replaceChildren(...buttons);
		}

		/// <summary>
		/// Mark the report.
		/// </summary>
		/// <param name="status">"open", "resolved" or "dismissed"</param>
		async function SetStatus(status)
		{
			if (isBusy)
			{
				return;
			}

			isBusy = true;
			error.textContent = "";
			RenderActions();
			const result = await Owls.Bridge.Request("reports.setStatus", { reportId: report.id, status });
			isBusy = false;

			if (!result.ok)
			{
				error.textContent = result.error;
				RenderActions();
				return;
			}

			report = { ...report, ...result.data.report, members: report.members, messageId: report.messageId };
			RenderSummary();
			RenderActions();
		}

		/// <summary>
		/// Load more of the copy before or after what is shown, keeping the reader's place when older owls arrive above.
		/// </summary>
		/// <param name="direction">"older" or "newer"</param>
		async function LoadMore(direction)
		{
			if (isBusy || messages.length === 0)
			{
				return;
			}

			isBusy = true;
			const anchorId = direction === "older" ? messages[0].id : messages[messages.length - 1].id;
			const result = await Owls.Bridge.Request("reports.messages", { reportId: report.id, anchorId, direction });
			isBusy = false;

			if (!result.ok)
			{
				error.textContent = result.error;
				return;
			}

			const page = result.data.page;
			const firstBefore = thread.querySelector(".mod-message");

			if (direction === "older")
			{
				messages = [...page.messages, ...messages];
				hasOlder = page.hasOlder === true;
			}
			else
			{
				messages = [...messages, ...page.messages];
				hasNewer = page.hasNewer === true;
			}

			RenderThread();

			if (direction === "older" && firstBefore)
			{
				const same = thread.querySelector(`[data-message-id="${firstBefore.dataset.messageId}"]`);

				if (same)
				{
					same.scrollIntoView({ block: "start" });
				}
			}
		}

		/// <summary>
		/// Fetch the report and the copy around the reported owl, then bring that owl into view.
		/// </summary>
		async function Open()
		{
			const result = await Owls.Bridge.Request("reports.open", { reportId: options.reportId });

			if (!result.ok)
			{
				thread.replaceChildren();
				error.textContent = result.error;
				return;
			}

			report = result.data.report;
			names.clear();

			for (const member of report.members)
			{
				names.set(member.number, member.name);
			}

			messages = result.data.page.messages;
			hasOlder = result.data.page.hasOlder === true;
			hasNewer = result.data.page.hasNewer === true;
			RenderSummary();
			RenderMembers();
			RenderThread();
			RenderActions();

			const reported = thread.querySelector(".mod-message.is-reported");

			if (reported)
			{
				reported.scrollIntoView({ block: "center" });
			}
		}

		Open();
		return { element, Destroy: () => {} };
	}

	return { FormatReportNumber, CreateList, CreateReport };
})();
