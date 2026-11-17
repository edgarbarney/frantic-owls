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
///
/// <para>
/// NOTE: Under a letter someone else wrote sit Block and Report. The reader is never told who wrote a letter, so Block is always anonymous:
/// it stops every letter from that writer, names nobody, and cannot be undone or listed (an undo or a list would unmask the writer).
/// Its pop-up offers to report the letter in the same step. Known correspondents are blocked, and unblocked, from the Correspondents tab instead.
/// </para>
///
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
		const enclosure = Element("div", { className: "letter-enclosure" });
		const blockButton = Element("button", { className: "desk-button", on: { click: () => ShowDialog("block") } },
		[
			Element("i", { className: "fa-solid fa-ban", attributes: { "aria-hidden": "true" } }),
			Element("span", { text: T("mail.reader.block") }),
		]);
		const reportButton = Element("button", { className: "desk-button", on: { click: () => ShowDialog("report") } },
		[
			Element("i", { className: "fa-solid fa-flag", attributes: { "aria-hidden": "true" } }),
			Element("span", { text: T("mail.reader.report") }),
		]);
		const footer = Element("div", { className: "reader-footer" }, [blockButton, reportButton]);
		const dialog = Element("div", { className: "desk-dialog-backdrop" });
		const element = Element("section", { className: "reader" },
		[
			Element("div", { className: "desk-toolbar" }, [backButton, details, Element("div", { className: "desk-toolbar-actions" }, [replyButton])]),
			enclosure,
			stage,
			footer,
			dialog,
		]);

		replyButton.hidden = true;
		enclosure.hidden = true;
		footer.hidden = true;
		dialog.hidden = true;

		/// <summary>
		/// Whether a block or report request is on its way, so the dialog's buttons cannot send a second one.
		/// </summary>
		let isSending = false;

		/// <summary>
		/// Hide the block or report dialog.
		/// </summary>
		function HideDialog()
		{
			dialog.hidden = true;
			dialog.replaceChildren();
		}

		/// <summary>
		/// Ask before blocking the letter's writer or reporting the letter.
		/// </summary>
		/// <param name="kind">"block" or "report"</param>
		function ShowDialog(kind)
		{
			if (!opened)
			{
				return;
			}

			/// <summary>
			/// One button of the dialog.
			/// </summary>
			/// <param name="label">Text</param>
			/// <param name="className">Extra classes</param>
			/// <param name="OnClick">Click handler</param>
			/// <returns>Button</returns>
			function DialogButton(label, className, OnClick)
			{
				return Element("button", { className: `desk-button ${className}`.trim(), on: { click: OnClick } }, [Element("span", { text: label })]);
			}

			const buttons = kind === "block"
				? [
					DialogButton(T("common.cancel"), "is-quiet", HideDialog),
					DialogButton(T("mail.reader.blockConfirm"), "", () => Block(false)),
					DialogButton(T("mail.reader.blockAndReport"), "is-primary", () => Block(true)),
				]
				: [
					DialogButton(T("common.cancel"), "is-quiet", HideDialog),
					DialogButton(T("mail.reader.reportConfirm"), "is-primary", Report),
				];

			dialog.replaceChildren(Element("div", { className: "desk-dialog", attributes: { role: "alertdialog", "aria-modal": "true" } },
			[
				Element("p", { className: "desk-dialog-title", text: T(kind === "block" ? "mail.reader.blockTitle" : "mail.reader.reportTitle") }),
				Element("p", { className: "desk-dialog-text", text: T(kind === "block" ? "mail.reader.blockWarning" : "mail.reader.reportWarning") }),
				Element("div", { className: "desk-dialog-actions" }, buttons),
			]));
			dialog.hidden = false;
		}

		/// <summary>
		/// Block the letter's writer anonymously, reporting the letter first if asked, then go back to the inbox, which no longer holds their letters.
		/// </summary>
		/// <param name="report">Whether to report the letter too</param>
		async function Block(report)
		{
			if (isSending || !opened)
			{
				return;
			}

			isSending = true;
			const result = await Owls.Bridge.Request("mail.blockWriter", { messageId: opened.id, report });
			isSending = false;
			HideDialog();

			if (!result.ok)
			{
				desk.ShowError(result.error);
				return;
			}

			Store.ForgetLetters(result.data.unread);
			desk.ShowNotice(T("mail.reader.blocked"), T(result.data.reportId > 0 ? "mail.reader.blockedAndReported" : "mail.reader.blockedHint"));
			desk.ShowLetters({ box: "inbox" });
		}

		/// <summary>
		/// Report the letter to the moderators.
		/// </summary>
		async function Report()
		{
			if (isSending || !opened)
			{
				return;
			}

			isSending = true;
			const result = await Owls.Bridge.Request("mail.report", { messageId: opened.id });
			isSending = false;
			HideDialog();

			if (!result.ok)
			{
				desk.ShowError(result.error);
				return;
			}

			desk.ShowNotice(T("report.sentTitle"), T(result.data.isNew ? "report.sentBody" : "report.alreadySent"));
		}

		/// <summary>
		/// The letter as opened, once it is; null until then.
		/// </summary>
		let opened = null;

		/// <summary>
		/// Whether a collect request is on its way, so a second click does not send another.
		/// </summary>
		let isCollecting = false;

		/// <summary>
		/// Draw the Galleons enclosed with the letter: Collect for its recipient while they wait, otherwise what became of them.
		/// Neither side is told who the other is; a parcel that went back says only that it went back to the sender.
		/// </summary>
		function RenderEnclosure()
		{
			const parcel = opened ? Store.GetParcel(opened) : null;
			enclosure.hidden = !parcel;

			if (!parcel)
			{
				return;
			}

			const items = parcel.items || [];
			const icon = Element("i", { className: `fa-solid ${items.length > 0 ? "fa-box-open" : "fa-coins"}`, attributes: { "aria-hidden": "true" } });
			const lines = parcel.galleons > 0 ? [Element("span", { className: "letter-enclosure-line", text: T("parcel.galleons", { count: parcel.galleons }) })] : [];

			for (const item of items)
			{
				lines.push(Element("span", { className: "letter-enclosure-line", text: T("parcel.itemLine", { label: item.label, count: item.amount }) }));
			}

			const parts = [icon, Element("span", { className: "letter-enclosure-amount" }, [Element("span", { className: "letter-enclosure-title", text: T("parcel.enclosed") }), ...lines])];

			if (parcel.status === "waiting" && opened.box === "inbox")
			{
				const collect = Element("button", { className: "desk-button is-primary", text: T(isCollecting ? "parcel.collecting" : "parcel.collect"), on: { click: Collect } });
				collect.disabled = isCollecting;
				parts.push(collect);
			}
			else
			{
				parts.push(Element("span", { className: "letter-enclosure-status", text: T(`parcel.status.${parcel.status}`) }));
			}

			enclosure.className = `letter-enclosure is-${parcel.status}`;
			enclosure.replaceChildren(...parts);
		}

		/// <summary>
		/// Collect the Galleons enclosed with the letter.
		/// </summary>
		async function Collect()
		{
			if (isCollecting || !opened)
			{
				return;
			}

			isCollecting = true;
			RenderEnclosure();
			const result = await Owls.Bridge.Request("parcels.collect", { messageId: opened.id });
			isCollecting = false;

			if (!result.ok)
			{
				desk.ShowError(result.error);
				RenderEnclosure();
				return;
			}

			Store.SetParcel(opened.id, result.data.parcel || null);
		}

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
			opened = letter;
			Store.ApplyOpened(letter, result.data.unread);
			details.textContent = Describe(letter);
			stage.replaceChildren(Owls.Sheet.CreateReading(letter.text).slot);
			RenderEnclosure();

			// Only a letter someone else wrote can be blocked or reported; official letters come from no character.
			footer.hidden = letter.box !== "inbox" || !!letter.official;
			reportButton.hidden = Store.state.config.reportsEnabled === false;

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

				if (reason === "parcel")
				{
					RenderEnclosure();
				}
			},
			Destroy: () => {},
		};
	}

	return { Create };
})();
