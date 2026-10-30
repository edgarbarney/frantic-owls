// FranticDreamer 2026
"use strict";

window.Owls = window.Owls || {};
Owls.DeskScreens = Owls.DeskScreens || {};

// ========================
// Reader Screen
// ========================

/// <summary>
/// One letter, laid out on its sheet exactly as its writer wrote it.
/// The server only sends a letter's text when it may be read where the player stands, and opening an unread letter marks it read.
/// </summary>
Owls.DeskScreens.Reader = (() =>
{
	const { Element, FormatLongDate, FormatClock } = Owls.Util;
	const T = Owls.Lang.T;
	const Store = Owls.MailStore;

	/// <summary>
	/// Build the screen.
	/// </summary>
	/// <param name="desk">Owls.Desk, for navigation and messages</param>
	/// <param name="params">{ letter } as listed</param>
	/// <returns>{ element, OnStore(reason), Destroy() }</returns>
	function Create(desk, params)
	{
		const listed = params.letter;
		const backButton = Element("button", { className: "desk-button is-quiet", on: { click: () => desk.ShowLetters({ box: listed.box }) } },
		[
			Element("i", { className: "fa-solid fa-arrow-left", attributes: { "aria-hidden": "true" } }),
			Element("span", { text: T("mail.reader.back") }),
		]);
		const details = Element("span", { className: "reader-details" });
		const replyButton = Element("button", { className: "desk-button is-primary" },
		[
			Element("i", { className: "fa-solid fa-feather-pointed", attributes: { "aria-hidden": "true" } }),
			Element("span", { text: T("mail.reader.reply") }),
		]);
		const stage = Element("div", { className: "reader-stage" }, [Element("p", { className: "desk-loading", text: T("mail.reader.opening") })]);
		const element = Element("section", { className: "reader" },
		[
			Element("div", { className: "desk-toolbar" }, [backButton, details, Element("div", { className: "desk-toolbar-actions" }, [replyButton])]),
			stage,
		]);

		replyButton.hidden = true;

		/// <summary>
		/// Describe when (and, for a sent letter, to whom) the letter went.
		/// </summary>
		/// <param name="letter">Opened letter</param>
		/// <returns>One line</returns>
		function Describe(letter)
		{
			const when = `${FormatLongDate(letter.arrivedAt)}, ${FormatClock(letter.arrivedAt)}`;

			if (letter.box === "sent")
			{
				const names = letter.recipients.map((name) => name || T("mail.list.unknownRecipient"));
				return T("mail.reader.sentTo", { names: names.length > 0 ? Owls.Sheet.JoinNames(names) : T("mail.list.unknownRecipient"), when });
			}

			return letter.official ? T("mail.reader.officialArrived", { name: letter.official.name, when }) : T("mail.reader.arrived", { when });
		}

		/// <summary>
		/// Ask the server for the letter's text and lay it out.
		/// </summary>
		async function Load()
		{
			const result = await Owls.Bridge.Request("mail.open", { messageId: listed.id });

			if (!result.ok)
			{
				desk.ShowError(result.error);
				desk.ShowLetters({ box: listed.box });
				return;
			}

			const letter = result.data.letter;
			Store.ApplyOpened(letter, result.data.unread);
			details.textContent = Describe(letter);
			stage.replaceChildren(Owls.Sheet.CreateReading(letter.text).slot);

			if (letter.canReply)
			{
				replyButton.hidden = false;
				replyButton.disabled = !Store.CanWrite();
				replyButton.title = Store.CanWrite() ? "" : T("error.mail.writeAtPost");
				replyButton.addEventListener("click", () => desk.Compose({ replyTo: letter }));
			}
		}

		Load();

		return {
			element,
			OnStore: (reason) =>
			{
				if (reason === "post" && !replyButton.hidden)
				{
					replyButton.disabled = !Store.CanWrite();
				}
			},
			Destroy: () => {},
		};
	}

	return { Create };
})();
