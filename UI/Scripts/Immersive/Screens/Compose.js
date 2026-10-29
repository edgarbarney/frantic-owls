// FranticDreamer 2026
"use strict";

window.Owls = window.Owls || {};
Owls.DeskScreens = Owls.DeskScreens || {};

// ========================
// Compose Screen
// ========================

/// <summary>
/// Writing a letter.
///
/// <para>
/// NOTE: By default the player writes only the middle of the letter: the greeting ("Dear Ominis and Natsai,") follows the recipients they pick,
/// and the sign-off and their name are filled in below. The quill button turns the whole letter into one page of text, greeting and signature included,
/// so they can be reworded or left out (an unsigned letter is anonymous to its reader). Either way the server stores the finished text and nothing else.
/// </para>
///
/// <para>
/// NOTE: Recipients come from two lists kept apart on purpose: owls online now, and the player's correspondents (everyone they have written to).
/// Merging them by owl number would show which correspondent is which online character, which an anonymous letter's reader is not meant to learn.
/// Answering a letter adds its writer as a recipient by the letter, not by name; the server finds who wrote it.
/// </para>
///
/// </summary>
Owls.DeskScreens.Compose = (() =>
{
	const { Element, Matches, NewKey } = Owls.Util;
	const T = Owls.Lang.T;
	const Store = Owls.MailStore;

	/// <summary>
	/// Most suggestions shown under the recipient field at once.
	/// </summary>
	const maxSuggestions = 30;

	/// <summary>
	/// How long a button waits for its confirming second click.
	/// </summary>
	const confirmMs = 4000;

	/// <summary>
	/// How long after the last keystroke the draft is saved.
	/// </summary>
	const draftSaveDelayMs = 400;

	/// <summary>
	/// Build the screen.
	/// </summary>
	/// <param name="desk">Owls.Desk, for navigation and messages</param>
	/// <param name="params">{ replyTo } with the opened letter being answered (optional)</param>
	/// <returns>{ element, OnStore(reason), Destroy() }</returns>
	function Create(desk, params = {})
	{
		const replyTo = params.replyTo || null;
		const draftKey = replyTo ? `reply:${replyTo.id}` : "new";
		const config = Store.state.config;
		const maxLength = Number(config.maxLetterLength) || 4000;
		const maxRecipients = Number(config.maxRecipients) || 8;
		const saved = Store.LoadDraft(draftKey);

		const draft =
		{
			recipients: saved && Array.isArray(saved.recipients) ? saved.recipients : [],
			body: saved ? String(saved.body || "") : "",
			isFull: !!(saved && saved.isFull),
			fullText: saved ? String(saved.fullText || "") : "",
		};

		// Answering adds the letter's writer, named the way they signed (or as the official sender they are).
		if (replyTo && !draft.recipients.some((recipient) => recipient.kind === "reply"))
		{
			const label = replyTo.official ? replyTo.official.name : replyTo.excerpt && replyTo.excerpt.last ? replyTo.excerpt.last : "";
			draft.recipients.unshift({ key: `reply:${replyTo.id}`, kind: "reply", replyToId: replyTo.id, name: label });
		}

		let online = [];
		let isSending = false;
		let saveTimer = null;
		let confirmTimer = null;
		let pendingConfirm = "";
		let picker = null;

		const element = Element("section", { className: "compose" });
		const counter = Element("span", { className: "compose-counter" });
		const status = Element("span", { className: "compose-status" });
		const sealButton = Element("button", { className: "seal", title: T("mail.compose.send"), attributes: { "aria-label": T("mail.compose.send") }, on: { click: Send } });
		const sealHint = Element("span", { className: "seal-hint", text: T("mail.compose.seal") });

		/// <summary>
		/// The names the letter is addressed to, in order, as the greeting uses them.
		/// </summary>
		/// <returns>Names</returns>
		function GetNames()
		{
			return draft.recipients.map((recipient) => recipient.name || T("mail.letter.noName"));
		}

		/// <summary>
		/// The letter's finished text, as it will be stored and read.
		/// </summary>
		/// <returns>Text</returns>
		function GetLetterText()
		{
			return draft.isFull ? draft.fullText : Owls.Sheet.Compose(GetNames(), draft.body, Store.state.me.name);
		}

		/// <summary>
		/// Save the draft a moment after the player stops typing.
		/// </summary>
		function QueueSave()
		{
			clearTimeout(saveTimer);
			saveTimer = setTimeout(SaveNow, draftSaveDelayMs);
		}

		/// <summary>
		/// Save the draft now, or forget it when nothing has been written or picked yet.
		/// </summary>
		function SaveNow()
		{
			clearTimeout(saveTimer);
			saveTimer = null;
			const isEmpty = draft.body.trim().length === 0 && (!draft.isFull || draft.fullText.trim().length === 0) && draft.recipients.every((recipient) => recipient.kind === "reply");
			Store.SaveDraft(draftKey, isEmpty ? null : { ...draft, savedAt: Date.now() });
		}

		/// <summary>
		/// Show how much of the letter's length is used, and whether it may be sent.
		/// </summary>
		function UpdateCounter()
		{
			const length = GetLetterText().length;
			counter.textContent = T("mail.compose.counter", { count: length, max: maxLength });
			counter.classList.toggle("is-over", length > maxLength);
			sealButton.disabled = isSending || !Store.CanWrite();
		}

		/// <summary>
		/// Make a button act only on a second click within a few seconds, showing what the second click will do.
		/// </summary>
		/// <param name="button">Button</param>
		/// <param name="id">Name of the action, so another button's pending click does not count</param>
		/// <param name="confirmText">Text shown while it waits</param>
		/// <returns>True when this click is the confirming one</returns>
		function Confirm(button, id, confirmText)
		{
			if (pendingConfirm === id)
			{
				clearTimeout(confirmTimer);
				pendingConfirm = "";
				return true;
			}

			pendingConfirm = id;
			const label = button.querySelector("span");
			const original = label.textContent;
			label.textContent = confirmText;
			button.classList.add("is-confirming");
			clearTimeout(confirmTimer);
			confirmTimer = setTimeout(() =>
			{
				pendingConfirm = "";
				label.textContent = original;
				button.classList.remove("is-confirming");
			}, confirmMs);
			return false;
		}

		// ========================
		// Recipients
		// ========================

		/// <summary>
		/// Create the recipient field: the names picked so far, a text box to find more, and the suggestions under it.
		/// In template mode it is the greeting line itself ("Dear [names],"); in full mode it sits above the sheet ("To: [names]").
		/// </summary>
		/// <param name="isGreeting">True for the greeting line on the sheet</param>
		/// <returns>{ element, Render(), Refresh(), Focus() }</returns>
		function CreatePicker(isGreeting)
		{
			// The greeting's words come from the language file around {names}, so the field reads exactly like the line it becomes.
			const [before, after] = isGreeting ? T("mail.letter.salutation", { names: "\u0000" }).split("\u0000") : [T("mail.compose.to"), ""];
			const names = Element("span", { className: "picker-names" });
			const input = Element("input", { className: "picker-input", attributes: { type: "text", autocomplete: "off", spellcheck: "false", maxlength: "64" } });
			const list = Element("ul", { className: "picker-list" });
			const dropdown = Element("div", { className: "picker-dropdown" }, [list]);
			const field = Element("span", { className: "picker-field" }, [input, dropdown]);
			const pickerElement = Element("div", { className: `picker ${isGreeting ? "is-greeting" : "is-address"}`, on: { click: FocusFromLine } },
			[
				Element("span", { className: "picker-before", text: before }),
				names,
				field,
				after ? Element("span", { className: "picker-after", text: after }) : null,
			]);

			/// <summary>
			/// Clicking anywhere on the line (but not on a name, which crosses it out) puts the cursor in the text box.
			/// </summary>
			/// <param name="event">Click event</param>
			function FocusFromLine(event)
			{
				if (!event.target.closest(".picker-name, .picker-dropdown"))
				{
					input.focus();
				}
			}

			/// <summary>
			/// The suggestions matching what is typed: owls online, then correspondents, leaving out anyone already picked from the same list.
			/// </summary>
			/// <returns>[{ heading } | { recipient }]</returns>
			function GetSuggestions()
			{
				const query = input.value.trim();
				const picked = new Set(draft.recipients.map((recipient) => recipient.key));
				const onlineMatches = online.filter((entry) => Matches(entry.name, query)).map((entry) => ({ key: `online:${entry.number}`, kind: "online", number: entry.number, name: entry.name })).filter((entry) => !picked.has(entry.key));
				const contactMatches = Store.state.contacts.filter((contact) => Matches(contact.name, query)).map((contact) => ({ key: `contact:${contact.number}`, kind: "contact", number: contact.number, name: contact.name })).filter((entry) => !picked.has(entry.key));
				const rows = [];

				if (onlineMatches.length > 0)
				{
					rows.push({ heading: T("mail.compose.online") }, ...onlineMatches.slice(0, maxSuggestions).map((recipient) => ({ recipient })));
				}

				if (contactMatches.length > 0)
				{
					rows.push({ heading: T("mail.compose.correspondents") }, ...contactMatches.slice(0, maxSuggestions).map((recipient) => ({ recipient })));
				}

				return rows;
			}

			/// <summary>
			/// Draw the suggestions.
			/// </summary>
			function RenderSuggestions()
			{
				const rows = GetSuggestions();

				if (rows.length === 0)
				{
					list.replaceChildren(Element("li", { className: "picker-none", text: T(draft.recipients.length >= maxRecipients ? "mail.compose.recipientsFull" : "mail.compose.noMatches") }));
					return;
				}

				list.replaceChildren(...rows.map((row) => (row.heading ? Element("li", { className: "picker-heading", text: row.heading }) : CreateOption(row.recipient))));
			}

			/// <summary>
			/// One suggestion. It is picked on mousedown, before the text box loses focus and the suggestions close.
			/// </summary>
			/// <param name="recipient">Suggested recipient</param>
			/// <returns>List item</returns>
			function CreateOption(recipient)
			{
				const option = Element("li", { className: "picker-option", text: recipient.name });

				option.addEventListener("mousedown", (event) =>
				{
					event.preventDefault();
					Pick(recipient);
				});

				return option;
			}

			/// <summary>
			/// Add a recipient.
			/// </summary>
			/// <param name="recipient">Suggestion picked</param>
			function Pick(recipient)
			{
				if (draft.recipients.length >= maxRecipients)
				{
					desk.ShowError(T("error.mail.tooManyRecipients", { count: maxRecipients }));
					return;
				}

				draft.recipients.push(recipient);
				input.value = "";
				OnRecipientsChanged();
				RenderSuggestions();
			}

			/// <summary>
			/// Remove a recipient.
			/// </summary>
			/// <param name="key">Recipient key</param>
			function Unpick(key)
			{
				draft.recipients = draft.recipients.filter((recipient) => recipient.key !== key);
				OnRecipientsChanged();
				RenderSuggestions();
			}

			/// <summary>
			/// Draw the names picked so far, joined the way the greeting will join them.
			/// </summary>
			function Render()
			{
				const shown = GetNames();
				let parts = [];

				// formatToParts gives the names with the language's own "and" between them; Intl throws for a locale it cannot parse.
				try
				{
					parts = shown.length > 0 ? new Intl.ListFormat(Owls.Lang.GetId(), { style: "long", type: "conjunction" }).formatToParts(shown) : [];
				}
				catch (error)
				{
					parts = shown.flatMap((name, index) => (index === 0 ? [{ type: "element", value: name }] : [{ type: "literal", value: ", " }, { type: "element", value: name }]));
				}

				let index = 0;
				names.replaceChildren(...parts.map((part) =>
				{
					if (part.type !== "element")
					{
						return Element("span", { className: "picker-literal", text: part.value });
					}

					const recipient = draft.recipients[index++];
					return Element("button", { className: `picker-name is-${recipient.kind}`, text: part.value, title: T("mail.compose.remove"), on: { click: () => Unpick(recipient.key) } });
				}));

				input.placeholder = T(draft.recipients.length === 0 ? "mail.compose.namePlaceholder" : "mail.compose.morePlaceholder");
				input.style.width = `${Math.max(6, (input.value || input.placeholder).length + 1)}ch`;
			}

			input.addEventListener("focus", () =>
			{
				RenderSuggestions();
				pickerElement.classList.add("is-open");
			});
			input.addEventListener("blur", () => pickerElement.classList.remove("is-open"));
			input.addEventListener("input", () =>
			{
				RenderSuggestions();
				input.style.width = `${Math.max(6, (input.value || input.placeholder).length + 1)}ch`;
			});
			input.addEventListener("keydown", (event) =>
			{
				if (event.key === "Backspace" && input.value === "" && draft.recipients.length > 0)
				{
					Unpick(draft.recipients[draft.recipients.length - 1].key);
				}
				else if (event.key === "Enter")
				{
					event.preventDefault();
					const first = GetSuggestions().find((row) => row.recipient);

					if (first)
					{
						Pick(first.recipient);
					}
				}
			});

			/// <summary>
			/// Draw the suggestions again if they are showing, e.g. once the owls online have arrived.
			/// </summary>
			function Refresh()
			{
				if (pickerElement.classList.contains("is-open"))
				{
					RenderSuggestions();
				}
			}

			Render();
			return { element: pickerElement, Render, Refresh, Focus: () => input.focus() };
		}

		/// <summary>
		/// Redraw what depends on the recipients: the greeting and the counter.
		/// </summary>
		function OnRecipientsChanged()
		{
			if (picker)
			{
				picker.Render();
			}

			UpdateCounter();
			QueueSave();
		}

		// ========================
		// Layout
		// ========================

		/// <summary>
		/// Lay the screen out for the current mode.
		/// </summary>
		function Build()
		{
			const backButton = Element("button", { className: "desk-button is-quiet", on: { click: () => { SaveNow(); desk.ShowLetters({}); } } },
			[
				Element("i", { className: "fa-solid fa-arrow-left", attributes: { "aria-hidden": "true" } }),
				Element("span", { text: T("mail.compose.back") }),
			]);
			const modeButton = Element("button", { className: `desk-button ${draft.isFull ? "is-active" : ""}`, title: T(draft.isFull ? "mail.compose.templateHint" : "mail.compose.fullHint") },
			[
				Element("i", { className: "fa-solid fa-feather-pointed", attributes: { "aria-hidden": "true" } }),
				Element("span", { text: T(draft.isFull ? "mail.compose.template" : "mail.compose.full") }),
			]);
			const discardButton = Element("button", { className: "desk-button is-quiet", title: T("mail.compose.discardHint") },
			[
				Element("i", { className: "fa-solid fa-trash-can", attributes: { "aria-hidden": "true" } }),
				Element("span", { text: T("mail.compose.discard") }),
			]);

			modeButton.addEventListener("click", () =>
			{
				if (!draft.isFull)
				{
					// The template is written out once; from here on the greeting and signature are the player's to change.
					draft.fullText = GetLetterText();
					draft.isFull = true;
				}
				else if (Confirm(modeButton, "template", T("mail.compose.templateConfirm")))
				{
					draft.isFull = false;
					draft.fullText = "";
				}
				else
				{
					return;
				}

				SaveNow();
				Build();
			});

			discardButton.addEventListener("click", () =>
			{
				if (Confirm(discardButton, "discard", T("mail.compose.discardConfirm")))
				{
					clearTimeout(saveTimer);
					saveTimer = null;
					Store.SaveDraft(draftKey, null);
					desk.ShowLetters({});
				}
			});

			const title = Element("span", { className: "compose-title", text: T(replyTo ? "mail.compose.titleReply" : "mail.compose.title") });
			const toolbar = Element("div", { className: "desk-toolbar" }, [backButton, title, modeButton, discardButton]);
			let sheet = null;
			let focusTarget = null;
			picker = CreatePicker(!draft.isFull);

			if (draft.isFull)
			{
				const text = Element("textarea", { className: "sheet-text compose-full", attributes: { spellcheck: "false", maxlength: String(maxLength), placeholder: T("mail.compose.bodyPlaceholder") } });
				text.value = draft.fullText;
				text.addEventListener("input", () =>
				{
					draft.fullText = text.value;
					UpdateCounter();
					QueueSave();
				});
				sheet = Owls.Sheet.Create([text], "is-writing");
				focusTarget = text;
			}
			else
			{
				const body = Element("textarea", { className: "sheet-text compose-body", attributes: { spellcheck: "false", maxlength: String(maxLength), placeholder: T("mail.compose.bodyPlaceholder") } });
				body.value = draft.body;
				body.addEventListener("input", () =>
				{
					draft.body = body.value;
					UpdateCounter();
					QueueSave();
				});

				const closing = Element("div", { className: "compose-closing" },
				[
					Element("div", { className: "compose-line", text: T("mail.letter.closing") }),
					Element("div", { className: "compose-line compose-signature", text: Store.state.me.name }),
				]);

				sheet = Owls.Sheet.Create([picker.element, body, closing], "is-writing is-template");
				focusTarget = draft.recipients.length === 0 ? null : body;
			}

			// The seal is pressed onto the sheet itself, so it scales with it.
			sheet.sheet.appendChild(Element("div", { className: "compose-seal" }, [sealButton, sealHint]));
			const stage = Element("div", { className: "compose-stage" }, [sheet.slot]);

			const parts =
			[
				toolbar,
				draft.isFull ? Element("div", { className: "compose-address" }, [picker.element]) : null,
				stage,
				Element("div", { className: "compose-footer" }, [status, counter]),
			];

			element.replaceChildren(...parts.filter(Boolean));

			UpdateCounter();
			requestAnimationFrame(() => (focusTarget ? focusTarget.focus() : picker.Focus()));
		}

		// ========================
		// Sending
		// ========================

		/// <summary>
		/// Seal the letter and send it, one copy per recipient.
		/// </summary>
		async function Send()
		{
			if (isSending)
			{
				return;
			}

			const text = GetLetterText();
			const reply = draft.recipients.find((recipient) => recipient.kind === "reply");
			const numbers = draft.recipients.filter((recipient) => recipient.kind !== "reply").map((recipient) => recipient.number);

			if (draft.recipients.length === 0)
			{
				desk.ShowError(T("error.mail.noRecipients"));
				picker.Focus();
				return;
			}

			if ((draft.isFull ? draft.fullText : draft.body).trim().length === 0)
			{
				desk.ShowError(T("error.emptyOwl"));
				return;
			}

			if (text.length > maxLength)
			{
				desk.ShowError(T("mail.compose.tooLong", { max: maxLength }));
				return;
			}

			isSending = true;
			status.textContent = T("mail.compose.sending");
			UpdateCounter();

			const result = await Owls.Bridge.Request("mail.send", { recipients: numbers, replyToId: reply ? reply.replyToId : 0, replyLabel: reply ? reply.name : "", body: text, clientKey: NewKey() });

			isSending = false;
			status.textContent = "";
			UpdateCounter();

			if (!result.ok)
			{
				desk.ShowError(result.error);
				return;
			}

			for (const contact of result.data.contacts || [])
			{
				Store.UpsertContact(contact);
			}

			clearTimeout(saveTimer);
			saveTimer = null;
			Store.SaveDraft(draftKey, null);
			Store.NoteSent();

			const failed = (result.data.failed || []).map((failure) =>
			{
				const recipient = draft.recipients.find((entry) => entry.number === failure.number) || reply;
				return { name: recipient && recipient.name ? recipient.name : T("mail.list.unknownRecipient"), error: T(failure.errorKey) };
			});

			desk.ShowDispatch((result.data.sent || []).length, failed);
			desk.ShowLetters({ box: "sent" });
		}

		/// <summary>
		/// Fetch the owls online to suggest as recipients.
		/// </summary>
		async function LoadOnline()
		{
			const result = await Owls.Bridge.Request("mail.recipients", {});

			if (result.ok)
			{
				online = Array.isArray(result.data.online) ? result.data.online : [];
				Store.SetPost(result.data.post || null);
				picker.Refresh();
			}
		}

		Build();
		LoadOnline();

		return {
			element,
			OnStore: (reason) =>
			{
				if (reason === "post")
				{
					UpdateCounter();
				}
			},
			Destroy: () =>
			{
				clearTimeout(confirmTimer);

				if (saveTimer !== null)
				{
					SaveNow();
				}
			},
		};
	}

	return { Create };
})();
