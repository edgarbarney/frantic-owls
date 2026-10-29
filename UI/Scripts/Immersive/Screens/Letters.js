// FranticDreamer 2026
"use strict";

window.Owls = window.Owls || {};
Owls.DeskScreens = Owls.DeskScreens || {};

// ========================
// Letters Screen
// ========================

/// <summary>
/// The list of letters: the inbox (letters that arrived) and the sent box (letters the player wrote), newest first.
///
/// <para>
/// NOTE: A received letter is listed by its own first and last lines (greeting and signature), never by who sent it:
/// the server does not tell a reader who wrote a letter, so a writer can stay anonymous by not signing it.
/// Official letters (the Ministry, other resources' senders) are the exception and carry their sender's name.
/// </para>
///
/// </summary>
Owls.DeskScreens.Letters = (() =>
{
	const { Element, FormatListTime } = Owls.Util;
	const T = Owls.Lang.T;
	const Store = Owls.MailStore;

	/// <summary>
	/// The box shown last, so coming back from a letter lands where the player was.
	/// </summary>
	let currentBox = "inbox";

	/// <summary>
	/// Build the screen.
	/// </summary>
	/// <param name="desk">Owls.Desk, for navigation and messages</param>
	/// <param name="params">{ box } (optional)</param>
	/// <returns>{ element, OnStore(reason), Destroy() }</returns>
	function Create(desk, params = {})
	{
		currentBox = params.box === "sent" ? "sent" : params.box === "inbox" ? "inbox" : currentBox;

		const tabs = Element("div", { className: "letters-tabs", attributes: { role: "tablist" } });
		const writeButton = Element("button", { className: "desk-button is-primary", on: { click: () => desk.Compose({}) } },
		[
			Element("i", { className: "fa-solid fa-feather-pointed", attributes: { "aria-hidden": "true" } }),
			Element("span", { text: T("mail.list.write") }),
		]);
		const hint = Element("p", { className: "letters-hint" });
		const list = Element("ul", { className: "letters-list" });
		const empty = Element("p", { className: "letters-empty" });
		const moreButton = Element("button", { className: "desk-button is-quiet letters-more", text: T("mail.list.older"), on: { click: () => Load(true) } });
		const element = Element("section", { className: "letters" },
		[
			Element("div", { className: "letters-head" }, [tabs, writeButton]),
			hint,
			Element("div", { className: "letters-scroll" }, [list, empty, moreButton]),
		]);

		let isLoading = false;

		/// <summary>
		/// Fetch the newest page of the current box, or the next older one.
		/// </summary>
		/// <param name="older">True to fetch the page below what is listed</param>
		async function Load(older)
		{
			if (isLoading)
			{
				return;
			}

			const box = Store.state.boxes[currentBox];
			const last = older && box.letters.length > 0 ? box.letters[box.letters.length - 1].id : 0;
			isLoading = true;
			Render();

			const result = await Owls.Bridge.Request("mail.list", { box: currentBox, beforeId: last });
			isLoading = false;

			if (!result.ok)
			{
				desk.ShowError(result.error);
				Render();
				return;
			}

			Store.ApplyPage(result.data);
		}

		/// <summary>
		/// Switch between the inbox and the sent box.
		/// </summary>
		/// <param name="box">"inbox" or "sent"</param>
		function ShowBox(box)
		{
			currentBox = box;
			Render();
			Load(false);
		}

		/// <summary>
		/// The names a sent letter went to, as the writer knows them.
		/// </summary>
		/// <param name="letter">Sent letter</param>
		/// <returns>Phrase such as "To Ominis and Natsai"</returns>
		function DescribeRecipients(letter)
		{
			if (letter.groupTitle)
			{
				return T("mail.list.toGroup", { title: letter.groupTitle });
			}

			const names = letter.recipients.map((number) => Store.GetContactName(number) || T("mail.list.unknownRecipient"));
			return T("mail.list.to", { names: names.length > 0 ? Owls.Sheet.JoinNames(names) : T("mail.list.unknownRecipient") });
		}

		/// <summary>
		/// One row of the list.
		/// </summary>
		/// <param name="letter">Listed letter</param>
		/// <returns>List item</returns>
		function CreateRow(letter)
		{
			const excerpt = letter.excerpt;
			let from = "";
			let preview = "";

			if (letter.box === "sent")
			{
				from = DescribeRecipients(letter);
			}
			else if (letter.official)
			{
				from = letter.official.name;
			}
			else if (excerpt && excerpt.last)
			{
				from = T("mail.list.signed", { name: excerpt.last });
			}
			else
			{
				from = T(letter.isReadable ? "mail.list.unsigned" : "mail.list.sealed");
			}

			if (excerpt)
			{
				preview = excerpt.second || excerpt.first;
			}
			else
			{
				preview = T(letter.readProblem || "mail.list.sealedHint");
			}

			const classes = ["letter-row", letter.isUnread ? "is-unread" : "", !letter.isReadable ? "is-locked" : "", letter.official ? "is-official" : ""].filter(Boolean).join(" ");

			return Element("li", { className: classes },
			[
				Element("button", { className: "letter-button", on: { click: () => Open(letter) } },
				[
					// The row's classes pick the picture: a sealed envelope while unread, an opened one after, faded with a padlock where it cannot be read.
					Element("span", { className: "letter-icon", attributes: { "aria-hidden": "true" } }),
					Element("span", { className: "letter-lines" },
					[
						Element("span", { className: "letter-from", text: from }),
						Element("span", { className: "letter-preview", text: preview }),
					]),
					Element("span", { className: "letter-meta" },
					[
						Element("span", { className: "letter-time", text: FormatListTime(letter.arrivedAt) }),
						letter.groupTitle && letter.box === "inbox" ? Element("span", { className: "letter-tag", text: letter.groupTitle }) : null,
					]),
				]),
			]);
		}

		/// <summary>
		/// Open a letter, or say why it cannot be read here.
		/// </summary>
		/// <param name="letter">Listed letter</param>
		function Open(letter)
		{
			if (!letter.isReadable)
			{
				desk.ShowError(T(letter.readProblem || "mail.list.sealedHint"));
				return;
			}

			desk.Read(letter);
		}

		/// <summary>
		/// Draw the tabs, hint and list from the store.
		/// </summary>
		function Render()
		{
			const box = Store.state.boxes[currentBox];
			const unread = Store.state.unread;

			tabs.replaceChildren
			(
				Element("button", { className: `letters-tab ${currentBox === "inbox" ? "is-active" : ""}`, attributes: { role: "tab" }, on: { click: () => ShowBox("inbox") } },
				[
					Element("span", { text: T("mail.list.inbox") }),
					unread > 0 ? Element("span", { className: "letters-badge", text: unread > 99 ? "99+" : String(unread) }) : null,
				]),
				Element("button", { className: `letters-tab ${currentBox === "sent" ? "is-active" : ""}`, attributes: { role: "tab" }, text: T("mail.list.sent"), on: { click: () => ShowBox("sent") } }),
			);

			const canWrite = Store.CanWrite();
			writeButton.disabled = !canWrite;
			writeButton.title = canWrite ? "" : T("error.mail.writeAtPost");
			hint.textContent = desk.GetPlaceHint();
			hint.hidden = hint.textContent.length === 0;

			list.replaceChildren(...box.letters.map(CreateRow));
			empty.textContent = isLoading && box.letters.length === 0 ? T("mail.list.loading") : T(currentBox === "inbox" ? "mail.list.emptyInbox" : "mail.list.emptySent");
			empty.hidden = box.letters.length > 0;
			moreButton.hidden = !box.hasMore;
			moreButton.disabled = isLoading;
		}

		Render();
		Load(false);

		return {
			element,
			OnStore: (reason) =>
			{
				// A letter that just arrived is fetched with the inbox's newest page.
				if (reason === "arrived" && currentBox === "inbox")
				{
					Load(false);
					return;
				}

				Render();
			},
			Refresh: () => Load(false),
			Destroy: () => {},
		};
	}

	return { Create };
})();
